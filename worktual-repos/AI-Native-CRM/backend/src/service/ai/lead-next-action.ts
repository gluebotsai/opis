/**
 * Process-aware next best action from current CRM state + activity timeline.
 * Used for lead summary "Next step" and scoring nextBestAction overrides.
 */

import type { LeadSummaryContext } from "@/service/ai/lead-summary-agent";
import {
  enrichLeadScoreSignalsFromSnippet,
  hasDemoOrSchedulingSignal,
} from "@/service/ai/lead-score-guardrails";
import type { LeadScoreContext } from "@/service/ai/lead-scoring-job";
import { SALES_READY_SCORE } from "@/service/ai/lead-score";

const QUOTE_SENT_RE =
  /\b(quote|quotation|proposal|prop[-\s]?\d|inv[-\s]?\d|sent you (?:a|the) (?:quote|proposal))\b/i;
const INBOUND_RE = /^re:\s/i;

function openDeals(ctx: LeadSummaryContext) {
  return ctx.deals.filter((d) => !/closed|won|lost|cancel/i.test(d.stage));
}

function upcomingMeetings(ctx: LeadSummaryContext) {
  const now = Date.now();
  return ctx.activities.filter((a) => {
    if (a.type !== "meeting") return false;
    const due = a.dueAt ? new Date(a.dueAt).getTime() : NaN;
    return Number.isFinite(due) && due > now;
  });
}

function pastMeetings(ctx: LeadSummaryContext) {
  const now = Date.now();
  return ctx.activities.filter((a) => {
    if (a.type !== "meeting") return false;
    if (a.completedAt) return true;
    const due = a.dueAt ? new Date(a.dueAt).getTime() : NaN;
    return Number.isFinite(due) && due <= now;
  });
}

function hasOutboundQuoteOrProposal(ctx: LeadSummaryContext): boolean {
  return ctx.activities.some((a) => {
    const subj = a.subject ?? "";
    const body = a.body ?? "";
    const haystack = `${subj}\n${body}`;
    if (!QUOTE_SENT_RE.test(haystack)) return false;
    if (a.type === "email" && INBOUND_RE.test(subj.trim())) return false;
    if (/draft|internal|note/i.test(subj)) return false;
    return true;
  });
}

function hasRecentInbound(ctx: LeadSummaryContext, days = 7): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  return ctx.activities.some((a) => {
    if (a.type !== "email") return false;
    if (!INBOUND_RE.test((a.subject ?? "").trim())) return false;
    const at = new Date(a.createdAt).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
}

function buildScoreSignals(ctx: LeadSummaryContext): LeadScoreContext {
  const inboundEmails = ctx.activities.filter((a) =>
    INBOUND_RE.test((a.subject ?? "").trim()),
  );
  const snippet = inboundEmails
    .slice(0, 2)
    .map((a) => `${a.subject}: ${(a.body ?? "").slice(0, 200)}`)
    .join("\n");

  return enrichLeadScoreSignalsFromSnippet({
    contactId: ctx.contactId,
    organizationId: ctx.organizationId,
    displayName: ctx.displayName,
    contactType: ctx.contactType,
    leadStatus: ctx.leadStatus,
    leadSource: ctx.leadSource,
    title: ctx.title,
    companyName: ctx.companyName,
    industry: ctx.industry,
    city: null,
    country: null,
    employeeCount: ctx.employeeCount,
    email: null,
    seniorityTier: null,
    emailDomainType: null,
    bantBudget: ctx.bant.budget,
    bantAuthority: ctx.bant.authority,
    bantNeed: ctx.bant.need,
    bantTimeline: ctx.bant.timeline,
    hasEmail: ctx.hasEmail,
    hasPhone: ctx.hasPhone,
    recentActivityCount: ctx.activities.length,
    inboundEmailCount: inboundEmails.length,
    callOrMeetingCount: ctx.activities.filter((a) =>
      ["call", "meeting"].includes(a.type),
    ).length,
    pricingPageVisits: 0,
    demoOrQuoteRequests: 0,
    emailOpens: 0,
    emailClicks: 0,
    contentDownloads: 0,
    webinarAttended: false,
    websiteVisits7d: 0,
    daysSinceLastActivity: null,
    convertedOutcome:
      ctx.leadStatus === "converted" || ctx.contactType === "customer",
    icp: null,
    intentDecayPenalty: 0,
    ownerUserId: ctx.ownerUserId,
    schedulingReplies: 0,
    recentActivitySnippet: snippet,
    omniChannelSummary: ctx.omniChannelSummary ?? null,
  });
}

function formatMeetingWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function primaryOpenDeal(ctx: LeadSummaryContext) {
  const open = openDeals(ctx);
  return open[0] ?? null;
}

/** Channels the CRM rep can action from this contact page: email compose and call. */
const UNAVAILABLE_OUTREACH_RE =
  /\b(whatsapp|wa\b|instagram|facebook|messenger|sms|text(?:\s+messages?)?|telegram|wechat|linkedin|social(?:\s+media)?)\b/i;

export function clampOutreachToCrmChannels(
  action: string,
  ctx: Pick<LeadSummaryContext, "hasEmail" | "hasPhone">,
): string {
  const text = action.trim();
  if (!text || !UNAVAILABLE_OUTREACH_RE.test(text)) return text;
  if (ctx.hasEmail) {
    return text
      .replace(UNAVAILABLE_OUTREACH_RE, "email")
      .replace(/\bon email\b/gi, "by email")
      .replace(/\bvia email\b/gi, "by email")
      .replace(/\sthrough email\b/gi, "by email");
  }
  if (ctx.hasPhone) {
    return text
      .replace(UNAVAILABLE_OUTREACH_RE, "call")
      .replace(/\bon call\b/gi, "with a call")
      .replace(/\bvia call\b/gi, "with a call")
      .replace(/\bfollow up on call\b/gi, "follow up with a call")
      .replace(/\bfollow up call\b/gi, "follow up with a call");
  }
  return "Capture a verified email or phone, then follow up.";
}

/**
 * Single source of truth for rep-facing next step from live process state.
 */
export function deriveProcessNextAction(
  ctx: LeadSummaryContext,
  scoreFallback?: string | null,
): string {
  return clampOutreachToCrmChannels(
    deriveProcessNextActionUnguarded(ctx, scoreFallback),
    ctx,
  );
}

function deriveProcessNextActionUnguarded(
  ctx: LeadSummaryContext,
  scoreFallback?: string | null,
): string {
  if (ctx.leadStatus === "disqualified") {
    return "Do not outreach — leave archived unless new intent appears.";
  }

  const converted =
    ctx.leadStatus === "converted" || ctx.contactType === "customer";
  const openDeal = primaryOpenDeal(ctx);
  const upcoming = upcomingMeetings(ctx);
  const pastMeetingsList = pastMeetings(ctx);
  const quoteSent = hasOutboundQuoteOrProposal(ctx);
  const recentInbound = hasRecentInbound(ctx);
  const signals = buildScoreSignals(ctx);
  const demoSignal = hasDemoOrSchedulingSignal(signals);
  const ownerAssigned = Boolean(ctx.ownerUserId?.trim());
  const score = ctx.score ?? 0;

  if (converted) {
    if (quoteSent) {
      return "Follow up on the sent quotation — confirm receipt, answer questions, and agree on next steps.";
    }
    if (upcoming.length > 0) {
      const when = formatMeetingWhen(upcoming[0]?.dueAt ?? null);
      return when
        ? `Confirm attendance for the scheduled meeting (${when}) and prepare an agenda aligned to their needs.`
        : "Confirm attendance for the scheduled meeting and prepare an agenda aligned to their needs.";
    }
    if (openDeal) {
      const stage = openDeal.stage.replace(/_/g, " ");
      return `Advance the open deal (“${openDeal.title}”, ${stage}) — align stakeholders and move toward close.`;
    }
    if ((ctx.orderCount ?? 0) > 0) {
      return "Check in on recent orders — confirm satisfaction and identify expansion or renewal opportunities.";
    }
    if (pastMeetingsList.length > 0 && !quoteSent) {
      return "Send a post-meeting recap with agreed next steps and any promised follow-up materials.";
    }
    return "Schedule a customer success check-in to confirm value realization and next milestones.";
  }

  if (upcoming.length > 0) {
    const when = formatMeetingWhen(upcoming[0]?.dueAt ?? null);
    return when
      ? `Prep for the upcoming meeting (${when}) — review recent emails and confirm the agenda with the lead.`
      : "Prep for the upcoming meeting — review recent emails and confirm the agenda with the lead.";
  }

  if (quoteSent) {
    return "Follow up on the sent quote or proposal — confirm they received it and address pricing or scope questions.";
  }

  if (pastMeetingsList.length > 0 && recentInbound) {
    return "Reply to the latest customer message and propose concrete next steps from the recent meeting.";
  }

  if (pastMeetingsList.length > 0 && !recentInbound) {
    return "Send a post-meeting follow-up — recap outcomes, share promised materials, and propose the next step.";
  }

  if (ownerAssigned && demoSignal && upcoming.length === 0 && pastMeetingsList.length === 0) {
    return "Book the confirmed demo on the assigned rep's calendar and log the meeting activity.";
  }

  if (ownerAssigned && (recentInbound || signals.inboundEmailCount > 0)) {
    return "Reply to the lead's latest message and propose a concrete next step (demo, discovery call, or quote).";
  }

  if (ownerAssigned && score >= SALES_READY_SCORE) {
    return "Assigned rep should follow up within one business day with a tailored discovery or demo offer.";
  }

  if (demoSignal && !ownerAssigned) {
    return "Assign an owner and book the requested demo on the rep's calendar.";
  }

  if (score >= SALES_READY_SCORE && !ownerAssigned) {
    return "Assign an owner and schedule a discovery call within one business day.";
  }

  if (scoreFallback?.trim()) {
    return scoreFallback.trim();
  }

  if (ctx.nextBestAction?.trim()) {
    return ctx.nextBestAction.trim();
  }

  return "Continue nurture with relevant content until intent or engagement increases.";
}
