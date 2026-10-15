/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/proposal-brief.test.ts
 */
import { renderProposalBriefNoteHtml, buildPostMeetingProposalRequirement, type ProposalBrief } from "./proposal-brief";
import type { PostMeetingAnalysis } from "./post-meeting-analyze";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const brief: ProposalBrief = {
  version: 1,
  createdAt: "2026-08-08T15:49:32.000Z",
  seller: {
    companyName: "Worktual",
    industryType: "SaaS",
    businessType: "b2b",
    websiteUrl: null,
  },
  customerBusinessSummary:
    "Aiswarya A from a company currently handling customer data manually is seeking a CRM solution.",
  requestedThemes: ["crm"],
  narrative:
    "Worktual can prepare a tailored proposal addressing these automation needs.",
  openQuestions: [
    "How many users will need CRM access?",
    "Are there specific integrations required with existing systems?",
  ],
  nextBestAction: "Review draft and send when ready.",
  activityId: null,
  dealId: null,
  proposalId: null,
  quoteId: null,
  pricingComplete: true,
};

const html = renderProposalBriefNoteHtml(brief);
assert(html.includes("<h3>Proposal draft ready</h3>"), "title");
assert(html.includes("Not emailed to the customer"), "no auto-send");
assert(html.includes("<h4>Customer situation</h4>"), "situation");
assert(html.includes("<h4>Recommended approach</h4>"), "approach when distinct");
assert(html.includes("<h4>Open questions</h4>"), "questions");
assert(html.includes("<li>How many users will need CRM access?</li>"), "question item");

const pending = renderProposalBriefNoteHtml(brief, { quotePending: true });
assert(pending.includes("Quotation needs salesperson"), "quote pending");

const analysis: PostMeetingAnalysis = {
  requirementsSufficientForProposal: true,
  pricingCompleteForQuote: false,
  customerBusinessSummary: brief.customerBusinessSummary,
  requestedThemes: brief.requestedThemes,
  wantsAnotherMeeting: false,
  proposedSlot: null,
  stageHint: "propose",
  objections: [],
  nextBestAction: brief.nextBestAction,
  openQuestions: brief.openQuestions,
  proposalNarrative: brief.narrative,
  suggestedDiscountPct: null,
  quoteLines: [],
};
const requirement = buildPostMeetingProposalRequirement({
  contactName: "Mohamed Fazil",
  brief,
  analysis,
  meetingTranscript: "Host: What products do you have?",
  proposalTitle: "Proposal – crm",
});
assert(requirement.includes("Meeting transcript:"), "requirement includes transcript");
assert(requirement.includes("Themes from meeting"), "requirement includes themes");

console.log("proposal-brief note html ok");
