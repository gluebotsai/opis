/**
 * Dashboard, Inbox, Digital Marketing (SEO + campaigns), notifications API,
 * and proactive cron sweeps (notification / agent drains).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-dashboard-inbox-marketing-notifications.ts
 *
 * Proactive AI agents (full matrix):
 *   npx tsx --env-file=../.env scripts/e2e-proactive-agents.ts
 */
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const CRON_SECRET =
  process.env.CRON_SECRET?.trim() ||
  process.env.ENRICH_INTERNAL_SECRET?.trim() ||
  "";

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

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

async function http(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    cookie: [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  storeCookies(res);
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, data, raw };
}

async function cronPost(path: string) {
  const headers: Record<string, string> = {};
  if (CRON_SECRET) {
    headers.authorization = `Bearer ${CRON_SECRET}`;
    headers["x-internal-secret"] = CRON_SECRET;
  }
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, data, raw };
}

async function mintSession(roleFilter: string) {
  cookieJar.clear();
  const db = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query(
    `
      SELECT u.id::text AS id, lower(r.name) AS role
      FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.organization_id = 1000 AND ${roleFilter}
      ORDER BY u.id
      LIMIT 1`,
  );
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) return null;
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  return { id, role: u.rows[0]?.role };
}

function payload(data: unknown): any {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  return d.data !== undefined ? d.data : d;
}

async function testDashboard() {
  const home = await http(
    "GET",
    "/api/home?metricsPeriod=week&lbPeriod=month&untouchedHours=48",
  );
  const block = payload(home.data);
  const hasAnalytics =
    block?.analytics != null ||
    block?.pipeline != null ||
    block?.metrics != null ||
    block?.leaderboard != null;
  record(
    "dashboard.home",
    home.status === 200 && Boolean(block),
    hasAnalytics ? "analytics block present" : `keys=${Object.keys(block || {}).slice(0, 8).join(",")}`,
  );

  const briefing = await http("GET", "/api/home/briefing");
  record(
    "dashboard.briefing",
    briefing.status === 200,
    briefing.raw.slice(0, 80),
  );
}

async function testInbox() {
  const threads = await http("GET", "/api/inbox/threads?limit=10");
  const tPayload = payload(threads.data);
  const threadList =
    tPayload?.threads || tPayload?.items || tPayload?.data?.threads || [];
  record(
    "inbox.threads",
    threads.status === 200 && Array.isArray(threadList),
    `count=${Array.isArray(threadList) ? threadList.length : "?"}`,
  );

  const contacts = await http("GET", "/api/inbox/contacts");
  const cPayload = payload(contacts.data);
  const contactList = cPayload?.contacts || cPayload?.items || [];
  record(
    "inbox.contacts",
    contacts.status === 200 && Array.isArray(contactList),
    `count=${Array.isArray(contactList) ? contactList.length : "?"}`,
  );
}

async function testMarketing(roleLabel: string) {
  const status = await http("GET", "/api/marketing/status");
  record(
    `marketing.${roleLabel}.status`,
    status.status === 200,
    status.raw.slice(0, 100),
  );

  const campaigns = await http("GET", "/api/marketing/campaigns?bucket=all");
  const camp = payload(campaigns.data);
  record(
    `marketing.${roleLabel}.campaigns`,
    campaigns.status === 200 && Array.isArray(camp?.campaigns ?? camp),
    `count=${Array.isArray(camp?.campaigns) ? camp.campaigns.length : Array.isArray(camp) ? camp.length : "?"}`,
  );

  const embed = await http("GET", "/api/marketing/embed-session");
  const embedOk =
    embed.status === 200 ||
    (embed.status === 503 && /unreachable|not configured/i.test(embed.raw));
  record(
    `marketing.${roleLabel}.embed-session`,
    embedOk,
    embed.raw.slice(0, 90),
  );
}

async function testSeo(roleLabel: string) {
  const projects = await http("GET", "/api/seo/projects");
  const ok =
    projects.status === 200 ||
    (projects.status === 403 && roleLabel === "admin");
  record(
    `seo.${roleLabel}.projects`,
    ok,
    projects.status === 200
      ? `count=${Array.isArray(payload(projects.data)) ? payload(projects.data).length : payload(projects.data)?.items?.length ?? "?"}`
      : projects.raw.slice(0, 80),
  );

  const social = await http("GET", "/api/seo/social-posts");
  record(
    `seo.${roleLabel}.social-posts`,
    social.status === 200 ||
      social.status === 403 ||
      social.status === 404,
    social.status === 404 ? "empty (no posts yet)" : social.raw.slice(0, 80),
  );
}

async function testNotifications(roleLabel: string) {
  const list = await http("GET", "/api/notifications?limit=15");
  const items = payload(list.data)?.items || payload(list.data)?.notifications;
  record(
    `notifications.${roleLabel}.list`,
    list.status === 200 && Array.isArray(items),
    `count=${Array.isArray(items) ? items.length : list.raw.slice(0, 60)}`,
  );
}

const CRON_SWEeps = [
  { name: "cron.inbox-sync-live", path: "/api/cron/inbox-sync-live" },
  { name: "cron.meeting-reminders", path: "/api/cron/meeting-reminders" },
  {
    name: "cron.meeting-miss-escalations",
    path: "/api/cron/meeting-miss-escalations",
  },
  { name: "cron.lead-enrichment", path: "/api/cron/lead-enrichment?limit=1" },
  { name: "cron.lead-scoring", path: "/api/cron/lead-scoring?limit=1" },
  { name: "cron.lead-nurture", path: "/api/cron/lead-nurture?limit=1" },
  { name: "cron.lead-lifecycle", path: "/api/cron/lead-lifecycle" },
  { name: "cron.lifecycle-stall", path: "/api/cron/lifecycle-stall" },
  { name: "cron.pipeline-forecast", path: "/api/cron/pipeline-forecast" },
  { name: "cron.invoice-escalation", path: "/api/cron/invoice-escalation" },
  { name: "cron.expansion-matcher", path: "/api/cron/expansion-matcher" },
  { name: "cron.invoice-dunning", path: "/api/cron/invoice-dunning" },
  { name: "cron.seo-social-publish", path: "/api/cron/seo-social-publish" },
];

async function testCronSweeps() {
  if (!CRON_SECRET && process.env.NODE_ENV === "production") {
    record("cron.auth", false, "CRON_SECRET required in production");
    return;
  }
  for (const sweep of CRON_SWEeps) {
    const res = await cronPost(sweep.path);
    const ok = res.status === 200 || res.status === 401;
    record(
      sweep.name,
      res.status === 200,
      res.status === 401
        ? "unauthorized (set CRON_SECRET in .env)"
        : res.raw.slice(0, 90),
    );
    if (res.status === 401) break;
  }
}

async function main() {
  console.log(`Dashboard / Inbox / Marketing / Notifications E2E @ ${API}\n`);

  const admin = await mintSession(
    "lower(r.name) IN ('admin', 'sales_manager')",
  );
  record("login.admin", Boolean(admin?.id), `user=${admin?.id} role=${admin?.role}`);
  if (!admin?.id) process.exit(1);

  await testDashboard();
  await testInbox();
  await testMarketing("admin");
  await testSeo("admin");
  await testNotifications("admin");

  const marketing = await mintSession("lower(r.name) = 'marketing'");
  if (marketing?.id) {
    record("login.marketing", true, `user=${marketing.id}`);
    await testMarketing("marketing-role");
    await testSeo("marketing-role");
    await testNotifications("marketing-role");
  } else {
    record("login.marketing", true, "skipped (no marketing seed user org 1000)");
  }

  await mintSession("lower(r.name) IN ('admin', 'sales_manager')");
  await testCronSweeps();

  summarize();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
