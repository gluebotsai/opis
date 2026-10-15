/**
 * Contact field matrix E2E: API persistence + optional live chat (LLM).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-contact-field-matrix.ts
 *
 * Optional live chat checks (slow, needs ai-service + LLM):
 *   RUN_CONTACT_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-contact-field-matrix.ts
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
const RUN_LLM = process.env.RUN_CONTACT_LLM_E2E === "1";

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
  const u = await db.query(
    `
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
    `,
  );
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

function person(data: any) {
  return data?.contact?.person || data?.person || {};
}

const CREATE_BODY = (t: string) => ({
  firstName: "Field",
  lastName: `Matrix${t}`,
  email: `field.matrix.${t}@example.com`,
  phone: `+9198${t.slice(0, 8).padStart(8, "0")}`,
  title: "Director",
  city: "Austin",
  country: "US",
  addressLine: "1 Test Lane",
  notes: "Matrix create",
  contactType: "lead",
  leadStatus: "new",
  leadSource: "e2e",
  tags: ["matrix", "e2e"],
  bantBudget: true,
  bantAuthority: false,
  bantNeed: true,
  bantTimeline: false,
});

type FieldCheck = { key: string; expected: unknown; read: (p: any) => unknown };

const READ_CHECKS: FieldCheck[] = [
  { key: "firstName", expected: "Field", read: (p) => p.firstName },
  { key: "lastName", expected: null, read: (p) => p.lastName?.startsWith("Matrix") },
  { key: "email", expected: null, read: (p) => p.email?.includes("field.matrix.") },
  { key: "phone", expected: null, read: (p) => Boolean(p.phone) },
  { key: "title", expected: "Director", read: (p) => p.title },
  { key: "city", expected: "Austin", read: (p) => p.city },
  { key: "country", expected: "US", read: (p) => p.country },
  { key: "addressLine", expected: "1 Test Lane", read: (p) => p.addressLine },
  { key: "notes", expected: "Matrix create", read: (p) => p.notes },
  { key: "contactType", expected: "lead", read: (p) => p.contactType },
  { key: "leadStatus", expected: "new", read: (p) => p.leadStatus },
  { key: "leadSource", expected: "e2e", read: (p) => p.leadSource },
  { key: "tags", expected: null, read: (p) => (Array.isArray(p.tags) ? p.tags.join(",") : "") },
  { key: "bantBudget", expected: true, read: (p) => p.bantBudget },
  { key: "bantAuthority", expected: false, read: (p) => p.bantAuthority },
  { key: "bantNeed", expected: true, read: (p) => p.bantNeed },
  { key: "bantTimeline", expected: false, read: (p) => p.bantTimeline },
];

const UPDATE_MATRIX: Array<{ key: string; value: unknown }> = [
  { key: "title", value: "VP Eng" },
  { key: "city", value: "Chennai" },
  { key: "country", value: "India" },
  { key: "addressLine", value: "42 Park" },
  { key: "notes", value: "Updated note" },
  { key: "phone", value: "+919811122233" },
  { key: "leadStatus", value: "qualified" },
  { key: "leadSource", value: "referral" },
  { key: "tags", value: ["hot"] },
  { key: "bantBudget", value: false },
  { key: "bantNeed", value: false },
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
    patch: (payload?.patch || payload?.contactDraftPatch) as Record<string, unknown> | undefined,
    tools: (payload?.toolProposals || []) as Array<{ name: string; args?: Record<string, unknown> }>,
    speech: String(payload?.assistantText || ""),
  };
}

async function main() {
  const t = tag();
  console.log(`Contact field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
  await login();

  const created = await http("POST", "/api/contacts", CREATE_BODY(t));
  const contactId =
    created.data?.contact?.id || created.data?.id || created.data?.data?.contact?.id;
  record(
    "api.create.full",
    (created.status === 200 || created.status === 201) && Boolean(contactId),
    contactId ? String(contactId) : created.raw.slice(0, 120),
  );
  if (!contactId) {
    summarize();
    process.exit(1);
  }

  const detail0 = await http("GET", `/api/contacts/${contactId}`);
  const p0 = person(detail0.data);
  for (const check of READ_CHECKS) {
    const got = check.read(p0);
    let ok: boolean;
    if (check.key === "lastName") ok = Boolean(got);
    else if (check.key === "email") ok = Boolean(got);
    else if (check.key === "phone") ok = Boolean(got);
    else if (check.key === "tags") ok = String(got).includes("matrix");
    else ok = got === check.expected;
    record(`api.create.read.${check.key}`, ok, `got=${JSON.stringify(got)?.slice(0, 80)}`);
  }

  let current = { ...p0 };
  for (const { key, value } of UPDATE_MATRIX) {
    const payload = {
      firstName: current.firstName || "Field",
      lastName: current.lastName || `Matrix${t}`,
      email: current.email,
      phone: current.phone ?? "",
      title: current.title ?? "",
      notes: current.notes ?? "",
      city: current.city ?? "",
      country: current.country ?? "",
      addressLine: current.addressLine ?? "",
      contactType: current.contactType || "lead",
      leadStatus: current.leadStatus || "new",
      leadSource: current.leadSource ?? "",
      tags: current.tags ?? [],
      bantBudget: current.bantBudget ?? null,
      bantAuthority: current.bantAuthority ?? null,
      bantNeed: current.bantNeed ?? null,
      bantTimeline: current.bantTimeline ?? null,
      companyId: current.companyId ?? null,
      locationId: current.locationId ?? null,
      [key]: value,
    };
    const updated = await http("PATCH", `/api/contacts/${contactId}`, payload);
    const ok = updated.status === 200;
    record(`api.update.${key}`, ok, ok ? String(value) : updated.raw.slice(0, 100));
    if (ok) {
      const detail = await http("GET", `/api/contacts/${contactId}`);
      current = person(detail.data);
      const readVal = (current as any)[key];
      const match =
        key === "tags"
          ? JSON.stringify(readVal) === JSON.stringify(value)
          : readVal === value;
      record(`api.update.read.${key}`, match, `got=${JSON.stringify(readVal)}`);
    }
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = {};
    const createCtx = {
      module: "contact",
      surface: "create",
      pathname: "/contact?view=create",
    };
    const chatFields: Array<{ field: string; value: string; user: string }> = [
      { field: "firstName", value: "Chat", user: "Chat Field" },
      { field: "lastName", value: "Only", user: "Chat Field" },
      { field: "email", value: `chat.${t}@example.com`, user: `chat.${t}@example.com` },
      { field: "title", value: "Architect", user: "title as Architect" },
      { field: "city", value: "Berlin", user: "city as Berlin" },
      { field: "country", value: "Germany", user: "country as Germany" },
    ];
    let messages: Msg[] = [{ role: "user", text: "help me create a new contact" }];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({
      role: "assistant",
      text: "What's their full name?",
    });
    for (const step of chatFields) {
      messages.push({ role: "user", text: step.user });
      const turn = await agentTurn({ messages, context: createCtx, draft });
      if (turn.patch) Object.assign(draft, turn.patch);
      const inDraft =
        step.field === "firstName" || step.field === "lastName"
          ? String(draft.firstName || "").includes("Chat") ||
            String(draft.lastName || "").length > 0
          : String(draft[step.field] || "")
              .toLowerCase()
              .includes(String(step.value).toLowerCase().slice(0, 4));
      record(
        `llm.create.patch.${step.field}`,
        Boolean(turn.ok && inDraft),
        `draft.${step.field}=${draft[step.field] ?? "(missing)"}`,
      );
      if (turn.speech) messages.push({ role: "assistant", text: turn.speech });
    }

    const updTurn = await agentTurn({
      messages: [{ role: "user", text: "city as Singapore" }],
      context: {
        module: "contact",
        surface: "detail",
        entityId: contactId,
        pathname: `/contact/${contactId}`,
      },
    });
    const updTool = updTurn.tools.find((x) => x.name === "propose_update_contact");
    record(
      "llm.update.city_tool",
      Boolean(updTool?.args?.city),
      updTool ? `city=${updTool.args?.city}` : updTurn.speech.slice(0, 100),
    );
  } else {
    console.log("\n(skip LLM chat checks — set RUN_CONTACT_LLM_E2E=1 to enable)");
  }

  await http("DELETE", `/api/contacts/${contactId}`);
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
