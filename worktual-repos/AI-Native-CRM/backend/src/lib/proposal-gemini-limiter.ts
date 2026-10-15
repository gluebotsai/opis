/**
 * Adaptive leaf concurrency. Raise PROPOSAL_LEAF_CONCURRENCY only after
 * 503 rate stays flat. Two consecutive 503s force serial writes.
 */

import { isGeminiUnavailableReason } from "@/lib/proposal-content-playbook";
import { proposalLeafConcurrency } from "@/lib/proposal-pipeline-v2";

let consecutiveUnavailable = 0;

export function noteProposalWriterResult(reason?: string | null) {
  if (
    isGeminiUnavailableReason(reason) ||
    /503|429|resource.?exhaust/i.test(String(reason || ""))
  ) {
    consecutiveUnavailable += 1;
    return;
  }
  consecutiveUnavailable = Math.max(0, consecutiveUnavailable - 1);
}

export function effectiveLeafConcurrency(): number {
  if (consecutiveUnavailable >= 2) return 1;
  return proposalLeafConcurrency();
}

export function resetProposalWriterLimiterForTests() {
  consecutiveUnavailable = 0;
}

export async function backoffIfRateLimited(reason?: string | null): Promise<void> {
  if (!reason) return;
  if (
    !isGeminiUnavailableReason(reason) &&
    !/503|429/.test(reason)
  ) {
    return;
  }
  const ms = consecutiveUnavailable >= 2 ? 8_000 : 2_000;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
