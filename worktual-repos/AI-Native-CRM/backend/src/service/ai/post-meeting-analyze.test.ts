/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/post-meeting-analyze.test.ts
 */
import { analyzePostMeetingHeuristic } from "./post-meeting-analyze";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const pricingOnly = analyzePostMeetingHeuristic({
  transcript:
    "They asked how much per seat and about volume discounts for the CRM module. We discussed cost ranges and payment terms but not full scope yet. ".repeat(
      6,
    ),
  seller: { companyName: "Worktual", industryType: "SaaS", businessType: "b2b", websiteUrl: null, id: "1" },
});

assert(!pricingOnly.wantsProposalDraft, "pricing-only not proposal");
assert(pricingOnly.wantsQuoteDraft, "pricing-only wants quote");
assert(!pricingOnly.pricingCompleteForQuote, "no invented prices");

const scopeAndPricing = analyzePostMeetingHeuristic({
  transcript:
    "Proposal scope covers CRM, commerce, and integrations. They asked for pricing on CRM per seat and support packages. ".repeat(
      8,
    ),
  seller: { companyName: "Worktual", industryType: "SaaS", businessType: "b2b", websiteUrl: null, id: "1" },
});

assert(scopeAndPricing.wantsProposalDraft, "scope wants proposal");
assert(scopeAndPricing.wantsQuoteDraft, "scope wants quote");

console.log("post-meeting-analyze branches ok");
