/**
 * Deal (sales) field matrix E2E: API persistence + optional live chat (LLM).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-deal-field-matrix.ts
 *
 * Optional live chat checks:
 *   RUN_DEAL_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-deal-field-matrix.ts
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
const RUN_LLM = process.env.RUN_DEAL_LLM_E2E === "1";

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
        AND lower(r.name) IN ('admin', 'sales_manager')
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

function deal(data: any) {
  return data?.deal || data?.data?.deal || {};
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
  const payload = r.data?.data && typeof r.data.data === "object" ? r.data.data : r.data;
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
  console.log(`Deal field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
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

  const createBody = {
    title: `DealMatrix ${t}`,
    stage: "qualification",
    amount: 100000,
    companyId,
    locationId,
    notes: "Matrix create",
  };
  const created = await http("POST", "/api/sales/deals", createBody);
  const dealId = created.data?.id || created.data?.data?.id;
  record(
    "api.create.full",
    created.status === 200 && Boolean(dealId),
    dealId ? String(dealId) : created.raw.slice(0, 120),
  );
  if (!dealId) {
    summarize();
    process.exit(1);
  }

  const detail0 = await http("GET", `/api/sales/deals/${dealId}`);
  const d0 = deal(detail0.data);
  const readChecks: Array<{ key: string; ok: boolean; detail: string }> = [
    {
      key: "title",
      ok: String(d0.title || "").includes("DealMatrix"),
      detail: String(d0.title),
    },
    {
      key: "stage",
      ok: d0.stage === "qualification",
      detail: String(d0.stage),
    },
    {
      key: "amount",
      ok: Number(d0.amount) === 100000,
      detail: String(d0.amount),
    },
    {
      key: "notes",
      ok: d0.notes === "Matrix create",
      detail: String(d0.notes ?? ""),
    },
  ];
  for (const c of readChecks) {
    record(`api.create.read.${c.key}`, c.ok, `got=${c.detail.slice(0, 80)}`);
  }

  let current = { ...d0, companyId, locationId };
  const updates: Array<{ key: string; value: unknown; via?: "stage" }> = [
    { key: "title", value: `Deal Matrix Renamed ${t}` },
    { key: "amount", value: 250000 },
    { key: "notes", value: "Updated matrix note" },
    { key: "stage", value: "discover", via: "stage" },
  ];

  for (const { key, value, via } of updates) {
    if (via === "stage") {
      const staged = await http("POST", `/api/sales/deals/${dealId}/stage`, {
        stage: value,
      });
      record(`api.update.${key}`, staged.status === 200, String(value));
      if (staged.status === 200) {
        const detail = await http("GET", `/api/sales/deals/${dealId}`);
        current = deal(detail.data);
        record(
          `api.update.read.${key}`,
          current.stage === value,
          `got=${current.stage}`,
        );
      }
      continue;
    }
    const payload = {
      title: current.title,
      stage: current.stage,
      amount: current.amount ?? null,
      companyId: current.companyId || companyId,
      locationId: current.locationId || locationId,
      notes: current.notes ?? null,
      [key]: value,
    };
    const updated = await http("PATCH", `/api/sales/deals/${dealId}`, payload);
    record(`api.update.${key}`, updated.status === 200, String(value));
    if (updated.status === 200) {
      const detail = await http("GET", `/api/sales/deals/${dealId}`);
      current = deal(detail.data);
      const readVal = (current as any)[key];
      const match =
        key === "amount" ? Number(readVal) === Number(value) : readVal === value;
      record(`api.update.read.${key}`, match, `got=${JSON.stringify(readVal)}`);
    }
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = {};
    const createCtx = {
      module: "sales",
      surface: "create",
      pathname: "/sales/new",
    };
    const chatSteps: Array<{ field: string; value: string; user: string }> = [
      { field: "title", value: "ChatDeal", user: `ChatDeal ${t}` },
      { field: "amount", value: "50000", user: "amount 50000" },
      { field: "companyName", value: "Acme", user: "company Acme" },
    ];
    let messages: Msg[] = [{ role: "user", text: "help me create a new deal" }];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({ role: "assistant", text: "What's the deal title?" });
    for (const step of chatSteps) {
      messages.push({ role: "user", text: step.user });
      const turn = await agentTurn({ messages, context: createCtx, draft });
      if (turn.patch) Object.assign(draft, turn.patch);
      const inDraft = String(draft[step.field] || "")
        .toLowerCase()
        .includes(String(step.value).toLowerCase().slice(0, 4));
      record(
        `llm.create.patch.${step.field}`,
        Boolean(turn.ok && inDraft),
        `${step.field}=${draft[step.field] ?? "(missing)"}`,
      );
      if (turn.speech) messages.push({ role: "assistant", text: turn.speech });
    }

    const updTurn = await agentTurn({
      messages: [{ role: "user", text: "amount as 88000" }],
      context: {
        module: "sales",
        surface: "detail",
        entityId: dealId,
        pathname: `/sales/${dealId}`,
      },
    });
    let updTool = updTurn.tools.find((x) => x.name === "propose_update_deal");
    if (!updTool?.args?.amount && updTurn.ok) {
      const retry = await agentTurn({
        messages: [
          { role: "user", text: "amount as 88000" },
          ...(updTurn.speech
            ? [{ role: "assistant" as const, text: updTurn.speech }]
            : []),
          {
            role: "user",
            text: "Propose updating this deal's amount to 88000.",
          },
        ],
        context: {
          module: "sales",
          surface: "detail",
          entityId: dealId,
          pathname: `/sales/${dealId}`,
        },
      });
      updTool = retry.tools.find((x) => x.name === "propose_update_deal");
    }
    record(
      "llm.update.amount_tool",
      Boolean(updTool?.args?.amount),
      updTool ? `amount=${updTool.args?.amount}` : updTurn.speech.slice(0, 100),
    );
  } else {
    console.log("\n(skip LLM chat checks — set RUN_DEAL_LLM_E2E=1 to enable)");
  }

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
