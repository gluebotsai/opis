/**
 * Demo readiness E2E — lead → agents → won/lost + notifications.
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/demo-readiness-e2e.ts
 *
 * Uses session mint when seed login fails (shared Worktual DB).
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox.ts";
import { resolveSetupUserDeliveryEmail } from "../src/service/account/setup-users.ts";
import { resolveEmailSendProvider } from "../src/service/email/send-connected-email.ts";
import { getValidOauthAccessToken } from "../src/service/email/send-crm-bot-email.ts";

const API = (process.env.E2E_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
const AI = (process.env.AI_SERVICE_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const SECRET =
  process.env.ENRICH_INTERNAL_SECRET?.trim() ||
  process.env.CRON_SECRET?.trim() ||
  "";
const ORG = process.env.DEMO_ORG_ID || "1000";
const OWNER_USER = process.env.SMOKE_OWNER_USER_ID || "1006";
const AGENT_TIMEOUT = Number(process.env.E2E_AGENT_TIMEOUT_MS || 120_000);
const HTTP_TIMEOUT = Number(process.env.E2E_HTTP_TIMEOUT_MS || 300_000);
const CRON_DRAIN_LIMIT = Number(process.env.E2E_CRON_DRAIN_LIMIT || 3);
const PIPELINE_WAIT_MS = Number(process.env.E2E_PIPELINE_WAIT_MS || 180_000);

type Verdict = "PASS" | "FAIL" | "WARN" | "BLOCKER";
type Row = { area: string; scenario: string; verdict: Verdict; detail: string };

const rows: Row[] = [];
const cookieJar = new Map<string, string>();

function sfx() {
  return randomBytes(4).toString("hex");
}

function record(area: string, scenario: string, verdict: Verdict, detail: string) {
  rows.push({ area, scenario, verdict, detail });
  console.log(`[${verdict.padEnd(7)}] ${area} — ${scenario}: ${detail}`);
}

function clip(v: unknown, n = 180): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return !s ? "" : s.length > n ? `${s.slice(0, n)}…` : s;
}

async function http(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookieJar.size) {
    headers.Cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { raw: raw.slice(0, 400) };
  }
  return { status: res.status, json, raw };
}

async function ensureSession() {
  const login = await http("POST", "/api/auth/login", {
    email: process.env.E2E_EMAIL || "admin.b2b@worktual.com",
    password: process.env.E2E_PASSWORD || "demo",
  });
  if (login.status === 200) {
    const user = login.json.user as { organizationId?: string; id?: string } | undefined;
    return String(user?.organizationId || ORG);
  }

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const u = await db.query<{ id: string; org: string }>(
    `
    SELECT u.id::text AS id, u.organization_id::text AS org
    FROM accounts.setup_users u
    JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
    JOIN accounts.setup_roles r ON r.id = a.role_id
    WHERE u.status = 'active' AND u.organization_id = $1::bigint
      AND lower(r.name) IN ('admin', 'sales_manager')
    ORDER BY u.id LIMIT 1
    `,
    [ORG],
  );
  await db.end();
  const row = u.rows[0];
  if (!row?.id) throw new Error("Cannot mint session — no CRM admin in org");
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
  const me = await http("GET", "/api/auth/me");
  if (me.status !== 200) throw new Error(`Minted session rejected: ${me.status}`);
  record("auth", "session mint", "PASS", `user ${row.id} org ${row.org}`);
  return row.org || ORG;
}

async function drainCron(paths: string[], rounds = 4, waitMs = 2000) {
  for (let i = 0; i < rounds; i++) {
    for (const p of paths) {
      const limit =
        p === "lead-enrichment" || p === "lead-scoring" || p === "lead-nurture"
          ? `?limit=${CRON_DRAIN_LIMIT}`
          : "";
      try {
        await http(
          "POST",
          `/api/cron/${p}${limit}`,
          {},
          { Authorization: `Bearer ${SECRET}` },
        );
      } catch (err) {
        record(
          "pipeline",
          `cron ${p}`,
          "WARN",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function waitFor(label: string, fn: () => Promise<boolean>, ms = PIPELINE_WAIT_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  record("pipeline", label, "FAIL", "timeout");
  return false;
}

async function q<T extends Record<string, unknown>>(sql: string, ...params: unknown[]) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query<T>(sql, params);
  await c.end();
  return r.rows[0] ?? null;
}

async function callAgent(agent: string, body: Record<string, unknown>) {
  const started = Date.now();
  try {
    const res = await fetch(`${AI}/ai/v1/agents/${agent}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SECRET ? { "x-internal-secret": SECRET } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    const ms = Date.now() - started;
    const blob = JSON.stringify(json);
    if (res.status >= 500 || res.status === 401) {
      return { verdict: "FAIL" as Verdict, detail: `http ${res.status} ${clip(json)}`, ms };
    }
    if (/crm_bot_gmail_reauth|Google token refresh failed|needs re-authentication/i.test(blob)) {
      return { verdict: "BLOCKER" as Verdict, detail: "CRM bot mail needs reconnect", ms };
    }
    if (/heuristic|llm_unavailable|offline/i.test(blob) && res.status === 200) {
      return { verdict: "WARN" as Verdict, detail: clip(json), ms };
    }
    if (res.status >= 400 || (json.ok === false && json.error)) {
      return { verdict: "FAIL" as Verdict, detail: clip(json.error ?? json), ms };
    }
    if (agent === "meeting-mom") {
      const customer = json.customerEmail as { body?: string } | undefined;
      const internal = json.internalEmail as { body?: string } | undefined;
      if (!customer?.body?.includes("MEETING OVERVIEW")) {
        return { verdict: "FAIL" as Verdict, detail: "customer MOM missing HTML template", ms };
      }
      if (!internal?.body?.includes("INTERNAL")) {
        return { verdict: "FAIL" as Verdict, detail: "internal MOM missing HTML template", ms };
      }
    }
    return { verdict: "PASS" as Verdict, detail: clip(json), ms };
  } catch (err) {
    return {
      verdict: "FAIL" as Verdict,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

async function checkInfra() {
  const api = await fetch(`${API}/health`).then((r) => r.status).catch(() => 0);
  record("infra", "CRM API :4000", api === 200 ? "PASS" : "FAIL", `status ${api}`);

  const ai = await fetch(`${AI}/health`)
    .then((r) => r.json() as Promise<{ status?: string }>)
    .catch(() => null);
  record("infra", "ai-service :8000", ai?.status === "ok" ? "PASS" : "FAIL", clip(ai));

  const owner = await resolveSetupUserDeliveryEmail(OWNER_USER, ORG);
  const ownerProv = await resolveEmailSendProvider(OWNER_USER, null);
  record(
    "infra",
    "Rep inbox (customer mail)",
    ownerProv ? "PASS" : "FAIL",
    owner?.email ? `${owner.email} via ${ownerProv}` : "no connected inbox",
  );

  const bot = await resolveCrmBotMailbox(ORG);
  let botOk = Boolean(bot?.oauthConnectionId && !bot.needsReauth);
  if (bot?.oauthConnectionId) {
    const tok = await getValidOauthAccessToken(bot).catch(() => ({
      ok: false as const,
      error: "token_check_failed",
    }));
    if (!tok.ok) botOk = false;
  }
  record(
    "infra",
    "CRM bot (nurture/internal mail)",
    botOk ? "PASS" : "BLOCKER",
    bot
      ? `${bot.accountEmail} oauth=${Boolean(bot.oauthConnectionId)} tokenOk=${botOk}`
      : "not configured",
  );
}

async function createLead(input: Record<string, unknown>) {
  try {
    const r = await http("POST", "/api/contacts", input);
    if (r.status !== 200 || !r.json.id) {
      throw new Error(`create lead ${r.status} ${r.raw.slice(0, 200)}`);
    }
    return String(r.json.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`create lead failed: ${msg}`);
  }
}

async function runPipelineAgents(orgId: string, contactId: string, agents: string[]) {
  for (const agent of agents) {
    const r = await callAgent(agent, { contactId, organizationId: orgId, force: true });
    record("agents", agent, r.verdict, `${(r.ms / 1000).toFixed(1)}s ${r.detail}`);
  }
}

async function scenarioHotLead(orgId: string) {
  const s = sfx();
  const id = await createLead({
    firstName: "Demo",
    lastName: `Hot${s}`,
    email: `ceo.demo.${s}@demoready-verify.com`,
    title: "CEO",
    city: "London",
    country: "United Kingdom",
    companyName: `DemoReady Hot ${s}`,
    companyDomain: `demoready-hot-${s}.com`,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "demo_request",
    leadStatus: "new",
    bantNeed: true,
    bantAuthority: true,
    bantBudget: true,
  });

  await drainCron(["lead-enrichment", "lead-scoring", "lead-nurture"], 4, 2500);

  const ok = await waitFor("hot lead scored+assigned", async () => {
    const sc = await q<{ score: string; status: string }>(
      `SELECT score::text, status FROM crm.lead_scoring_jobs WHERE contact_id=$1`,
      id,
    );
    const pr = await q<{ owner_user_id: string | null; sla_deadline: string | null }>(
      `SELECT owner_user_id::text, sla_deadline::text FROM crm.contact_profiles WHERE account_contact_id=$1`,
      id,
    );
    return Boolean(sc?.status === "scored" && Number(sc.score) >= 40 && pr?.owner_user_id);
  });

  const sc = await q<{ score: string; band: string }>(
    `SELECT score::text, band FROM crm.lead_scoring_jobs WHERE contact_id=$1`,
    id,
  );
  const enrich = await q<{ status: string }>(
    `SELECT status FROM crm.lead_enrichment_jobs WHERE contact_id=$1`,
    id,
  );
  const summary = await q<{ id: string }>(
    `SELECT id FROM crm.lead_summaries WHERE contact_id=$1`,
    id,
  );
  const pr = await q<{ owner_user_id: string | null }>(
    `SELECT owner_user_id::text FROM crm.contact_profiles WHERE account_contact_id=$1`,
    id,
  );

  record(
    "pipeline",
    "Hot lead → enrich+score+summary+assign",
    ok && enrich && summary && pr?.owner_user_id ? "PASS" : ok ? "WARN" : "FAIL",
    `score=${sc?.score} band=${sc?.band} enrich=${enrich?.status} owner=${pr?.owner_user_id ?? "none"}`,
  );

  await runPipelineAgents(orgId, id, [
    "enrich-lead",
    "score-lead",
    "summarize-lead",
    "assign-sales",
    "lifecycle-lead",
  ]);

  return { id, companyId: await q<{ company_id: string }>(`SELECT company_id FROM crm.contact_profiles WHERE account_contact_id=$1`, id) };
}

async function scenarioColdLead(orgId: string) {
  const s = sfx();
  const id = await createLead({
    firstName: "Demo",
    lastName: `Cold${s}`,
    email: `cold.demo.${s}@gmail.com`,
    companyName: `DemoReady Cold ${s}`,
    contactType: "lead",
    leadSource: "csv",
    leadStatus: "new",
  });

  await drainCron(["lead-enrichment", "lead-scoring", "lead-nurture"], 4, 2500);

  const ok = await waitFor("cold lead scored+nurture", async () => {
    const sc = await q<{ score: string }>(`SELECT score::text FROM crm.lead_scoring_jobs WHERE contact_id=$1 AND status='scored'`, id);
    const nj = await q<{ status: string }>(`SELECT status FROM crm.lead_nurture_jobs WHERE contact_id=$1`, id);
    return Boolean(sc && Number(sc.score) < 40 && nj);
  });

  const sc = await q<{ score: string; band: string }>(
    `SELECT score::text, band FROM crm.lead_scoring_jobs WHERE contact_id=$1`,
    id,
  );
  const nj = await q<{ status: string; nurture_status: string | null }>(
    `SELECT status, nurture_status FROM crm.lead_nurture_jobs WHERE contact_id=$1`,
    id,
  );

  record(
    "pipeline",
    "Cold lead → score+nurture",
    ok ? "PASS" : "FAIL",
    `score=${sc?.score} band=${sc?.band} nurtureJob=${nj?.status}/${nj?.nurture_status}`,
  );

  for (const agent of ["score-lead", "nurture-lead", "lifecycle-lead"]) {
    const r = await callAgent(agent, { contactId: id, organizationId: orgId, force: true });
    record("agents", `cold/${agent}`, r.verdict, `${(r.ms / 1000).toFixed(1)}s ${r.detail}`);
  }
}

async function scenarioWonLost(hot: { id: string; companyId: { company_id: string } | null }) {
  const companyId = hot.companyId?.company_id;
  if (!companyId) {
    record("pipeline", "Won/lost deals", "FAIL", "hot lead missing company");
    return;
  }

  const loc = await q<{ id: string }>(
    `SELECT id FROM crm.company_locations WHERE company_id=$1 ORDER BY created_at LIMIT 1`,
    companyId,
  );
  if (!loc?.id) {
    record("pipeline", "Won/lost deals", "FAIL", "no company location");
    return;
  }

  const s = sfx();
  const won = await http("POST", "/api/sales/deals", {
    title: `Demo won ${s}`,
    companyId,
    locationId: loc.id,
    contactId: hot.id,
    stage: "negotiation",
    amount: 50000,
    currency: "USD",
  });
  const lost = await http("POST", "/api/sales/deals", {
    title: `Demo lost ${s}`,
    companyId,
    locationId: loc.id,
    contactId: hot.id,
    stage: "proposal",
    amount: 25000,
    currency: "USD",
  });

  if (won.status !== 200 || !won.json.id || lost.status !== 200 || !lost.json.id) {
    record("pipeline", "Create deals", "FAIL", clip(won.json.error ?? lost.raw));
    return;
  }

  const wonId = String(won.json.id);
  const lostId = String(lost.json.id);

  const wonStage = await http("POST", `/api/sales/deals/${wonId}/stage`, { stage: "closed_won" });
  const lostStage = await http("POST", `/api/sales/deals/${lostId}/stage`, {
    stage: "closed_lost",
    lostReason: "Demo test — budget",
  });

  record(
    "pipeline",
    "Deal closed_won",
    wonStage.status === 200 ? "PASS" : "FAIL",
    clip(wonStage.json.error ?? wonStage.json),
  );
  record(
    "pipeline",
    "Deal closed_lost",
    lostStage.status === 200 ? "PASS" : "FAIL",
    clip(lostStage.json.error ?? lostStage.json),
  );

  await drainCron(["lead-lifecycle"], 3, 1500);

  const contactType = await q<{ contact_type: string }>(
    `
    SELECT lower(coalesce(p.contact_type, 'lead')) AS contact_type
    FROM cdp.customer_profile p WHERE p.cdp_id::text = $1
    `,
    hot.id,
  );
  record(
    "pipeline",
    "Won promotes contact to customer",
    contactType?.contact_type === "customer" ? "PASS" : "WARN",
    `contact_type=${contactType?.contact_type ?? "unknown"}`,
  );

  const lc = await callAgent("lifecycle-lead", { contactId: hot.id, organizationId: ORG, force: true });
  record("agents", "won-lost/lifecycle-lead", lc.verdict, lc.detail);
}

async function scenarioProactiveAgents() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const deal = await c.query(`
    SELECT id, organization_id::text org FROM crm.deals
    WHERE stage NOT IN ('closed_won','closed_lost') ORDER BY updated_at DESC LIMIT 1`);
  const meeting = await c.query(`
    SELECT id, organization_id::text org, contact_id FROM crm.contact_activities
    WHERE type='meeting' ORDER BY COALESCE(due_at, created_at) DESC LIMIT 1`);
  const invoice = await c.query(`
    SELECT id, organization_id::text org FROM crm.invoices ORDER BY updated_at DESC LIMIT 1`);
  const inbox = await c.query(`
    SELECT id, organization_id::text org, contact_id FROM crm.contact_activities
    WHERE type='email' AND folder='inbox' ORDER BY created_at DESC LIMIT 1`);
  await c.end();

  const battery: Array<[string, string, Record<string, unknown>]> = [];
  if (deal.rows[0]) {
    battery.push([
      "forecast",
      "audit-forecast",
      { dealId: deal.rows[0].id, organizationId: deal.rows[0].org || ORG },
    ]);
  }
  if (meeting.rows[0]) {
    battery.push([
      "meeting",
      "meeting-brief-email",
      {
        activityId: meeting.rows[0].id,
        contactId: meeting.rows[0].contact_id,
        organizationId: meeting.rows[0].org || ORG,
        audience: "owner",
      },
    ]);
    battery.push([
      "meeting",
      "meeting-mom",
      {
        activityId: meeting.rows[0].id,
        contactId: meeting.rows[0].contact_id,
        organizationId: meeting.rows[0].org || ORG,
        transcript: "Rep: Thanks for joining.\nCustomer: We need pricing by Friday.\nRep: Will send quote.",
      },
    ]);
  }
  if (invoice.rows[0]) {
    battery.push([
      "finance",
      "invoice-escalation",
      { invoiceId: invoice.rows[0].id, organizationId: invoice.rows[0].org || ORG },
    ]);
  }
  if (inbox.rows[0]) {
    battery.push([
      "inbound",
      "auto-reply-email",
      {
        activityId: inbox.rows[0].id,
        contactId: inbox.rows[0].contact_id,
        organizationId: inbox.rows[0].org || ORG,
      },
    ]);
  }

  if (!battery.length) {
    record("agents", "proactive battery", "WARN", "no fixture deals/meetings/invoices");
    return;
  }

  for (const [area, agent, body] of battery) {
    const r = await callAgent(agent, body);
    record("agents", `${area}/${agent}`, r.verdict, `${(r.ms / 1000).toFixed(1)}s ${r.detail}`);
  }
}

async function scenarioNotifications() {
  const ping = await http(
    "POST",
    "/api/internal/notifications/test",
    {
      organizationId: ORG,
      recipientUserIds: [OWNER_USER],
      kind: "demo_readiness_ping",
      title: "[Demo test] In-app notification",
      body: "Demo readiness check — safe to ignore.",
      href: "/dashboard",
    },
    { "x-internal-secret": SECRET },
  ).catch(() => ({ status: 404, json: {}, raw: "" }));

  if (ping.status === 404) {
    const n = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.notifications WHERE recipient_user_id=$1::bigint AND created_at > NOW() - INTERVAL '1 day'`,
      OWNER_USER,
    );
    record(
      "notifications",
      "In-app bell (recent activity)",
      Number(n?.n || 0) > 0 ? "PASS" : "WARN",
      `${n?.n ?? 0} notifications in last 24h for owner`,
    );
  } else {
    record(
      "notifications",
      "In-app ping",
      ping.status === 200 ? "PASS" : "WARN",
      clip(ping.json),
    );
  }

  record(
    "notifications",
    "CRM bot nurture path",
    rows.some((r) => r.scenario.includes("CRM bot") && r.verdict === "BLOCKER") ? "BLOCKER" : "PASS",
    "See infra CRM bot check — reconnect bot.worktual@gmail.com before demo if BLOCKER",
  );
}

async function main() {
  console.log("\n=== Demo Readiness E2E (org", ORG, ") ===\n");
  if (!SECRET) {
    console.warn("WARN: ENRICH_INTERNAL_SECRET / CRON_SECRET not set — cron drain may fail");
  }

  await checkInfra();
  let orgId = ORG;
  try {
    orgId = await ensureSession();
  } catch (err) {
    record(
      "runtime",
      "session bootstrap",
      "FAIL",
      err instanceof Error ? err.message : String(err),
    );
    printSummary();
    process.exit(1);
  }

  try {
    const hot = await scenarioHotLead(orgId);
    await scenarioWonLost(hot);
  } catch (err) {
    record(
      "runtime",
      "hot lead scenario",
      "FAIL",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    await scenarioColdLead(orgId);
  } catch (err) {
    record(
      "runtime",
      "cold lead scenario",
      "FAIL",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    await scenarioProactiveAgents();
  } catch (err) {
    record(
      "runtime",
      "proactive agents",
      "FAIL",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    await scenarioNotifications();
  } catch (err) {
    record(
      "runtime",
      "notifications",
      "FAIL",
      err instanceof Error ? err.message : String(err),
    );
  }

  printSummary();
}

function printSummary() {
  const blockers = rows.filter((r) => r.verdict === "BLOCKER");
  const failed = rows.filter((r) => r.verdict === "FAIL");
  const warned = rows.filter((r) => r.verdict === "WARN");
  const passed = rows.filter((r) => r.verdict === "PASS");

  console.log("\n=== Summary ===");
  console.log(`PASS: ${passed.length} | WARN: ${warned.length} | FAIL: ${failed.length} | BLOCKER: ${blockers.length}`);
  if (blockers.length) {
    console.log("\nBlockers (fix before demo):");
    for (const b of blockers) console.log(`  • ${b.area} — ${b.scenario}: ${b.detail}`);
  }
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  • ${f.area} — ${f.scenario}: ${f.detail}`);
  }
  if (warned.length) {
    console.log("\nWarnings:");
    for (const w of warned) console.log(`  • ${w.area} — ${w.scenario}: ${w.detail}`);
  }

  process.exit(blockers.length || failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  record("runtime", "unhandled error", "FAIL", err instanceof Error ? err.message : String(err));
  printSummary();
  process.exit(1);
});
