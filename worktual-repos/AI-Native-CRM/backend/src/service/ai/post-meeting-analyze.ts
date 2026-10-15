/**
 * Heuristic seed + Python LangGraph post-meeting analysis.
 * AI is the primary brain when configured; heuristic is seed / array fill only.
 */

import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import type { SellerOrganization } from "@/service/ai/seller-org";

export type ProposedSlotGuess = {
  /** Raw phrase from transcript */
  raw: string;
  /** Best-effort ISO if parseable */
  startIso: string | null;
  timeZone: string;
};

export type PostMeetingAction =
  | "book_follow_up"
  | "propose_alternate_slots"
  | "prepare_proposal"
  | "move_stage"
  | "close_lost"
  | "none";

export type PostMeetingQuoteLineGuess = {
  productName: string;
  productId?: string | null;
  quantity: number;
  unitPrice: number;
};

export type PostMeetingAnalysis = {
  requirementsSufficientForProposal: boolean;
  /** Alias: scope/commercial discussion sufficient for a proposal draft. */
  wantsProposalDraft?: boolean;
  /** Pricing/quote topic discussed — catalog quote even without agreed unit prices. */
  wantsQuoteDraft?: boolean;
  /** Product names/themes from transcript for catalog matching. */
  quoteProductHints?: string[];
  /** True only when transcript yields concrete qty + unit prices for catalog lines. */
  pricingCompleteForQuote: boolean;
  customerBusinessSummary: string | null;
  requestedThemes: string[];
  wantsAnotherMeeting: boolean;
  proposedSlot: ProposedSlotGuess | null;
  stageHint:
    | "qualification"
    | "discover"
    | "propose"
    | "negotiate"
    | "won"
    | "lost"
    | null;
  objections: string[];
  nextBestAction: string;
  openQuestions: string[];
  proposalNarrative: string | null;
  /** Optional discount % discussed in meeting (0–100). */
  suggestedDiscountPct: number | null;
  /** Concrete commercial lines when pricing is complete. */
  quoteLines: PostMeetingQuoteLineGuess[];
  /** Machine-readable actions from the AI agent (optional). */
  actions?: PostMeetingAction[];
};

const MEETING_ASK =
  /\b(another (call|meeting|demo)|schedule (a )?(call|meeting|demo)|tomorrow|next (week|monday|tuesday|wednesday|thursday|friday)|can we (meet|talk|hop on)|book a (slot|time)|follow[- ]?up (call|meeting))\b/i;

const PRICING_DISCUSSED =
  /\b(pricing|price list|how much|cost|rate card|budget range|per seat|licen[cs]e cost|quote|quotation|discount)\b/i;

const PROPOSAL_READY =
  /\b(proposal|quote|pricing|commercial|budget|sow|statement of work|send (me )?(a )?(proposal|quote)|business type|we (are|run|sell)|our (company|business)|employees|headcount)\b/i;

const LOST =
  /\b(not interested|no budget|chose another|went with|cancel)\b/i;

const SLOT_RE =
  /\b((?:tomorrow\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)/i;

function guessSlotFromText(text: string, timeZone: string): ProposedSlotGuess | null {
  const m = text.match(SLOT_RE);
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  const probe = Date.parse(raw);
  return {
    raw,
    startIso: Number.isFinite(probe) ? new Date(probe).toISOString() : null,
    timeZone,
  };
}

export function analyzePostMeetingHeuristic(input: {
  transcript: string;
  seller: SellerOrganization | null;
  timeZone?: string;
}): PostMeetingAnalysis {
  const text = input.transcript.trim();
  const lower = text.toLowerCase();
  const timeZone = input.timeZone || "Asia/Kolkata";

  const wantsAnotherMeeting = MEETING_ASK.test(text);
  const proposedSlot = guessSlotFromText(text, timeZone);
  const sufficient = PROPOSAL_READY.test(text) && text.length > 200;
  const pricingDiscussed = PRICING_DISCUSSED.test(text);
  const lost = LOST.test(text);

  let stageHint: PostMeetingAnalysis["stageHint"] = null;
  if (lost) stageHint = "lost";
  else if (sufficient) stageHint = "propose";
  else if (wantsAnotherMeeting) stageHint = "discover";
  else if (text.length > 80) stageHint = "qualification";

  const sellerName = input.seller?.companyName || "our team";
  const narrative = sufficient
    ? [
        `Based on the meeting transcript, ${sellerName} can prepare a tailored proposal.`,
        input.seller?.industryType
          ? `Seller focus: ${input.seller.industryType}.`
          : null,
        input.seller?.businessType
          ? `Seller business type: ${input.seller.businessType}.`
          : null,
        "Product SKUs will be attached when the CDP catalog is available; this brief captures requirements only.",
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const themes: string[] = [];
  for (const t of [
    "crm",
    "commerce",
    "marketing",
    "finance",
    "integration",
    "support",
    "automation",
  ]) {
    if (lower.includes(t)) themes.push(t);
  }

  return {
    requirementsSufficientForProposal: sufficient,
    wantsProposalDraft: sufficient,
    wantsQuoteDraft: pricingDiscussed || sufficient,
    quoteProductHints: themes,
    // Heuristic never invents prices — salesperson must complete quotation.
    pricingCompleteForQuote: false,
    customerBusinessSummary: text.slice(0, 600),
    requestedThemes: themes,
    wantsAnotherMeeting: wantsAnotherMeeting || Boolean(proposedSlot),
    proposedSlot,
    stageHint,
    objections: lost ? ["Customer expressed disinterest or competitive loss"] : [],
    nextBestAction: lost
      ? "Confirm close-lost with owner"
      : sufficient
        ? "Create proposal draft and notify salesperson"
        : wantsAnotherMeeting
          ? "Schedule follow-up meeting"
          : "Continue qualification",
    openQuestions: sufficient
      ? []
      : ["Confirm timeline", "Confirm decision makers", "Confirm scope"],
    proposalNarrative: narrative,
    suggestedDiscountPct: null,
    quoteLines: [],
  };
}

export async function analyzePostMeeting(input: {
  transcript: string;
  seller: SellerOrganization | null;
  contactName?: string | null;
  timeZone?: string;
  activityId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
}): Promise<PostMeetingAnalysis> {
  const timeZone = input.timeZone || "Asia/Kolkata";
  const fallback = analyzePostMeetingHeuristic({ ...input, timeZone });

  const ai = await callAiServiceAgent<{
    ok?: boolean;
    analysis?: Partial<PostMeetingAnalysis>;
    actions?: PostMeetingAction[];
  }>(
    "post-meeting-process",
    {
      transcript: input.transcript.slice(0, 12000),
      seller: input.seller,
      contactName: input.contactName,
      heuristic: fallback,
      timeZone,
      referenceNowIso: new Date().toISOString(),
      activityId: input.activityId,
      contactId: input.contactId,
      organizationId: input.organizationId,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  if (!ai?.ok || !ai.analysis) return fallback;

  const proposedSlot =
    ai.analysis.proposedSlot &&
    (ai.analysis.proposedSlot.raw || ai.analysis.proposedSlot.startIso)
      ? {
          raw: ai.analysis.proposedSlot.raw || fallback.proposedSlot?.raw || "",
          startIso:
            ai.analysis.proposedSlot.startIso ??
            fallback.proposedSlot?.startIso ??
            null,
          timeZone:
            ai.analysis.proposedSlot.timeZone ||
            fallback.proposedSlot?.timeZone ||
            timeZone,
        }
      : (fallback.proposedSlot ?? null);

  const quoteLinesRaw = Array.isArray(ai.analysis.quoteLines)
    ? ai.analysis.quoteLines
    : [];
  const quoteLines: PostMeetingQuoteLineGuess[] = [];
  for (const row of quoteLinesRaw) {
    if (!row || typeof row !== "object") continue;
    const productName = String(
      (row as PostMeetingQuoteLineGuess).productName || "",
    ).trim();
    const quantity = Number((row as PostMeetingQuoteLineGuess).quantity);
    const unitPrice = Number((row as PostMeetingQuoteLineGuess).unitPrice);
    if (!productName || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    quoteLines.push({
      productName: productName.slice(0, 200),
      productId:
        typeof (row as PostMeetingQuoteLineGuess).productId === "string"
          ? (row as PostMeetingQuoteLineGuess).productId
          : null,
      quantity,
      unitPrice,
    });
  }
  const discountRaw = Number(ai.analysis.suggestedDiscountPct);
  const suggestedDiscountPct =
    Number.isFinite(discountRaw) && discountRaw >= 0
      ? Math.min(100, discountRaw)
      : null;
  const pricingCompleteForQuote =
    Boolean(ai.analysis.pricingCompleteForQuote) && quoteLines.length > 0;

  const wantsProposalDraft =
    ai.analysis.wantsProposalDraft ??
    ai.analysis.requirementsSufficientForProposal ??
    fallback.wantsProposalDraft ??
    fallback.requirementsSufficientForProposal;
  const wantsQuoteDraft =
    ai.analysis.wantsQuoteDraft ??
    fallback.wantsQuoteDraft ??
    wantsProposalDraft;
  const quoteProductHints =
    ai.analysis.quoteProductHints?.length
      ? ai.analysis.quoteProductHints
      : fallback.quoteProductHints ?? fallback.requestedThemes;

  const nextBestAction = sanitizePostMeetingNextBestAction(
    ai.analysis.nextBestAction || fallback.nextBestAction,
  );

  return {
    ...fallback,
    ...ai.analysis,
    wantsProposalDraft,
    wantsQuoteDraft,
    quoteProductHints,
    requirementsSufficientForProposal: wantsProposalDraft,
    requestedThemes:
      ai.analysis.requestedThemes?.length
        ? ai.analysis.requestedThemes
        : fallback.requestedThemes,
    objections: ai.analysis.objections ?? fallback.objections,
    openQuestions: ai.analysis.openQuestions ?? fallback.openQuestions,
    proposedSlot,
    customerBusinessSummary:
      ai.analysis.customerBusinessSummary?.trim() ||
      fallback.customerBusinessSummary,
    proposalNarrative:
      ai.analysis.proposalNarrative ?? fallback.proposalNarrative,
    pricingCompleteForQuote,
    quoteLines,
    suggestedDiscountPct,
    nextBestAction,
    actions: ai.actions?.length ? ai.actions : undefined,
  };
}

/** CRM never auto-emails proposal/quote; rewrite LLM nudges that say otherwise. */
export function sanitizePostMeetingNextBestAction(
  raw: string | null | undefined,
): string {
  const text = (raw || "").trim() || "Continue qualification";
  const lowered = text.toLowerCase();
  const mentionsDoc =
    lowered.includes("proposal") ||
    lowered.includes("quote") ||
    lowered.includes("quotation");
  const mentionsSend =
    lowered.includes("email") ||
    lowered.includes("send to customer") ||
    lowered.includes("send the customer") ||
    lowered.includes("mail the customer");
  if (mentionsDoc && mentionsSend) {
    return "Prepare CRM proposal/quote drafts for salesperson review (do not email the customer automatically)";
  }
  return text.slice(0, 400);
}
