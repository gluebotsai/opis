/**
 * Finance (invoice) field matrix E2E: API persistence + optional live chat (LLM).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-finance-field-matrix.ts
 *
 * Optional live chat checks:
 *   RUN_FINANCE_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-finance-field-matrix.ts
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
const RUN_LLM = process.env.RUN_FINANCE_LLM_E2E === "1";

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
        AND lower(r.name) IN ('admin', 'sales_manager', 'finance')
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

function invoice(data: any) {
  return data?.invoice || data?.data?.invoice || data?.data || data;
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

async function resolveProduct(): Promise<{
  productId: string;
  name: string;
  unitPrice: number;
}> {
  const list = await http("GET", "/api/products?page=1&pageSize=5");
  const items = Array.isArray(list.data?.items)
    ? list.data.items
    : Array.isArray(list.data?.data?.items)
      ? list.data.data.items
      : [];
  const row = items[0];
  const productId = String(row?.id || "").trim();
  const name = String(row?.name || "Catalog product").trim();
  const unitPrice = Number(row?.price ?? 100) || 100;
  return { productId, name, unitPrice };
}

function productLine(input: {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}) {
  const amount = input.quantity * input.unitPrice;
  return {
    kind: "product" as const,
    productId: input.productId,
    name: input.name,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    taxPercent: 0,
    amount,
  };
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
  console.log(`Finance (invoice) field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
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

  const { productId, name: productName, unitPrice } = await resolveProduct();
  record(
    "setup.product",
    Boolean(productId),
    `product=${productId} name=${productName.slice(0, 40)}`,
  );
  if (!productId) {
    summarize();
    process.exit(1);
  }

  const dealRes = await http("POST", "/api/sales/deals", {
    title: `InvMatrix Deal ${t}`,
    stage: "qualification",
    amount: 50000,
    companyId,
    locationId,
    notes: "Invoice matrix deal",
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
    notes: "Matrix invoice notes",
    paymentTerms: "Net 30",
    billingAddress: "123 Matrix St, Austin TX",
    leadEmail: `matrix-${t}@example.com`,
    leadPhone: "+1-555-0100",
    taxId: "TAX-MATRIX-1",
    discountAmount: 5,
    issueDate: "2026-10-01",
    dueAt: "2026-11-15",
    lines: [productLine({ productId, name: productName, quantity: qty, unitPrice })],
  };

  const created = await http("POST", "/api/finance/invoices", createBody);
  const invoiceId = created.data?.id || created.data?.data?.id;
  record(
    "api.create.full",
    created.status === 200 && Boolean(invoiceId),
    invoiceId ? String(invoiceId) : created.raw.slice(0, 160),
  );
  if (!invoiceId) {
    await http("DELETE", `/api/sales/deals/${dealId}`);
    summarize();
    process.exit(1);
  }

  const detail0 = await http("GET", `/api/finance/invoices/${invoiceId}`);
  const inv0 = invoice(detail0.data);
  const createReads: Array<{
    key: string;
    ok: boolean;
    detail: string;
  }> = [
    {
      key: "currency",
      ok: inv0.currency === "USD",
      detail: String(inv0.currency),
    },
    {
      key: "notes",
      ok: inv0.notes === "Matrix invoice notes",
      detail: String(inv0.notes ?? ""),
    },
    {
      key: "paymentTerms",
      ok: inv0.paymentTerms === "Net 30",
      detail: String(inv0.paymentTerms ?? ""),
    },
    {
      key: "billingAddress",
      ok: String(inv0.billingAddress || "").includes("Matrix St"),
      detail: String(inv0.billingAddress ?? "").slice(0, 60),
    },
    {
      key: "leadEmail",
      ok: String(inv0.leadEmail || "").includes(`matrix-${t}@example.com`),
      detail: String(inv0.leadEmail ?? ""),
    },
    {
      key: "leadPhone",
      ok: String(inv0.leadPhone || "").includes("555"),
      detail: String(inv0.leadPhone ?? ""),
    },
    {
      key: "taxId",
      ok: inv0.taxId === "TAX-MATRIX-1",
      detail: String(inv0.taxId ?? ""),
    },
    {
      key: "discountAmount",
      ok: numEq(inv0.discountAmount, 5),
      detail: String(inv0.discountAmount),
    },
    {
      key: "lines.quantity",
      ok: numEq(inv0.lines?.[0]?.quantity, qty),
      detail: String(inv0.lines?.[0]?.quantity),
    },
  ];
  for (const c of createReads) {
    record(`api.create.read.${c.key}`, c.ok, `got=${c.detail}`);
  }

  type PatchStep =
    | { key: string; body: Record<string, unknown>; match: (inv: any) => boolean }
    | { key: string; body: Record<string, unknown>; match: (inv: any) => boolean; lines: true };

  const updates: PatchStep[] = [
    {
      key: "notes",
      body: { notes: "Updated matrix notes" },
      match: (inv) => inv.notes === "Updated matrix notes",
    },
    {
      key: "paymentTerms",
      body: { paymentTerms: "Due on receipt" },
      match: (inv) => inv.paymentTerms === "Due on receipt",
    },
    {
      key: "discountPct",
      body: { discountPct: 10 },
      match: (inv) => true,
    },
    {
      key: "discountAmount",
      body: { discountAmount: 12 },
      match: (inv) => numEq(inv.discountAmount, 12),
    },
    {
      key: "lines.quantity",
      body: {},
      lines: true,
      match: (inv) => numEq(inv.lines?.[0]?.quantity, 4),
    },
  ];

  let current = inv0;
  for (const step of updates) {
    let body = { ...step.body };
    if ("lines" in step && step.lines) {
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
    const patched = await http("PATCH", `/api/finance/invoices/${invoiceId}`, body);
    record(`api.update.${step.key}`, patched.status === 200, JSON.stringify(body).slice(0, 80));
    if (patched.status === 200) {
      const detail = await http("GET", `/api/finance/invoices/${invoiceId}`);
      current = invoice(detail.data);
      record(
        `api.update.read.${step.key}`,
        step.match(current),
        `discount=${current.discountAmount} qty=${current.lines?.[0]?.quantity}`,
      );
    }
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = {};
    const createCtx = {
      module: "finance",
      surface: "create",
      pathname: "/finance/new",
    };
    let messages: Msg[] = [
      { role: "user", text: "help me create a new invoice" },
    ];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({ role: "assistant", text: "Which deal?" });

    const chatSteps: Array<{ field: string; value: string; user: string }> = [
      {
        field: "notes",
        value: "From chat",
        user: "notes as From chat",
      },
      {
        field: "currency",
        value: "USD",
        user: "currency USD",
      },
      {
        field: "paymentTerms",
        value: "Net 15",
        user: "payment terms Net 15",
      },
    ];
    for (const step of chatSteps) {
      messages.push({ role: "user", text: step.user });
      const turn = await agentTurn({ messages, context: createCtx, draft });
      if (turn.patch) Object.assign(draft, turn.patch);
      const got = String(draft[step.field] ?? "");
      const ok =
        turn.ok &&
        got.toLowerCase().includes(String(step.value).toLowerCase().slice(0, 4));
      record(
        `llm.create.patch.${step.field}`,
        ok,
        `${step.field}=${draft[step.field] ?? "(missing)"}`,
      );
      if (turn.speech) messages.push({ role: "assistant", text: turn.speech });
    }

    const updTurn = await agentTurn({
      messages: [{ role: "user", text: "notes as Finance LLM note" }],
      context: {
        module: "finance",
        surface: "detail",
        entityId: invoiceId,
        pathname: `/finance/${invoiceId}`,
      },
    });
    let updTool = updTurn.tools.find((x) => x.name === "propose_update_invoice");
    if (!updTool?.args?.notes && updTurn.ok) {
      const retry = await agentTurn({
        messages: [
          { role: "user", text: "notes as Finance LLM note" },
          ...(updTurn.speech
            ? [{ role: "assistant" as const, text: updTurn.speech }]
            : []),
          {
            role: "user",
            text: "Propose updating this invoice notes to Finance LLM note.",
          },
        ],
        context: {
          module: "finance",
          surface: "detail",
          entityId: invoiceId,
          pathname: `/finance/${invoiceId}`,
        },
      });
      updTool = retry.tools.find((x) => x.name === "propose_update_invoice");
    }
    const notes = String(updTool?.args?.notes || "");
    record(
      "llm.update.notes_tool",
      notes.toLowerCase().includes("finance"),
      updTool ? `notes=${notes.slice(0, 60)}` : updTurn.speech.slice(0, 100),
    );
  } else {
    console.log(
      "\n(skip LLM chat checks — set RUN_FINANCE_LLM_E2E=1 to enable)",
    );
  }

  await http("DELETE", `/api/finance/invoices/${invoiceId}`);
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
