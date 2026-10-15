/**
 * Post-score guardrails: intent floors and score holds when demo/scheduling
 * or assigned-rep engagement is present — prevents LLM rescoring from dropping
 * hot leads back into nurture incorrectly.
 */

import {
  bandFromScore,
  gradeFromScore,
  isSalesReadyScore,
  SALES_READY_SCORE,
  type LeadScoreResult,
} from "@/service/ai/lead-score";
import type { LeadScoreContext } from "@/service/ai/lead-scoring-job";
import { SLOT_CONFIRM_RE } from "@/service/ai/demo-booking";

const DEMO_TEXT_RE =
  /\b(demo|quote|walkthrough|schedule\s+(?:a\s+)?(?:call|meeting|demo)|book\s+(?:a\s+)?(?:demo|call))\b/i;

const SCHEDULING_TEXT_RE =
  /\b(works for me|works for us|that time works|see you then|confirm(?:ed)?\s+time)\b/i;

const TIME_CONFIRM_RE =
  /\d{1,2}[\.:][0-5]\d\s*(?:am|pm)|\d{1,2}\s*(?:am|pm)\b(?:\s*(?:today|tomorrow))?/i;

/** Infer demo/scheduling counters from recent inbound snippet when SQL filters miss HTML bodies. */
export function enrichLeadScoreSignalsFromSnippet(
  ctx: LeadScoreContext,
): LeadScoreContext {
  const haystack = [ctx.recentActivitySnippet, ctx.omniChannelSummary]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  if (!haystack) return ctx;

  let demoOrQuoteRequests = ctx.demoOrQuoteRequests;
  let schedulingReplies = ctx.schedulingReplies;

  if (DEMO_TEXT_RE.test(haystack)) {
    demoOrQuoteRequests = Math.max(demoOrQuoteRequests, 1);
  }
  if (
    SLOT_CONFIRM_RE.test(haystack) ||
    SCHEDULING_TEXT_RE.test(haystack) ||
    TIME_CONFIRM_RE.test(haystack)
  ) {
    schedulingReplies = Math.max(schedulingReplies, 1);
  }

  if (
    demoOrQuoteRequests === ctx.demoOrQuoteRequests &&
    schedulingReplies === ctx.schedulingReplies
  ) {
    return ctx;
  }

  return { ...ctx, demoOrQuoteRequests, schedulingReplies };
}

export function hasDemoOrSchedulingSignal(ctx: LeadScoreContext): boolean {
  const enriched = enrichLeadScoreSignalsFromSnippet(ctx);
  return (
    enriched.demoOrQuoteRequests > 0 || enriched.schedulingReplies > 0
  );
}

export function hasRecentActiveEngagement(ctx: LeadScoreContext): boolean {
  return (
    ctx.inboundEmailCount > 0 &&
    (ctx.daysSinceLastActivity == null || ctx.daysSinceLastActivity <= 7)
  );
}

export function hasAssignedRepEngagement(ctx: LeadScoreContext): boolean {
  return Boolean(ctx.ownerUserId?.trim()) && ctx.inboundEmailCount > 0;
}

export function resolveNextBestActionForLead(
  ctx: LeadScoreContext,
  result: LeadScoreResult,
): string {
  if (ctx.leadStatus === "disqualified") {
    return "Do not outreach — leave archived unless new intent appears.";
  }
  if (hasAssignedRepEngagement(ctx) && hasDemoOrSchedulingSignal(ctx)) {
    return "Book the confirmed demo on the assigned rep's calendar and log the meeting.";
  }
  if (hasAssignedRepEngagement(ctx)) {
    return "Assigned rep should follow up personally — no automated nurture.";
  }
  if (hasDemoOrSchedulingSignal(ctx)) {
    return result.salesReady
      ? "Book the demo on calendar and confirm with the customer."
      : "Confirm demo time and book on calendar.";
  }
  return result.nextBestAction;
}

export function applyScoreGuardrails(
  ctx: LeadScoreContext,
  result: LeadScoreResult,
  previousScore: number | null,
): LeadScoreResult {
  const enrichedCtx = enrichLeadScoreSignalsFromSnippet(ctx);
  const guardNotes: string[] = [];
  const fitScore = Math.min(50, Math.max(0, Math.round(result.fitScore || 0)));
  let intentScore = Math.min(50, Math.max(0, Math.round(result.intentScore || 0)));
  const totalFromParts = () => Math.min(100, Math.max(0, fitScore + intentScore));
  let score = totalFromParts();
  const demoOrSchedule = hasDemoOrSchedulingSignal(enrichedCtx);
  const assignedEngaged = hasAssignedRepEngagement(enrichedCtx);
  const recentEngaged = hasRecentActiveEngagement(enrichedCtx);

  if (demoOrSchedule && intentScore < 28) {
    guardNotes.push(
      `Demo/scheduling interest — intent raised to 28 (was ${intentScore})`,
    );
    intentScore = 28;
    score = totalFromParts();
  }

  if (assignedEngaged && recentEngaged && intentScore < 30) {
    guardNotes.push(
      `Assigned rep + recent inbound — intent raised to 30 (was ${intentScore})`,
    );
    intentScore = 30;
    score = totalFromParts();
  }

  if (
    demoOrSchedule &&
    recentEngaged &&
    score < SALES_READY_SCORE &&
    (assignedEngaged || enrichedCtx.schedulingReplies > 0)
  ) {
    guardNotes.push(
      `Demo/scheduling with recent customer reply — score raised to ${SALES_READY_SCORE}`,
    );
    score = Math.max(score, SALES_READY_SCORE);
    intentScore = Math.min(50, Math.max(intentScore, score - fitScore));
  }

  if (
    previousScore != null &&
    score < previousScore &&
    (demoOrSchedule || assignedEngaged || (recentEngaged && demoOrSchedule))
  ) {
    guardNotes.push(
      `Score held at ${previousScore} — active sales engagement (computed ${score})`,
    );
    score = previousScore;
    intentScore = Math.min(50, Math.max(intentScore, score - fitScore));
  }

  if (
    previousScore != null &&
    previousScore >= SALES_READY_SCORE &&
    demoOrSchedule &&
    score < SALES_READY_SCORE
  ) {
    guardNotes.push(
      `Score restored to ${previousScore} — customer confirmed scheduling/demo`,
    );
    score = previousScore;
    intentScore = Math.min(50, Math.max(intentScore, score - fitScore));
  }

  const salesReady = isSalesReadyScore(score);
  const band = bandFromScore(score);
  const grade = gradeFromScore(score);

  const behaviouralPositiveReasons = [
    ...guardNotes,
    ...(result.behaviouralPositiveReasons ?? []),
  ].slice(0, 5);

  return {
    ...result,
    score,
    fitScore,
    intentScore,
    salesReady,
    band,
    grade,
    behaviouralPositiveReasons,
    rationale: guardNotes.length
      ? `${result.rationale} Guardrails: ${guardNotes.join("; ")}.`
      : result.rationale,
  };
}
