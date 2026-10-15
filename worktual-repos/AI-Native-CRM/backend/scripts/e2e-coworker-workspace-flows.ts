/**
 * Live E2E: coworker native turns across modules + workspace dynamics.
 *
 * Run: npx tsx --env-file=../.env scripts/e2e-coworker-workspace-flows.ts
 *
 * Mirrors AgentModuleShell: agent-turn → merge patch / sessionMemory / tools /
 * uiRefresh. Does not persist form-owned creates except where confirmTool is
 * a navigation or draft patch.
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
const TIMEOUT_MS = Number(process.env.E2E_AGENT_TIMEOUT_MS || 180_000);

type Msg = { role: "assistant" | "user"; text: string };
type Tool = { id?: string; name: string; label?: string; args?: Record<string, unknown>; risk?: string };
type Turn = {
  ok: boolean;
  assistantText?: string;
  error?: string;
  toolProposals?: Tool[];
  patch?: Record<string, unknown>;
  contactDraftPatch?: Record<string, unknown>;
  sessionMemory?: Record<string, unknown>;
  sessionMemoryPatch?: Record<string, unknown>;
  uiRefresh?: { modules?: string[]; entityIds?: string[]; reason?: string; href?: string };
  analytics?: { plan?: unknown; findings?: unknown; chart?: unknown; audit?: unknown };
  agent?: string;
};

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const tag = randomBytes(3).toString("hex");

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function storeCookies(res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const part = line.split(";")[0] || "";
    const i = part.indexOf("=");
    if (i > 0) cookieJar.set(part.slice(0, i), part.slice(i + 1));
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function clip(v: unknown, n = 160): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function mergePatch(
  draft: Record<string, unknown>,
  turn: Turn,
): Record<string, unknown> {
  const patch = turn.patch || turn.contactDraftPatch;
  if (patch && typeof patch === "object") return { ...draft, ...patch };
  return draft;
}

function mergeMemory(
  current: Record<string, unknown>,
  patch?: Record<string, unknown> | null,
  full?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (full && typeof full === "object") return { ...full };
  if (!patch) return current;
  if (patch.clear) return {};
  const next: Record<string, unknown> = {
    ...current,
    ...patch,
    slots: {
      ...((current.slots as Record<string, unknown>) || {}),
      ...((patch.slots as Record<string, unknown>) || {}),
    },
    lastEntities: {
      ...((current.lastEntities as Record<string, unknown>) || {}),
      ...((patch.lastEntities as Record<string, unknown>) || {}),
    },
  };
  return next;
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

async function agentTurn(input: {
  messages: Msg[];
  context: Record<string, unknown>;
  sessionMemory?: Record<string, unknown>;
  confirmTool?: { name: string; args?: Record<string, unknown> } | null;
}): Promise<Turn> {
  const r = await http("POST", "/api/coworker/agent-turn", input);
  const payload =
    r.data?.data && typeof r.data.data === "object" ? r.data.data : r.data;
  if (r.status !== 200) {
    return { ok: false, error: `HTTP ${r.status}: ${r.raw.slice(0, 220)}` };
  }
  if (payload?.ok === false) {
    return { ok: false, error: String(payload.error || payload.assistantText || "agent failed") };
  }
  return {
    ok: true,
    assistantText: payload?.assistantText,
    toolProposals: payload?.toolProposals,
    patch: payload?.patch,
    contactDraftPatch: payload?.contactDraftPatch,
    sessionMemory: payload?.sessionMemory,
    sessionMemoryPatch: payload?.sessionMemoryPatch,
    uiRefresh: payload?.uiRefresh,
    analytics: payload?.analytics,
    agent: payload?.agent,
    error: payload?.error,
  };
}

function workspaceSignal(turn: Turn): string[] {
  const names = (turn.toolProposals || []).map((t) => t.name);
  const keys = Object.keys(turn.patch || turn.contactDraftPatch || {});
  const mem = turn.sessionMemoryPatch || turn.sessionMemory || {};
  const bits = [
    turn.assistantText ? "speech" : "",
    names.length ? `tools=${names.join(",")}` : "",
    keys.length ? `patch=${keys.join(",")}` : "",
    mem.activeAgent ? `agent=${String(mem.activeAgent)}` : "",
    turn.uiRefresh ? `uiRefresh=${JSON.stringify(turn.uiRefresh)}` : "",
    turn.analytics ? "analytics" : "",
  ].filter(Boolean);
  return bits;
}

function failedSpeech(turn: Turn): boolean {
  const blob = `${turn.assistantText || ""} ${turn.error || ""}`;
  return /something went wrong|llm returned no usable|router returned invalid|no usable response/i.test(
    blob,
  );
}

async function guidedCreate(opts: {
  name: string;
  module: string;
  pathname: string;
  userText: string;
  expectPatchKeys: string[];
  sessionMemory: Record<string, unknown>;
  followUpText?: string;
}): Promise<{ draft: Record<string, unknown>; memory: Record<string, unknown>; turn: Turn }> {
  let draft: Record<string, unknown> = {};
  const messages: Msg[] = [{ role: "user", text: opts.userText }];
  let turn = await agentTurn({
    messages,
    context: {
      module: opts.module,
      surface: "create",
      pathname: opts.pathname,
      draft,
    },
    sessionMemory: opts.sessionMemory,
  });
  draft = mergePatch(draft, turn);
  let memory = mergeMemory(opts.sessionMemory, turn.sessionMemoryPatch, turn.sessionMemory);
  const hasValue = (k: string) => {
    const v = draft[k];
    return v != null && String(v).trim() !== "";
  };
  let hasPatch = opts.expectPatchKeys.some(hasValue);
  const tools = turn.toolProposals || [];
  const isWorkspaceTool = (t: Tool) =>
    ["set_workspace", "patch_contact_draft", "patch_company_draft", "patch_deal_draft", "navigate"].includes(t.name) ||
    t.name.startsWith("patch_");
  let workspaceTool = tools.some(isWorkspaceTool);

  if (turn.ok && !failedSpeech(turn) && !hasPatch && !workspaceTool && (turn.assistantText || "").length > 0) {
    const follow = await agentTurn({
      messages: [
        ...messages,
        { role: "assistant", text: turn.assistantText || "" },
        {
          role: "user",
          text:
            opts.followUpText ||
            `${opts.userText}. Apply those values to the draft form now.`,
        },
      ],
      context: {
        module: opts.module,
        surface: "create",
        pathname: opts.pathname,
        draft,
      },
      sessionMemory: memory,
    });
    draft = mergePatch(draft, follow);
    memory = mergeMemory(memory, follow.sessionMemoryPatch, follow.sessionMemory);
    turn = follow;
    hasPatch = opts.expectPatchKeys.some(hasValue);
    workspaceTool = (turn.toolProposals || []).some(isWorkspaceTool);
  }

  const ok = Boolean(
    turn.ok &&
      !failedSpeech(turn) &&
      (hasPatch || workspaceTool),
  );
  record(
    opts.name,
    ok,
    `${workspaceSignal(turn).join(" | ")} speech=${clip(turn.assistantText || turn.error || "")} draft=${clip(draft)}`,
  );
  return { draft, memory, turn };
}

async function moduleAsk(opts: {
  name: string;
  module: string;
  surface: string;
  pathname: string;
  entityId?: string;
  text: string;
  sessionMemory: Record<string, unknown>;
  expect?: (turn: Turn) => boolean;
}): Promise<{ memory: Record<string, unknown>; turn: Turn }> {
  const turn = await agentTurn({
    messages: [{ role: "user", text: opts.text }],
    context: {
      module: opts.module,
      surface: opts.surface,
      pathname: opts.pathname,
      entityId: opts.entityId || null,
      draft: null,
    },
    sessionMemory: opts.sessionMemory,
  });
  const memory = mergeMemory(opts.sessionMemory, turn.sessionMemoryPatch, turn.sessionMemory);
  const ok = opts.expect
    ? Boolean(turn.ok && !failedSpeech(turn) && opts.expect(turn))
    : Boolean(
        turn.ok &&
          !failedSpeech(turn) &&
          ((turn.assistantText || "").length > 8 || (turn.toolProposals || []).length),
      );
  record(opts.name, ok, `${workspaceSignal(turn).join(" | ")} speech=${clip(turn.assistantText || turn.error || "")}`);
  return { memory, turn };
}

async function main() {
  console.log(`Coworker workspace E2E against ${API} as ${EMAIL} (tag=${tag})\n`);

  const login = await http("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status === 200) {
    record("login", true, EMAIL);
  } else {
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
      record("login", false, `${login.status} ${login.raw.slice(0, 160)}`);
      process.exit(1);
    }
    cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
    const me = await http("GET", "/api/auth/me");
    if (me.status !== 200) {
      record(
        "login",
        false,
        `minted session rejected ${me.status} ${me.raw.slice(0, 160)}`,
      );
      process.exit(1);
    }
    record("login", true, `minted session user=${row.id}`);
  }

  let memory: Record<string, unknown> = { conversationId: `e2e-ws-${tag}` };

  const contactCreate = await guidedCreate({
    name: "contact.create_workspace",
    module: "contact",
    pathname: "/contact/new",
    userText: `Create a contact named Workspace ${tag} with email workspace.${tag}@example.com`,
    expectPatchKeys: ["firstName", "lastName", "email"],
    sessionMemory: memory,
  });
  memory = contactCreate.memory;
  record(
    "contact.native_active_agent",
    String(memory.activeAgent || "").includes("contact") ||
      String(memory.activeDomain || "") === "contact",
    `activeAgent=${memory.activeAgent || "(none)"} domain=${memory.activeDomain || "(none)"}`,
  );

  const companyCreate = await guidedCreate({
    name: "company.create_workspace",
    module: "company",
    pathname: "/company/new",
    userText: `Create a company called Workspace Co ${tag} in Bengaluru`,
    expectPatchKeys: ["name", "locationName", "city"],
    followUpText: `Put Workspace Co ${tag} in Bengaluru on the company form now.`,
    sessionMemory: memory,
  });
  memory = companyCreate.memory;

  const dealCreate = await guidedCreate({
    name: "deal.create_workspace",
    module: "sales",
    pathname: "/sales/new",
    userText: `Create a deal titled Workspace Pipeline ${tag} for 25000 USD`,
    expectPatchKeys: ["title", "amount"],
    sessionMemory: memory,
  });
  memory = dealCreate.memory;

  const productCreate = await guidedCreate({
    name: "product.create_workspace",
    module: "product",
    pathname: "/product/new",
    userText: `Add a product named Workspace Seat ${tag}`,
    expectPatchKeys: ["name"],
    sessionMemory: memory,
  });
  memory = productCreate.memory;

  const activityCreate = await guidedCreate({
    name: "activity.create_workspace",
    module: "activities",
    pathname: "/activities/log",
    userText: `Log a follow-up call tomorrow about Workspace ${tag}`,
    expectPatchKeys: ["subject", "type", "dueAt"],
    sessionMemory: memory,
  });
  memory = activityCreate.memory;

  const contactList = await moduleAsk({
    name: "contact.list_flow",
    module: "contact",
    surface: "list",
    pathname: "/contact",
    text: "Show me recent leads",
    sessionMemory: memory,
  });
  memory = contactList.memory;

  const companyList = await moduleAsk({
    name: "company.list_flow",
    module: "company",
    surface: "list",
    pathname: "/company",
    text: "List companies",
    sessionMemory: memory,
  });
  memory = companyList.memory;

  const salesList = await moduleAsk({
    name: "sales.list_flow",
    module: "sales",
    surface: "list",
    pathname: "/sales",
    text: "What deals are open?",
    sessionMemory: memory,
  });
  memory = salesList.memory;

  const productList = await moduleAsk({
    name: "product.list_flow",
    module: "product",
    surface: "list",
    pathname: "/product",
    text: "Show catalog products",
    sessionMemory: memory,
    expect: (turn) => {
      const speech = turn.assistantText || "";
      return (
        !/don'?t have (access|permission)|do not have (access|permission)|lacks? permission/i.test(
          speech,
        ) &&
        (speech.length > 8 || (turn.toolProposals || []).length > 0)
      );
    },
  });
  memory = productList.memory;

  const reports = await moduleAsk({
    name: "reports.analytics_no_sql",
    module: "reports",
    surface: "list",
    pathname: "/reports",
    text: "How many deals are there by stage?",
    sessionMemory: memory,
    expect: (turn) => {
      const blob = JSON.stringify(turn);
      const hasSql = /"sql"\s*:/.test(blob) || /\bSELECT\b.+\bFROM\b/i.test(blob);
      const fallback = /could not complete that report/i.test(turn.assistantText || "");
      return Boolean(
        turn.ok &&
          !hasSql &&
          !fallback &&
          (turn.analytics || (turn.assistantText || "").length > 8),
      );
    },
  });
  memory = reports.memory;

  const cross = await moduleAsk({
    name: "cross_module.navigate_companies",
    module: "contact",
    surface: "list",
    pathname: "/contact",
    text: "Take me to companies",
    sessionMemory: memory,
    expect: (turn) => {
      const names = (turn.toolProposals || []).map((t) => t.name);
      const href = String((turn.toolProposals || []).find((t) => t.name === "navigate")?.args?.href || "");
      return (
        names.includes("navigate") ||
        names.includes("set_workspace") ||
        /compan/i.test(turn.assistantText || "") ||
        href.includes("compan")
      );
    },
  });
  memory = cross.memory;

  const nav = (cross.turn.toolProposals || []).find(
    (t) => t.name === "navigate" || t.name === "set_workspace",
  );
  if (nav) {
    const confirmed = await agentTurn({
      messages: [{ role: "user", text: "Take me to companies" }],
      context: {
        module: "contact",
        surface: "list",
        pathname: "/contact",
        draft: null,
      },
      sessionMemory: memory,
      confirmTool: { name: nav.name, args: nav.args || {} },
    });
    memory = mergeMemory(memory, confirmed.sessionMemoryPatch, confirmed.sessionMemory);
    record(
      "cross_module.confirm_nav_workspace",
      Boolean(confirmed.ok),
      `${workspaceSignal(confirmed).join(" | ")}`,
    );
  } else {
    record("cross_module.confirm_nav_workspace", true, "no confirm needed");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
