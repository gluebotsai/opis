/**
 * Activities field matrix E2E: API persistence + optional live chat (LLM).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-activity-field-matrix.ts
 *
 * Optional live chat checks:
 *   RUN_ACTIVITY_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-activity-field-matrix.ts
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
const RUN_LLM = process.env.RUN_ACTIVITY_LLM_E2E === "1";

type Msg = { role: "assistant" | "user"; text: string };

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const createdActivityIds: Array<{ contactId: string; activityId: string }> = [];

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
    signal: AbortSignal.timeout(90_000),
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

function contactActivities(data: any): any[] {
  if (Array.isArray(data?.activities)) return data.activities;
  if (Array.isArray(data?.data?.activities)) return data.data.activities;
  return [];
}

async function resolveContactAndAssignee(): Promise<{
  contactId: string;
  assigneeUserId: string;
}> {
  const list = await http("GET", "/api/contacts?page=1&pageSize=5");
  const items = Array.isArray(list.data?.items)
    ? list.data.items
    : Array.isArray(list.data?.data?.items)
      ? list.data.data.items
      : [];
  const contactId = String(items[0]?.id || "").trim();
  if (!contactId) return { contactId: "", assigneeUserId: "" };
  const detail = await http("GET", `/api/contacts/${contactId}`);
  const payload = detail.data?.data ?? detail.data ?? {};
  const assigneeUserId = String(
    payload.currentUserId || payload.contact?.crm?.ownerUserId || "",
  ).trim();
  return { contactId, assigneeUserId };
}

async function createAndRead(
  contactId: string,
  label: string,
  body: Record<string, unknown>,
  read: (row: any) => boolean,
) {
  const created = await http("POST", `/api/contacts/${contactId}/activities`, body);
  const activityId = created.data?.id || created.data?.data?.id;
  const okCreate = created.status === 200 && Boolean(activityId);
  record(`api.create.${label}`, okCreate, activityId ? String(activityId) : created.raw.slice(0, 120));
  if (!okCreate || !activityId) return;
  createdActivityIds.push({ contactId, activityId: String(activityId) });
  const detail = await http("GET", `/api/contacts/${contactId}`);
  const payload = detail.data?.data ?? detail.data ?? detail;
  const row = contactActivities(payload).find((a) => a.id === activityId);
  record(
    `api.create.read.${label}`,
    Boolean(row && read(row)),
    row
      ? `type=${row.type} subject=${String(row.subject).slice(0, 40)}`
      : "missing on contact",
  );
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
  console.log(`Activity field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
  await login();

  const { contactId, assigneeUserId } = await resolveContactAndAssignee();
  record(
    "setup.contact",
    Boolean(contactId && assigneeUserId),
    `contact=${contactId} assignee=${assigneeUserId}`,
  );
  if (!contactId || !assigneeUserId) {
    summarize();
    process.exit(1);
  }

  const dueAt = "2026-12-15T10:00:00.000Z";

  await createAndRead(
    contactId,
    "call",
    {
      type: "call",
      subject: `Matrix call ${t}`,
      body: "Called about renewal",
    },
    (r) => r.type === "call" && String(r.subject).includes("Matrix call"),
  );

  await createAndRead(
    contactId,
    "meeting",
    {
      type: "meeting",
      subject: `Matrix meeting ${t}`,
      body: "Agenda: demo",
      dueAt,
    },
    (r) =>
      r.type === "meeting" &&
      String(r.subject).includes("Matrix meeting") &&
      Boolean(r.dueAt),
  );

  await createAndRead(
    contactId,
    "email",
    {
      type: "email",
      subject: `Matrix email ${t}`,
      body: "Follow-up thread",
    },
    (r) => r.type === "email" && String(r.subject).includes("Matrix email"),
  );

  await createAndRead(
    contactId,
    "sms",
    {
      type: "sms",
      subject: `Matrix sms ${t}`,
      body: "Quick ping",
    },
    (r) => r.type === "sms" && String(r.subject).includes("Matrix sms"),
  );

  await createAndRead(
    contactId,
    "note",
    {
      type: "note",
      subject: `Matrix note ${t}`,
      body: "Note body text",
    },
    (r) => r.type === "note" && String(r.body || r.subject).includes("Note"),
  );

  const taskCreate = await http("POST", `/api/contacts/${contactId}/activities`, {
    type: "task",
    subject: `Matrix task ${t}`,
    body: "Task description",
    dueAt,
    assigneeUserId,
  });
  const taskId = taskCreate.data?.id || taskCreate.data?.data?.id;
  record(
    "api.create.task",
    taskCreate.status === 200 && Boolean(taskId),
    taskId ? String(taskId) : taskCreate.raw.slice(0, 120),
  );
  if (taskId) {
    createdActivityIds.push({ contactId, activityId: String(taskId) });
    const detail = await http("GET", `/api/contacts/${contactId}`);
    const payload = detail.data?.data ?? detail.data ?? detail;
    const taskRow = contactActivities(payload).find((a) => a.id === taskId);
    record(
      "api.create.read.task",
      Boolean(
        taskRow?.type === "task" &&
          taskRow.taskStatus === "open" &&
          String(taskRow.body).includes("Task description"),
      ),
      taskRow ? `status=${taskRow.taskStatus}` : "missing",
    );

    const statusPatch = await http(
      "PATCH",
      `/api/contacts/activities/${taskId}/status`,
      { taskStatus: "completed" },
    );
    record(
      "api.update.taskStatus",
      statusPatch.status === 200,
      "completed",
    );
    const after = await http("GET", `/api/contacts/${contactId}`);
    const afterPayload = after.data?.data ?? after.data ?? after;
    const done = contactActivities(afterPayload).find((a) => a.id === taskId);
    record(
      "api.update.read.taskStatus",
      done?.taskStatus === "completed",
      `got=${done?.taskStatus ?? "(missing)"}`,
    );
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = { contactId };
    const createCtx = {
      module: "activities",
      surface: "create",
      pathname: "/activities/log",
    };
    let messages: Msg[] = [
      { role: "user", text: "help me log a new activity" },
    ];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({ role: "assistant", text: "What type of activity?" });

    const steps: Array<{ field: string; value: string; user: string }> = [
      { field: "type", value: "call", user: "type call" },
      { field: "subject", value: "Chat", user: `subject Chat activity ${t}` },
      { field: "body", value: "From", user: "body From chat matrix" },
    ];
    for (const step of steps) {
      messages.push({ role: "user", text: step.user });
      const turn = await agentTurn({ messages, context: createCtx, draft });
      if (turn.patch) Object.assign(draft, turn.patch);
      const got = String(draft[step.field] ?? "").toLowerCase();
      const ok =
        turn.ok &&
        got.includes(String(step.value).toLowerCase().slice(0, 3));
      record(
        `llm.create.patch.${step.field}`,
        ok,
        `${step.field}=${draft[step.field] ?? "(missing)"}`,
      );
      if (turn.speech) messages.push({ role: "assistant", text: turn.speech });
    }
  } else {
    console.log(
      "\n(skip LLM chat checks — set RUN_ACTIVITY_LLM_E2E=1 to enable)",
    );
  }

  for (const { contactId: cid, activityId } of createdActivityIds) {
    await http("DELETE", `/api/contacts/${cid}/activities/${activityId}`);
  }

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
