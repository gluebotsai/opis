/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/post-meeting-process.test.ts
 */
import { wantsCommercialDrafts } from "./post-meeting-process";
import type { PostMeetingAnalysis } from "./post-meeting-analyze";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function analysis(
  patch: Partial<PostMeetingAnalysis>,
): PostMeetingAnalysis {
  return {
    requirementsSufficientForProposal: false,
    pricingCompleteForQuote: false,
    customerBusinessSummary: null,
    requestedThemes: [],
    wantsAnotherMeeting: false,
    proposedSlot: null,
    stageHint: null,
    objections: [],
    nextBestAction: "",
    openQuestions: [],
    proposalNarrative: null,
    suggestedDiscountPct: null,
    quoteLines: [],
    ...patch,
  };
}

assert(!wantsCommercialDrafts(analysis({})), "empty analysis");

assert(
  wantsCommercialDrafts(
    analysis({ wantsProposalDraft: true, requirementsSufficientForProposal: true }),
  ),
  "proposal branch",
);

assert(
  wantsCommercialDrafts(analysis({ wantsQuoteDraft: true })),
  "quote-only branch",
);

assert(
  wantsCommercialDrafts(
    analysis({
      wantsProposalDraft: true,
      wantsQuoteDraft: true,
      requirementsSufficientForProposal: true,
    }),
  ),
  "both branch",
);

console.log("post-meeting-process wantsCommercialDrafts ok");
