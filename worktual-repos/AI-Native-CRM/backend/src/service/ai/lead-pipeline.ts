/**
 * Lead agent pipeline orchestrator (Phase 1).
 *
 * Sequence: Enrich → Score → Summary → Assign (≥40) | Nurture (<40)
 * Create-time: enqueue enrich only; score runs after enrich settles
 * (or immediately when enrich cannot start — no company name).
 */

import { enqueueLeadEnrichment } from "@/service/ai/lead-enrichment-job";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { getOrRefreshLeadSummary } from "@/service/ai/lead-summary-agent";
import {
  routeLeadAfterScore,
  type LeadScoreRouteResult,
} from "@/service/ai/lead-score-route";
import type { LeadScoreResult } from "@/service/ai/lead-score";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

/**
 * Start of pipeline for a new/merged lead. Does not race score in parallel.
 */
export async function onLeadCreated(input: {
  contactId: string;
  organizationId?: string | null;
  companyId?: string | null;
  triggerReason?: string;
}): Promise<{ enrichEnqueued: boolean; scoreEnqueued: boolean }> {
  const organizationId = await resolveRequestOrganizationId(
    input.organizationId,
  );

  let enrichEnqueued = false;
  try {
    const job = await enqueueLeadEnrichment({
      contactId: input.contactId,
      organizationId,
      companyId: input.companyId,
      processImmediately: true,
    });
    enrichEnqueued = Boolean(job);
  } catch (err) {
    console.error("pipeline enrich enqueue failed", err);
  }

  // No company → enrich cannot run; score immediately so the rest of the
  // pipeline (summary → assign|nurture) still fires.
  let scoreEnqueued = false;
  if (!enrichEnqueued) {
    try {
      const job = await enqueueLeadScoring({
        contactId: input.contactId,
        organizationId,
        triggerReason: input.triggerReason ?? "lead_created_no_enrich",
        processImmediately: true,
      });
      scoreEnqueued = Boolean(job);
    } catch (err) {
      console.error("pipeline score enqueue (no enrich) failed", err);
    }
  }

  return { enrichEnqueued, scoreEnqueued };
}

/**
 * After a scoring job completes: refresh summary, then assign or nurture.
 */
export async function afterScoreComplete(input: {
  contactId: string;
  organizationId: string;
  scoreResult: LeadScoreResult;
  previousScore?: number | null;
  forceSalesIntent?: boolean;
}): Promise<{
  summaryOk: boolean;
  route: LeadScoreRouteResult;
}> {
  let summaryOk = false;
  try {
    const view = await getOrRefreshLeadSummary(input.contactId, {
      organizationId: input.organizationId,
      force: true,
    });
    summaryOk = Boolean(view?.summary);
  } catch (err) {
    console.error("pipeline summary after score failed", err);
  }

  const route = await routeLeadAfterScore({
    contactId: input.contactId,
    organizationId: input.organizationId,
    scoreResult: input.scoreResult,
    previousScore: input.previousScore,
    forceSalesIntent: input.forceSalesIntent,
  });

  return { summaryOk, route };
}
