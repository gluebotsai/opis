/**
 * Nightly outline evals — never a CI blocker for lead/finance.
 * Enable with PROPOSAL_EVALS_ENABLED=true.
 */

export async function runProposalOutlineEvalsIfEnabled(): Promise<{
  skipped: boolean;
  reason?: string;
}> {
  const on = String(process.env.PROPOSAL_EVALS_ENABLED || "")
    .trim()
    .toLowerCase();
  if (on !== "1" && on !== "true" && on !== "on") {
    return { skipped: true, reason: "disabled" };
  }
  console.info("[proposal-evals] nightly outline eval placeholder", {
    mode: process.env.PROPOSAL_OUTLINE_MODE || "frozen",
    note: "Enable dynamic per org only after conservative beats frozen on leave-one-out.",
  });
  return { skipped: false };
}
