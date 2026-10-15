/**
 * Autonomous lead nurture agent.
 * On nurture_now: when org voice nurture is enabled and the lead has a phone,
 * triggers cc-core auto-bot-call (after configured delay) unless buyer intent
 * is present; otherwise queues Campaign personalised-crm or CRM bot mailbox.
 * Waits or skips otherwise. Never sends from a salesperson's connected inbox.
 */

import type { Prisma } from "@prisma/client";
import { getContact } from "@/dao/contacts/contact-service";
import { listContactActivities } from "@/dao/contacts/contact-activity-service";
import { getCompanySnapshot } from "@/dao/companies/sync-from-contacts";
import { requireOrganizationId } from "@/dao/org/organization";
import {
  getCurrentOrganizationId,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import { prisma } from "@/dao/db/prisma";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";
import { getOrCreateOrgNurtureSettings } from "@/dao/ai/org-nurture-settings";
import {
  recordNurtureOutboundSent,
  resolveNurtureEmail,
  resolveNurturePhone,
  sendNurtureOutbound,
} from "@/service/ai/nurture-outbound";
import {
  executeNurtureOutboundTouch,
  isInitialVoiceNurtureEligible,
  isVoiceCallDueNow,
  lowScoreOverridesModelWait,
  MODEL_RETRY_MS,
  nurtureComposeFromJobSummary,
  nurtureComposeReadyForTouch,
  nurtureReachableForSend,
  nurtureSummaryHasVoiceDelay,
  nurtureSummaryHasVoiceOutcome,
  nurtureTransportAvailableForOrg,
  VOICE_NO_ANSWER_MS,
  VOICE_OUTCOME_POLL_MS,
  voiceBotDataFromCustomFields,
  type NurtureTouchContext,
} from "@/service/ai/nurture-send-touch";
import { nurtureVoiceCustomerSpoke } from "@/service/voice/nurture-call-transcript";
import { accountQuery } from "@/dao/db/account-pool";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { SALES_READY_SCORE } from "@/service/ai/lead-score";
import { recordLoadContextStep } from "@/dao/ai/agent-step-events";
import {
  claimNurtureJob,
  findNurtureJobById,
  findNurtureJobByOrgContact,
  listConversationDeferredNurtureJobs,
  listConversationDeferredOrganizationIds,
  listDueNurtureJobs,
  listDueNurtureOrganizationIds,
  listVoiceScheduledNurtureJobs,
  reclaimStaleAnalyzingNurtureJobs,
  updateNurtureJob,
  upsertNurtureJob,
  type NurtureJobRow,
} from "@/dao/ai/lead-nurture-store";
import { findScoringJobByOrgContact } from "@/dao/ai/lead-scoring-store";
import {
  conversationGateFromSummary,
  conversationGateSummaryPatch,
  evaluateConversationNurtureGate,
  POST_CONVERSATION_SCORE_TRIGGER,
} from "@/service/ai/nurture-conversation-gate";

const MAX_ATTEMPTS = 5;

function queuePostConversationScore(
  organizationId: string,
  contactId: string,
  summary: { reason?: unknown } | null | undefined,
): void {
  if (summary?.reason !== "omni_summary_ready") return;
  void import("@/service/ai/lead-scoring-job")
    .then(({ enqueueLeadScoring }) =>
      enqueueLeadScoring({
        contactId,
        organizationId,
        triggerReason: POST_CONVERSATION_SCORE_TRIGGER,
        processImmediately: true,
      }),
    )
    .catch((error) => {
      console.error(
        "post-conversation lead score enqueue failed",
        contactId,
        error,
      );
    });
}

/** Nurture calls ai-service for decide + compose; this job gates, persists, and sends. */
const NURTURE_AI_TIMEOUT_MS = AI_SERVICE_JOB_TIMEOUT_MS;
const RECENT_ACTIVITY_MS = 24 * 60 * 60_000;
/** Default (active cold 20–39): more frequent touches. */
const SEND_COOLDOWN_ACTIVE_MS = 7 * 24 * 60 * 60_000;
/** Deep cold (0–19): longer cooldown. */
const SEND_COOLDOWN_DEEP_MS = 21 * 24 * 60 * 60_000;
const SEND_COOLDOWN_MS = SEND_COOLDOWN_ACTIVE_MS;
const WAIT_RETRY_MS = 3 * 24 * 60 * 60_000;
const FAIL_RETRY_MS = 6 * 60 * 60_000;

function nurtureCooldownMs(nurtureStatus: string | null | undefined): number {
  if (nurtureStatus === "deep_cold") return SEND_COOLDOWN_DEEP_MS;
  return SEND_COOLDOWN_ACTIVE_MS;
}

export type NurtureDecision =
  | "nurture_now"
  | "wait"
  | "skip_not_interested"
  | "skip_guardrail";

type NurtureContext = {
  organizationId: string;
  contactId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  secondaryEmails: string[];
  phone: string | null;
  secondaryPhones: string[];
  city: string | null;
  region: string | null;
  country: string | null;
  title: string | null;
  companyName: string | null;
  industry: string | null;
  contactType: string | null;
  leadStatus: string | null;
  leadSource: string | null;
  status: string | null;
  /** Compliance & Privacy Control Agent — durable marketing suppression. */
  marketingOptOut: boolean;
  notes: string | null;
  /** CRM contact owner only — never company owner (pooled leads stay null). */
  ownerUserId: string | null;
  /** True when Accounts has an active CRM email channel for this org. */
  hasCrmBotMailbox: boolean;
  nurtureStatus: string | null;
  bant: { budget: boolean; authority: boolean; need: boolean; timeline: boolean };
  daysSinceLastActivity: number | null;
  recentActivityCount: number;
  activities: Array<{
    type: string;
    subject: string;
    body: string | null;
    createdAt: string;
    emailDirection?: string | null;
    dueAt?: string | null;
  }>;
  lastSentAt: Date | null;
  leadSummary: string | null;
  leadHeadline: string | null;
  leadIntent: string | null;
  recommendedAction: string | null;
  enrichment: {
    companyDescription: string | null;
    products: string | null;
    seniorityTier: string | null;
    geography: string | null;
  } | null;
  score: number | null;
  fitScore: number | null;
  intentScore: number | null;
  band: string | null;
  nextBestAction: string | null;
  deals: Array<{ title: string; stage: string; amount: string | null }>;
  voiceBotData: Record<string, unknown> | null;
  /** CDP conversation/product signals supplied to the nurture LLM. */
  customFields: Record<string, unknown> | null;
  /** Org Configuration toggle — LLM should nurture_now when a phone is on file. */
  nurtureCallEnabled: boolean;
};

function backoffMs(attempt: number): number {
  return Math.min(24 * 60 * 60_000, FAIL_RETRY_MS * 2 ** Math.max(0, attempt - 1));
}

type NurtureComposePayload = {
  brief?: string | null;
  campaignName?: string | null;
  goal?: string | null;
  voiceInstruction?: string | null;
  subject?: string | null;
  body?: string | null;
};

function toTouchContext(ctx: NurtureContext): NurtureTouchContext {
  return {
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    displayName: ctx.displayName,
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    email: ctx.email,
    secondaryEmails: ctx.secondaryEmails,
    phone: ctx.phone,
    secondaryPhones: ctx.secondaryPhones,
    lastSentAt: ctx.lastSentAt,
    companyName: ctx.companyName,
    ownerUserId: ctx.ownerUserId,
    hasCrmBotMailbox: ctx.hasCrmBotMailbox,
    leadSummary: ctx.leadSummary,
    leadIntent: ctx.leadIntent,
    leadSource: ctx.leadSource,
    city: ctx.city,
    region: ctx.region,
    country: ctx.country,
    voiceBotData: ctx.voiceBotData,
    activitiesForIntent: ctx.activities,
  };
}

export { resolveNurtureEmail } from "@/service/ai/nurture-outbound";

const ENQUEUE_PER_ORG = 200;

export async function listOpenLeadIdsForNurture(
  organizationId: string,
  limit = ENQUEUE_PER_ORG,
): Promise<string[]> {
  const orgId = requireOrganizationId(organizationId);
  const rows = await prisma.$queryRaw<Array<{ contact_id: string }>>`
    SELECT p.account_contact_id AS contact_id
    FROM crm.contact_profiles p
    JOIN crm.lead_scoring_jobs s
      ON s.organization_id = p.organization_id
     AND s.contact_id = p.account_contact_id
    JOIN cdp.customer_profile c
      ON c.cdp_id::text = p.account_contact_id
     AND c.organization_id = p.organization_id
    WHERE p.organization_id = ${BigInt(orgId)}
      AND p.status = 'active'
      AND p.lead_status NOT IN ('converted', 'disqualified')
      AND p.marketing_opt_out = false
      AND p.owner_user_id IS NULL
      AND s.status = 'scored'
      AND s.score < ${SALES_READY_SCORE}
      AND lower(coalesce(c.contact_type, 'contact')) = 'lead'
      AND EXISTS (
        SELECT 1
        FROM cdp.identity_keys k
        WHERE k.cdp_id = c.cdp_id
          AND k.key_type IN ('email', 'email_secondary', 'phone', 'phone_secondary')
          AND nullif(btrim(k.key_value), '') IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM crm.lead_nurture_jobs n
        WHERE n.organization_id = p.organization_id
          AND n.contact_id = p.account_contact_id
          AND (
            n.status IN ('analyzing', 'pending')
            OR (
              n.status IN ('waited', 'failed', 'sent', 'skipped')
              AND n.next_retry_at > NOW()
            )
          )
      )
    ORDER BY p.updated_at ASC
    LIMIT ${Math.max(1, limit)}
  `;
  return rows.map((row) => row.contact_id);
}

export async function buildNurtureContext(
  contactId: string,
  organizationId?: string | null,
  prior?: NurtureJobRow | null,
): Promise<NurtureContext | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;

  const { person, crm, displayName } = contact;
  const orgId = await resolveRequestOrganizationId(
    organizationId ?? contact.person.organizationId,
  );
  const [
    rawActivities,
    company,
    leadSummaryRow,
    enrichmentSnap,
    scoreJob,
    deals,
    nurtureSettings,
  ] = await Promise.all([
    listContactActivities(contactId, 20),
    person.companyId
      ? getCompanySnapshot(person.companyId).catch(() => null)
      : Promise.resolve(null),
    import("@/dao/ai/lead-summary-store")
      .then(({ findLeadSummary }) => findLeadSummary(orgId, contactId))
      .catch(() => null),
    import("@/dao/ai/lead-enrichment-snapshot")
      .then(({ findLeadEnrichmentSnapshot }) =>
        findLeadEnrichmentSnapshot(orgId, contactId),
      )
      .catch(() => null),
    import("@/dao/ai/lead-scoring-store")
      .then(({ findScoringJobByContactId }) =>
        findScoringJobByContactId(contactId),
      )
      .catch(() => null),
    import("@/dao/sales/deal-service")
      .then(({ listDealsForContact }) => listDealsForContact(contactId))
      .catch(() => []),
    getOrCreateOrgNurtureSettings(orgId).catch(() => null),
  ]);

  const { isInternalNoiseActivity } = await import(
    "@/service/ai/lead-lifecycle-signals"
  );
  const activities = rawActivities.filter((a) => {
    if (isInternalNoiseActivity(a)) return false;
    // Nurture "recent activity" means real customer touch — not our outbound blasts.
    if (a.type === "email" && a.emailDirection !== "inbound") return false;
    return true;
  });

  const last = activities[0];
  const daysSinceLastActivity = last
    ? Math.floor(
        (Date.now() - new Date(last.createdAt).getTime()) / (24 * 60 * 60_000),
      )
    : null;

  const nurtureRows = await prisma.$queryRawUnsafe<
    Array<{ nurture_status: string | null; marketing_opt_out: boolean | null }>
  >(
    `SELECT nurture_status, marketing_opt_out FROM contact_profiles WHERE account_contact_id = $1::text LIMIT 1`,
    contactId,
  );

  const contactOwnerId = person.ownerUserId?.trim() || null;
  const botMailbox = await resolveCrmBotMailbox(orgId).catch(() => null);

  const cdpProfile = await accountQuery<{
    region: string | null;
    custom_fields: Record<string, unknown> | null;
  }>(
    `SELECT region, custom_fields
     FROM cdp.customer_profile
     WHERE cdp_id::text = $1
     LIMIT 1`,
    [contactId],
  ).then(({ rows }) => rows[0] ?? null).catch(() => null);

  const voiceBotData = voiceBotDataFromCustomFields(
    cdpProfile?.custom_fields ?? null,
  );
  const voiceBotDataOrNull =
    Object.keys(voiceBotData).length > 0 ? voiceBotData : null;

  const enrichmentStr = (key: string) => {
    const value = enrichmentSnap?.[key];
    return value == null || String(value).trim() === ""
      ? null
      : String(value).trim();
  };

  return {
    organizationId: orgId,
    contactId,
    displayName,
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    secondaryEmails: person.secondaryEmails ?? [],
    phone: person.phone ?? null,
    secondaryPhones: person.secondaryPhones ?? [],
    city: person.city ?? null,
    region: cdpProfile?.region?.trim() || null,
    country: person.country ?? null,
    title: person.title,
    companyName: company?.name ?? person.company?.name ?? null,
    industry:
      company?.industry ??
      person.company?.industry ??
      enrichmentStr("industry"),
    contactType: person.contactType,
    leadStatus: person.leadStatus,
    leadSource: crm.leadSource,
    status: crm.status,
    marketingOptOut: Boolean(nurtureRows[0]?.marketing_opt_out),
    notes: crm.notes,
    ownerUserId: contactOwnerId,
    hasCrmBotMailbox: Boolean(botMailbox),
    nurtureStatus: nurtureRows[0]?.nurture_status ?? null,
    bant: {
      budget: Boolean(person.bantBudget),
      authority: Boolean(person.bantAuthority),
      need: Boolean(person.bantNeed),
      timeline: Boolean(person.bantTimeline),
    },
    daysSinceLastActivity,
    recentActivityCount: activities.filter(
      (a) => Date.now() - new Date(a.createdAt).getTime() < RECENT_ACTIVITY_MS,
    ).length,
    activities: activities.map((a) => ({
      type: a.type,
      subject: a.subject,
      body: a.body,
      createdAt: a.createdAt,
      emailDirection: a.emailDirection,
      dueAt: a.dueAt,
    })),
    lastSentAt: prior?.lastSentAt ?? null,
    leadSummary: leadSummaryRow?.summary?.trim() || null,
    leadHeadline: leadSummaryRow?.headline?.trim() || null,
    leadIntent: leadSummaryRow?.intent?.trim() || null,
    recommendedAction: leadSummaryRow?.recommendedAction?.trim() || null,
    enrichment: enrichmentSnap
      ? {
          companyDescription: enrichmentStr("company_description"),
          products: enrichmentStr("products"),
          seniorityTier: enrichmentStr("seniority_tier"),
          geography: enrichmentStr("geography"),
        }
      : null,
    score: scoreJob?.score ?? null,
    fitScore: scoreJob?.fitScore ?? null,
    intentScore: scoreJob?.intentScore ?? null,
    band: scoreJob?.band ?? null,
    nextBestAction: scoreJob?.nextBestAction ?? null,
    deals: deals.map((deal) => ({
      title: deal.title,
      stage: deal.stage,
      amount: deal.amount?.toString() ?? null,
    })),
    voiceBotData: voiceBotDataOrNull,
    customFields: cdpProfile?.custom_fields ?? null,
    nurtureCallEnabled: Boolean(nurtureSettings?.nurtureCallEnabled),
  };
}

const STOP_CONTACT_RE =
  /not interested|no longer|unsubscribe|do not contact|stop emailing|wrong person|remove me/i;

/** Phone or email on file and a score below the assign gate stays in nurture. */
function lowScorePhoneMustNurture(ctx: NurtureContext): boolean {
  const phone = resolveNurturePhone(ctx.phone, ctx.secondaryPhones);
  const email = resolveNurtureEmail(ctx.email, ctx.secondaryEmails);
  if (!phone && !email) return false;
  if (ctx.marketingOptOut || ctx.leadStatus === "disqualified") return false;
  if (ctx.score != null && ctx.score >= SALES_READY_SCORE) return false;
  const blob = [
    ctx.notes ?? "",
    ...ctx.activities.map((activity) => `${activity.subject} ${activity.body ?? ""}`),
  ].join(" ");
  if (STOP_CONTACT_RE.test(blob)) return false;
  if (
    ctx.lastSentAt &&
    Date.now() - ctx.lastSentAt.getTime() < nurtureCooldownMs(ctx.nurtureStatus)
  ) {
    return false;
  }
  return true;
}

function initialVoiceNurtureEligibleFromContext(ctx: NurtureContext): boolean {
  return isInitialVoiceNurtureEligible({
    nurtureCallEnabled: ctx.nurtureCallEnabled,
    phone: ctx.phone,
    secondaryPhones: ctx.secondaryPhones,
    leadStatus: ctx.leadStatus,
    contactType: ctx.contactType,
    marketingOptOut: ctx.marketingOptOut,
    lastSentAt: ctx.lastSentAt,
    ownerUserId: ctx.ownerUserId,
  });
}

function heuristicDecide(ctx: NurtureContext): {
  decision: NurtureDecision;
  score: number;
  rationale: string;
  waitDays?: number;
} {
  if (initialVoiceNurtureEligibleFromContext(ctx)) {
    return {
      decision: "nurture_now",
      score: 70,
      rationale:
        "New lead with phone on file — schedule first nurture voice call.",
    };
  }

  const textBlob = [
    ctx.notes ?? "",
    ...ctx.activities.map((a) => `${a.subject} ${a.body ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();

  const notInterested =
    /not interested|no longer|unsubscribe|do not contact|stop emailing|wrong person|remove me/.test(
      textBlob,
    );
  if (notInterested || ctx.leadStatus === "disqualified" || ctx.marketingOptOut) {
    return {
      decision: "skip_not_interested",
      score: 5,
      rationale: "Signals suggest the lead is not interested.",
    };
  }

  if (ctx.lastSentAt && Date.now() - ctx.lastSentAt.getTime() < nurtureCooldownMs(ctx.nurtureStatus)) {
    return {
      decision: "skip_guardrail",
      score: 20,
      rationale: "Nurture cooldown — already emailed recently.",
    };
  }

  const lastAt = ctx.activities[0]?.createdAt
    ? new Date(ctx.activities[0].createdAt).getTime()
    : null;
  if (lastAt && Date.now() - lastAt < RECENT_ACTIVITY_MS) {
    return {
      decision: "wait",
      score: 40,
      rationale: "Recent activity — wait before re-engaging.",
      waitDays: 2,
    };
  }

  const bantScore =
    Number(ctx.bant.budget) +
    Number(ctx.bant.authority) +
    Number(ctx.bant.need) +
    Number(ctx.bant.timeline);

  let score = 50;
  if (ctx.daysSinceLastActivity == null) score += 15;
  else if (ctx.daysSinceLastActivity >= 14) score += 25;
  else if (ctx.daysSinceLastActivity >= 5) score += 15;
  else if (ctx.daysSinceLastActivity >= 2) score += 5;
  else score -= 10;

  if (["qualifying", "qualified", "contacted"].includes(ctx.leadStatus ?? "")) {
    score += 15;
  }
  if (ctx.leadStatus === "new" && (ctx.daysSinceLastActivity ?? 99) >= 3) {
    score += 10;
  }
  score += bantScore * 5;
  if (ctx.industry) score += 5;
  if (ctx.recentActivityCount === 0) score += 10;

  if (score >= 60) {
    return {
      decision: "nurture_now",
      score,
      rationale:
        "Lead still looks viable and engagement has cooled — send a personalized nudge.",
    };
  }

  return {
    decision: "wait",
    score,
    rationale: "Potential lead, but timing is early — check again later.",
    waitDays: score >= 45 ? 3 : 5,
  };
}

async function aiDecide(_ctx: NurtureContext): Promise<{
  decision: NurtureDecision;
  score: number;
  rationale: string;
  waitDays?: number;
} | null> {
  // LLM decisions run in Python nurture-lead (own-server). Offline TS path is heuristic-only.
  return null;
}

function heuristicEmail(ctx: NurtureContext): { subject: string; body: string } {
  const first = ctx.firstName || ctx.displayName.split(" ")[0] || "there";
  const company = ctx.companyName ? ` at ${ctx.companyName}` : "";
  const active = ctx.nurtureStatus !== "deep_cold";
  const subject = active
    ? ctx.companyName
      ? `Quick idea for ${ctx.companyName} — open to a short call?`
      : `Worth a quick chat, ${first}?`
    : ctx.companyName
      ? `Staying in touch with ${ctx.companyName}`
      : `Checking in, ${first}`;
  const cta = active
    ? "Would you have 15 minutes this week for a quick catch-up? Happy to work around your calendar."
    : "If timing is better later, I can share a short overview by email whenever useful.";
  const body = [
    `Hi ${first},`,
    "",
    `I wanted to reconnect${company}. We spoke earlier about how we might help${
      ctx.industry ? ` teams in ${ctx.industry}` : ""
    }, and I thought a short follow-up might be useful.`,
    "",
    cta,
    "",
    "Best regards",
  ].join("\n");
  return { subject, body };
}

async function aiCompose(
  _ctx: NurtureContext,
): Promise<{ subject: string; body: string } | null> {
  // LLM compose runs in Python nurture-lead (own-server). Offline TS path is heuristic-only.
  return null;
}

/**
 * Nurture voice: after the org's configured delay, hit the call API.
 * The cron queue can be hundreds of jobs deep, so re-run this job exactly when
 * the delay ends instead of waiting for the next cron tick to reach it.
 */
const voiceCallTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TIMER_MS = 24 * 60 * 60_000;

function scheduleVoiceCallRun(row: NurtureJobRow): void {
  const summary =
    row.resultSummary &&
    typeof row.resultSummary === "object" &&
    !Array.isArray(row.resultSummary)
      ? (row.resultSummary as Record<string, unknown>)
      : null;
  if (
    row.status !== "waited" ||
    row.attempts >= row.maxAttempts ||
    !row.nextRetryAt ||
    typeof summary?.callTouchEligibleAt !== "string"
  ) {
    return;
  }
  const existing = voiceCallTimers.get(row.id);
  if (existing) clearTimeout(existing);

  // +1.5s so next_retry_at <= NOW() holds in claimNurtureJob.
  const delay = Math.min(
    MAX_TIMER_MS,
    Math.max(1_000, row.nextRetryAt.getTime() - Date.now() + 1_500),
  );
  const timer = setTimeout(() => {
    voiceCallTimers.delete(row.id);
    void processLeadNurtureJob(row.id).catch((err) => {
      console.error("nurture voice call run failed", row.id, err);
    });
  }, delay);
  timer.unref?.();
  voiceCallTimers.set(row.id, timer);
}

function nurtureJobSummary(row: NurtureJobRow): Record<string, unknown> {
  if (
    row.resultSummary &&
    typeof row.resultSummary === "object" &&
    !Array.isArray(row.resultSummary)
  ) {
    return { ...(row.resultSummary as Record<string, unknown>) };
  }
  return {};
}

/** Re-arm voice delay timers after scheduler/API restart (cron alone is too coarse). */
export async function armScheduledVoiceNurtureTimers(): Promise<number> {
  const jobs = await listVoiceScheduledNurtureJobs();
  for (const row of jobs) {
    scheduleVoiceCallRun(row);
  }
  return jobs.length;
}

export async function processLeadNurtureJob(
  jobId: string,
): Promise<NurtureJobRow | null> {
  const existing = await findNurtureJobById(jobId);
  if (!existing) return null;

  if (
    existing.status === "sent" &&
    existing.nextRetryAt &&
    existing.nextRetryAt.getTime() > Date.now()
  ) {
    return existing;
  }

  const claimed = await claimNurtureJob(jobId);
  if (!claimed) {
    return findNurtureJobById(jobId);
  }

  const job = (await findNurtureJobById(jobId))!;
  const attempts = job.attempts + 1;
  let settled = false;

  async function finish(
    data: Parameters<typeof updateNurtureJob>[1],
    opts?: { preserveAttempts?: boolean },
  ): Promise<NurtureJobRow> {
    if (settled) {
      const again = await findNurtureJobById(jobId);
      if (again) return again;
    }
    settled = true;
    const attemptCount = opts?.preserveAttempts ? job.attempts : attempts;
    const updated = await updateNurtureJob(jobId, {
      ...data,
      attempts: attemptCount,
    });
    scheduleVoiceCallRun(updated);
    return updated;
  }

  const conversationGate = await evaluateConversationNurtureGate({
    organizationId: job.organizationId,
    contactId: job.contactId,
    resultSummary: job.resultSummary,
  });
  if (conversationGate.action !== "allow") {
    const waiting = await finish(
      {
        status: "waited",
        decision: "wait",
        lastError: null,
        completedAt: new Date(),
        nextRetryAt: conversationGate.nextRetryAt,
        resultSummary: conversationGateSummaryPatch(
          job.resultSummary,
          conversationGate,
        ),
      },
      { preserveAttempts: true },
    );
    if (conversationGate.action === "rescore") {
      queuePostConversationScore(job.organizationId, job.contactId, {
        reason: "omni_summary_ready",
      });
    }
    return waiting;
  }

  const scored = await findScoringJobByOrgContact(
    job.organizationId,
    job.contactId,
  );
  if (
    scored?.status === "scored" &&
    scored.score != null &&
    scored.score >= SALES_READY_SCORE
  ) {
    return finish(
      {
        status: "skipped",
        decision: "skip_sales_ready",
        lastError: null,
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: {
          ...nurtureJobSummary(job),
          reason: "score_sales_ready",
          score: scored.score,
        },
      },
      { preserveAttempts: true },
    );
  }

  const summaryAtClaim = nurtureJobSummary(job);
  if (nurtureSummaryHasVoiceDelay(summaryAtClaim)) {
    const delaySettings = await getOrCreateOrgNurtureSettings(job.organizationId);
    if (
      !isVoiceCallDueNow(
        summaryAtClaim,
        delaySettings.nurtureCallDelayMinutes,
      )
    ) {
      const restored = await updateNurtureJob(jobId, {
        status: "waited",
        attempts: job.attempts,
      });
      scheduleVoiceCallRun(restored);
      return restored;
    }
  }

  async function resolvePendingVoiceOutcome(
    row: NurtureJobRow,
  ): Promise<NurtureJobRow | null> {
    const summary = nurtureJobSummary(row);
    if (!nurtureSummaryHasVoiceOutcome(summary)) return null;
    const pending = summary.voiceOutcomePending;
    if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
      return null;
    }
    const sessionId =
      typeof (pending as { sessionId?: unknown }).sessionId === "string"
        ? (pending as { sessionId: string }).sessionId.trim()
        : "";
    const triggeredAtRaw = (pending as { triggeredAt?: unknown }).triggeredAt;
    const triggeredAt =
      typeof triggeredAtRaw === "string" ? new Date(triggeredAtRaw) : null;
    const ageMs =
      triggeredAt && !Number.isNaN(triggeredAt.getTime())
        ? Date.now() - triggeredAt.getTime()
        : VOICE_NO_ANSWER_MS;
    if (!sessionId) return null;

    const spoke = await nurtureVoiceCustomerSpoke({
      organizationId: row.organizationId,
      contactId: row.contactId,
      sessionId,
    });
    if (spoke !== true && ageMs < VOICE_NO_ANSWER_MS) {
      return finish(
        {
          status: "waited",
          decision: "wait",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + VOICE_OUTCOME_POLL_MS),
          resultSummary: summary as Prisma.InputJsonObject,
        },
        { preserveAttempts: true },
      );
    }
    if (spoke === true) {
      const ctx = await buildNurtureContext(
        row.contactId,
        row.organizationId,
        row,
      );
      const { voiceOutcomePending: _pending, ...rest } = summary;
      return finish({
        status: "sent",
        decision: "nurture_now",
        lastError: null,
        completedAt: new Date(),
        lastSentAt: new Date(),
        nextRetryAt: new Date(
          Date.now() + nurtureCooldownMs(ctx?.nurtureStatus),
        ),
        resultSummary: {
          ...rest,
          transport: "voice_auto_bot",
          sessionId,
          rationale: "Customer answered the nurture voice call.",
        },
      });
    }

    const ctx = await buildNurtureContext(
      row.contactId,
      row.organizationId,
      row,
    );
    if (!ctx) {
      return finish({
        status: "skipped",
        decision: "skip_guardrail",
        lastError: "contact_not_found",
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: { reason: "contact_not_found" },
      });
    }
    const compose = nurtureComposeFromJobSummary(summary);
    const email = resolveNurtureEmail(ctx.email, ctx.secondaryEmails);
    const { voiceOutcomePending: _drop, ...rest } = summary;
    if (!email) {
      return finish({
        status: "failed",
        decision: "nurture_now",
        lastError: "customer_did_not_answer",
        completedAt: null,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS),
        resultSummary: {
          ...rest,
          reason: "customer_did_not_answer",
          rationale: "Customer did not answer, and there is no email to send.",
        },
      });
    }
    const score =
      typeof summary.score === "number" && Number.isFinite(summary.score)
        ? summary.score
        : 50;
    const rationale = "Customer did not answer the nurture call, so email was sent.";
    const outbound = await sendNurtureOutbound(toTouchContext(ctx), compose);
    if (!outbound.ok) {
      return finish({
        status: "failed",
        decision: "nurture_now",
        lastError: outbound.error,
        completedAt: null,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS),
        resultSummary: {
          ...rest,
          reason: outbound.reason,
          rationale,
          voiceFallback: "customer_did_not_answer",
        },
      });
    }
    await recordNurtureOutboundSent({
      ctx: toTouchContext(ctx),
      score,
      rationale,
      fallbackBody: compose.body,
      outbound,
    });
    return finish({
      status: "sent",
      decision: "nurture_now",
      lastError: null,
      completedAt: new Date(),
      lastSentAt: new Date(),
      nextRetryAt: new Date(Date.now() + nurtureCooldownMs(ctx.nurtureStatus)),
      resultSummary: {
        ...rest,
        score,
        rationale,
        transport: outbound.transport,
        voiceFallback: "customer_did_not_answer",
        sessionId,
      },
    });
  }

  async function processVoiceDueNurtureTouch(
    row: NurtureJobRow,
  ): Promise<NurtureJobRow | null> {
    const summary = nurtureJobSummary(row);
    if (!nurtureSummaryHasVoiceDelay(summary)) return null;

    const nurtureSettings = await getOrCreateOrgNurtureSettings(row.organizationId);
    if (
      !nurtureSettings.nurtureCallEnabled ||
      !isVoiceCallDueNow(summary, nurtureSettings.nurtureCallDelayMinutes)
    ) {
      return null;
    }

    const ctx = await buildNurtureContext(
      row.contactId,
      row.organizationId,
      row,
    );
    if (!ctx) {
      return finish({
        status: "skipped",
        decision: "skip_guardrail",
        lastError: "contact_not_found",
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: { reason: "contact_not_found" },
      });
    }

    if (ctx.ownerUserId?.trim()) {
      return finish({
        status: "skipped",
        decision: "skip_guardrail",
        lastError: null,
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: {
          reason: "contact_assigned_to_sales",
          rationale:
            "This lead is assigned to a sales rep, so they own the follow-up.",
        },
      });
    }

    if (
      ctx.contactType !== "lead" ||
      ctx.leadStatus === "converted" ||
      ctx.leadStatus === "disqualified" ||
      ctx.status === "archived" ||
      ctx.status === "inactive" ||
      ctx.marketingOptOut
    ) {
      return finish({
        status: "skipped",
        decision: "skip_guardrail",
        lastError: null,
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: {
          reason: "not_an_open_lead",
          rationale: "This contact is no longer an open lead.",
        },
      });
    }

    const touchCtx = toTouchContext(ctx);
    const compose = nurtureComposeFromJobSummary(
      summary,
      typeof summary.rationale === "string" ? summary.rationale : null,
    );
    const score =
      typeof summary.score === "number" && Number.isFinite(summary.score)
        ? summary.score
        : 50;
    const rationale =
      typeof summary.rationale === "string" && summary.rationale.trim()
        ? summary.rationale.trim()
        : "Placing scheduled nurture voice call.";

    const touch = await executeNurtureOutboundTouch({
      ctx: touchCtx,
      compose,
      settings: nurtureSettings,
      job: row,
      score,
      rationale,
      fallbackBody: compose.body,
    });

    if (touch.action === "wait") {
      queuePostConversationScore(
        row.organizationId,
        row.contactId,
        touch.resultSummaryPatch,
      );
      return finish(
        {
          status: "waited",
          decision: "wait",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: touch.nextRetryAt,
          resultSummary: touch.resultSummaryPatch,
        },
        { preserveAttempts: true },
      );
    }

    if (touch.action === "skip") {
      return finish({
        status: "skipped",
        decision:
          touch.reason === "score_sales_ready"
            ? "skip_sales_ready"
            : "skip_guardrail",
        lastError: null,
        completedAt: new Date(),
        nextRetryAt: null,
        resultSummary: touch.resultSummaryPatch,
      });
    }

    if (touch.action === "failed") {
      return finish({
        status: "failed",
        decision: "nurture_now",
        lastError: touch.error,
        completedAt: null,
        nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
        resultSummary: {
          ...touch.resultSummaryPatch,
          reason: touch.reason,
        },
      });
    }

    const outbound = touch.outbound;
    return finish({
      status: "sent",
      decision: "nurture_now",
      lastError: null,
      completedAt: new Date(),
      lastSentAt: new Date(),
      nextRetryAt: new Date(Date.now() + nurtureCooldownMs(ctx.nurtureStatus)),
      resultSummary: {
        ...touch.resultSummaryPatch,
        sessionId:
          outbound.transport === "voice_auto_bot"
            ? outbound.sessionId
            : undefined,
        transport: outbound.transport,
        voiceFallback:
          typeof touch.resultSummaryPatch.voiceFallback === "string"
            ? touch.resultSummaryPatch.voiceFallback
            : undefined,
      },
    });
  }

  try {
    const voiceOutcomeHandled = await resolvePendingVoiceOutcome(job);
    if (voiceOutcomeHandled) {
      return voiceOutcomeHandled;
    }

    const voiceDueHandled = await processVoiceDueNurtureTouch(job);
    if (voiceDueHandled) {
      return voiceDueHandled;
    }

    const run = async () => {
      const ctx = await buildNurtureContext(
        job.contactId,
        job.organizationId,
        job,
      );
      if (!ctx) {
        await recordLoadContextStep({
          organizationId: job.organizationId,
          agent: "lead_nurture",
          jobId,
          contactId: job.contactId,
          status: "skipped",
          label: "Loading contact context",
          errorReason: "contact_not_found",
        });
        return finish({
          status: "skipped",
          decision: "skip_guardrail",
          lastError: "contact_not_found",
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: { reason: "contact_not_found" },
        });
      }

      if (
        ctx.contactType !== "lead" ||
        ctx.leadStatus === "converted" ||
        ctx.leadStatus === "disqualified" ||
        ctx.status === "archived" ||
        ctx.status === "inactive"
      ) {
        return finish({
          status: "skipped",
          decision: "skip_guardrail",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: {
            reason: "not_an_open_lead",
            rationale: "This contact is no longer an open lead.",
            leadStatus: ctx.leadStatus,
            contactType: ctx.contactType,
          },
        });
      }

      // Compliance & Privacy Control Agent — durable opt-out. Never overridden
      // by lead-status/BANT signals; this is the enforcement point that makes
      // the agent's autonomous opt-out mutation actually stop future sends.
      if (ctx.marketingOptOut) {
        return finish({
          status: "skipped",
          decision: "skip_guardrail",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: {
            reason: "marketing_opt_out",
            rationale: "They opted out of marketing.",
          },
        });
      }

      if (ctx.ownerUserId?.trim()) {
        return finish({
          status: "skipped",
          decision: "skip_guardrail",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: {
            reason: "contact_assigned_to_sales",
            rationale:
              "This lead is assigned to a sales rep, so they own the follow-up.",
          },
        });
      }

      const nurtureSettings = await getOrCreateOrgNurtureSettings(ctx.organizationId);
      const touchCtx = toTouchContext(ctx);
      if (!nurtureReachableForSend({ ctx: touchCtx, settings: nurtureSettings })) {
        return finish({
          status: "skipped",
          decision: "skip_guardrail",
          lastError: "no_channel",
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: { reason: "no_email_or_phone" },
        });
      }

      // Prefer Python LangGraph nurture-lead (own-server LLM for decide/compose).
      const py = await callAiServiceAgent<{
        status?: string;
        source?: string;
        decision?: NurtureDecision;
        score?: number;
        rationale?: string;
        waitDays?: number;
        subject?: string;
        body?: string;
        brief?: string;
        campaignName?: string;
        goal?: string;
        voiceInstruction?: string;
      }>(
        "nurture-lead",
        {
          contactId: ctx.contactId,
          organizationId: ctx.organizationId,
        },
        { timeoutMs: NURTURE_AI_TIMEOUT_MS },
      );

      // The LLM decides and composes, but only this backend job may persist or
      // send. This keeps the live-conversation gate on the same process and
      // prevents an ai-service callback from bypassing it.
      let decision: {
        decision: NurtureDecision;
        score: number;
        rationale: string;
        waitDays?: number;
      } =
        py?.decision &&
        (py.decision === "nurture_now" ||
          py.decision === "wait" ||
          py.decision === "skip_not_interested" ||
          py.decision === "skip_guardrail")
          ? {
              decision: py.decision as NurtureDecision,
              score: typeof py.score === "number" ? py.score : 50,
              rationale: py.rationale || "Model decision",
              waitDays: py.waitDays,
            }
          : {
              decision: "wait" as NurtureDecision,
              score: 50,
              rationale:
                "nurture-lead unavailable — keeping prior nurture state; retry later.",
              waitDays: 1,
            };
      const decisionSource =
        py?.decision != null
          ? py.source === "heuristic"
            ? "heuristic"
            : "ai-service"
          : "keep_previous";

      // Hard guardrails always win over model.
      if (
        ctx.lastSentAt &&
        Date.now() - ctx.lastSentAt.getTime() < nurtureCooldownMs(ctx.nurtureStatus)
      ) {
        decision = {
          decision: "skip_guardrail",
          score: decision.score,
          rationale: "Nurture cooldown — already emailed recently.",
        };
      }
      const lastAt = ctx.activities[0]?.createdAt
        ? new Date(ctx.activities[0].createdAt).getTime()
        : null;
      if (
        decision.decision === "nurture_now" &&
        lastAt &&
        Date.now() - lastAt < RECENT_ACTIVITY_MS &&
        !initialVoiceNurtureEligibleFromContext(ctx)
      ) {
        decision = {
          decision: "wait",
          score: decision.score,
          rationale: "Recent activity — wait before re-engaging.",
          waitDays: 2,
        };
      }

      if (
        decision.decision === "wait" &&
        initialVoiceNurtureEligibleFromContext(ctx)
      ) {
        decision = {
          decision: "nurture_now",
          score: Math.max(decision.score, 70),
          rationale:
            "New lead with phone on file — schedule first nurture voice call.",
        };
      }

      if (
        (decision.decision === "skip_not_interested" ||
          decision.decision === "skip_guardrail") &&
        lowScorePhoneMustNurture(ctx)
      ) {
        decision = {
          decision: "nurture_now",
          score: Math.max(decision.score, 70),
          rationale:
            "Phone or email is on file and the lead score is low — continue nurture instead of skipping.",
        };
      }

      if (
        lowScoreOverridesModelWait({
          decision: decision.decision,
          rationale: decision.rationale,
          lowScoreMustNurture: lowScorePhoneMustNurture(ctx),
        })
      ) {
        decision = {
          decision: "nurture_now",
          score: Math.max(decision.score, 70),
          rationale:
            "Phone or email is on file and the lead score is low — continue nurture instead of waiting.",
        };
      }

      if (
        decision.decision === "skip_not_interested" ||
        decision.decision === "skip_guardrail"
      ) {
        return finish({
          status: "skipped",
          decision: decision.decision,
          lastError: null,
          completedAt: new Date(),
          nextRetryAt:
            decision.decision === "skip_guardrail" &&
            decision.rationale.includes("cooldown")
              ? new Date(
                  (ctx.lastSentAt?.getTime() ?? Date.now()) + nurtureCooldownMs(ctx.nurtureStatus),
                )
              : null,
          resultSummary: {
            score: decision.score,
            rationale: decision.rationale,
            source: decisionSource,
          },
        });
      }

      if (decision.decision === "wait") {
        const days = Math.max(1, Math.min(14, decision.waitDays ?? 3));
        return finish({
          status: "waited",
          decision: "wait",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + days * 24 * 60 * 60_000),
          resultSummary: {
            score: decision.score,
            rationale: decision.rationale,
            waitDays: days,
            source: decisionSource,
          },
        });
      }

      if (!nurtureTransportAvailableForOrg(ctx, nurtureSettings, ctx.secondaryPhones)) {
        return finish({
          status: "skipped",
          decision: "skip_guardrail",
          lastError: "no_nurture_transport",
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + WAIT_RETRY_MS),
          resultSummary: {
            score: decision.score,
            rationale:
              "Campaign API, CRM bot mailbox, and nurture voice are not configured for this org.",
            reason: "no_nurture_transport",
            source: decisionSource,
          },
        });
      }

      const compose: NurtureComposePayload = {
        brief: py?.brief ?? null,
        campaignName: py?.campaignName ?? null,
        goal: py?.goal ?? null,
        voiceInstruction: py?.voiceInstruction ?? null,
        subject: py?.subject ?? null,
        body: py?.body ?? null,
      };

      if (!nurtureComposeReadyForTouch(compose, nurtureSettings, touchCtx)) {
        const retrySoon = lowScorePhoneMustNurture(ctx);
        return finish(
          {
            status: "waited",
            decision: "wait",
            lastError: null,
            completedAt: new Date(),
            nextRetryAt: new Date(
              Date.now() + (retrySoon ? MODEL_RETRY_MS : WAIT_RETRY_MS),
            ),
            resultSummary: {
              score: decision.score,
              rationale:
                "nurture compose unavailable — not sending heuristic email; retry later.",
              waitDays: retrySoon ? 0 : 1,
              source: "keep_previous",
            },
          },
          retrySoon ? { preserveAttempts: true } : undefined,
        );
      }

      const touch = await executeNurtureOutboundTouch({
        ctx: touchCtx,
        compose,
        settings: nurtureSettings,
        job,
        score: decision.score,
        rationale: decision.rationale,
        fallbackBody: compose.body,
      });

      if (touch.action === "wait") {
        const voiceDelayWait = nurtureSummaryHasVoiceDelay(
          touch.resultSummaryPatch,
        );
        const voiceOutcomeWait = nurtureSummaryHasVoiceOutcome(
          touch.resultSummaryPatch,
        );
        const conversationGateWait =
          touch.resultSummaryPatch.conversationGate != null;
        queuePostConversationScore(
          job.organizationId,
          job.contactId,
          touch.resultSummaryPatch,
        );
        return finish(
          {
            status: "waited",
            decision: "wait",
            lastError: null,
            completedAt: new Date(),
            nextRetryAt: touch.nextRetryAt,
            resultSummary: touch.resultSummaryPatch,
          },
          voiceDelayWait || voiceOutcomeWait || conversationGateWait
            ? { preserveAttempts: true }
            : undefined,
        );
      }

      if (touch.action === "skip") {
        return finish({
          status: "skipped",
          decision:
            touch.reason === "score_sales_ready"
              ? "skip_sales_ready"
              : "skip_guardrail",
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: touch.resultSummaryPatch,
        });
      }

      if (touch.action === "failed") {
        return finish({
          status: "failed",
          decision: "nurture_now",
          lastError: touch.error,
          completedAt: null,
          nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
          resultSummary: {
            ...touch.resultSummaryPatch,
            reason: touch.reason,
            subject: compose.subject ?? null,
          },
        });
      }

      const outbound = touch.outbound;
      return finish({
        status: "sent",
        decision: "nurture_now",
        lastError: null,
        completedAt: new Date(),
        lastSentAt: new Date(),
        nextRetryAt: new Date(Date.now() + nurtureCooldownMs(ctx.nurtureStatus)),
        resultSummary: {
          ...touch.resultSummaryPatch,
          runId:
            outbound.transport === "campaign" ||
            outbound.transport === "campaign_automation"
              ? outbound.runId
              : undefined,
          sessionId:
            outbound.transport === "voice_auto_bot"
              ? outbound.sessionId
              : undefined,
          subject:
            outbound.transport === "fallback" ? outbound.subject : compose.subject,
          via: outbound.transport === "fallback" ? outbound.via : undefined,
        },
      });
    };

    return await run();
  } catch (err) {
    console.error("processLeadNurtureJob failed", err);
    return finish({
      status: "failed",
      decision: null,
      lastError: err instanceof Error ? err.message : "nurture_failed",
      nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
      resultSummary: { reason: "exception" },
    });
  }
}

export async function enqueueLeadNurture(input: {
  contactId: string;
  organizationId?: string | null;
  processImmediately?: boolean;
}): Promise<NurtureJobRow | null> {
  const organizationId = await resolveRequestOrganizationId(
    input.organizationId,
  );
  try {
    const prior = await findNurtureJobByOrgContact(
      organizationId,
      input.contactId,
    );
    const resumeAfterRescore =
      prior?.status === "waited" &&
      conversationGateFromSummary(prior.resultSummary)?.phase ===
        "awaiting_rescore";
    if (resumeAfterRescore && prior) {
      await updateNurtureJob(prior.id, { nextRetryAt: new Date() });
    }
    if (
      !resumeAfterRescore &&
      prior?.status === "waited" &&
      nurtureSummaryHasVoiceDelay(nurtureJobSummary(prior))
    ) {
      const settings = await getOrCreateOrgNurtureSettings(organizationId);
      const summary = nurtureJobSummary(prior);
      if (!isVoiceCallDueNow(summary, settings.nurtureCallDelayMinutes)) {
        scheduleVoiceCallRun(prior);
        return prior;
      }
      if (input.processImmediately !== false) {
        void processLeadNurtureJob(prior.id).catch((err) => {
          console.error("nurture voice-due process failed", prior.id, err);
        });
      }
      return prior;
    }

    const job = await upsertNurtureJob({
      organizationId,
      contactId: input.contactId,
      maxAttempts: MAX_ATTEMPTS,
    });
    // Persist intensity band from contact profile if present
    await prisma.$executeRawUnsafe(
      `
      UPDATE lead_nurture_jobs nj SET
        nurture_status = COALESCE(cp.nurture_status, nj.nurture_status, 'active_cold'),
        sequence_started_at = COALESCE(nj.sequence_started_at, NOW()),
        current_sequence_step = COALESCE(nj.current_sequence_step, 0),
        updated_at = NOW()
      FROM contact_profiles cp
      WHERE nj.id = $1
        AND cp.account_contact_id = nj.contact_id
      `,
      job.id,
    ).catch(() => null);

    if (input.processImmediately !== false) {
      void processLeadNurtureJob(job.id).catch((err) => {
        console.error("nurture immediate process failed", err);
      });
    }
    return job;
  } catch (err) {
    console.error("enqueueLeadNurture failed", err);
    return null;
  }
}

export async function enqueueOpenLeadsForNurture(options: {
  organizationId: string;
  limit?: number;
}): Promise<{ enqueued: number }> {
  const organizationId = requireOrganizationId(options.organizationId);
  const ids = await listOpenLeadIdsForNurture(
    organizationId,
    options.limit ?? 40,
  );
  let enqueued = 0;
  for (const contactId of ids) {
    try {
      await upsertNurtureJob({ organizationId, contactId, maxAttempts: MAX_ATTEMPTS });
      enqueued += 1;
    } catch (err) {
      console.error("nurture enqueue failed", contactId, err);
    }
  }
  return { enqueued };
}

/**
 * Apply a nurture decision from the Python LangGraph agent (send / wait / skip).
 * Does not touch the job row — the caller updates it from the returned payload.
 */
export async function applyNurtureAgentDecision(
  contactId: string,
  input: {
    organizationId?: string | null;
    decision: NurtureDecision;
    score: number;
    rationale: string;
    waitDays?: number;
    subject?: string | null;
    body?: string | null;
    brief?: string | null;
    campaignName?: string | null;
    goal?: string | null;
    voiceInstruction?: string | null;
  },
): Promise<{
  status: string;
  decision: NurtureDecision | "skip_sales_ready";
  score: number;
  rationale: string;
  waitDays?: number;
  subject?: string;
  lastError?: string | null;
  nextRetryAt?: string | null;
  lastSentAt?: string | null;
  transport?: string;
  runId?: string;
  sessionId?: string;
  voiceFallback?: string;
  callTouchEligibleAt?: string | null;
  reason?: string;
  conversationGate?: Prisma.JsonObject;
}> {
  const orgId = await resolveRequestOrganizationId(input.organizationId);
  const prior = await findNurtureJobByOrgContact(orgId, contactId);
  const ctx = await buildNurtureContext(contactId, orgId, prior);
  if (!ctx) {
    return {
      status: "skipped",
      decision: "skip_guardrail",
      score: 0,
      rationale: "contact_not_found",
      lastError: "contact_not_found",
    };
  }

  const nurtureSettings = await getOrCreateOrgNurtureSettings(ctx.organizationId);
  const touchCtx = toTouchContext(ctx);

  if (ctx.ownerUserId?.trim()) {
    return {
      status: "skipped",
      decision: "skip_guardrail",
      score: input.score,
      rationale:
        "This lead is assigned to a sales rep, so they own the follow-up.",
      reason: "contact_assigned_to_sales",
    };
  }

  let decision = input.decision;
  let rationale = input.rationale;
  let score = input.score;
  let waitDays = input.waitDays;

  // Hard guardrails always win.
  if (
    ctx.lastSentAt &&
    Date.now() - ctx.lastSentAt.getTime() < nurtureCooldownMs(ctx.nurtureStatus)
  ) {
    decision = "skip_guardrail";
    rationale = "Nurture cooldown — already emailed recently.";
  }
  const lastAt = ctx.activities[0]?.createdAt
    ? new Date(ctx.activities[0].createdAt).getTime()
    : null;
  if (
    decision === "nurture_now" &&
    lastAt &&
    Date.now() - lastAt < RECENT_ACTIVITY_MS &&
    !initialVoiceNurtureEligibleFromContext(ctx)
  ) {
    decision = "wait";
    rationale = "Recent activity — wait before re-engaging.";
    waitDays = 2;
  }

  if (decision === "wait" && initialVoiceNurtureEligibleFromContext(ctx)) {
    decision = "nurture_now";
    score = Math.max(score, 70);
    rationale =
      "New lead with phone on file — schedule first nurture voice call.";
    waitDays = undefined;
  }

  if (
    (decision === "skip_not_interested" || decision === "skip_guardrail") &&
    lowScorePhoneMustNurture(ctx)
  ) {
    decision = "nurture_now";
    score = Math.max(score, 70);
    rationale =
      "Phone or email is on file and the lead score is low — continue nurture instead of skipping.";
    waitDays = undefined;
  }

  if (
    lowScoreOverridesModelWait({
      decision,
      rationale,
      lowScoreMustNurture: lowScorePhoneMustNurture(ctx),
    })
  ) {
    decision = "nurture_now";
    score = Math.max(score, 70);
    rationale =
      "Phone or email is on file and the lead score is low — continue nurture instead of waiting.";
    waitDays = undefined;
  }

  if (decision === "skip_not_interested" || decision === "skip_guardrail") {
    return {
      status: "skipped",
      decision,
      score,
      rationale,
      nextRetryAt:
        decision === "skip_guardrail" && rationale.includes("cooldown")
          ? new Date(
              (ctx.lastSentAt?.getTime() ?? Date.now()) + nurtureCooldownMs(ctx.nurtureStatus),
            ).toISOString()
          : null,
    };
  }

  if (decision === "wait") {
    const days = Math.max(1, Math.min(14, waitDays ?? 3));
    return {
      status: "waited",
      decision: "wait",
      score,
      rationale,
      waitDays: days,
      nextRetryAt: new Date(Date.now() + days * 24 * 60 * 60_000).toISOString(),
    };
  }

  if (!nurtureTransportAvailableForOrg(ctx, nurtureSettings, ctx.secondaryPhones)) {
    return {
      status: "skipped",
      decision: "skip_guardrail",
      score,
      rationale:
        "Campaign API, CRM bot mailbox, and nurture voice are not configured for this org.",
      lastError: "no_nurture_transport",
      nextRetryAt: new Date(Date.now() + WAIT_RETRY_MS).toISOString(),
    };
  }

  const compose: NurtureComposePayload = {
    brief: input.brief ?? null,
    campaignName: input.campaignName ?? null,
    goal: input.goal ?? null,
    voiceInstruction: input.voiceInstruction ?? null,
    subject: input.subject ?? null,
    body: input.body ?? null,
  };

  if (!nurtureComposeReadyForTouch(compose, nurtureSettings, touchCtx)) {
    const retrySoon = lowScorePhoneMustNurture(ctx);
    return {
      status: "waited",
      decision: "wait",
      score,
      rationale:
        "nurture compose unavailable — not sending heuristic email; retry later.",
      waitDays: retrySoon ? 0 : 1,
      nextRetryAt: new Date(
        Date.now() + (retrySoon ? MODEL_RETRY_MS : WAIT_RETRY_MS),
      ).toISOString(),
    };
  }

  const touch = await executeNurtureOutboundTouch({
    ctx: touchCtx,
    compose,
    settings: nurtureSettings,
    job: prior,
    score,
    rationale,
    fallbackBody: compose.body,
  });

  if (touch.action === "wait") {
    const callTouchEligibleAt =
      typeof touch.resultSummaryPatch.callTouchEligibleAt === "string"
        ? touch.resultSummaryPatch.callTouchEligibleAt
        : null;
    const conversationGate =
      touch.resultSummaryPatch.conversationGate &&
      typeof touch.resultSummaryPatch.conversationGate === "object" &&
      !Array.isArray(touch.resultSummaryPatch.conversationGate)
        ? (touch.resultSummaryPatch.conversationGate as Prisma.JsonObject)
        : undefined;
    const reason =
      typeof touch.resultSummaryPatch.reason === "string"
        ? touch.resultSummaryPatch.reason
        : undefined;
    return {
      status: "waited",
      decision: "wait",
      score,
      rationale: touch.rationale,
      nextRetryAt: touch.nextRetryAt.toISOString(),
      callTouchEligibleAt,
      reason,
      conversationGate,
    };
  }

  if (touch.action === "skip") {
    return {
      status: "skipped",
      decision:
        touch.reason === "score_sales_ready"
          ? "skip_sales_ready"
          : "skip_guardrail",
      score,
      rationale: touch.rationale,
      reason: touch.reason,
      nextRetryAt: null,
    };
  }

  if (touch.action === "failed") {
    return {
      status: "failed",
      decision: "nurture_now",
      score,
      rationale,
      subject: compose.subject ?? undefined,
      lastError: touch.error,
      nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
    };
  }

  const outbound = touch.outbound;
  return {
    status: "sent",
    decision: "nurture_now",
    score,
    rationale,
    subject:
      outbound.transport === "fallback" ? outbound.subject : compose.subject ?? undefined,
    transport: outbound.transport,
    runId:
      outbound.transport === "campaign" ||
      outbound.transport === "campaign_automation"
        ? outbound.runId
        : undefined,
    sessionId:
      outbound.transport === "voice_auto_bot"
        ? outbound.sessionId
        : undefined,
    voiceFallback:
      typeof touch.resultSummaryPatch.voiceFallback === "string"
        ? touch.resultSummaryPatch.voiceFallback
        : undefined,
    lastSentAt: new Date().toISOString(),
    nextRetryAt: new Date(Date.now() + nurtureCooldownMs(ctx.nurtureStatus)).toISOString(),
  };
}

async function listTenantOrganizationIds(): Promise<string[]> {
  const rows = await prisma.contactProfile.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows
    .map((r) => r.organizationId)
    .filter((id): id is string => Boolean(id?.trim()));
}

export async function processDueLeadNurtureJobs(limit = 15): Promise<{
  enqueued: number;
  processed: number;
  results: Array<{ id: string; status: string; decision: string | null }>;
}> {
  const orgIds = await listTenantOrganizationIds();
  let enqueued = 0;
  for (const organizationId of orgIds) {
    const result = await enqueueOpenLeadsForNurture({
      organizationId,
      limit: ENQUEUE_PER_ORG,
    });
    enqueued += result.enqueued;
  }

  const nurtureOrgIds = await listDueNurtureOrganizationIds(MAX_ATTEMPTS);
  const results: Array<{ id: string; status: string; decision: string | null }> =
    [];
  for (const organizationId of nurtureOrgIds) {
    const due = await listDueNurtureJobs(limit, MAX_ATTEMPTS, organizationId);
    for (const job of due) {
      const updated = await processLeadNurtureJob(job.id);
      results.push({
        id: job.id,
        status: updated?.status ?? "unknown",
        decision: updated?.decision ?? null,
      });
    }
  }
  return { enqueued, processed: results.length, results };
}

/** Recheck only jobs paused by the live-conversation hard gate. */
export async function processConversationDeferredNurtureJobs(
  limit = 50,
): Promise<{
  processed: number;
  results: Array<{ id: string; status: string; decision: string | null }>;
}> {
  await reclaimStaleAnalyzingNurtureJobs();
  const orgIds = await listConversationDeferredOrganizationIds();
  const results: Array<{ id: string; status: string; decision: string | null }> =
    [];
  for (const organizationId of orgIds) {
    const due = await listConversationDeferredNurtureJobs(limit, organizationId);
    for (const job of due) {
      const updated = await processLeadNurtureJob(job.id);
      results.push({
        id: job.id,
        status: updated?.status ?? "unknown",
        decision: updated?.decision ?? null,
      });
    }
  }
  return { processed: results.length, results };
}

export async function getLeadNurtureStatus(contactId: string): Promise<{
  status: string;
  decision: string | null;
  lastError: string | null;
  lastSentAt: string | null;
  nextRetryAt: string | null;
  rationale: string | null;
  skipReason: string | null;
  resultSummary: unknown;
} | null> {
  const organizationId = await getCurrentOrganizationId();
  const job = await findNurtureJobByOrgContact(organizationId, contactId);
  if (!job) return null;
  const summary =
    job.resultSummary &&
    typeof job.resultSummary === "object" &&
    !Array.isArray(job.resultSummary)
      ? (job.resultSummary as Record<string, unknown>)
      : null;
  const rationale =
    typeof summary?.rationale === "string" && summary.rationale.trim()
      ? summary.rationale.trim()
      : null;

  let status = job.status;
  let decision = job.decision;
  let lastError = job.lastError;
  let skipReason =
    typeof summary?.reason === "string" ? summary.reason.trim() : null;

  // Stale skip: nurture ran before email/phone/owner — reconcile and re-queue.
  // Guard with a cooldown: every contact-page view re-fetches this status, and
  // a nurture send/skip itself publishes an SSE "summary" event that triggers
  // another re-fetch. Without this guard, that becomes a tight feedback loop
  // (view -> reconcile -> reprocess -> activity log -> SSE -> view -> ...),
  // burning through attempts in seconds and never giving the configured call
  // delay a chance to elapse.
  const RECONCILE_COOLDOWN_MS = 60_000;
  const recentlyUpdated =
    Date.now() - job.updatedAt.getTime() < RECONCILE_COOLDOWN_MS;
  const staleChannelSkip =
    !recentlyUpdated &&
    status === "skipped" &&
    (lastError === "no_email" ||
      lastError === "no_channel" ||
      skipReason === "no_email_or_phone");

  if (staleChannelSkip) {
    const contact = await getContact(contactId);
    const email = resolveNurtureEmail(
      contact?.person.email,
      contact?.person.secondaryEmails,
    );
    const phone = resolveNurturePhone(
      contact?.person.phone,
      contact?.person.secondaryPhones,
    );
    const nurtureSettings = await getOrCreateOrgNurtureSettings(organizationId);
    const reachable =
      contact != null &&
      nurtureReachableForSend({
        ctx: {
          organizationId,
          contactId,
          displayName: contact.displayName,
          firstName: contact.person.firstName,
          email: contact.person.email,
          secondaryEmails: contact.person.secondaryEmails ?? [],
          phone: contact.person.phone,
          secondaryPhones: contact.person.secondaryPhones ?? [],
          companyName: contact.person.company?.name ?? null,
          ownerUserId: contact.person.ownerUserId,
          hasCrmBotMailbox: false,
          activitiesForIntent: [],
        },
        settings: nurtureSettings,
      });

    if (contact?.person.ownerUserId?.trim()) {
      lastError = null;
      decision = "skip_guardrail";
      skipReason = "contact_assigned_to_sales";
    } else if (reachable) {
      lastError = null;
      skipReason = phone && !email ? "phone_added_retry" : "email_added_retry";
      status = "analyzing";
      void enqueueLeadNurture({
        contactId,
        organizationId,
        processImmediately: true,
      }).catch(() => null);
    }
  } else if (
    !recentlyUpdated &&
    status === "waited" &&
    decision === "wait" &&
    !nurtureSummaryHasVoiceDelay(summary) &&
    !conversationGateFromSummary(summary) &&
    !job.lastSentAt
  ) {
    const ctx = await buildNurtureContext(contactId, organizationId, job);
    if (ctx && initialVoiceNurtureEligibleFromContext(ctx)) {
      status = "analyzing";
      skipReason = "initial_voice_nurture_retry";
      void enqueueLeadNurture({
        contactId,
        organizationId,
        processImmediately: true,
      }).catch(() => null);
    }
  } else if (
    status === "skipped" &&
    !lastError &&
    skipReason === "contact_assigned_to_sales"
  ) {
    // Already the correct skip reason.
  }

  return {
    status,
    decision,
    lastError,
    lastSentAt: job.lastSentAt?.toISOString() ?? null,
    nextRetryAt: job.nextRetryAt?.toISOString() ?? null,
    rationale,
    skipReason,
    resultSummary: job.resultSummary,
  };
}
