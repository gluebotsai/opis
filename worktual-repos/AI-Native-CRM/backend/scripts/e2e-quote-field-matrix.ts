/**
 * Quotes field matrix E2E: API persistence + optional live chat (LLM).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-quote-field-matrix.ts
 *
 * Optional live chat checks:
 *   RUN_QUOTE_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-quote-field-matrix.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";
const RUN_LLM = process.env.RUN_QUOTE_LLM_E2E === "1";

type Msg = { role: "assistant" | "user"; text: string };

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function tag() {
  return randomBytes(3).toString("hex");
}

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function storeCookies(res: Response) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const part = line.split(";")[0] || "";
    const i = part.indexOf("=");
    if (i > 0) cookieJar.set(part.slice(0, i), part.slice(i + 1));
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function http(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any; raw: string }> {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  storeCookies(res);
  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, data, raw };
}

async function login() {
  const loginRes = await http("POST", "/api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  if (loginRes.status === 200) {
    record("login", true, EMAIL);
    return;
  }
  const db = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query(`
      SELECT u.id::text AS id
      FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a
        ON a.user_id = u.id AND a.product_id = 'crm'
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.status = 'active'
        AND u.organization_id = 1000
        AND lower(r.name) IN ('admin', 'sales_manager', 'sales_rep')
      ORDER BY u.id
      LIMIT 1
    `);
  await db.end();
  const row = u.rows[0] as { id?: string } | undefined;
  if (!row?.id) {
    record("login", false, loginRes.raw.slice(0, 120));
    process.exit(1);
  }
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
  const me = await http("GET", "/api/auth/me");
  record("login", me.status === 200, `session user=${row.id}`);
  if (me.status !== 200) process.exit(1);
}

function quote(data: any) {
  return data?.quote || data?.data?.quote || data?.data || data;
}

function numEq(a: unknown, b: unknown) {
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

async function resolveCompanyLocation(): Promise<{
  companyId: string;
  locationId: string;
}> {
  const companies = await http("GET", "/api/companies?page=1");
  const items = Array.isArray(companies.data?.items)
    ? companies.data.items
    : Array.isArray(companies.data?.data?.items)
      ? companies.data.data.items
      : [];
  const companyId = String(items[0]?.id || "").trim();
  if (!companyId) return { companyId: "", locationId: "" };
  const locs = await http("GET", `/api/companies/${companyId}/locations`);
  const locList = Array.isArray(locs.data?.locations)
    ? locs.data.locations
    : Array.isArray(locs.data?.data?.locations)
      ? locs.data.data.locations
      : [];
  const locationId = String(locList[0]?.id || "").trim();
  return { companyId, locationId };
}

async function resolveQuoteLineProduct(): Promise<{
  productId: string;
  name: string;
  unitPrice: number;
}> {
  const productsRes = await http("GET", "/api/products?page=1&pageSize=5");
  const products = Array.isArray(productsRes.data?.items)
    ? productsRes.data.items
    : Array.isArray(productsRes.data?.data?.items)
      ? productsRes.data.data.items
      : [];
  const row = products[0];
  const productId = String(row?.id || "").trim();
  const name = String(row?.name || "Quote product").trim();
  const unitPrice = Number(row?.price ?? row?.listPrice ?? 100) || 100;
  return { productId, name, unitPrice };
}

async function agentTurn(input: {
  messages: Msg[];
  context: Record<string, unknown>;
  draft?: Record<string, unknown>;
}) {
  const r = await http("POST", "/api/coworker/agent-turn", {
    messages: input.messages,
    context: { ...input.context, draft: input.draft ?? null },
  });
  const payload =
    r.data?.data && typeof r.data.data === "object" ? r.data.data : r.data;
  return {
    ok: r.status === 200 && payload?.ok !== false,
    patch: payload?.patch as Record<string, unknown> | undefined,
    tools: (payload?.toolProposals || []) as Array<{
      name: string;
      args?: Record<string, unknown>;
    }>,
    speech: String(payload?.assistantText || ""),
  };
}

async function main() {
  const t = tag();
  console.log(`Quote field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
  await login();

  const { companyId, locationId } = await resolveCompanyLocation();
  record(
    "setup.company_location",
    Boolean(companyId && locationId),
    `company=${companyId} location=${locationId}`,
  );
  if (!companyId || !locationId) {
    summarize();
    process.exit(1);
  }

  const { productId, name: productName, unitPrice } =
    await resolveQuoteLineProduct();
  record(
    "setup.quote_product",
    Boolean(productId),
    `product=${productId} name=${productName.slice(0, 36)}`,
  );
  if (!productId) {
    summarize();
    process.exit(1);
  }

  const dealRes = await http("POST", "/api/sales/deals", {
    title: `QuoteMatrix Deal ${t}`,
    stage: "qualification",
    amount: 40000,
    companyId,
    locationId,
  });
  const dealId = dealRes.data?.id || dealRes.data?.data?.id;
  record(
    "setup.deal",
    dealRes.status === 200 && Boolean(dealId),
    dealId ? String(dealId) : dealRes.raw.slice(0, 120),
  );
  if (!dealId) {
    summarize();
    process.exit(1);
  }

  const qty = 2;
  const createBody = {
    dealId,
    currency: "USD",
    notes: "Matrix quote notes",
    discountPct: 5,
    fromTemplate: false,
    lines: [
      {
        productId,
        name: productName,
        quantity: qty,
        unitPrice,
      },
    ],
  };

  let created = await http("POST", "/api/sales/quotes", createBody);
  for (let attempt = 0; attempt < 4 && created.status !== 200; attempt += 1) {
    if (!String(created.raw).includes("Unique constraint")) break;
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    created = await http("POST", "/api/sales/quotes", createBody);
  }
  const quoteId = created.data?.id || created.data?.data?.id;
  record(
    "api.create.full",
    created.status === 200 && Boolean(quoteId),
    quoteId ? String(quoteId) : created.raw.slice(0, 400),
  );
  if (!quoteId) {
    await http("DELETE", `/api/sales/deals/${dealId}`);
    summarize();
    process.exit(1);
  }

  const detail0 = await http("GET", `/api/sales/quotes/${quoteId}`);
  const q0 = quote(detail0.data);
  const createReads = [
    { key: "currency", ok: q0.currency === "USD", detail: String(q0.currency) },
    {
      key: "notes",
      ok: q0.notes === "Matrix quote notes",
      detail: String(q0.notes ?? ""),
    },
    {
      key: "discountPct",
      ok: numEq(q0.discountPct, 5),
      detail: String(q0.discountPct),
    },
    {
      key: "lines.quantity",
      ok: numEq(q0.lines?.[0]?.quantity, qty),
      detail: String(q0.lines?.[0]?.quantity),
    },
    {
      key: "dealId",
      ok: q0.dealId === dealId,
      detail: String(q0.dealId),
    },
  ];
  for (const c of createReads) {
    record(`api.create.read.${c.key}`, c.ok, `got=${c.detail}`);
  }

  let current = q0;
  const updates: Array<{
    key: string;
    body: Record<string, unknown>;
    match: (q: any) => boolean;
    lines?: boolean;
  }> = [
    {
      key: "notes",
      body: { notes: "Updated quote notes" },
      match: (q) => q.notes === "Updated quote notes",
    },
    {
      key: "customerName",
      body: { customerName: "Matrix Customer" },
      match: (q) => q.customerName === "Matrix Customer",
    },
    {
      key: "companyName",
      body: { companyName: "Matrix Co" },
      match: (q) => q.companyName === "Matrix Co",
    },
    {
      key: "vendorName",
      body: { vendorName: "Matrix Vendor LLC" },
      match: (q) => q.vendorName === "Matrix Vendor LLC",
    },
    {
      key: "discountPct",
      body: { discountPct: 8 },
      match: (q) => numEq(q.discountPct, 8),
    },
    {
      key: "lines.quantity",
      body: {},
      lines: true,
      match: (q) => numEq(q.lines?.[0]?.quantity, 4),
    },
  ];

  for (const step of updates) {
    let body = { ...step.body };
    if (step.lines) {
      const line0 = current.lines?.[0];
      body = {
        lines: [
          {
            productId,
            name: line0?.name || productName,
            quantity: 4,
            unitPrice: Number(line0?.unitPrice ?? unitPrice),
          },
        ],
      };
    }
    const patched = await http("PATCH", `/api/sales/quotes/${quoteId}`, body);
    record(`api.update.${step.key}`, patched.status === 200, JSON.stringify(body).slice(0, 72));
    if (patched.status === 200) {
      const detail = await http("GET", `/api/sales/quotes/${quoteId}`);
      current = quote(detail.data);
      record(
        `api.update.read.${step.key}`,
        step.match(current),
        `discount=${current.discountPct} qty=${current.lines?.[0]?.quantity}`,
      );
    }
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = {};
    const createCtx = {
      module: "quotes",
      surface: "create",
      pathname: "/sales/quotes/new",
    };
    let messages: Msg[] = [{ role: "user", text: "help me create a new quote" }];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({ role: "assistant", text: "Which deal?" });

    const chatSteps: Array<{ field: string; value: string; user: string }> = [
      { field: "notes", value: "From chat", user: "notes as From chat" },
      { field: "quantity", value: "3", user: "quantity 3" },
      { field: "discountPct", value: "10", user: "discount 10 percent" },
    ];
    for (const step of chatSteps) {
      messages.push({ role: "user", text: step.user });
      const turn = await agentTurn({ messages, context: createCtx, draft });
      if (turn.patch) Object.assign(draft, turn.patch);
      const got = String(draft[step.field] ?? "");
      const ok =
        turn.ok &&
        got.toLowerCase().includes(String(step.value).toLowerCase().slice(0, 3));
      record(
        `llm.create.patch.${step.field}`,
        ok,
        `${step.field}=${draft[step.field] ?? "(missing)"}`,
      );
      if (turn.speech) messages.push({ role: "assistant", text: turn.speech });
    }

    const updTurn = await agentTurn({
      messages: [{ role: "user", text: "notes as Quote LLM note" }],
      context: {
        module: "quotes",
        surface: "detail",
        entityId: quoteId,
        pathname: `/sales/quotes/${quoteId}`,
      },
    });
    let updTool = updTurn.tools.find((x) => x.name === "propose_update_quote");
    if (!updTool?.args?.notes && updTurn.ok) {
      const retry = await agentTurn({
        messages: [
          { role: "user", text: "notes as Quote LLM note" },
          ...(updTurn.speech
            ? [{ role: "assistant" as const, text: updTurn.speech }]
            : []),
          {
            role: "user",
            text: "Propose updating this quote notes to Quote LLM note.",
          },
        ],
        context: {
          module: "quotes",
          surface: "detail",
          entityId: quoteId,
          pathname: `/sales/quotes/${quoteId}`,
        },
      });
      updTool = retry.tools.find((x) => x.name === "propose_update_quote");
    }
    const notes = String(updTool?.args?.notes || "");
    record(
      "llm.update.notes_tool",
      notes.toLowerCase().includes("quote"),
      updTool ? `notes=${notes.slice(0, 60)}` : updTurn.speech.slice(0, 100),
    );
  } else {
    console.log("\n(skip LLM chat checks — set RUN_QUOTE_LLM_E2E=1 to enable)");
  }

  await http("DELETE", `/api/sales/quotes/${quoteId}`);
  await http("DELETE", `/api/sales/deals/${dealId}`);
  summarize();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
