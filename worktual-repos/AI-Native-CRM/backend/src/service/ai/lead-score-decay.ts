/**
 * Nightly lead score intent decay.
 * Re-scores via Python score-lead (LLM-primary) only when the activity-age
 * band (or prior score fingerprint) changed — avoids hourly LLM spam.
 */

import {
  buildLeadScoreContext,
  computeScoreViaAgent,
} from "@/service/ai/lead-scoring-job";
import { afterScoreComplete } from "@/service/ai/lead-pipeline";
import { applyScoreGuardrails } from "@/service/ai/lead-score-guardrails";
import { buildLeadSummaryContext } from "@/service/ai/lead-summary-agent";
import { deriveProcessNextAction } from "@/service/ai/lead-next-action";
import {
  listScoredJobsForDecay,
  updateScoringJob,
} from "@/dao/ai/lead-scoring-store";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  activityAgeBand,
  hashAgentInput,
} from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const AGENT = "lead-score-decay";

export async function processLeadScoreDecay(limit = 150): Promise<{
  processed: number;
  updated: number;
  skipped: number;
  skippedUnchanged: number;
}> {
  const jobs = await listScoredJobsForDecay(limit);
  let updated = 0;
  let skipped = 0;
  let skippedUnchanged = 0;

  for (const job of jobs) {
    try {
      const ctx = await buildLeadScoreContext(
        job.contactId,
        job.organizationId,
      );
      if (!ctx) {
        skipped += 1;
        continue;
      }

      const days = ctx.daysSinceLastActivity;
      if (days == null || days < 14) {
        skipped += 1;
        continue;
      }

      const organizationId = String(job.organizationId);
      const inputHash = hashAgentInput({
        contactId: job.contactId,
        score: job.score ?? null,
        band: job.band ?? null,
        fitScore: job.fitScore ?? null,
        intentScore: job.intentScore ?? null,
        activityBand: activityAgeBand(days),
        contactType: ctx.contactType ?? null,
        leadStatus: ctx.leadStatus ?? null,
        recentActivityCount: ctx.recentActivityCount,
        companyName: ctx.companyName ?? null,
      });

      const needsLlm = await shouldCallLlmForFingerprint({
        organizationId,
        agent: AGENT,
        entityType: "contact",
        entityId: job.contactId,
        inputHash,
      });

      if (!needsLlm) {
        skippedUnchanged += 1;
        await markAgentInputFingerprint({
          organizationId,
          agent: AGENT,
          entityType: "contact",
          entityId: job.contactId,
          inputHash,
          llmRan: false,
        });
        continue;
      }

      const guarded = applyScoreGuardrails(
        ctx,
        await computeScoreViaAgent(ctx),
        job.score,
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

      await markAgentInputFingerprint({
        organizationId,
        agent: AGENT,
        entityType: "contact",
        entityId: job.contactId,
        inputHash: hashAgentInput({
          contactId: job.contactId,
          score: result.score,
          band: result.band,
          fitScore: result.fitScore ?? null,
          intentScore: result.intentScore ?? null,
          activityBand: activityAgeBand(days),
          contactType: ctx.contactType ?? null,
          leadStatus: ctx.leadStatus ?? null,
          recentActivityCount: ctx.recentActivityCount,
          companyName: ctx.companyName ?? null,
        }),
        llmRan: true,
      });

      if (result.score === job.score && result.band === job.band) {
        skipped += 1;
        continue;
      }

      const previousScore = job.score;

      await updateScoringJob(job.id, {
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
        completedAt: new Date(),
        resultSummary: {
          salesReady: result.salesReady,
          decay: true,
          daysSinceLastActivity: days,
          fitScore: result.fitScore,
          intentScore: result.intentScore,
          scoreBreakdown: result.scoreBreakdown,
          pillars: result.pillars,
          positiveReasons: result.positiveReasons,
          negativeReasons: result.negativeReasons,
          behaviouralPositiveReasons: result.behaviouralPositiveReasons,
          behaviouralNegativeReasons: result.behaviouralNegativeReasons,
          behaviouralReasons: result.behaviouralReasons,
          scoredAt: new Date().toISOString(),
          triggerReason: "nightly_decay",
          source: result.source ?? "ai",
        },
      });

      await writeAuditLog({
        action: "update",
        entityType: "contact",
        entityId: job.contactId,
        organizationId: job.organizationId,
        meta: {
          source: "lead_score_decay",
          previousScore,
          score: result.score,
          fitScore: result.fitScore,
          intentScore: result.intentScore,
          band: result.band,
          daysSinceLastActivity: days,
          scoreSource: result.source ?? "ai",
        },
      }).catch(() => null);

      await afterScoreComplete({
        contactId: job.contactId,
        organizationId: job.organizationId,
        scoreResult: result,
        previousScore: previousScore ?? null,
      });

      updated += 1;
    } catch (err) {
      console.error("lead score decay failed", job.id, err);
      skipped += 1;
    }
  }

  return {
    processed: jobs.length,
    updated,
    skipped,
    skippedUnchanged,
  };
}
