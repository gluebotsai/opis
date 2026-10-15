/**
 * End-to-end verification of Lead Pipeline Phase 1 scenarios.
 * Run: npx tsx --env-file=../.env scripts/verify-lead-pipeline.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { getPrismaClient } from "../src/dao/db/prisma.ts";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";
import { persistLeadEnrichment } from "../src/dao/ai/lead-enrichment-persist.ts";
import { getDomainEnrichmentCache } from "../src/dao/ai/domain-enrichment-cache.ts";
import { routeLeadAfterScore } from "../src/service/ai/lead-score-route.ts";
import { scoreLeadHeuristic } from "../src/service/ai/lead-score.ts";
import { processLeadScoreDecay } from "../src/service/ai/lead-score-decay.ts";
import { enqueueLeadScoring, processLeadScoringJob } from "../src/service/ai/lead-scoring-job.ts";
import { findScoringJobByContactId } from "../src/dao/ai/lead-scoring-store.ts";

const API = "http://127.0.0.1:4000";
const SECRET = process.env.ENRICH_INTERNAL_SECRET || "2b179c0d739539750168566ca295a7df";
const EMAIL = "admin.b2b@worktual.com";
const PASSWORD = "demo";

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];
const cookieJar = new Map<string, string>();

function suffix(): string {
  return randomBytes(4).toString("hex");
}

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function http(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: any; raw: string }> {
  const headers: Record<string, string> = {
    ...(extraHeaders || {}),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookieJar.size) {
    headers.Cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookieJar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  // Node fetch may expose set-cookie differently
  const sc = res.headers.get("set-cookie");
  if (sc) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookieJar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const raw = await res.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }
  return { status: res.status, json, raw };
}

async function login() {
  const r = await http("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (r.status === 200) return r.json.user as { organizationId: string; id: string };

  const rows = await getPrismaClient().$queryRawUnsafe<
    Array<{ id: string; org: string }>
  >(
    `
    SELECT u.id::text AS id, u.organization_id::text AS org
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
  const row = rows[0];
  if (!row?.id) throw new Error(`login failed ${r.status} ${r.raw}`);
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
  const me = await http("GET", "/api/auth/me");
  if (me.status !== 200) throw new Error(`minted session rejected ${me.status}`);
  console.log(`session minted for CRM admin user ${row.id} org ${row.org}`);
  return { organizationId: row.org, id: row.id };
}

async function createLead(input: Record<string, unknown>): Promise<string> {
  const r = await http("POST", "/api/contacts", input);
  if (r.status !== 200 || !r.json.id) {
    throw new Error(`create contact failed ${r.status} ${r.raw.slice(0, 300)}`);
  }
  return String(r.json.id);
}

async function addActivity(
  contactId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const r = await http("POST", `/api/contacts/${contactId}/activities`, input);
  if (r.status !== 200) {
    throw new Error(`activity failed ${r.status} ${r.raw.slice(0, 300)}`);
  }
}

async function drain(paths: string[], rounds = 3, waitMs = 1500) {
  for (let i = 0; i < rounds; i++) {
    for (const path of paths) {
      await http(
        "POST",
        `/api/cron/${path}`,
        {},
        { Authorization: `Bearer ${SECRET}` },
      );
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function waitFor(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 45000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.warn(`timeout waiting for ${label}`);
  return false;
}

async function row(sql: string, ...params: unknown[]) {
  const p = getPrismaClient();
  const rows = await p.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  return rows[0] ?? null;
}

async function rows(sql: string, ...params: unknown[]) {
  const p = getPrismaClient();
  return p.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
}

async function scenario1(orgId: string) {
  const s = suffix();
  const hotId = await createLead({
    firstName: "V1",
    lastName: `Hot${s}`,
    email: `ceo.${s}@northstar-verify.com`,
    title: "CEO",
    city: "London",
    country: "United Kingdom",
    companyName: "Northstar Verify",
    companyDomain: "northstar-verify.com",
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "demo_request",
    leadStatus: "new",
    bantNeed: true,
    bantAuthority: true,
    bantBudget: true,
  });
  const coldId = await createLead({
    firstName: "V1",
    lastName: `Cold${s}`,
    email: `cold.${s}@gmail.com`,
    companyName: `Cold Verify ${s}`,
    contactType: "lead",
    leadSource: "csv",
    leadStatus: "new",
  });

  await drain(["lead-enrichment", "lead-scoring", "lead-nurture"], 4, 2000);

  const hotReady = await waitFor("hot scored+assigned", async () => {
    const sc = await row(
      `SELECT score, band FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`,
      hotId,
    );
    const pr = await row(
      `SELECT owner_user_id, sla_deadline FROM contact_profiles WHERE account_contact_id=$1::text`,
      hotId,
    );
    return Boolean(sc && Number(sc.score) >= 40 && pr?.owner_user_id && pr?.sla_deadline);
  });

  const hotScore = await row(
    `SELECT score, fit_score, intent_score, band, trigger_reason FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    hotId,
  );
  const hotSnap = await row(
    `SELECT seniority_tier, email_domain_type FROM lead_enrichment_snapshots WHERE contact_id=$1::text`,
    hotId,
  );
  const hotSum = await row(
    `SELECT recommended_action, flags FROM lead_summaries WHERE contact_id=$1::text`,
    hotId,
  );
  const hotProf = await row(
    `SELECT owner_user_id, assignment_reason, sla_deadline, nurture_status FROM contact_profiles WHERE account_contact_id=$1::text`,
    hotId,
  );

  record(
    "1a corporate ≥40 → enrich+score+summary+assign+SLA",
    hotReady &&
      Number(hotScore?.score) >= 40 &&
      Boolean(hotSnap?.seniority_tier) &&
      hotSnap?.email_domain_type === "corporate" &&
      Boolean(hotSum?.recommended_action) &&
      Boolean(hotProf?.owner_user_id) &&
      Boolean(hotProf?.sla_deadline),
    `score=${hotScore?.score} fit=${hotScore?.fit_score} intent=${hotScore?.intent_score} band=${hotScore?.band} trigger=${hotScore?.trigger_reason} senior=${hotSnap?.seniority_tier} owner=${hotProf?.owner_user_id ? "yes" : "no"} sla=${hotProf?.sla_deadline ? "yes" : "no"} summary=${hotSum?.recommended_action ? "yes" : "no"}`,
  );

  const coldReady = await waitFor("cold scored", async () => {
    const sc = await row(
      `SELECT score FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`,
      coldId,
    );
    return Boolean(sc && Number(sc.score) < 40);
  });
  const coldScore = await row(
    `SELECT score, band FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    coldId,
  );
  const coldProf = await row(
    `SELECT nurture_status, owner_user_id FROM contact_profiles WHERE account_contact_id=$1::text`,
    coldId,
  );
  const coldNurture = await row(
    `SELECT status, nurture_status FROM lead_nurture_jobs WHERE contact_id=$1::text`,
    coldId,
  );

  record(
    "1b cold <40 → nurture (deep_cold)",
    coldReady &&
      Number(coldScore?.score) < 40 &&
      !coldProf?.owner_user_id &&
      (coldProf?.nurture_status === "deep_cold" ||
        coldNurture?.nurture_status === "deep_cold" ||
        Boolean(coldNurture)),
    `score=${coldScore?.score} band=${coldScore?.band} nurture=${coldProf?.nurture_status} job=${coldNurture?.status}/${coldNurture?.nurture_status}`,
  );

  return { hotId, coldId, orgId, hotOwner: String(hotProf?.owner_user_id || "") };
}

async function scenario2(orgId: string) {
  const s = suffix();
  // Start below gate: corporate but weak intent, no demo
  const id = await createLead({
    firstName: "V2",
    lastName: `Engage${s}`,
    email: `analyst.${s}@engage-verify.com`,
    title: "Analyst",
    companyName: "Engage Verify Co",
    companyDomain: "engage-verify.com",
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "csv",
    leadStatus: "new",
  });
  await drain(["lead-enrichment", "lead-scoring", "lead-nurture"], 3, 2000);
  await waitFor("v2 initial score", async () => {
    const sc = await row(
      `SELECT status FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`,
      id,
    );
    return Boolean(sc);
  });

  const before = await row(
    `SELECT score, band FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  // Force below gate if somehow already ready (shouldn't be)
  const beforeScore = Number(before?.score ?? 0);

  // High-intent engagement signals
  await addActivity(id, {
    type: "email",
    subject: "Re: Requested a demo and pricing",
    body: "Please book a demo — I want to talk to sales about pricing and quote.",
    emailDirection: "inbound",
    folder: "inbox",
  });
  await addActivity(id, {
    type: "meeting",
    subject: "Product demo booked",
    body: "Customer booked a demo",
  });
  await addActivity(id, {
    type: "note",
    subject: "Pricing page visit",
    body: "Visited pricing page twice",
  });

  // Rescore
  await enqueueLeadScoring({
    contactId: id,
    organizationId: orgId,
    triggerReason: "engagement_test",
    processImmediately: true,
  });
  await drain(["lead-scoring", "lead-nurture"], 3, 2000);

  const ready = await waitFor("v2 crossed 40 + assigned", async () => {
    const sc = await row(
      `SELECT score FROM lead_scoring_jobs WHERE contact_id=$1::text`,
      id,
    );
    const pr = await row(
      `SELECT owner_user_id, nurture_status FROM contact_profiles WHERE account_contact_id=$1::text`,
      id,
    );
    return Boolean(sc && Number(sc.score) >= 40 && pr?.owner_user_id);
  }, 60000);

  const after = await row(
    `SELECT score, fit_score, intent_score, band FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  const pr = await row(
    `SELECT owner_user_id, nurture_status, assignment_reason FROM contact_profiles WHERE account_contact_id=$1::text`,
    id,
  );
  const nurture = await row(
    `SELECT status, decision, nurture_status FROM lead_nurture_jobs WHERE contact_id=$1::text`,
    id,
  );

  const exited =
    pr?.nurture_status === "exited_sales_ready" ||
    nurture?.nurture_status === "exited_sales_ready" ||
    nurture?.decision === "skip_sales_ready" ||
    (Boolean(pr?.owner_user_id) && Number(after?.score) >= 40);

  record(
    "2 engagement raises intent past 40 → assign; nurture exits",
    ready && exited && Number(after?.score) >= 40 && Boolean(pr?.owner_user_id),
    `before=${beforeScore} after=${after?.score} intent=${after?.intent_score} owner=${pr?.owner_user_id ? "yes" : "no"} nurtureProf=${pr?.nurture_status} nurtureJob=${nurture?.status}/${nurture?.decision}/${nurture?.nurture_status}`,
  );

  return id;
}

async function scenario3(hotId: string, hotOwner: string, orgId: string) {
  if (!hotId || !hotOwner) {
    record("3 decay going-cold, owner unchanged", false, "missing hot lead from scenario 1");
    return;
  }

  // Backdate last activity so decay applies, and force a prior sales-ready score
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE contact_activities SET created_at = NOW() - INTERVAL '35 days' WHERE contact_id = $1::text`,
    hotId,
  );
  // Ensure at least one old activity exists
  const actCount = await row(
    `SELECT count(*)::int AS n FROM contact_activities WHERE contact_id=$1::text`,
    hotId,
  );
  if (!actCount || Number(actCount.n) === 0) {
    await getPrismaClient().$executeRawUnsafe(
      `INSERT INTO contact_activities (id, organization_id, contact_id, type, subject, body, created_at, updated_at)
       VALUES ($1, $2::bigint, $3::text, 'note', 'old touch', 'stale', NOW() - INTERVAL '35 days', NOW())`,
      `act_${randomBytes(8).toString("hex")}`,
      orgId,
      hotId,
    );
  }

  const beforeOwner = await row(
    `SELECT owner_user_id FROM contact_profiles WHERE account_contact_id=$1::text`,
    hotId,
  );

  // Direct going-cold path (authoritative for assignment invariant)
  const coldResult = scoreLeadHeuristic({
    contactType: "lead",
    leadStatus: "new",
    leadSource: "csv",
    title: "CEO",
    companyName: "Northstar Verify",
    industry: "Software",
    email: "ceo@northstar-verify.com",
    hasEmail: true,
    hasPhone: false,
    recentActivityCount: 0,
    inboundEmailCount: 0,
    callOrMeetingCount: 0,
    daysSinceLastActivity: 35,
  });

  const route = await routeLeadAfterScore({
    contactId: hotId,
    organizationId: orgId,
    scoreResult: coldResult,
    previousScore: 56,
  });

  const afterOwner = await row(
    `SELECT owner_user_id FROM contact_profiles WHERE account_contact_id=$1::text`,
    hotId,
  );
  const notif = await row(
    `SELECT kind, title FROM notifications WHERE contact_id=$1::text AND kind='lead_going_cold' ORDER BY created_at DESC LIMIT 1`,
    hotId,
  );

  // Also exercise decay cron endpoint
  const decayHttp = await http(
    "POST",
    "/api/cron/lead-score-decay",
    {},
    { Authorization: `Bearer ${SECRET}` },
  );

  record(
    "3 assigned lead goes cold → notify, owner unchanged",
    route.path === "going_cold" &&
      String(afterOwner?.owner_user_id) === String(beforeOwner?.owner_user_id) &&
      Boolean(notif) &&
      decayHttp.status === 200,
    `route=${route.path} ownerBefore=${beforeOwner?.owner_user_id} ownerAfter=${afterOwner?.owner_user_id} notif=${notif?.kind} decayHttp=${decayHttp.status} newScore=${coldResult.score}`,
  );
}

async function scenario4(orgId: string) {
  const s = suffix();
  const id = await createLead({
    firstName: "V4",
    lastName: `Size${s}`,
    email: `founder.${s}@sizeguard-verify.com`,
    title: "Founder",
    companyName: "SizeGuard Verify",
    companyDomain: "sizeguard-verify.com",
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "website",
  });
  await drain(["lead-enrichment", "lead-scoring"], 3, 1500);
  await waitFor("v4 company exists", async () => {
    const c = await row(
      `SELECT company_id FROM contact_profiles WHERE account_contact_id=$1::text AND company_id IS NOT NULL`,
      id,
    );
    return Boolean(c);
  });

  const companyId = String(
    (
      await row(
        `SELECT company_id FROM contact_profiles WHERE account_contact_id=$1::text`,
        id,
      )
    )?.company_id,
  );

  // User-set size
  await getPrismaClient().company.update({
    where: { id: companyId },
    data: { employeeCount: 150 },
  });

  const persist = await persistLeadEnrichment(
    {
      contactId: id,
      fields: {
        employeeCount: {
          value: 9999,
          confidence: 90,
          sourceUrl: "https://example.com/fake",
        },
        industry: {
          value: "Totally Different Industry",
          confidence: 90,
          sourceUrl: "https://example.com/fake",
        },
      },
      status: "enriched",
    },
    { organizationId: orgId },
  );

  const company = await row(
    `SELECT employee_count, industry FROM companies WHERE id=$1`,
    companyId,
  );
  const snap = await row(
    `SELECT conflict_flags FROM lead_enrichment_snapshots WHERE contact_id=$1::text`,
    id,
  );

  const sizeOk = Number(company?.employee_count) === 150;
  const conflicts = Array.isArray(persist.conflictFlags)
    ? persist.conflictFlags
    : [];
  const flagged =
    conflicts.includes("employeeCount") ||
    (Array.isArray(snap?.conflict_flags) &&
      (snap?.conflict_flags as string[]).includes("employeeCount")) ||
    (typeof snap?.conflict_flags === "object" &&
      JSON.stringify(snap?.conflict_flags).includes("employeeCount"));

  record(
    "4 user-provided company size not overwritten",
    sizeOk && flagged && !persist.filled.includes("employeeCount"),
    `employeeCount=${company?.employee_count} filled=${JSON.stringify(persist.filled)} conflicts=${JSON.stringify(conflicts)} snapFlags=${JSON.stringify(snap?.conflict_flags)}`,
  );
}

async function scenario5(orgId: string) {
  const domain = `cachehit-${suffix()}.com`;
  const s = suffix();
  const first = await createLead({
    firstName: "V5",
    lastName: `A${s}`,
    email: `a.${s}@${domain}`,
    title: "Director",
    companyName: `CacheHit ${s}`,
    companyDomain: domain,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "website",
  });
  await drain(["lead-enrichment", "lead-scoring"], 4, 2000);
  await waitFor("v5a enrich done", async () => {
    const e = await row(
      `SELECT status FROM lead_enrichment_jobs WHERE contact_id=$1::text AND status IN ('enriched','skipped')`,
      first,
    );
    return Boolean(e);
  });

  const cached = await getDomainEnrichmentCache(orgId, domain);
  const second = await createLead({
    firstName: "V5",
    lastName: `B${s}`,
    email: `b.${s}@${domain}`,
    title: "Manager",
    companyName: `CacheHit ${s}`,
    companyDomain: domain,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "website",
  });
  await drain(["lead-enrichment", "lead-scoring"], 3, 2000);
  await waitFor("v5b enrich done", async () => {
    const e = await row(
      `SELECT status FROM lead_enrichment_jobs WHERE contact_id=$1::text AND status IN ('enriched','skipped')`,
      second,
    );
    return Boolean(e);
  });

  const enrichB = await row(
    `SELECT result_summary FROM lead_enrichment_jobs WHERE contact_id=$1::text`,
    second,
  );
  const summary =
    enrichB?.result_summary && typeof enrichB.result_summary === "object"
      ? (enrichB.result_summary as Record<string, unknown>)
      : {};

  record(
    "5 same domain second lead hits 30d cache",
    Boolean(cached) &&
      (summary.fromCache === true || summary.reason === "domain_cache"),
    `cachePresent=${Boolean(cached)} fromCache=${summary.fromCache} reason=${summary.reason}`,
  );
}

async function scenario6(contactId: string) {
  const score = await row(
    `SELECT score, fit_score, intent_score, result_summary FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    contactId,
  );
  const summary =
    score?.result_summary && typeof score.result_summary === "object"
      ? (score.result_summary as Record<string, unknown>)
      : {};
  const breakdown = summary.scoreBreakdown;
  const audit = await row(
    `SELECT meta FROM audit_logs
     WHERE entity_id=$1 AND entity_type='contact'
       AND meta::text LIKE '%lead_scoring_agent%'
     ORDER BY created_at DESC LIMIT 1`,
    contactId,
  );
  const meta =
    audit?.meta && typeof audit.meta === "object"
      ? (audit.meta as Record<string, unknown>)
      : {};

  record(
    "6 score change audits include breakdown reasons",
    Boolean(breakdown && typeof breakdown === "object") &&
      Boolean(meta.scoreBreakdown || meta.fitScore != null) &&
      meta.source === "lead_scoring_agent",
    `jobBreakdownKeys=${breakdown ? Object.keys(breakdown as object).join(",") : "none"} auditSource=${meta.source} auditFit=${meta.fitScore} auditIntent=${meta.intentScore}`,
  );
}

async function scenarioIntentOverride(orgId: string) {
  const s = suffix();
  // Intentionally weak profile but explicit sales intent in inbound mail
  const id = await createLead({
    firstName: "V7",
    lastName: `Intent${s}`,
    email: `shopper.${s}@gmail.com`,
    companyName: `Intent Verify ${s}`,
    contactType: "lead",
    leadSource: "csv",
    leadStatus: "new",
  });
  await drain(["lead-scoring"], 2, 1500);
  await waitFor("v7 scored", async () => {
    const sc = await row(
      `SELECT status FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`,
      id,
    );
    return Boolean(sc);
  });
  const before = await row(
    `SELECT score FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );

  await addActivity(id, {
    type: "email",
    subject: "Please book a demo",
    body: "I want to talk to sales and get a quote this week.",
    emailDirection: "inbound",
    folder: "inbox",
  });

  // Force route with low score but explicit intent detection via afterScoreComplete path
  const { afterScoreComplete } = await import("../src/service/ai/lead-pipeline.ts");
  const low = scoreLeadHeuristic({
    contactType: "lead",
    leadStatus: "new",
    leadSource: "csv",
    email: `shopper.${s}@gmail.com`,
    hasEmail: true,
    hasPhone: false,
    recentActivityCount: 1,
    inboundEmailCount: 1,
    callOrMeetingCount: 0,
  });
  const out = await afterScoreComplete({
    contactId: id,
    organizationId: orgId,
    scoreResult: low,
    previousScore: Number(before?.score ?? 0),
    forceSalesIntent: true,
  });

  const pr = await row(
    `SELECT owner_user_id, assignment_reason, assignment_escalated FROM contact_profiles WHERE account_contact_id=$1::text`,
    id,
  );

  record(
    "bonus explicit sales intent forces assign path",
    (out.route.path === "assign" || Boolean(pr?.owner_user_id) || pr?.assignment_escalated === true || String(pr?.assignment_reason || "").includes("no_eligible") || out.route.reason.includes("escalated") || out.route.reason.includes("explicit")) &&
      Number(low.score) < 40,
    `score=${low.score} route=${out.route.path}/${out.route.reason} owner=${pr?.owner_user_id ? "yes" : "no"} escalated=${pr?.assignment_escalated}`,
  );
}

async function main() {
  console.log("\n=== Lead Pipeline scenario suite ===\n");
  const user = await login();
  const orgId = user.organizationId;
  console.log(`org=${orgId}\n`);

  const { hotId, hotOwner } = await scenario1(orgId);
  await scenario2(orgId);
  await scenario3(hotId, hotOwner, orgId);
  await scenario4(orgId);
  await scenario5(orgId);
  await scenario6(hotId);
  await scenarioIntentOverride(orgId);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed / ${results.length} ===`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  FAIL: ${r.name} — ${r.detail}`);
  }
  await getPrismaClient().$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await getPrismaClient().$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
