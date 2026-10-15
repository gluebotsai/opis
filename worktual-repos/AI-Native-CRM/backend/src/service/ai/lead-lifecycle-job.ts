/**
 * Autonomous Lead Lifecycle Agent.
 *
 * Owns three ladders for a contact — lead status, lifecycle stage, and the
 * sales pipeline — and elevates them one step per run from CRM signals
 * (activities, emails, meetings, transcripts, score, intent).
 */

import { requireOrganizationId } from "@/dao/org/organization";
import {
  getCurrentOrganizationId,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import { getPrismaClient } from "@/dao/db/prisma";
import {
  buildLifecycleContext,
  type LifecycleContext,
} from "@/service/ai/lead-lifecycle-context";
import {
  commercialWinCommittedInDb,
  enforceCommercialWinFromDb,
  isHighRisk,
  shouldBypassHighRiskCloseWon,
  withLifecycleReason,
  type LifecycleDecision,
} from "@/service/ai/lead-lifecycle-decide";
import { enforceEvidenceBar } from "@/service/ai/lead-lifecycle-evidence";
import {
  applyLifecycleDecision,
  auditLifecycleFailure,
  auditLifecycleMove,
} from "@/service/ai/lead-lifecycle-apply";
import { analyzePendingTranscripts } from "@/service/ai/lead-lifecycle-transcripts";
import { processCommercialAcceptance } from "@/service/ai/commercial-acceptance";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { enqueueLifecycleHighRiskIfNeeded } from "@/service/ai/post-meeting-process";
import { recordLoadContextStep } from "@/dao/ai/agent-step-events";
import {
  claimLifecycleJob,
  findLifecycleJobById,
  findLifecycleJobByOrgContact,
  listDueLifecycleJobs,
  listDueLifecycleOrganizationIds,
  reclaimStaleAnalyzingLifecycleJobs,
  updateLifecycleJob,
  upsertLifecycleJob,
  type LifecycleJobRow,
} from "@/dao/ai/lead-lifecycle-store";

const MAX_ATTEMPTS = 5;
/** Must exceed AI_SERVICE_JOB_TIMEOUT_MS so the agent can finish before budget race. */
const JOB_BUDGET_MS = AI_SERVICE_JOB_TIMEOUT_MS + 30_000;
const FAIL_RETRY_MS = 30 * 60_000;

function backoffMs(attempt: number): number {
  return Math.min(12 * 60 * 60_000, FAIL_RETRY_MS * 2 ** Math.max(0, attempt - 1));
}

export function shouldReplayLifecycleAfterTrigger(
  startTrigger: string | null | undefined,
  latestTrigger: string | null | undefined,
): boolean {
  return Boolean(
    latestTrigger &&
      latestTrigger !== startTrigger &&
      latestTrigger !== "cron_sweep",
  );
}

/** Fire-and-forget trigger for callers that just changed a contact signal. */
export function enqueueLeadLifecycleAsync(input: {
  contactId: string;
  organizationId?: string | null;
  triggerReason?: string;
}): void {
  void enqueueLeadLifecycle(input).catch((err) => {
    console.error("lead lifecycle enqueue failed", input.contactId, err);
  });
}

export async function enqueueLeadLifecycle(input: {
  contactId: string;
  organizationId?: string | null;
  triggerReason?: string;
  processImmediately?: boolean;
}): Promise<LifecycleJobRow | null> {
  const contactId = input.contactId?.trim();
  if (!contactId) return null;

  // Background producers (inbox sync, cron) often have no signed-in user.
  // Prefer explicit org → contact profile/person org → session (last resort).
  let orgFromContact: string | null = null;
  if (!input.organizationId?.trim()) {
    try {
      const { getContact } = await import("@/dao/contacts/contact-service");
      const contact = await getContact(contactId);
      orgFromContact =
        contact?.person.organizationId?.trim() || null;
    } catch {
      orgFromContact = null;
    }
  }

  const organizationId = await resolveRequestOrganizationId(
    input.organizationId ?? orgFromContact,
  );
  let job: LifecycleJobRow;
  try {
    job = await upsertLifecycleJob({
      organizationId,
      contactId,
      triggerReason: input.triggerReason ?? null,
      maxAttempts: MAX_ATTEMPTS,
    });
  } catch (err) {
    console.error("lead lifecycle upsert failed", err);
    return null;
  }

  if (input.processImmediately) {
    void processLeadLifecycleJob(job.id).catch((err) => {
      console.error("lead lifecycle immediate process failed", err);
    });
  }
  return job;
}

/**
 * Contacts worth re-evaluating even without an event: open leads and contacts
 * with a live deal. Bounded so the cron stays predictable.
 */
export async function listLifecycleCandidates(
  organizationId: string,
  limit = 40,
): Promise<string[]> {
  const ids = new Set<string>();

  try {
    const { findContactIdsByContactType } = await import(
      "@/dao/account/account-repository"
    );
    const prisma = getPrismaClient();
    const eligibleIds = new Set<string>();
    for (const stage of ["lead", "prospect"] as const) {
      const stageIds = await findContactIdsByContactType(stage, {
        organizationId,
        limit: limit * 2,
      });
      stageIds.forEach((id) => eligibleIds.add(id));
    }
    if (eligibleIds.size > 0) {
      const profiles = await prisma.contactProfile.findMany({
        where: {
          organizationId,
          accountContactId: { in: [...eligibleIds] },
          status: "active",
          leadStatus: { not: "disqualified" },
          flaggedForReview: false,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: { accountContactId: true },
      });
      for (const row of profiles) ids.add(row.accountContactId);
    }
  } catch (err) {
    console.error("lifecycle candidate contacts query failed", err);
  }

  try {
    const prisma = getPrismaClient();
    const deals = await prisma.deal.findMany({
      where: {
        organizationId,
        contactId: { not: null },
        stage: { notIn: ["closed_won", "closed_lost"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { contactId: true },
      take: limit,
    });
    const dealContactIds = [
      ...new Set(
        deals
          .map((d) => d.contactId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (dealContactIds.length > 0) {
      const flagged = await prisma.contactProfile.findMany({
        where: {
          accountContactId: { in: dealContactIds },
          flaggedForReview: true,
        },
        select: { accountContactId: true },
      });
      const flaggedSet = new Set(flagged.map((r) => r.accountContactId));
      for (const contactId of dealContactIds) {
        if (!flaggedSet.has(contactId)) ids.add(contactId);
      }
    }
  } catch (err) {
    console.error("lifecycle candidate deals query failed", err);
  }

  return [...ids].slice(0, limit);
}

export async function processLeadLifecycleJob(
  jobId: string,
): Promise<LifecycleJobRow | null> {
  const existing = await findLifecycleJobById(jobId);
  if (!existing) return null;

  const claimed = await claimLifecycleJob(jobId);
  if (!claimed) return findLifecycleJobById(jobId);

  const job = (await findLifecycleJobById(jobId))!;
  const attempts = job.attempts + 1;
  const startTrigger = job.triggerReason;
  let settled = false;

  async function finish(
    data: Parameters<typeof updateLifecycleJob>[1],
  ): Promise<LifecycleJobRow> {
    if (settled) {
      const again = await findLifecycleJobById(jobId);
      if (again) return again;
    }
    settled = true;
    const finished = await updateLifecycleJob(jobId, { ...data, attempts });
    const latest = await findLifecycleJobById(jobId);
    if (
      latest &&
      shouldReplayLifecycleAfterTrigger(startTrigger, latest.triggerReason)
    ) {
      // A material signal arrived while this run was analyzing. The producer's
      // immediate claim could not take an in-flight job, so replay it now using
      // the newer summary/score revision instead of keeping the stale backoff.
      if (latest.status === "analyzing") return latest;
      const queued =
        latest.status === "pending"
          ? latest
          : await updateLifecycleJob(jobId, {
              status: "pending",
              nextRetryAt: new Date(),
              completedAt: null,
            });
      void processLeadLifecycleJob(jobId).catch((err) => {
        console.error("lead lifecycle follow-up after new signals failed", err);
      });
      return queued;
    }
    return finished;
  }

  try {
    const run = async (): Promise<LifecycleJobRow> => {
      // Fresh transcripts become structured signals before the rules read them.
      await analyzePendingTranscripts(job.contactId).catch((err) => {
        console.error("transcript analysis pass failed", job.contactId, err);
        return 0;
      });
      const { refreshCustomerBantFromTouchpoints } = await import(
        "@/service/ai/contact-bant-from-communication"
      );
      await refreshCustomerBantFromTouchpoints(job.contactId).catch((err) => {
        console.error("customer BANT touchpoint refresh failed", job.contactId, err);
      });

      const ctx = await buildLifecycleContext(job.contactId, job.organizationId);
      if (!ctx) {
        await recordLoadContextStep({
          organizationId: job.organizationId,
          agent: "lead_lifecycle",
          jobId,
          contactId: job.contactId,
          status: "skipped",
          label: "Loading contact & deal context",
          errorReason: "contact_not_found",
        });
        return finish({
          status: "skipped",
          decision: "skip",
          reason: "contact_not_found",
          ladder: "none",
          fromStage: null,
          toStage: null,
          lastError: "contact_not_found",
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: { reason: "contact_not_found" },
        });
      }

      const commercialOutcome = await processCommercialAcceptance(ctx).catch(
        (err) => {
          console.error("processCommercialAcceptance failed", ctx.contactId, err);
          return null;
        },
      );
      if (commercialOutcome?.applied) {
        await auditLifecycleMove(ctx, commercialOutcome);
        return finish({
          status: "applied",
          decision: "commercial_acceptance",
          ladder: commercialOutcome.ladder,
          fromStage: commercialOutcome.from,
          toStage: commercialOutcome.to,
          reason: commercialOutcome.reason,
          dealId: commercialOutcome.dealId,
          lastError: commercialOutcome.blocked,
          completedAt: new Date(),
          lastAppliedAt: new Date(),
          nextRetryAt: new Date(),
          resultSummary: {
            reason: commercialOutcome.reason,
            action: "commercial_acceptance",
            quoteId: commercialOutcome.quoteId,
          },
        });
      }

      // Paid invoice / accepted quote already in CRM — close won without waiting
      // on LLM quote_send confirmations (stale high-risk queue).
      if (commercialWinCommittedInDb(ctx) && ctx.deal && !ctx.deal.closed) {
        const winDecision = enforceEvidenceBar(
          ctx,
          enforceCommercialWinFromDb(ctx, {
            action: { kind: "wait", waitHours: 1 },
            ladder: "none",
            from: null,
            to: null,
            reason: "commercial_win_committed",
          }),
        );
        if (winDecision.action.kind === "close_won") {
          const outcome = await applyLifecycleDecision(ctx, winDecision, {
            lastAppliedAt: job.lastAppliedAt,
          });
          if (outcome.applied) {
            await auditLifecycleMove(ctx, outcome);
            return finish({
              status: "applied",
              decision: "close_won",
              ladder: "pipeline",
              fromStage: winDecision.from,
              toStage: winDecision.to,
              reason: winDecision.reason,
              dealId: ctx.deal.id,
              lastError: null,
              completedAt: new Date(),
              lastAppliedAt: new Date(),
              nextRetryAt: new Date(),
              resultSummary: {
                reason: winDecision.reason,
                action: "close_won",
                source: "commercial_win_db",
              },
            });
          }
        }
      }

      // Prefer Python LangGraph lifecycle-lead (own-server LLM for high-risk).
      const py = await callAiServiceAgent<{
        status?: string;
        decision?: LifecycleDecision;
        persistResult?: {
          status?: string;
          decision?: string;
          ladder?: string;
          from?: string | null;
          to?: string | null;
          reason?: string;
          dealId?: string | null;
          quoteId?: string | null;
          waitHours?: number;
          blocked?: string | null;
        };
      }>("lifecycle-lead", {
        contactId: ctx.contactId,
        organizationId: ctx.organizationId,
      }, { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS });

      if (py?.persistResult?.status) {
        const pr = py.persistResult;
        if (pr.status === "skipped") {
          return finish({
            status: "skipped",
            decision: pr.decision ?? "skip",
            ladder: (pr.ladder as "none") ?? "none",
            fromStage: pr.from ?? null,
            toStage: pr.to ?? null,
            reason: pr.reason ?? "",
            lastError: pr.blocked ?? null,
            completedAt: new Date(),
            nextRetryAt: pr.blocked
              ? new Date(Date.now() + 12 * 60 * 60_000)
              : null,
            resultSummary: { reason: pr.reason, blocked: pr.blocked },
          });
        }
        if (pr.status === "waited") {
          const hours = Math.max(1, Math.min(72, pr.waitHours ?? 24));
          return finish({
            status: "waited",
            decision: "wait",
            ladder: "none",
            fromStage: null,
            toStage: null,
            reason: pr.reason ?? "",
            lastError: null,
            completedAt: new Date(),
            nextRetryAt: new Date(Date.now() + hours * 60 * 60_000),
            resultSummary: { reason: pr.reason, waitHours: hours },
          });
        }
        if (pr.status === "applied") {
          return finish({
            status: "applied",
            decision: pr.decision ?? "convert",
            ladder: (pr.ladder as "lifecycle") ?? "lifecycle",
            fromStage: pr.from ?? null,
            toStage: pr.to ?? null,
            reason: pr.reason ?? "",
            dealId: pr.dealId ?? null,
            lastError: null,
            completedAt: new Date(),
            lastAppliedAt: new Date(),
            nextRetryAt: new Date(),
            resultSummary: {
              reason: pr.reason,
              action: pr.decision,
              ladder: pr.ladder,
              from: pr.from,
              to: pr.to,
              dealId: pr.dealId,
              quoteId: pr.quoteId,
            },
          });
        }
      }

      // Prefer Python decision. If ai-service is down, wait — do not invent
      // stage moves in TypeScript (keeps prior CRM state).
      let rawDecision: LifecycleDecision;
      let decisionSource: string;
      if (
        py?.decision &&
        typeof py.decision === "object" &&
        py.decision.action &&
        typeof py.decision.action === "object"
      ) {
        rawDecision = withLifecycleReason(py.decision);
        decisionSource = "ai-service";
      } else {
        rawDecision = {
          action: { kind: "wait", waitHours: 6 },
          ladder: "none",
          from: null,
          to: null,
          reason:
            "lifecycle-lead unavailable — keeping current stage; retry later.",
        };
        decisionSource = "keep_previous";
      }
      const decision = enforceEvidenceBar(
        ctx,
        enforceCommercialWinFromDb(ctx, rawDecision),
      );

      if (decision.action.kind === "skip") {
        return finish({
          status: "skipped",
          decision: "skip",
          ladder: "none",
          fromStage: null,
          toStage: null,
          reason: decision.reason,
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: null,
          resultSummary: { reason: decision.reason, source: decisionSource },
        });
      }

      if (decision.action.kind === "wait") {
        const hours = Math.max(1, Math.min(72, decision.action.waitHours));
        return finish({
          status: "waited",
          decision: "wait",
          ladder: "none",
          fromStage: null,
          toStage: null,
          reason: decision.reason,
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + hours * 60 * 60_000),
          resultSummary: {
            reason: decision.reason,
            waitHours: hours,
            source: decisionSource,
          },
        });
      }

      if (decision.action.kind === "flag_for_review") {
        const outcome = await applyLifecycleDecision(ctx, decision, {
          lastAppliedAt: job.lastAppliedAt,
        });
        return finish({
          status: outcome.applied ? "applied" : "skipped",
          decision: "flag_for_review",
          ladder: "none",
          fromStage: decision.from,
          toStage: decision.to,
          reason: decision.reason,
          lastError: outcome.blocked,
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + 12 * 60 * 60_000),
          resultSummary: {
            reason: decision.reason,
            action: "flag_for_review",
            source: decisionSource,
          },
        });
      }

      if (
        isHighRisk(decision.action) &&
        !(
          decision.action.kind === "close_won" &&
          shouldBypassHighRiskCloseWon(ctx)
        )
      ) {
        const gated = await enqueueLifecycleHighRiskIfNeeded(ctx, decision);
        return finish({
          status: "waited",
          decision: decision.action.kind,
          ladder: decision.ladder,
          fromStage: decision.from,
          toStage: decision.to,
          reason: gated.queued
            ? `Awaiting contact-owner confirmation (${decision.action.kind})`
            : decision.reason,
          lastError: null,
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + 12 * 60 * 60_000),
          resultSummary: {
            reason: decision.reason,
            awaitingOwnerConfirmation: gated.queued,
            confirmationId: gated.confirmationId ?? null,
            action: decision.action.kind,
          },
        });
      }

      const outcome = await applyLifecycleDecision(ctx, decision, {
        lastAppliedAt: job.lastAppliedAt,
      });

      if (!outcome.applied) {
        return finish({
          status: "skipped",
          decision: decision.action.kind,
          ladder: decision.ladder,
          fromStage: decision.from,
          toStage: decision.to,
          reason: outcome.blocked ?? decision.reason,
          lastError: outcome.blocked,
          completedAt: new Date(),
          nextRetryAt: new Date(Date.now() + 12 * 60 * 60_000),
          resultSummary: {
            reason: decision.reason,
            blocked: outcome.blocked,
            action: decision.action.kind,
          },
        });
      }

      await auditLifecycleMove(ctx, outcome);

      return finish({
        status: "applied",
        decision: decision.action.kind,
        ladder: decision.ladder,
        fromStage: decision.from,
        toStage: decision.to,
        reason: decision.reason,
        dealId: outcome.dealId,
        lastError: null,
        completedAt: new Date(),
        lastAppliedAt: new Date(),
        // Due now: the next CRM event (or cron sweep) can take the next step immediately.
        nextRetryAt: new Date(),
        resultSummary: {
          reason: decision.reason,
          action: decision.action.kind,
          ladder: decision.ladder,
          from: decision.from,
          to: decision.to,
          dealId: outcome.dealId,
          quoteId: outcome.quoteId,
          signals: ctx.signals.evidence.slice(0, 5),
        },
      });
    };

    const raced = await Promise.race([
      run().then((row) => ({ kind: "ok" as const, row })),
      new Promise<{ kind: "budget" }>((resolve) => {
        setTimeout(() => resolve({ kind: "budget" }), JOB_BUDGET_MS);
      }),
    ]);

    if (raced.kind === "budget") {
      await auditLifecycleFailure({
        organizationId: job.organizationId,
        contactId: job.contactId,
        error: "job_budget_exceeded",
      });
      return finish({
        status: "failed",
        lastError: "job_budget_exceeded",
        nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
        resultSummary: { reason: "job_budget_exceeded" },
      });
    }
    return raced.row;
  } catch (err) {
    console.error("processLeadLifecycleJob failed", err);
    const message = err instanceof Error ? err.message : "lifecycle_failed";
    await auditLifecycleFailure({
      organizationId: job.organizationId,
      contactId: job.contactId,
      error: message,
    });
    return finish({
      status: "failed",
      lastError: message,
      nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
      resultSummary: { reason: "exception" },
    });
  }
}

export async function enqueueLifecycleCandidates(options: {
  organizationId: string;
  limit?: number;
}): Promise<{ enqueued: number }> {
  const organizationId = requireOrganizationId(options.organizationId);
  const ids = await listLifecycleCandidates(organizationId, options.limit ?? 40);
  let enqueued = 0;
  for (const contactId of ids) {
    try {
      await upsertLifecycleJob({
        organizationId,
        contactId,
        triggerReason: "cron_sweep",
        maxAttempts: MAX_ATTEMPTS,
      });
      enqueued += 1;
    } catch (err) {
      console.error("lifecycle sweep enqueue failed", contactId, err);
    }
  }
  return { enqueued };
}

async function listTenantOrganizationIds(): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.contactProfile.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows
    .map((r) => r.organizationId)
    .filter((id): id is string => Boolean(id?.trim()));
}

export async function processDueLeadLifecycleJobs(limit = 15): Promise<{
  enqueued: number;
  processed: number;
  results: Array<{
    id: string;
    status: string;
    ladder: string | null;
    from: string | null;
    to: string | null;
  }>;
}> {
  const orgIds = await listTenantOrganizationIds();
  let enqueued = 0;
  for (const organizationId of orgIds) {
    const result = await enqueueLifecycleCandidates({
      organizationId,
      limit: Math.min(limit * 2, 40),
    });
    enqueued += result.enqueued;
  }

  await reclaimStaleAnalyzingLifecycleJobs();
  const dueOrgIds = await listDueLifecycleOrganizationIds(MAX_ATTEMPTS);
  const results: Array<{
    id: string;
    status: string;
    ladder: string | null;
    from: string | null;
    to: string | null;
  }> = [];
  for (const organizationId of dueOrgIds) {
    const due = await listDueLifecycleJobs(limit, MAX_ATTEMPTS, organizationId);
    for (const job of due) {
      const updated = await processLeadLifecycleJob(job.id);
      results.push({
        id: job.id,
        status: updated?.status ?? "unknown",
        ladder: updated?.ladder ?? null,
        from: updated?.fromStage ?? null,
        to: updated?.toStage ?? null,
      });
    }
  }
  return { enqueued, processed: results.length, results };
}

export async function getLeadLifecycleStatus(contactId: string): Promise<{
  status: string;
  ladder: string | null;
  from: string | null;
  to: string | null;
  reason: string | null;
  lastAppliedAt: string | null;
  lastError: string | null;
} | null> {
  const organizationId = await getCurrentOrganizationId();
  const job = await findLifecycleJobByOrgContact(organizationId, contactId);
  if (!job) return null;
  return {
    status: job.status,
    ladder: job.ladder,
    from: job.fromStage,
    to: job.toStage,
    reason: job.reason,
    lastAppliedAt: job.lastAppliedAt?.toISOString() ?? null,
    lastError: job.lastError,
  };
}
