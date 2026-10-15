/**
 * Framework-agnostic wrapper around the autonomous lead summary agent so the
 * Fastify strangler API can expose it with the same ownership RBAC as the
 * Next RSC (src/components/ai/LeadSummaryPanel.tsx) and SSE route
 * (src/app/api/contacts/[contactId]/summary/events/route.ts).
 */

import { getContact } from "@/dao/contacts/contact-service";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { canEditContacts } from "@/service/auth/rbac";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  getOrRefreshLeadSummary,
  type LeadSummaryView,
} from "@/service/ai/lead-summary-agent";
import { getLeadScoreStatus } from "@/service/ai/lead-scoring-job";
import {
  bandFromScore,
  gradeFromScore,
  isSalesReadyScore,
  type LeadScoreResult,
} from "@/service/ai/lead-score";
import {
  findScoringJobByOrgContact,
  updateScoringJob,
  upsertScoringJob,
} from "@/dao/ai/lead-scoring-store";
import { afterScoreComplete } from "@/service/ai/lead-pipeline";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { publishLeadSummaryEvent } from "@/service/ai/lead-summary-events";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { composeInboxEmailCommand } from "@/service/inbox/inbox-commands";

export type LeadScoreStatusView = Awaited<ReturnType<typeof getLeadScoreStatus>>;

type AccessResult =
  | { ok: true; ownerUserId: string | null }
  | { ok: false; error: string; status: number };

async function loadContactWithAccess(contactId: string): Promise<AccessResult> {
  const contact = await getContact(contactId);
  if (!contact) {
    return { ok: false, error: "Contact not found.", status: 404 };
  }
  try {
    await assertRecordAccess(contact.crm.ownerUserId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, error: err.message, status: 403 };
    }
    throw err;
  }
  return { ok: true, ownerUserId: contact.crm.ownerUserId };
}

export async function assertLeadSummaryAccess(
  contactId: string,
): Promise<AccessResult> {
  return loadContactWithAccess(contactId);
}

export type LeadSummaryCommandResult =
  | {
      ok: true;
      summary: LeadSummaryView | null;
      scoreStatus: LeadScoreStatusView;
    }
  | { ok: false; error: string; status: number };

export async function getLeadSummaryCommand(
  contactId: string,
  options?: { force?: boolean },
): Promise<LeadSummaryCommandResult> {
  const access = await loadContactWithAccess(contactId);
  if (!access.ok) return access;

  const [summary, scoreStatus] = await Promise.all([
    getOrRefreshLeadSummary(contactId, { force: options?.force }),
    getLeadScoreStatus(contactId).catch(() => null),
  ]);

  return { ok: true, summary, scoreStatus };
}

export type DraftNbaFollowUpResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; error: string; status: number };

export async function draftNbaFollowUpCommand(
  contactId: string,
  nextBestAction?: string | null,
): Promise<DraftNbaFollowUpResult> {
  const access = await loadContactWithAccess(contactId);
  if (!access.ok) return access;

  const contact = await getContact(contactId);
  if (!contact) {
    return { ok: false, error: "Contact not found.", status: 404 };
  }

  const [summary, scoreStatus] = await Promise.all([
    getOrRefreshLeadSummary(contactId).catch(() => null),
    getLeadScoreStatus(contactId).catch(() => null),
  ]);

  const nextStep =
    nextBestAction?.trim() ||
    summary?.recommendedAction?.trim() ||
    scoreStatus?.nextBestAction?.trim() ||
    "";
  if (!nextStep) {
    return {
      ok: false,
      error: "No next best action to follow up on.",
      status: 400,
    };
  }

  const summaryText = summary?.summary?.trim() || "";
  const instruction = [
    "Write a short customer-facing follow-up email this person can receive.",
    "The next best action below is an internal note for the sales rep.",
    "Do not paste it into the subject or body. Do not mention next best action,",
    "internal prep, reviewing emails, or instructions meant only for the rep.",
    "Turn the customer-facing part into a polite, specific email with one clear ask.",
    "",
    `Internal next best action: ${nextStep}`,
    summaryText ? `Contact summary: ${summaryText.slice(0, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const composed = await composeInboxEmailCommand({
    instruction,
    contactId,
    contactName: contact.displayName,
    companyName: contact.person.company?.name ?? null,
    requireAi: true,
  });
  if (!composed.ok) {
    return { ok: false, error: composed.error, status: 502 };
  }
  return {
    ok: true,
    subject: composed.subject,
    body: composed.body,
  };
}

export type SetManualLeadScoreResult =
  | {
      ok: true;
      score: number;
      summary: LeadSummaryView;
    }
  | { ok: false; error: string; status: number };

export async function setManualLeadScoreCommand(
  contactId: string,
  input: { score: number; reason: string },
): Promise<SetManualLeadScoreResult> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to update lead scores.",
    );

    if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
      return {
        ok: false,
        error: "Lead score must be a whole number from 0 to 100.",
        status: 400,
      };
    }
    const reason = input.reason.trim();
    if (!reason) {
      return {
        ok: false,
        error: "A reason is required before changing the lead score.",
        status: 400,
      };
    }
    if (reason.length > 1000) {
      return {
        ok: false,
        error: "Lead score reason must be 1000 characters or fewer.",
        status: 400,
      };
    }

    const access = await loadContactWithAccess(contactId);
    if (!access.ok) return access;

    const organizationId = await getCurrentOrganizationId();
    const actorUserId = await getServerUserId();
    const existing =
      (await findScoringJobByOrgContact(organizationId, contactId)) ??
      (await upsertScoringJob({
        organizationId,
        contactId,
        triggerReason: "manual_override",
      }));
    const previousScore = existing.score ?? existing.previousScore ?? null;
    const resultSummary =
      existing.resultSummary &&
      typeof existing.resultSummary === "object" &&
      !Array.isArray(existing.resultSummary)
        ? { ...existing.resultSummary }
        : {};
    const score = input.score;
    const now = new Date();
    const scoreResult: LeadScoreResult = {
      score,
      fitScore: 0,
      intentScore: score,
      grade: gradeFromScore(score),
      band: bandFromScore(score),
      salesReady: isSalesReadyScore(score),
      rationale: reason,
      scoreBreakdown: { manualOverride: score },
      pillars: {
        demographics: 0,
        firmographics: 0,
        behavioural: score,
      },
      positiveReasons: [],
      negativeReasons: [],
      behaviouralPositiveReasons: [],
      behaviouralNegativeReasons: [],
      behaviouralReasons: [reason],
      factors: [reason],
      nextBestAction: existing.nextBestAction ?? "",
    };

    await updateScoringJob(existing.id, {
      status: "scored",
      score,
      fitScore: 0,
      intentScore: score,
      grade: scoreResult.grade,
      band: scoreResult.band,
      rationale: reason,
      factors: [reason],
      nextBestAction: existing.nextBestAction,
      triggerReason: "manual_override",
      previousScore,
      attempts: existing.attempts,
      lastError: null,
      nextRetryAt: null,
      completedAt: now,
      resultSummary: {
        ...resultSummary,
        source: "manual",
        manualReason: reason,
        manualScore: score,
        manualActorUserId: actorUserId,
        manualUpdatedAt: now.toISOString(),
        salesReady: scoreResult.salesReady,
        delta: previousScore == null ? null : score - previousScore,
        fitScore: 0,
        intentScore: score,
        scoreBreakdown: scoreResult.scoreBreakdown,
        pillars: scoreResult.pillars,
        behaviouralReasons: [reason],
      },
    });

    await writeAuditLog({
      actorUserId,
      action: "update",
      entityType: "contact",
      entityId: contactId,
      organizationId,
      meta: {
        source: "manual_lead_score",
        score,
        previousScore,
        reason,
      },
    });

    const pipeline = await afterScoreComplete({
      contactId,
      organizationId,
      scoreResult,
      previousScore,
    });
    triggerLeadLifecycle({
      contactId,
      organizationId,
      triggerReason: "score:manual_override",
    });
    publishLeadSummaryEvent({ contactId, reason: "manual_score" });

    const summary = pipeline.summaryOk
      ? await getOrRefreshLeadSummary(contactId, { organizationId })
      : null;
    if (!summary?.summary) {
      return {
        ok: false,
        error:
          "The lead score was updated, but the AI summary could not be regenerated. Please retry the summary.",
        status: 502,
      };
    }
    return { ok: true, score, summary };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, error: err.message, status: 403 };
    }
    console.error("setManualLeadScoreCommand failed", err);
    return {
      ok: false,
      error: "Couldn't update the lead score. Try again.",
      status: 500,
    };
  }
}
