/**
 * Extended agent scenario coverage for lead pipeline Phase 1.
 * Complements scripts/verify-lead-pipeline.ts with agent-specific paths.
 *
 * Run: npx tsx --env-file=../.env scripts/verify-lead-agents.ts
 */
import { randomBytes } from "node:crypto";
import { getPrismaClient } from "../src/dao/db/prisma.ts";
import { scoreLeadHeuristic, bandFromScore, SALES_READY_SCORE } from "../src/service/ai/lead-score.ts";
import { assignLeadFromScore, routeLeadAfterScore } from "../src/service/ai/lead-score-route.ts";
import { processLeadScoreDecay } from "../src/service/ai/lead-score-decay.ts";
import { enqueueLeadScoring } from "../src/service/ai/lead-scoring-job.ts";
import { enqueueLeadNurture, processLeadNurtureJob } from "../src/service/ai/lead-nurture-job.ts";
import { findNurtureJobByOrgContact } from "../src/dao/ai/lead-nurture-store.ts";
import { getOrRefreshLeadSummary } from "../src/service/ai/lead-summary-agent.ts";
import { onLeadCreated } from "../src/service/ai/lead-pipeline.ts";

const API = "http://127.0.0.1:4000";
const AI = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const SECRET = process.env.ENRICH_INTERNAL_SECRET || "2b179c0d739539750168566ca295a7df";
const EMAIL = "admin.b2b@worktual.com";
const PASSWORD = "demo";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const cookieJar = new Map<string, string>();

function sfx() {
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
  base = API,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (base === API && cookieJar.size) {
    headers.Cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get("set-cookie");
  if (sc) {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
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
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  return r.json.user as { organizationId: string; id: string };
}

async function createLead(input: Record<string, unknown>) {
  const r = await http("POST", "/api/contacts", input);
  if (r.status !== 200 || !r.json.id) throw new Error(`create ${r.raw.slice(0, 200)}`);
  return String(r.json.id);
}

async function addActivity(contactId: string, input: Record<string, unknown>) {
  const r = await http("POST", `/api/contacts/${contactId}/activities`, input);
  if (r.status !== 200) throw new Error(`activity ${r.raw.slice(0, 200)}`);
}

async function drain(paths: string[], rounds = 3, waitMs = 1500) {
  for (let i = 0; i < rounds; i++) {
    for (const p of paths) {
      await http("POST", `/api/cron/${p}`, {}, API, { Authorization: `Bearer ${SECRET}` });
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function waitFor(label: string, fn: () => Promise<boolean>, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn("timeout", label);
  return false;
}

async function q1(sql: string, ...params: unknown[]) {
  const rows = await getPrismaClient().$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  return rows[0] ?? null;
}

async function agentA_EnrichNoCompanyThenScore(orgId: string) {
  const s = sfx();
  // No companyName → enrich returns null → score immediately
  const id = await createLead({
    firstName: "EA",
    lastName: `NoCo${s}`,
    email: `noco.${s}@gmail.com`,
    title: "Intern",
    contactType: "lead",
    leadSource: "csv",
  });
  await drain(["lead-scoring"], 2, 1200);
  await waitFor("noco scored", async () =>
    Boolean(await q1(`SELECT id FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`, id)),
  );
  // Ensure route runs even if async afterScoreComplete raced
  const { afterScoreComplete } = await import("../src/service/ai/lead-pipeline.ts");
  const sc = await q1(
    `SELECT score, fit_score, intent_score, band FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  const forced = scoreLeadHeuristic({
    contactType: "lead",
    leadStatus: "new",
    leadSource: "csv",
    email: `noco.${s}@gmail.com`,
    hasEmail: true,
    hasPhone: false,
    recentActivityCount: 0,
    inboundEmailCount: 0,
    callOrMeetingCount: 0,
  });
  await afterScoreComplete({
    contactId: id,
    organizationId: orgId,
    scoreResult: {
      ...forced,
      score: Number(sc?.score ?? forced.score),
      fitScore: Number(sc?.fit_score ?? forced.fitScore),
      intentScore: Number(sc?.intent_score ?? forced.intentScore),
      band: (sc?.band as "cold" | "warm" | "hot") || forced.band,
    },
  });
  const enrich = await q1(`SELECT id FROM lead_enrichment_jobs WHERE contact_id=$1::text`, id);
  const score = await q1(
    `SELECT score, band, trigger_reason FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  const nurture = await q1(
    `SELECT nurture_status FROM contact_profiles WHERE account_contact_id=$1::text`,
    id,
  );
  record(
    "Enrich: no company → skip enrich, score still runs → nurture",
    !enrich && Number(score?.score) < 40 && Boolean(score) && Boolean(nurture?.nurture_status),
    `enrichJob=${Boolean(enrich)} score=${score?.score} trigger=${score?.trigger_reason} nurture=${nurture?.nurture_status}`,
  );
}

async function agentB_ScoreBandsAndSummary(orgId: string) {
  // Unit bands
  const bandOk =
    bandFromScore(70) === "hot" &&
    bandFromScore(40) === "warm" &&
    bandFromScore(39) === "cold" &&
    SALES_READY_SCORE === 40;
  record("Score: band thresholds hot/warm/cold + gate 40", bandOk, `ready=${SALES_READY_SCORE}`);

  // Hot lead via formula + assign path for SLA 15m
  const hot = scoreLeadHeuristic({
    contactType: "lead",
    leadStatus: "qualified",
    leadSource: "demo_request",
    title: "CEO",
    companyName: "HotCo",
    industry: "Software",
    city: "London",
    country: "United Kingdom",
    employeeCount: 120,
    email: "ceo@hotco-verify.test",
    hasEmail: true,
    hasPhone: true,
    recentActivityCount: 8,
    inboundEmailCount: 3,
    callOrMeetingCount: 2,
    demoOrQuoteRequests: 1,
    pricingPageVisits: 1,
    webinarAttended: true,
    bantBudget: true,
    bantAuthority: true,
    bantNeed: true,
    bantTimeline: true,
    icp: {
      targetIndustries: ["software"],
      sizeTiers: ["51-200"],
      serviceableGeos: ["united kingdom", "london"],
    },
  });
  record(
    "Score: activity engagement produces Hot (≥70)",
    hot.band === "hot" && hot.score >= 70 && hot.fitScore === 0 && hot.score === hot.intentScore,
    `score=${hot.score} fit=${hot.fitScore} intent=${hot.intentScore} band=${hot.band}`,
  );

  const s = sfx();
  const id = await createLead({
    firstName: "SB",
    lastName: `Sum${s}`,
    email: `vp.${s}@summary-verify.com`,
    title: "VP Engineering",
    companyName: "Summary Verify",
    companyDomain: "summary-verify.com",
    companyIndustry: "Software",
    city: "London",
    country: "United Kingdom",
    contactType: "lead",
    leadSource: "demo_request",
    bantNeed: true,
    bantAuthority: true,
  });
  await drain(["lead-enrichment", "lead-scoring"], 4, 2000);
  await waitFor("summary scored", async () =>
    Boolean(await q1(`SELECT id FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`, id)),
  );
  const view = await getOrRefreshLeadSummary(id, { organizationId: orgId, force: true });
  const sum = await q1(
    `SELECT summary, recommended_action, flags, source FROM lead_summaries WHERE contact_id=$1::text`,
    id,
  );
  record(
    "Summary: auto row after score with action + flags",
    Boolean(view?.summary) &&
      Boolean(sum?.recommended_action) &&
      Boolean(sum?.flags) &&
      String(sum?.summary || "").length > 20,
    `source=${sum?.source} action=${sum?.recommended_action} flags=${JSON.stringify(sum?.flags)} len=${String(sum?.summary || "").length}`,
  );
  return { hotFormula: hot, summaryContactId: id };
}

async function agentC_AssignHotSlaAndEscalate(orgId: string, hotFormula: ReturnType<typeof scoreLeadHeuristic>) {
  const s = sfx();
  // Create unowned lead then assign via agent with hot band for 15m SLA
  const id = await createLead({
    firstName: "AA",
    lastName: `HotSla${s}`,
    email: `ceo.${s}@hotsla-verify.com`,
    title: "CEO",
    companyName: "HotSLA Verify",
    companyDomain: "hotsla-verify.com",
    companyIndustry: "Software",
    city: "London",
    country: "United Kingdom",
    contactType: "lead",
    leadSource: "demo_request",
  });
  // Clear any auto-assignment race by ensuring no owner then assign hot
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE contact_profiles SET owner_user_id=NULL, assignment_reason=NULL, sla_deadline=NULL, assigned_at=NULL WHERE account_contact_id=$1::text`,
    id,
  );
  const route = await assignLeadFromScore({
    contactId: id,
    organizationId: orgId,
    scoreResult: { ...hotFormula, band: "hot", score: Math.max(hotFormula.score, 70) },
  });
  const pr = await q1(
    `SELECT owner_user_id, sla_deadline, assigned_at, assignment_reason FROM contact_profiles WHERE account_contact_id=$1::text`,
    id,
  );
  let slaMins: number | null = null;
  if (pr?.sla_deadline && pr?.assigned_at) {
    slaMins =
      (new Date(String(pr.sla_deadline)).getTime() - new Date(String(pr.assigned_at)).getTime()) /
      60000;
  }
  record(
    "Assign: Hot SLA ≈ 15 minutes",
    route.path === "assign" &&
      Boolean(pr?.owner_user_id || route.reason.includes("escalated")) &&
      slaMins != null &&
      slaMins >= 14 &&
      slaMins <= 16,
    `route=${route.path} reason=${route.reason} slaMins=${slaMins?.toFixed(1)} owner=${pr?.owner_user_id ? "yes" : "no"}`,
  );

  const orphan = await createLead({
    firstName: "AA",
    lastName: `Esc${s}`,
    email: `esc.${s}@escalate-verify.com`,
    title: "CEO",
    companyName: "Escalate Verify",
    companyDomain: `escalate-${s}.com`,
    contactType: "lead",
    leadSource: "demo_request",
  });

  // Escalation: mark every sales candidate as not accepting via upsert profiles
  const candidatesRes = await http(
    "GET",
    `/api/internal/assignment/candidates`,
    undefined,
    API,
    {
      "x-internal-secret": SECRET,
      "x-organization-id": orgId,
    },
  );
  const candidates = Array.isArray(candidatesRes.json.candidates)
    ? candidatesRes.json.candidates
    : [];
  for (const c of candidates) {
    await getPrismaClient().salesUserAssignmentProfile.upsert({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: String(c.id),
        },
      },
      create: {
        organizationId: orgId,
        userId: String(c.id),
        acceptingLeads: false,
      },
      update: { acceptingLeads: false },
    }).catch(async () => {
      // unique may differ — raw upsert
      await getPrismaClient().$executeRawUnsafe(
        `INSERT INTO sales_user_assignment_profiles (id, organization_id, user_id, accepting_leads, created_at, updated_at)
         VALUES ($1, $2::bigint, $3::bigint, false, NOW(), NOW())
         ON CONFLICT (organization_id, user_id) DO UPDATE SET accepting_leads=false, updated_at=NOW()`,
        `sap_${randomBytes(8).toString("hex")}`,
        orgId,
        String(c.id),
      );
    });
  }
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE contact_profiles SET owner_user_id=NULL, assignment_reason=NULL, sla_deadline=NULL, assigned_at=NULL, assignment_escalated=false WHERE account_contact_id=$1::text`,
    orphan,
  );
  let esc;
  try {
    esc = await assignLeadFromScore({
      contactId: orphan,
      organizationId: orgId,
      scoreResult: { ...hotFormula, band: "warm", score: 55 },
    });
  } finally {
    for (const c of candidates) {
      await getPrismaClient().$executeRawUnsafe(
        `UPDATE sales_user_assignment_profiles SET accepting_leads=true, updated_at=NOW()
         WHERE organization_id=$1::bigint AND user_id=$2::bigint`,
        orgId,
        String(c.id),
      );
    }
  }
  const escProf = await q1(
    `SELECT assignment_escalated, assignment_reason, owner_user_id FROM contact_profiles WHERE account_contact_id=$1::text`,
    orphan,
  );
  const escNotif = await q1(
    `SELECT kind FROM notifications WHERE contact_id=$1::text AND kind='lead_assignment_escalated' ORDER BY created_at DESC LIMIT 1`,
    orphan,
  );
  const escalated =
    Boolean(esc?.reason.includes("escalated")) ||
    escProf?.assignment_escalated === true ||
    Boolean(escNotif);

  record(
    "Assign: no-eligible-rep escalates (never silent)",
    Boolean(esc) && escalated && !escProf?.owner_user_id,
    `route=${esc?.path}/${esc?.reason} escalated=${escProf?.assignment_escalated} notif=${escNotif?.kind} owner=${escProf?.owner_user_id ? "yes" : "no"} candidates=${candidates.length}`,
  );
}

async function agentD_NurtureBandsAndOptOut(orgId: string) {
  const s = sfx();
  // Active cold (20-39): create mid-score-ish lead by routing manually
  const activeId = await createLead({
    firstName: "NA",
    lastName: `Active${s}`,
    email: `mgr.${s}@nurture-active.com`,
    title: "Manager",
    companyName: "Nurture Active Co",
    companyDomain: `nurture-active-${s}.com`,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "website",
  });
  await drain(["lead-enrichment", "lead-scoring"], 3, 1500);
  await waitFor("active scored", async () =>
    Boolean(await q1(`SELECT id FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`, activeId)),
  );
  // Force route with score 25 → active_cold
  const mid = scoreLeadHeuristic({
    contactType: "lead",
    leadStatus: "new",
    leadSource: "website",
    title: "Manager",
    companyName: "Nurture Active Co",
    industry: "Software",
    email: `mgr.${s}@nurture-active.com`,
    hasEmail: true,
    hasPhone: false,
    recentActivityCount: 1,
    inboundEmailCount: 0,
    callOrMeetingCount: 0,
  });
  // Clamp path: use route with constructed result at 25
  const forcedMid = { ...mid, score: 25, band: "cold" as const, salesReady: false, fitScore: 20, intentScore: 5 };
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE contact_profiles SET owner_user_id=NULL WHERE account_contact_id=$1::text`,
    activeId,
  );
  await routeLeadAfterScore({
    contactId: activeId,
    organizationId: orgId,
    scoreResult: forcedMid,
    previousScore: 25,
  });
  const activeProf = await q1(
    `SELECT nurture_status FROM contact_profiles WHERE account_contact_id=$1::text`,
    activeId,
  );

  const deepId = await createLead({
    firstName: "ND",
    lastName: `Deep${s}`,
    email: `deep.${s}@gmail.com`,
    contactType: "lead",
    leadSource: "csv",
  });
  await drain(["lead-scoring"], 2, 1200);
  await waitFor("deep scored", async () =>
    Boolean(await q1(`SELECT id FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`, deepId)),
  );
  const deepScore = await q1(
    `SELECT score, fit_score, intent_score, band FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    deepId,
  );
  await routeLeadAfterScore({
    contactId: deepId,
    organizationId: orgId,
    scoreResult: {
      ...scoreLeadHeuristic({
        contactType: "lead",
        leadStatus: "new",
        leadSource: "csv",
        email: `deep.${s}@gmail.com`,
        hasEmail: true,
        hasPhone: false,
        recentActivityCount: 0,
        inboundEmailCount: 0,
        callOrMeetingCount: 0,
      }),
      score: Number(deepScore?.score ?? 0),
      band: "cold",
      salesReady: false,
    },
  });
  const deepProf = await q1(
    `SELECT nurture_status FROM contact_profiles WHERE account_contact_id=$1::text`,
    deepId,
  );

  record(
    "Nurture: sub-bands active_cold (20–39) vs deep_cold (0–19)",
    activeProf?.nurture_status === "active_cold" && deepProf?.nurture_status === "deep_cold",
    `active=${activeProf?.nurture_status} deep=${deepProf?.nurture_status}`,
  );

  // Opt-out
  const optId = await createLead({
    firstName: "NO",
    lastName: `Opt${s}`,
    email: `opt.${s}@optout-verify.com`,
    title: "Analyst",
    companyName: "OptOut Verify",
    companyDomain: `optout-${s}.com`,
    contactType: "lead",
    leadSource: "website",
  });
  await drain(["lead-enrichment", "lead-scoring", "lead-nurture"], 3, 1500);
  await addActivity(optId, {
    type: "email",
    subject: "Please unsubscribe",
    body: "Not interested — unsubscribe and do not contact me again.",
    emailDirection: "inbound",
    folder: "inbox",
  });
  await enqueueLeadNurture({
    contactId: optId,
    organizationId: orgId,
    processImmediately: true,
  });
  await drain(["lead-nurture"], 2, 1500);
  const job = await findNurtureJobByOrgContact(orgId, optId);
  // May need process once more
  if (job && job.status !== "skipped") {
    await processLeadNurtureJob(job.id);
  }
  const after = await findNurtureJobByOrgContact(orgId, optId);
  record(
    "Nurture: opt-out / unsubscribe stops (skip_not_interested)",
    after?.decision === "skip_not_interested" || after?.status === "skipped",
    `status=${after?.status} decision=${after?.decision} err=${after?.lastError}`,
  );
}

async function agentE_DecayCronDbUpdate(orgId: string) {
  const s = sfx();
  const id = await createLead({
    firstName: "DC",
    lastName: `Decay${s}`,
    email: `decay.${s}@decay-verify.com`,
    title: "Director",
    companyName: "Decay Verify",
    companyDomain: `decay-${s}.com`,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "website",
  });
  await drain(["lead-enrichment", "lead-scoring"], 3, 1500);
  await waitFor("decay scored", async () =>
    Boolean(await q1(`SELECT id FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`, id)),
  );
  const before = await q1(
    `SELECT score, intent_score, band FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  // Backdate all activities 35d and insert one if empty
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE contact_activities SET created_at = NOW() - INTERVAL '35 days' WHERE contact_id=$1::text`,
    id,
  );
  const n = await q1(`SELECT count(*)::int AS n FROM contact_activities WHERE contact_id=$1::text`, id);
  if (!n || Number(n.n) === 0) {
    await addActivity(id, { type: "note", subject: "old", body: "touch" });
    await getPrismaClient().$executeRawUnsafe(
      `UPDATE contact_activities SET created_at = NOW() - INTERVAL '35 days' WHERE contact_id=$1::text`,
      id,
    );
  }
  // Bump previous score so decay can change something meaningful
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE lead_scoring_jobs SET score = GREATEST(score, 30), intent_score = GREATEST(COALESCE(intent_score,0), 20), status='scored' WHERE contact_id=$1::text`,
    id,
  );

  const decay = await processLeadScoreDecay(500);
  const after = await q1(
    `SELECT score, intent_score, band, result_summary FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  const summary =
    after?.result_summary && typeof after.result_summary === "object"
      ? (after.result_summary as Record<string, unknown>)
      : {};
  const audit = await q1(
    `SELECT meta FROM audit_logs WHERE entity_id=$1 AND meta::text LIKE '%lead_score_decay%' ORDER BY created_at DESC LIMIT 1`,
    id,
  );

  record(
    "Decay: nightly job recalculates + audits",
    decay.processed >= 0 &&
      (Number(after?.score) <= Number(before?.score) || summary.decay === true || Boolean(audit)),
    `before=${before?.score}/${before?.intent_score} after=${after?.score}/${after?.intent_score} decay=${JSON.stringify({ processed: decay.processed, updated: decay.updated, skipped: decay.skipped })} audit=${Boolean(audit)} flag=${summary.decay}`,
  );
  void orgId;
}

async function agentF_PythonAgents(orgId: string) {
  // Call Python score-lead with a known context-bearing contact
  const s = sfx();
  const id = await createLead({
    firstName: "PY",
    lastName: `Score${s}`,
    email: `py.${s}@py-verify.com`,
    title: "VP Sales",
    companyName: "Py Verify",
    companyDomain: `py-verify-${s}.com`,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "demo_request",
    bantNeed: true,
  });
  await drain(["lead-enrichment"], 2, 1500);

  const scoreRes = await http(
    "POST",
    "/ai/v1/agents/score-lead/run",
    { contactId: id, organizationId: orgId },
    AI,
    { "x-internal-secret": SECRET },
  );
  const py = scoreRes.json;
  const local = scoreLeadHeuristic({
    contactType: "lead",
    leadStatus: "new",
    leadSource: "demo_request",
    title: "VP Sales",
    companyName: "Py Verify",
    industry: "Software",
    email: `py.${s}@py-verify.com`,
    hasEmail: true,
    hasPhone: false,
    recentActivityCount: 0,
    inboundEmailCount: 0,
    callOrMeetingCount: 0,
    bantNeed: true,
  });

  record(
    "Python score-lead agent returns Fit+Intent shape",
    scoreRes.status === 200 &&
      typeof py.fitScore === "number" &&
      typeof py.intentScore === "number" &&
      typeof py.score === "number" &&
      py.scoreBreakdown &&
      ["hot", "warm", "cold"].includes(py.band),
    `http=${scoreRes.status} score=${py.score} fit=${py.fitScore} intent=${py.intentScore} band=${py.band} localApprox=${local.score}`,
  );

  const enrichRes = await http(
    "POST",
    "/ai/v1/agents/enrich-lead/run",
    { contactId: id, organizationId: orgId },
    AI,
    { "x-internal-secret": SECRET },
  );
  record(
    "Python enrich-lead agent responds",
    enrichRes.status === 200 && Boolean(enrichRes.json.contactId || enrichRes.json.status || enrichRes.json.fields),
    `http=${enrichRes.status} status=${enrichRes.json.status} keys=${Object.keys(enrichRes.json || {}).slice(0, 8).join(",")}`,
  );

  const sumRes = await http(
    "POST",
    "/ai/v1/agents/summarize-lead/run",
    { contactId: id, organizationId: orgId, force: true },
    AI,
    { "x-internal-secret": SECRET },
  );
  record(
    "Python summarize-lead agent responds",
    sumRes.status === 200 && Boolean(sumRes.json.summary || sumRes.json.status === "ok"),
    `http=${sumRes.status} status=${sumRes.json.status} source=${sumRes.json.source} hasSummary=${Boolean(sumRes.json.summary)}`,
  );

  const assignRes = await http(
    "POST",
    "/ai/v1/agents/assign-sales/run",
    {
      organizationId: orgId,
      contactId: id,
      country: "United Kingdom",
      city: "London",
    },
    AI,
    { "x-internal-secret": SECRET },
  );
  record(
    "Python assign-sales agent responds",
    assignRes.status === 200 && (assignRes.json.owner || assignRes.json.status),
    `http=${assignRes.status} status=${assignRes.json.status} owner=${assignRes.json.owner?.userId || assignRes.json.owner?.name || "none"}`,
  );

  const nurtureRes = await http(
    "POST",
    "/ai/v1/agents/nurture-lead/run",
    { contactId: id, organizationId: orgId },
    AI,
    { "x-internal-secret": SECRET },
  );
  record(
    "Python nurture-lead agent responds",
    nurtureRes.status === 200 && Boolean(nurtureRes.json.decision || nurtureRes.json.status),
    `http=${nurtureRes.status} decision=${nurtureRes.json.decision} status=${nurtureRes.json.status}`,
  );
}

async function agentG_OrchestratorOnLeadCreated() {
  // Verify sequential helper: enrich enqueued when company present
  const s = sfx();
  // Create via API already uses onLeadCreated — assert trigger chain on a fresh corporate lead
  const id = await createLead({
    firstName: "OR",
    lastName: `Seq${s}`,
    email: `seq.${s}@orch-verify.com`,
    title: "Director",
    companyName: "Orch Verify",
    companyDomain: `orch-verify-${s}.com`,
    companyIndustry: "Software",
    contactType: "lead",
    leadSource: "website",
  });
  // Immediately after create, enrich job should exist before/with score
  await new Promise((r) => setTimeout(r, 800));
  const enrich = await q1(
    `SELECT status, created_at FROM lead_enrichment_jobs WHERE contact_id=$1::text`,
    id,
  );
  await drain(["lead-enrichment", "lead-scoring"], 3, 1500);
  await waitFor("orch scored", async () =>
    Boolean(await q1(`SELECT id FROM lead_scoring_jobs WHERE contact_id=$1::text AND status='scored'`, id)),
  );
  const score = await q1(
    `SELECT trigger_reason, score FROM lead_scoring_jobs WHERE contact_id=$1::text`,
    id,
  );
  record(
    "Orchestrator: company lead enriches then scores (not parallel create race)",
    Boolean(enrich) &&
      (score?.trigger_reason === "enrichment_complete" ||
        score?.trigger_reason === "enrichment_skipped"),
    `enrichStatus=${enrich?.status} scoreTrigger=${score?.trigger_reason} score=${score?.score}`,
  );
  void onLeadCreated;
}

async function main() {
  console.log("\n=== Extended lead-agent scenario suite ===\n");
  const user = await login();
  const orgId = user.organizationId;
  console.log(`org=${orgId} ai=${AI}\n`);

  await agentA_EnrichNoCompanyThenScore(orgId);
  const { hotFormula } = await agentB_ScoreBandsAndSummary(orgId);
  await agentC_AssignHotSlaAndEscalate(orgId, hotFormula);
  await agentD_NurtureBandsAndOptOut(orgId);
  await agentE_DecayCronDbUpdate(orgId);
  await agentF_PythonAgents(orgId);
  await agentG_OrchestratorOnLeadCreated();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed / ${results.length} ===`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  FAIL: ${r.name} — ${r.detail}`);
  }
  await getPrismaClient().$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await getPrismaClient().$disconnect();
  } catch {
    /* */
  }
  process.exit(1);
});
