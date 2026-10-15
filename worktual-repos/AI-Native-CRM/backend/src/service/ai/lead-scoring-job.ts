/**
 * Lead Scoring Agent.
 *
 * Continuously evaluates leads on fit, engagement, intent, and conversion
 * likelihood. Scores immediately on create/import and recalculates when
 * meaningful CRM signals change (activities, enrichment, stage updates).
 */

import { getPrismaClient } from "@/dao/db/prisma";
import { getContact, promoteContactToLeadIfEligible } from "@/dao/contacts/contact-service";
import {
  isSalesReadyScore,
  SALES_READY_SCORE,
  classifySeniorityTier,
  emailDomainType,
  type LeadScoreResult,
  type LeadIcpConfig,
} from "@/service/ai/lead-score";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import { afterScoreComplete } from "@/service/ai/lead-pipeline";
import { publishLeadSummaryEvent } from "@/service/ai/lead-summary-events";
import {
  buildLeadSummaryContext,
  loadOmniChannelSummary,
  omniChannelHash,
} from "@/service/ai/lead-summary-agent";
import { deriveProcessNextAction } from "@/service/ai/lead-next-action";
import { findLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { recordLoadContextStep, recordAgentStep } from "@/dao/ai/agent-step-events";
import {
  claimScoringJob,
  findScoringJobByContactId,
  findScoringJobById,
  listDueScoringJobs,
  listDueScoringOrganizationIds,
  reclaimStaleScoringJobs,
  updateScoringJob,
  upsertScoringJob,
  type ScoringJobRow,
} from "@/dao/ai/lead-scoring-store";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  applyScoreGuardrails,
  enrichLeadScoreSignalsFromSnippet,
} from "@/service/ai/lead-score-guardrails";
import { parseEmployeeNumber } from "@/service/ai/lead-enrichment-wikidata";

const MAX_ATTEMPTS = 5;

/** If one of these arrives while a score job is in flight, re-run after the current pass. */
const RESCORE_AFTER_TRIGGERS = new Set([
  "enrichment_complete",
  "contact_updated",
  "activity",
  "inbound_email",
  "omni_channel_summary",
  "conversation_closed_omni_summary",
  "nurture_sent",
]);

export function shouldRescoreAfterTrigger(
  startTrigger: string | null | undefined,
  latestTrigger: string | null | undefined,
): boolean {
  if (!latestTrigger || latestTrigger === startTrigger) return false;
  const triggerKind = latestTrigger.split(":", 1)[0] ?? latestTrigger;
  return (
    RESCORE_AFTER_TRIGGERS.has(latestTrigger) ||
    triggerKind === "summary_refreshed"
  );
}

const SIZE_TIER_MIDPOINT: Record<string, number> = {
  "1-10": 5,
  "11-50": 30,
  "51-200": 125,
  "201-1000": 600,
  "1000+": 5000,
};

function blank(value: string | null | undefined): boolean {
  return !value?.trim();
}

export function scoreSignalFingerprint(ctx: {
  omniChannelSummary: string | null;
  recentActivityCount: number;
  inboundEmailCount: number;
  callOrMeetingCount: number;
  demoOrQuoteRequests: number;
  schedulingReplies: number;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
  companyName?: string | null;
  title?: string | null;
  hasEmail?: boolean;
  hasPhone?: boolean;
}): string {
  return [
    omniChannelHash(ctx.omniChannelSummary) ?? "",
    ctx.recentActivityCount,
    ctx.inboundEmailCount,
    ctx.callOrMeetingCount,
    ctx.demoOrQuoteRequests,
    ctx.schedulingReplies,
    ctx.bantBudget ? "1" : "0",
    ctx.bantAuthority ? "1" : "0",
    ctx.bantNeed ? "1" : "0",
    ctx.bantTimeline ? "1" : "0",
    (ctx.companyName ?? "").trim().toLowerCase(),
    (ctx.title ?? "").trim().toLowerCase(),
    ctx.hasEmail ? "1" : "0",
    ctx.hasPhone ? "1" : "0",
  ].join("|");
}

function fingerprintFromJob(job: ScoringJobRow): string | null {
  const summary =
    job.resultSummary &&
    typeof job.resultSummary === "object" &&
    !Array.isArray(job.resultSummary)
      ? (job.resultSummary as Record<string, unknown>)
      : {};
  return typeof summary.signalFingerprint === "string"
    ? summary.signalFingerprint
    : null;
}

function employeeCountFromSnapshotSize(
  raw: string | null | undefined,
): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const tierMid = SIZE_TIER_MIDPOINT[trimmed];
  if (tierMid != null) return tierMid;
  return parseEmployeeNumber(trimmed);
}

/** Fill score firmographics from enrichment snapshot when CRM company row is sparse. */
export function applyEnrichmentSnapshotToScoreFields(input: {
  companyName: string | null;
  industry: string | null;
  employeeCount: number | null;
  city: string | null;
  country: string | null;
  snapshot: Record<string, unknown> | null;
}): {
  companyName: string | null;
  industry: string | null;
  employeeCount: number | null;
  city: string | null;
  country: string | null;
} {
  const snapshot = input.snapshot;
  if (!snapshot) return input;

  const snapCompany =
    typeof snapshot.company_name === "string" ? snapshot.company_name : null;
  const snapIndustry =
    typeof snapshot.industry === "string" ? snapshot.industry : null;
  const snapSize =
    typeof snapshot.company_size === "string" ? snapshot.company_size : null;
  const snapGeo =
    typeof snapshot.geography === "string" ? snapshot.geography : null;

  const employeeCount =
    input.employeeCount ??
    employeeCountFromSnapshotSize(snapSize);

  let city = input.city;
  let country = input.country;
  if (blank(city) && snapGeo?.trim()) {
    city = snapGeo.trim();
  }

  return {
    companyName: blank(input.companyName) ? snapCompany?.trim() || null : input.companyName,
    industry: blank(input.industry) ? snapIndustry?.trim() || null : input.industry,
    employeeCount,
    city: city ?? null,
    country: country ?? null,
  };
}

function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export type LeadScoreContext = {
  contactId: string;
  organizationId: string;
  displayName: string;
  contactType: string | null;
  leadStatus: string | null;
  leadSource: string | null;
  title: string | null;
  companyName: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  employeeCount: number | null;
  email: string | null;
  seniorityTier: string | null;
  emailDomainType: "corporate" | "personal" | null;
  bantBudget: boolean | null;
  bantAuthority: boolean | null;
  bantNeed: boolean | null;
  bantTimeline: boolean | null;
  hasEmail: boolean;
  hasPhone: boolean;
  recentActivityCount: number;
  inboundEmailCount: number;
  callOrMeetingCount: number;
  pricingPageVisits: number;
  demoOrQuoteRequests: number;
  emailOpens: number;
  emailClicks: number;
  contentDownloads: number;
  webinarAttended: boolean;
  websiteVisits7d: number;
  daysSinceLastActivity: number | null;
  convertedOutcome: boolean;
  icp: LeadIcpConfig | null;
  intentDecayPenalty: number;
  ownerUserId: string | null;
  /** Inbound replies confirming a meeting/demo time slot. */
  schedulingReplies: number;
  /** Short recent inbound snippets for the score agent. */
  recentActivitySnippet: string | null;
  /** CCaaS paragraph on cdp.customer_profile.custom_fields.omniChannelSummary. */
  omniChannelSummary: string | null;
};

export async function buildLeadScoreContext(
  contactId: string,
  organizationId?: string | null,
): Promise<LeadScoreContext | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;

  const orgId = await resolveRequestOrganizationId(
    organizationId ?? contact.person.organizationId,
  );
  const prisma = getPrismaClient();

  let employeeCount: number | null = null;
  let industry = contact.person.company?.industry ?? null;
  let companyName = contact.person.company?.name ?? null;

  if (contact.person.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: contact.person.companyId, organizationId: orgId },
      select: {
        name: true,
        industry: true,
        employeeCount: true,
      },
    });
    if (company) {
      companyName = company.name;
      industry = company.industry ?? industry;
      employeeCount = company.employeeCount;
    }
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const activityRows = await prisma.$queryRawUnsafe<
    Array<{
      total: number | bigint;
      inbound_email: number | bigint;
      call_meeting: number | bigint;
      pricing: number | bigint;
      demo_quote: number | bigint;
      scheduling_replies: number | bigint;
      opens: number | bigint;
      clicks: number | bigint;
      downloads: number | bigint;
      webinar: number | bigint;
      visits_7d: number | bigint;
      last_at: Date | null;
    }>
  >(
    `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE type = 'email' AND email_direction = 'inbound'
      )::int AS inbound_email,
      COUNT(*) FILTER (
        WHERE type IN ('call', 'meeting')
      )::int AS call_meeting,
      COUNT(*) FILTER (
        WHERE subject ILIKE '%pricing%' OR body ILIKE '%pricing%'
      )::int AS pricing,
      COUNT(*) FILTER (
        WHERE (
          (type = 'email' AND email_direction = 'inbound')
          OR type IN ('call', 'meeting')
        )
        AND (
          subject ILIKE '%demo%' OR subject ILIKE '%quote%'
          OR body ILIKE '%demo%'
          OR body ILIKE '%quote%'
          OR body ILIKE '%schedule%call%'
          OR body ILIKE '%schedule%meeting%'
          OR body ILIKE '%book%a%demo%'
          OR body ILIKE '%walkthrough%'
        )
      )::int AS demo_quote,
      COUNT(*) FILTER (
        WHERE type = 'email'
          AND email_direction = 'inbound'
          AND (
            body ILIKE '%works for me%'
            OR body ILIKE '%works for us%'
            OR body ILIKE '%that time works%'
            OR body ILIKE '%confirm%time%'
            OR body ILIKE '%see you then%'
            OR body ~* '\\d{1,2}[\\.:][0-5][0-9]\\s*(am|pm)'
            OR body ~* '\\d{1,2}\\s*(am|pm)\\s*(today|tomorrow)?'
          )
      )::int AS scheduling_replies,
      COUNT(*) FILTER (
        WHERE type = 'email' AND (
          subject ILIKE '%opened%' OR body ILIKE '%email open%'
        )
      )::int AS opens,
      COUNT(*) FILTER (
        WHERE type = 'email' AND (
          subject ILIKE '%clicked%' OR body ILIKE '%link click%'
        )
      )::int AS clicks,
      COUNT(*) FILTER (
        WHERE subject ILIKE '%download%' OR body ILIKE '%downloaded%'
      )::int AS downloads,
      COUNT(*) FILTER (
        WHERE subject ILIKE '%webinar%' OR body ILIKE '%webinar%'
      )::int AS webinar,
      COUNT(*) FILTER (
        WHERE created_at >= NOW() - INTERVAL '7 days'
      )::int AS visits_7d,
      MAX(created_at) AS last_at
    FROM contact_activities
    WHERE contact_id = $1::text
      AND created_at >= $2
    `,
    contactId,
    since,
  );
  const activity = activityRows[0];

  const snippetRows = await prisma.$queryRawUnsafe<
    Array<{ subject: string | null; body: string | null }>
  >(
    `
    SELECT subject, body
    FROM contact_activities
    WHERE contact_id = $1::text
      AND type = 'email'
      AND email_direction = 'inbound'
      AND created_at >= $2
    ORDER BY created_at DESC
    LIMIT 3
    `,
    contactId,
    since,
  );
  const recentActivitySnippet = snippetRows
    .map((row) => {
      const subj = (row.subject ?? "").trim().slice(0, 120);
      const body = (row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
      return subj ? `${subj}: ${body}` : body;
    })
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 900) || null;

  const omniChannelSummary = await loadOmniChannelSummary(contactId);

  const convertedOutcome =
    Boolean(contact.person.convertedDealId) ||
    contact.person.contactType === "customer" ||
    contact.person.leadStatus === "converted";

  const snapshot = await findLeadEnrichmentSnapshot(orgId, contactId);
  const firmographics = applyEnrichmentSnapshotToScoreFields({
    companyName,
    industry,
    employeeCount,
    city: contact.person.city,
    country: contact.person.country ?? null,
    snapshot,
  });
  companyName = firmographics.companyName;
  industry = firmographics.industry;
  employeeCount = firmographics.employeeCount;

  const seniorityTier =
    (snapshot?.seniority_tier as string | null) ||
    classifySeniorityTier(contact.person.title);
  const domainType =
    (snapshot?.email_domain_type as "corporate" | "personal" | null) ||
    emailDomainType(contact.person.email);

  let icp: LeadIcpConfig | null = null;
  try {
    const icpRows = await prisma.$queryRawUnsafe<
      Array<{ lead_icp: unknown }>
    >(
      `SELECT lead_icp FROM org_assignment_settings WHERE organization_id = $1::bigint LIMIT 1`,
      orgId,
    );
    const raw = icpRows[0]?.lead_icp;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      icp = raw as LeadIcpConfig;
    }
  } catch {
    /* optional column / client lag */
  }

  const lastAt = activity?.last_at ? new Date(activity.last_at) : null;
  const daysSinceLastActivity = lastAt
    ? Math.floor((Date.now() - lastAt.getTime()) / (24 * 60 * 60_000))
    : null;

  return enrichLeadScoreSignalsFromSnippet({
    contactId,
    organizationId: orgId,
    displayName: contact.displayName,
    contactType: contact.person.contactType,
    leadStatus: contact.person.leadStatus,
    leadSource: contact.person.leadSource,
    title: contact.person.title,
    companyName,
    industry,
    city: firmographics.city,
    country: firmographics.country,
    employeeCount,
    email: contact.person.email ?? null,
    seniorityTier,
    emailDomainType: domainType,
    bantBudget: contact.person.bantBudget,
    bantAuthority: contact.person.bantAuthority,
    bantNeed: contact.person.bantNeed,
    bantTimeline: contact.person.bantTimeline,
    hasEmail: Boolean(contact.person.email?.trim()),
    hasPhone: Boolean(contact.person.phone?.trim()),
    recentActivityCount: Number(activity?.total ?? 0),
    inboundEmailCount: Number(activity?.inbound_email ?? 0),
    callOrMeetingCount: Number(activity?.call_meeting ?? 0),
    pricingPageVisits: Number(activity?.pricing ?? 0),
    demoOrQuoteRequests: Number(activity?.demo_quote ?? 0),
    emailOpens: Number(activity?.opens ?? 0),
    emailClicks: Number(activity?.clicks ?? 0),
    contentDownloads: Number(activity?.downloads ?? 0),
    webinarAttended: Number(activity?.webinar ?? 0) > 0,
    websiteVisits7d: Number(activity?.visits_7d ?? 0),
    daysSinceLastActivity,
    convertedOutcome,
    icp,
    intentDecayPenalty: 0,
    ownerUserId: contact.person.ownerUserId?.trim() || null,
    schedulingReplies: Number(activity?.scheduling_replies ?? 0),
    recentActivitySnippet,
    omniChannelSummary,
  });
}

/** Call Python score-lead. LLM-only — never persist a heuristic formula score. */
export async function computeScoreViaAgent(
  ctx: LeadScoreContext,
): Promise<LeadScoreResult> {
  const py = await callAiServiceAgent<{
    status?: string;
    source?: string;
    reason?: string;
    score?: number;
    fitScore?: number;
    intentScore?: number;
    grade?: string;
    band?: string;
    salesReady?: boolean;
    rationale?: string;
    scoreBreakdown?: LeadScoreResult["scoreBreakdown"];
    pillars?: LeadScoreResult["pillars"];
    positiveReasons?: string[];
    negativeReasons?: string[];
    behaviouralPositiveReasons?: string[];
    behaviouralNegativeReasons?: string[];
    behaviouralReasons?: string[];
    factors?: string[];
    nextBestAction?: string;
  }>(
    "score-lead",
    {
      contactId: ctx.contactId,
      organizationId: ctx.organizationId,
    },
    // Agent retries LLM internally; allow slow models up to job budget.
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  if (py?.source === "heuristic") {
    throw new Error("score-lead agent failed: heuristic_forbidden");
  }

  if (
    py?.status === "scored" &&
    typeof py.score === "number" &&
    typeof py.fitScore === "number" &&
    typeof py.intentScore === "number" &&
    py.grade &&
    py.band
  ) {
    const fitScore = py.fitScore;
    const intentScore = py.intentScore;
    return {
      score: py.score,
      fitScore,
      intentScore,
      grade: py.grade as LeadScoreResult["grade"],
      band: py.band as LeadScoreResult["band"],
      salesReady: Boolean(py.salesReady),
      rationale: py.rationale || "",
      scoreBreakdown: py.scoreBreakdown ?? {},
      pillars: py.pillars ?? {
        demographics: Math.round(fitScore * 0.5),
        firmographics: Math.round(fitScore * 0.5),
        behavioural: intentScore,
      },
      positiveReasons: py.positiveReasons ?? [],
      negativeReasons: py.negativeReasons ?? [],
      behaviouralPositiveReasons: py.behaviouralPositiveReasons ?? [],
      behaviouralNegativeReasons: py.behaviouralNegativeReasons ?? [],
      behaviouralReasons: py.behaviouralReasons ?? [],
      factors: py.factors ?? [],
      nextBestAction: py.nextBestAction?.trim() || "",
      source: "ai",
    };
  }

  throw new Error(
    `score-lead agent failed: ${py?.reason || py?.status || "unavailable"}`,
  );
}

/**
 * Idempotent enqueue: one job per org+contact. Re-queues when new signals arrive.
 */
export async function enqueueLeadScoring(input: {
  contactId: string;
  organizationId?: string | null;
  triggerReason?: string;
  processImmediately?: boolean;
}): Promise<ScoringJobRow | null> {
  const contact = await promoteContactToLeadIfEligible(input.contactId);
  if (!contact) return null;

  const organizationId = await resolveRequestOrganizationId(
    input.organizationId ?? contact.person.organizationId,
  );

  let job: ScoringJobRow;
  try {
    job = await upsertScoringJob({
      organizationId,
      contactId: input.contactId,
      triggerReason: input.triggerReason ?? "manual",
      maxAttempts: MAX_ATTEMPTS,
    });
  } catch (err) {
    console.error("lead scoring enqueue failed", input.contactId, err);
    return null;
  }

  if (input.processImmediately !== false) {
    void processLeadScoringJob(job.id).catch((err) => {
      console.error("lead scoring immediate process failed", err);
    });
  }

  return job;
}

export async function processLeadScoringJob(
  jobId: string,
): Promise<ScoringJobRow | null> {
  await reclaimStaleScoringJobs();
  const claimed = await claimScoringJob(jobId);
  if (!claimed) {
    return findScoringJobById(jobId);
  }

  const job = await findScoringJobById(jobId);
  if (!job) return null;

  const attempts = job.attempts + 1;

  try {
    const lead = await promoteContactToLeadIfEligible(job.contactId);
    if (!lead) {
      await recordLoadContextStep({
        organizationId: job.organizationId,
        agent: "lead_scoring",
        jobId,
        contactId: job.contactId,
        status: "skipped",
        label: "Lead pipeline eligibility",
        errorReason: "not_a_lead",
      });
      await updateScoringJob(jobId, {
        status: "failed",
        attempts,
        lastError: "not_a_lead",
        nextRetryAt: null,
        completedAt: new Date(),
      });
      return findScoringJobById(jobId);
    }

    const ctx = await buildLeadScoreContext(job.contactId, job.organizationId);
    if (!ctx) {
      await recordLoadContextStep({
        organizationId: job.organizationId,
        agent: "lead_scoring",
        jobId,
        contactId: job.contactId,
        status: "failed",
        label: "Loading contact & company context",
        errorReason: "contact_not_found",
      });
      await updateScoringJob(jobId, {
        status: "failed",
        attempts,
        lastError: "contact_not_found",
        nextRetryAt: null,
        completedAt: new Date(),
      });
      return findScoringJobById(jobId);
    }

    const guarded = applyScoreGuardrails(
      ctx,
      await computeScoreViaAgent(ctx),
      job.previousScore ?? job.score,
    );
    const summaryCtx = await buildLeadSummaryContext(
      job.contactId,
      job.organizationId,
    );
    const result = summaryCtx
      ? {
          ...guarded,
          nextBestAction: deriveProcessNextAction(
            summaryCtx,
            guarded.nextBestAction,
          ),
        }
      : guarded;
    const previousScore = job.previousScore ?? job.score;
    const delta =
      previousScore == null ? null : result.score - previousScore;
    const intentLift = delta != null && delta >= 15;
    const intentDrop = delta != null && delta <= -15;

    // A human can set a score while this LLM job is in flight. The manual
    // write changes the trigger to manual_override; never overwrite it with
    // the stale score computed from the earlier job snapshot.
    const latestBeforePersist = await findScoringJobById(jobId);
    if (
      latestBeforePersist?.triggerReason === "manual_override" &&
      job.triggerReason !== "manual_override"
    ) {
      return latestBeforePersist;
    }

    const updated = await updateScoringJob(jobId, {
      status: "scored",
      score: result.score,
      fitScore: result.fitScore,
      intentScore: result.intentScore,
      grade: result.grade,
      band: result.band,
      rationale: result.rationale,
      factors: result.factors,
      nextBestAction: result.nextBestAction,
      previousScore: previousScore ?? null,
      attempts,
      lastError: null,
      nextRetryAt: null,
      completedAt: new Date(),
      resultSummary: {
        salesReady: result.salesReady,
        delta,
        intentLift,
        intentDrop,
        triggerReason: job.triggerReason,
        companyName: ctx.companyName,
        leadSource: ctx.leadSource,
        recentActivityCount: ctx.recentActivityCount,
        signalFingerprint: scoreSignalFingerprint(ctx),
        scoredAt: new Date().toISOString(),
        fitScore: result.fitScore,
        intentScore: result.intentScore,
        scoreBreakdown: result.scoreBreakdown,
        pillars: result.pillars,
        positiveReasons: result.positiveReasons,
        negativeReasons: result.negativeReasons,
        behaviouralPositiveReasons: result.behaviouralPositiveReasons,
        behaviouralNegativeReasons: result.behaviouralNegativeReasons,
        behaviouralReasons: result.behaviouralReasons,
        source: result.source ?? "ai",
      },
    });

    await writeAuditLog({
      action: "update",
      entityType: "contact",
      entityId: ctx.contactId,
      organizationId: ctx.organizationId,
      meta: {
        source: "lead_scoring_agent",
        score: result.score,
        fitScore: result.fitScore,
        intentScore: result.intentScore,
        band: result.band,
        previousScore,
        scoreBreakdown: result.scoreBreakdown,
        triggerReason: job.triggerReason,
      },
    }).catch((err) => console.error("score audit failed", err));

    await recordAgentStep({
      organizationId: ctx.organizationId,
      agent: "lead_scoring",
      jobId,
      contactId: job.contactId,
      step: "compute",
      label: "Scoring fit & intent",
      status: "ok",
      detail: {
        score: result.score,
        previousScore,
        delta,
        fitScore: result.fitScore,
        intentScore: result.intentScore,
        band: result.band,
        grade: result.grade,
        source: result.source ?? "ai",
        rationale: result.rationale,
        positiveReasons: [
          ...result.positiveReasons,
          ...result.behaviouralPositiveReasons,
        ],
        negativeReasons: [
          ...result.negativeReasons,
          ...result.behaviouralNegativeReasons,
        ],
        factors: result.factors,
      },
    }).catch((err) =>
      console.error("score agent step detail failed", jobId, err),
    );

    // If evidence changed while the LLM was scoring, do not route this stale
    // result. Re-run first; only the pass that consumed the newest summary may
    // advance lifecycle or enqueue nurture.
    publishLeadSummaryEvent({
      contactId: ctx.contactId,
      reason: "score",
    });
    const startTrigger = job.triggerReason ?? null;
    const latest = await findScoringJobById(jobId);
    const latestTrigger = latest?.triggerReason ?? null;
    if (shouldRescoreAfterTrigger(startTrigger, latestTrigger)) {
      const queued = await updateScoringJob(jobId, {
        status: "pending",
        nextRetryAt: new Date(),
        completedAt: null,
        previousScore: result.score,
      });
      void processLeadScoringJob(jobId).catch((err) => {
        console.error("lead scoring follow-up after new signals failed", err);
      });
      return queued;
    }

    // Score is an input to lead qualification. Complete that evaluation before
    // assignment/nurture routing so a newly-qualified lead cannot receive a
    // nurture touch while lifecycle is still reading the fresh evidence.
    try {
      const lifecycle = await import("@/service/ai/lead-lifecycle-job");
      const lifecycleJob = await lifecycle.enqueueLeadLifecycle({
        contactId: ctx.contactId,
        organizationId: ctx.organizationId,
        triggerReason: `score:${job.triggerReason ?? "recalculated"}`,
        processImmediately: false,
      });
      if (lifecycleJob) {
        await lifecycle.processLeadLifecycleJob(lifecycleJob.id);
      }
    } catch (err) {
      console.error("lifecycle evaluation after score failed", ctx.contactId, err);
    }

    // Pipeline: fresh lifecycle → refreshed score summary → assign | nurture.
    void afterScoreComplete({
      contactId: ctx.contactId,
      organizationId: ctx.organizationId,
      scoreResult: result,
      previousScore: previousScore ?? null,
    }).catch((err) =>
      console.error("afterScoreComplete failed", ctx.contactId, err),
    );

    if (
      result.salesReady &&
      (previousScore == null || (previousScore ?? 0) < SALES_READY_SCORE)
    ) {
      notifyAdminsOfLeadEventAsync({
        kind: "lead_scored_hot",
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        contactName: ctx.displayName,
        companyName: ctx.companyName,
        detail: `Grade ${result.grade} · Fit ${result.fitScore}/Intent ${result.intentScore} · total ${result.score}/100 — ${result.nextBestAction}`,
      });
    } else if (intentLift) {
      notifyAdminsOfLeadEventAsync({
        kind: "lead_score_lifted",
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        contactName: ctx.displayName,
        companyName: ctx.companyName,
        detail: `Score rose ${delta} pts → ${result.score}/100 (${result.grade}). ${result.nextBestAction}`,
      });
    }

    return updated;
  } catch (err) {
    console.error("processLeadScoringJob failed", jobId, err);
    const latestAfterFailure = await findScoringJobById(jobId);
    if (
      latestAfterFailure?.triggerReason === "manual_override" &&
      job.triggerReason !== "manual_override"
    ) {
      return latestAfterFailure;
    }
    const hadScore = typeof job.score === "number";
    const exhausted = attempts >= MAX_ATTEMPTS;
    // A failed refresh is not a completed score. Keep the previous number
    // visible, leave the old fingerprint in place, and stay pending so the
    // due-job picker and the conversation gate can try again. Marking this
    // row scored would freeze nurture on the pre-conversation score.
    await updateScoringJob(jobId, {
      status: "pending",
      attempts: exhausted ? 0 : attempts,
      lastError: err instanceof Error ? err.message : "scoring_failed",
      nextRetryAt: new Date(
        Date.now() + (exhausted ? 60 * 60_000 : backoffMs(attempts)),
      ),
      completedAt: null,
    });
    publishLeadSummaryEvent({
      contactId: job.contactId,
      reason: hadScore ? "score" : "score_failed",
    });
    return findScoringJobById(jobId);
  }
}

export async function processDueLeadScoringJobs(limit = 25): Promise<{
  processed: number;
  scored: number;
  failed: number;
}> {
  await reclaimStaleScoringJobs();
  const orgIds = await listDueScoringOrganizationIds(MAX_ATTEMPTS);
  let processed = 0;
  let scored = 0;
  let failed = 0;
  for (const organizationId of orgIds) {
    const due = await listDueScoringJobs(limit, MAX_ATTEMPTS, organizationId);
    for (const job of due) {
      const updated = await processLeadScoringJob(job.id);
      processed += 1;
      if (updated?.status === "scored") scored += 1;
      else if (updated?.status === "failed") failed += 1;
    }
  }
  return { processed, scored, failed };
}

export async function getLeadScoreStatus(contactId: string): Promise<{
  status: string | null;
  score: number | null;
  fitScore: number | null;
  intentScore: number | null;
  scoreDelta: number | null;
  grade: string | null;
  band: string | null;
  rationale: string | null;
  factors: string[];
  positiveReasons: string[];
  negativeReasons: string[];
  behaviouralPositiveReasons: string[];
  behaviouralNegativeReasons: string[];
  behaviouralReasons: string[];
  pillars: {
    demographics: number;
    firmographics: number;
    behavioural: number;
  } | null;
  nextBestAction: string | null;
  salesReady: boolean;
  previousScore: number | null;
  updatedAt: string | null;
  source?: string | null;
} | null> {
  await reclaimStaleScoringJobs();
  let job = await findScoringJobByContactId(contactId);

  // No job yet — enqueue score-lead; do not invent a heuristic score.
  if (!job) {
    const ctx = await buildLeadScoreContext(contactId);
    if (!ctx) return null;
    job = await enqueueLeadScoring({
      contactId,
      organizationId: ctx.organizationId,
      triggerReason: "view_backfill",
      processImmediately: true,
    });
    if (!job) return null;
  }

  if (job.status === "scored" || job.status === "failed") {
    const ctx = await buildLeadScoreContext(contactId, job.organizationId);
    if (ctx) {
      const fingerprint = scoreSignalFingerprint(ctx);
      if (fingerprintFromJob(job) !== fingerprint) {
        const queued = await enqueueLeadScoring({
          contactId,
          organizationId: ctx.organizationId,
          triggerReason: ctx.omniChannelSummary
            ? "omni_channel_summary"
            : "activity",
          processImmediately: true,
        });
        if (queued) job = queued;
      }
    }
  }

  const pendingStaleMs = 12_000;
  if (
    job.status === "pending" &&
    Date.now() - job.updatedAt.getTime() >= pendingStaleMs &&
    (!job.nextRetryAt || job.nextRetryAt.getTime() <= Date.now())
  ) {
    void processLeadScoringJob(job.id).catch((err) => {
      console.error("lead scoring kick on summary read failed", job?.id, err);
    });
  }

  const factors = Array.isArray(job.factors)
    ? job.factors.filter((f): f is string => typeof f === "string")
    : [];
  const summary =
    job.resultSummary &&
    typeof job.resultSummary === "object" &&
    !Array.isArray(job.resultSummary)
      ? (job.resultSummary as Record<string, unknown>)
      : {};

  const asStringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];

  const pillars =
    summary.pillars &&
    typeof summary.pillars === "object" &&
    !Array.isArray(summary.pillars)
      ? {
          demographics: Number(
            (summary.pillars as Record<string, unknown>).demographics ?? 0,
          ),
          firmographics: Number(
            (summary.pillars as Record<string, unknown>).firmographics ?? 0,
          ),
          behavioural: Number(
            (summary.pillars as Record<string, unknown>).behavioural ?? 0,
          ),
        }
      : null;

  const positiveReasons = asStringList(summary.positiveReasons);
  const negativeReasons = asStringList(summary.negativeReasons);
  const behaviouralPositiveReasons = asStringList(
    summary.behaviouralPositiveReasons,
  );
  const behaviouralNegativeReasons = asStringList(
    summary.behaviouralNegativeReasons,
  );
  const behaviouralReasons = asStringList(summary.behaviouralReasons);

  const score =
    typeof job.score === "number"
      ? job.score
      : typeof job.previousScore === "number"
        ? job.previousScore
        : null;
  const fitScore = job.fitScore;
  const intentScore = job.intentScore;
  const grade = job.grade;
  const band = job.band;
  const rationale = job.rationale;
  const summaryCtx = await buildLeadSummaryContext(
    contactId,
    job.organizationId,
  );
  const nextBestAction = summaryCtx
    ? deriveProcessNextAction(summaryCtx, job.nextBestAction)
    : job.nextBestAction;
  const scoreDelta =
    typeof summary.delta === "number"
      ? summary.delta
      : job.previousScore != null && typeof score === "number"
        ? score - job.previousScore
        : null;
  const salesReady =
    Boolean(summary.salesReady) ||
    (typeof job.score === "number" && isSalesReadyScore(job.score));
  const source =
    typeof summary.source === "string" ? summary.source : null;

  return {
    status: job.status,
    score,
    fitScore,
    intentScore,
    scoreDelta,
    grade,
    band,
    rationale,
    factors,
    positiveReasons,
    negativeReasons,
    behaviouralPositiveReasons,
    behaviouralNegativeReasons,
    behaviouralReasons,
    pillars,
    nextBestAction,
    salesReady,
    previousScore: job.previousScore,
    updatedAt: job.updatedAt?.toISOString() ?? null,
    source,
  };
}
