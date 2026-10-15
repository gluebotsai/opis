/**
 * Evidence bars for Lead Lifecycle transitions (spec §10.4).
 * Pure business logic — no LLM. Lifecycle must call this before applying
 * an elevation; if the bar is not met, only wait / skip / flag_for_review.
 */

import type { LifecycleContext } from "@/service/ai/lead-lifecycle-context";
import { commercialWinCommittedInDb } from "@/service/ai/lead-lifecycle-decide";
import type {
  LifecycleAction,
  LifecycleDecision,
} from "@/service/ai/lead-lifecycle-decide";

export type EvidenceCheck = {
  ok: boolean;
  missing: string[];
  reason: string;
};

function ok(): EvidenceCheck {
  return { ok: true, missing: [], reason: "evidence bar met" };
}

function fail(missing: string[], reason: string): EvidenceCheck {
  return { ok: false, missing, reason };
}

/** Minimum evidence for a proposed lifecycle action. */
export function checkEvidenceBar(
  ctx: LifecycleContext,
  action: LifecycleAction,
): EvidenceCheck {
  const s = ctx.signals;

  switch (action.kind) {
    case "wait":
    case "skip":
    case "flag_for_review":
      return ok();

    case "lead_status": {
      if (action.to === "contacted") {
        const customerEngaged =
          s.inboundReply && (s.meetingHeld || s.meetingBooked);
        if (ctx.outboundTouches > 0 || customerEngaged) return ok();
        return fail(
          ["outbound_or_customer_engagement"],
          "Need outbound touch or inbound + meeting engagement for contacted",
        );
      }
      if (action.to === "qualifying") {
        if (
          s.inboundReply ||
          s.meetingBooked ||
          s.meetingHeld ||
          ctx.outboundTouches > 0
        ) {
          return ok();
        }
        return fail(
          ["inbound_reply_or_meeting"],
          "Need a reply or meeting for qualifying",
        );
      }
      if (action.to === "qualified") {
        // Score-ready OR clear buying intent OR real two-way engagement
        // (inbound reply plus demo/meeting signal). Meeting keywords alone
        // or a lone inbound "thanks" must not qualify a cold lead.
        const scoreOk = typeof ctx.score === "number" && ctx.score >= 40;
        const intent = s.quoteRequested || s.pricingInterest;
        const engaged =
          s.inboundReply &&
          (s.meetingHeld || s.meetingBooked || s.demoRequested);
        const confirmedBant =
          Number(ctx.bant.budget) +
          Number(ctx.bant.authority) +
          Number(ctx.bant.need) +
          Number(ctx.bant.timeline);
        const qualifiedByBantAndMeeting =
          confirmedBant >= 3 && (s.meetingHeld || s.meetingBooked);
        if (scoreOk || intent || engaged || qualifiedByBantAndMeeting) {
          return ok();
        }
        return fail(
          ["score_or_intent_or_engagement_or_bant"],
          "Qualified needs score ≥ 40, pricing intent, inbound reply with demo/meeting interest, or 3 confirmed BANT fields plus a meeting",
        );
      }
      return ok();
    }

    case "convert": {
      const scoreOk = typeof ctx.score === "number" && ctx.score >= 40;
      if (ctx.leadStatus === "qualified" || scoreOk || s.accepted) return ok();
      return fail(
        ["qualified_or_score"],
        "Convert needs qualified status or score ≥ 40",
      );
    }

    case "deal_stage": {
      if (action.to === "discover") {
        if (s.meetingHeld || s.discoveryDone) return ok();
        return fail(
          ["meeting"],
          "Discover needs a meeting with non-negative outcome",
        );
      }
      if (action.to === "propose") {
        if (s.pricingInterest || s.quoteRequested) return ok();
        return fail(
          ["pricing"],
          "Propose needs pricing interest or a quote request",
        );
      }
      if (action.to === "negotiate") {
        const sent = ctx.deal?.quotes?.some((q) => q.status === "sent");
        if (sent && (s.negotiating || s.inboundReply || s.accepted)) return ok();
        if (s.negotiating) return ok();
        return fail(
          ["proposal_sent_and_response"],
          "Negotiate needs a sent proposal/quote and a prospect response",
        );
      }
      return ok();
    }

    case "quote_draft":
      if (
        ctx.deal &&
        (s.pricingInterest ||
          s.quoteRequested ||
          ctx.deal.stage === "propose")
      ) {
        return ok();
      }
      return fail(
        ["deal_propose"],
        "Quote draft needs propose-stage deal or pricing signal",
      );

    case "quote_send":
    case "quote_accept":
    case "close_won":
      if (s.accepted || s.paymentConfirmed) return ok();
      if (ctx.deal?.quotes?.some((q) => q.status === "accepted")) return ok();
      if (ctx.deal?.hasPaidInvoice) return ok();
      // High-risk path still allowed to queue for human confirm — bar is soft here.
      return ok();

    case "close_lost":
    case "disqualify":
      if (s.declined || s.lost) return ok();
      return fail(["explicit_decline"], "Need explicit decline/lost signal");

    default:
      return ok();
  }
}

/**
 * If the decision fails the evidence bar, rewrite to flag_for_review (when
 * there is some signal) or wait (when empty).
 *
 * Ambiguous / neutral meeting analysis:
 * - Never blocks lead_status or convert (hybrid demo path).
 * - Does not block qualification → discover when a CRM transcript already
 *   proves the meeting was held (otherwise deals sit on Qualify forever).
 * - Still blocks later pipeline / commercial actions and always flags
 *   explicit objections.
 */
export function enforceEvidenceBar(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
): LifecycleDecision {
  if (commercialWinCommittedInDb(ctx)) {
    const deal = ctx.deal!;
    const accepted = deal.quotes.find((q) => q.status === "accepted");
    return {
      action: { kind: "close_won" },
      ladder: "pipeline",
      from: deal.stage,
      to: "closed_won",
      reason: accepted
        ? `Quote ${accepted.number} accepted — closing won from CRM commercial state`
        : "Invoice paid — closing won from CRM commercial state",
    };
  }

  const kind = decision.action.kind;
  const to =
    "to" in decision.action && typeof decision.action.to === "string"
      ? decision.action.to
      : null;

  const earlyDiscoverWithHeldMeeting =
    kind === "deal_stage" &&
    to === "discover" &&
    (ctx.signals.meetingHeld || ctx.signals.discoveryDone);

  const meetingGateApplies =
    kind !== "wait" &&
    kind !== "skip" &&
    kind !== "flag_for_review" &&
    kind !== "lead_status" &&
    kind !== "convert" &&
    !earlyDiscoverWithHeldMeeting;

  if (meetingGateApplies && ctx.meetingAnalysis) {
    const outcome = ctx.meetingAnalysis.outcome;
    const ambiguous =
      outcome === "objection" ||
      outcome === "neutral" ||
      (ctx.meetingAnalysis.confidence > 0 &&
        ctx.meetingAnalysis.confidence < 0.5);
    if (ambiguous) {
      return {
        action: {
          kind: "flag_for_review",
          reason: `Meeting analysis ambiguous (${outcome}, confidence=${ctx.meetingAnalysis.confidence})`,
        },
        ladder: "none",
        from: decision.from,
        to: decision.to,
        reason: "Meeting analysis ambiguous — needs human review",
      };
    }
  }

  // Explicit objection still blocks early discover even with a transcript.
  if (
    earlyDiscoverWithHeldMeeting &&
    ctx.meetingAnalysis?.outcome === "objection"
  ) {
    return {
      action: {
        kind: "flag_for_review",
        reason: "Meeting analysis outcome is objection",
      },
      ladder: "none",
      from: decision.from,
      to: decision.to,
      reason: "Meeting objection — needs human review before advancing pipeline",
    };
  }

  const check = checkEvidenceBar(ctx, decision.action);
  if (check.ok) return decision;

  const hasAmbiguity =
    ctx.signals.evidence.length > 0 ||
    ctx.meetings > 0 ||
    ctx.inboundReplies > 0 ||
    Boolean(ctx.meetingAnalysis);

  if (hasAmbiguity) {
    return {
      action: {
        kind: "flag_for_review",
        reason: check.reason,
      },
      ladder: "none",
      from: decision.from,
      to: decision.to,
      reason: `Evidence incomplete for ${decision.action.kind}: ${check.reason}`,
    };
  }

  return {
    action: { kind: "wait", waitHours: 24 },
    ladder: "none",
    from: null,
    to: null,
    reason: check.reason,
  };
}
