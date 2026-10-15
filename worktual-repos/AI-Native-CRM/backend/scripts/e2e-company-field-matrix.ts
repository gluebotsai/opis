/**
 * Company field matrix E2E: API persistence + optional live chat (LLM).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-company-field-matrix.ts
 *
 * Optional live chat checks (slow, needs ai-service + LLM):
 *   RUN_COMPANY_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-company-field-matrix.ts
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
const RUN_LLM = process.env.RUN_COMPANY_LLM_E2E === "1";

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

function company(data: any) {
  return data?.company || data?.data?.company || {};
}

const CREATE_BODY = (t: string) => {
  const slug = `matrixco${t}`.toLowerCase();
  return {
    name: `MatrixCo ${t}`,
    domain: `${slug}.com`,
    industry: "Software",
    employeeCount: 120,
    linkedinUrl: "https://linkedin.com/company/matrix-e2e",
    locationName: `HQ ${t}`,
    locationAddress: "100 Matrix Lane",
    locationType: "hq" as const,
  };
};

type FieldCheck = { key: string; expected: unknown; read: (c: any) => unknown };

const READ_CHECKS: FieldCheck[] = [
  { key: "name", expected: null, read: (c) => c.name?.includes("MatrixCo") },
  { key: "domain", expected: null, read: (c) => c.domain?.includes("matrixco") },
  { key: "industry", expected: "Software", read: (c) => c.industry },
  { key: "employeeCount", expected: 120, read: (c) => c.employeeCount },
];

const UPDATE_MATRIX: Array<{ key: string; value: unknown }> = [
  { key: "industry", value: "FinTech" },
  { key: "employeeCount", value: 500 },
  { key: "name", value: "Co Matrix Renamed" },
];

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
    patch: (payload?.patch || payload?.contactDraftPatch) as
      | Record<string, unknown>
      | undefined,
    tools: (payload?.toolProposals || []) as Array<{
      name: string;
      args?: Record<string, unknown>;
    }>,
    speech: String(payload?.assistantText || ""),
  };
}

async function main() {
  const t = tag();
  console.log(`Company field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
  await login();

  const created = await http("POST", "/api/companies", CREATE_BODY(t));
  const companyId = created.data?.id || created.data?.data?.id;
  record(
    "api.create.full",
    created.status === 200 && Boolean(companyId),
    companyId ? String(companyId) : created.raw.slice(0, 120),
  );
  if (!companyId) {
    summarize();
    process.exit(1);
  }

  const detail0 = await http("GET", `/api/companies/${companyId}`);
  const c0 = company(detail0.data);
  for (const check of READ_CHECKS) {
    const got = check.read(c0);
    const ok =
      check.expected === null ? Boolean(got) : got === check.expected;
    record(`api.create.read.${check.key}`, ok, `got=${JSON.stringify(got)?.slice(0, 80)}`);
  }

  let current = { ...c0, name: c0.name || `MatrixCo ${t}` };
  for (const { key, value } of UPDATE_MATRIX) {
    const payload = {
      name: current.name || `MatrixCo ${t}`,
      domain: current.domain ?? null,
      industry: current.industry ?? null,
      employeeCount: current.employeeCount ?? null,
      linkedinUrl: current.linkedinUrl ?? null,
      [key]: value,
    };
    const updated = await http("PATCH", `/api/companies/${companyId}`, payload);
    const ok = updated.status === 200;
    record(`api.update.${key}`, ok, ok ? String(value) : updated.raw.slice(0, 100));
    if (ok) {
      const detail = await http("GET", `/api/companies/${companyId}`);
      current = company(detail.data);
      const readVal = (current as any)[key];
      record(
        `api.update.read.${key}`,
        readVal === value,
        `got=${JSON.stringify(readVal)}`,
      );
    }
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = {};
    const createCtx = {
      module: "company",
      surface: "create",
      pathname: "/company/new",
    };
    const chatFields: Array<{ field: string; value: string; user: string }> = [
      { field: "name", value: "ChatCo", user: `ChatCo ${t}` },
      { field: "domain", value: "chatco.example.com", user: "domain chatco.example.com" },
      { field: "industry", value: "Healthcare", user: "industry Healthcare" },
      {
        field: "locationName",
        value: "Boston",
        user: "first location Boston HQ",
      },
    ];
    let messages: Msg[] = [{ role: "user", text: "help me create a new company" }];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({
      role: "assistant",
      text: "What's the company name?",
    });
    for (const step of chatFields) {
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
      messages: [{ role: "user", text: "industry as Aerospace" }],
      context: {
        module: "company",
        surface: "detail",
        entityId: companyId,
        pathname: `/company/${companyId}`,
      },
    });
    let updTool = updTurn.tools.find((x) => x.name === "propose_update_company");
    if (!updTool?.args?.industry && updTurn.ok) {
      const retry = await agentTurn({
        messages: [
          { role: "user", text: "industry as Aerospace" },
          ...(updTurn.speech
            ? [{ role: "assistant" as const, text: updTurn.speech }]
            : []),
          {
            role: "user",
            text: "Propose updating this company's industry to Aerospace.",
          },
        ],
        context: {
          module: "company",
          surface: "detail",
          entityId: companyId,
          pathname: `/company/${companyId}`,
        },
      });
      updTool = retry.tools.find((x) => x.name === "propose_update_company");
    }
    record(
      "llm.update.industry_tool",
      Boolean(updTool?.args?.industry),
      updTool
        ? `industry=${updTool.args?.industry}`
        : updTurn.speech.slice(0, 100),
    );
  } else {
    console.log("\n(skip LLM chat checks — set RUN_COMPANY_LLM_E2E=1 to enable)");
  }

  await http("DELETE", `/api/companies/${companyId}`);
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
