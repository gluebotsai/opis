/**
 * Deterministic elevation rules for the Lead Lifecycle Agent.
 *
 * The agent owns three ladders and advances at most one step per run:
 *   lead status  new → contacted → qualifying → qualified → (converted)
 *   lifecycle    lead → prospect → customer
 *   pipeline     qualification → discover → propose → negotiate → won/lost
 *
 * Soft engagement can move lead status and early pipeline stages. Anything with
 * commercial consequence (sending a quote, accepting one, closing won) needs an
 * explicit signal — see `lead-lifecycle-signals.ts`.
 */

import type { DealStage } from "@prisma/client";
import type { LifecycleContext } from "@/service/ai/lead-lifecycle-context";

export type LifecycleLadder = "lead_status" | "lifecycle" | "pipeline" | "none";

export type LifecycleAction =
  | { kind: "lead_status"; to: "contacted" | "qualifying" | "qualified" }
  | { kind: "disqualify"; reason: string }
  | { kind: "convert" }
  | { kind: "deal_stage"; to: DealStage }
  | { kind: "quote_draft" }
  | { kind: "quote_send"; quoteId: string }
  | { kind: "quote_accept"; quoteId: string }
  | { kind: "close_won" }
  | { kind: "close_lost"; reason: string }
  | { kind: "wait"; waitHours: number }
  | { kind: "skip"; reason: string }
  | { kind: "flag_for_review"; reason: string };

export type LifecycleDecision = {
  action: LifecycleAction;
  ladder: LifecycleLadder;
  from: string | null;
  to: string | null;
  reason: string;
};

const PIPELINE_ORDER: DealStage[] = [
  "qualification",
  "discover",
  "propose",
  "negotiate",
];

/** Commercial commitments never run on soft engagement alone. */
const HIGH_RISK: ReadonlySet<LifecycleAction["kind"]> = new Set([
  "quote_send",
  "quote_accept",
  "close_won",
  "close_lost",
  "disqualify",
]);

export function isHighRisk(action: LifecycleAction): boolean {
  return HIGH_RISK.has(action.kind);
}

function wait(hours: number, reason: string): LifecycleDecision {
  return {
    action: { kind: "wait", waitHours: hours },
    ladder: "none",
    from: null,
    to: null,
    reason,
  };
}

function skip(reason: string): LifecycleDecision {
  return {
    action: { kind: "skip", reason },
    ladder: "none",
    from: null,
    to: null,
    reason,
  };
}

function after(
  signalAt: string | undefined,
  reference: string | null,
): boolean {
  if (!signalAt) return false;
  if (!reference) return true;
  return new Date(signalAt).getTime() >= new Date(reference).getTime();
}

function evidence(ctx: LifecycleContext, fallback: string): string {
  const top = ctx.signals.evidence.slice(0, 2).join(", ");
  return top ? `${fallback} — ${top}` : fallback;
}

function decideLeadStatus(ctx: LifecycleContext): LifecycleDecision | null {
  const status = ctx.leadStatus ?? "new";
  const s = ctx.signals;

  if (status === "disqualified" || status === "converted") return null;

  // A lead cannot decline outreach that never happened — this keeps bulk
  // inbound marketing mail from disqualifying an untouched contact.
  const reachedOut = ctx.outboundTouches > 0;
  if (reachedOut && (s.declined || s.lost)) {
    return {
      action: {
        kind: "disqualify",
        reason: s.lost ? "Lost to another option" : "Not interested",
      },
      ladder: "lead_status",
      from: status,
      to: "disqualified",
      reason: evidence(ctx, "Explicit decline on the timeline"),
    };
  }

  if (status === "new") {
    const customerEngaged =
      s.inboundReply && (s.meetingHeld || s.meetingBooked);
    // Completed demo with CRM transcript → jump to qualifying in one step.
    if (s.meetingHeld && (s.inboundReply || reachedOut || s.meetingBooked)) {
      return {
        action: { kind: "lead_status", to: "qualifying" },
        ladder: "lead_status",
        from: status,
        to: "qualifying",
        reason: evidence(
          ctx,
          "Demo/meeting held with conversation evidence — entering qualification",
        ),
      };
    }
    if (reachedOut || customerEngaged) {
      const why = reachedOut
        ? `First outreach logged (${ctx.outboundTouches} outbound touch${
            ctx.outboundTouches === 1 ? "" : "es"
          }).`
        : evidence(ctx, "Customer-initiated engagement (inbound + meeting)");
      return {
        action: { kind: "lead_status", to: "contacted" },
        ladder: "lead_status",
        from: status,
        to: "contacted",
        reason: why,
      };
    }
    return wait(12, "No outreach or customer meeting engagement yet.");
  }

  if (status === "contacted") {
    const engaged =
      s.inboundReply || s.meetingHeld || ctx.outboundTouches + ctx.inboundReplies >= 3;
    if (engaged) {
      return {
        action: { kind: "lead_status", to: "qualifying" },
        ladder: "lead_status",
        from: status,
        to: "qualifying",
        reason: evidence(ctx, "Lead is engaging — moving into qualification"),
      };
    }
    return wait(24, "Contacted but no response yet.");
  }

  if (status === "qualifying") {
    const intentReady = s.quoteRequested || s.pricingInterest;
    const engaged =
      s.inboundReply && (s.meetingHeld || s.meetingBooked);
    if (ctx.salesReady || intentReady || engaged) {
      const why = ctx.salesReady
        ? "Lead score is sales-ready"
        : intentReady
          ? "Buying intent expressed"
          : "Inbound reply with a meeting on the timeline";
      return {
        action: { kind: "lead_status", to: "qualified" },
        ladder: "lead_status",
        from: status,
        to: "qualified",
        reason: evidence(ctx, why),
      };
    }
    return wait(
      24,
      "Qualifying — need score ≥ 40, buying intent, or inbound reply with a meeting.",
    );
  }

  return null;
}

function decideConvert(ctx: LifecycleContext): LifecycleDecision | null {
  if (ctx.leadStatus !== "qualified") return null;
  if (ctx.contactType !== "lead") return null;

  if (ctx.businessType === "b2c") {
    return skip("B2C sells through Commerce — no deal conversion.");
  }
  if (ctx.deal && !ctx.deal.closed) {
    // Convert is done — fall through to pipeline (must not return skip).
    return null;
  }

  return {
    action: { kind: "convert" },
    ladder: "lifecycle",
    from: "lead",
    to: "prospect",
    reason: evidence(ctx, "Qualified lead — opening an opportunity"),
  };
}

function decidePipeline(ctx: LifecycleContext): LifecycleDecision | null {
  const deal = ctx.deal;
  if (!deal || deal.closed) return null;
  if (ctx.businessType === "b2c") return null;

  const s = ctx.signals;
  const stage = deal.stage;
  const idx = PIPELINE_ORDER.indexOf(stage);
  if (idx < 0) return null;

  if (s.lost) {
    return {
      action: {
        kind: "close_lost",
        reason: "Customer chose another option",
      },
      ladder: "pipeline",
      from: stage,
      to: "closed_lost",
      reason: evidence(ctx, "Explicit loss signal"),
    };
  }

  const acceptedQuote = deal.quotes.find((q) => q.status === "accepted");
  const sentQuote = deal.quotes.find((q) => q.status === "sent");
  const draftQuote = deal.quotes.find((q) => q.status === "draft");

  // Win path: accepted quote, paid invoice, or explicit payment signal.
  if (acceptedQuote || deal.hasPaidInvoice || s.paymentConfirmed) {
    return {
      action: { kind: "close_won" },
      ladder: "pipeline",
      from: stage,
      to: "closed_won",
      reason: evidence(
        ctx,
        acceptedQuote
          ? `Quote ${acceptedQuote.number} accepted`
          : deal.hasPaidInvoice
            ? "Invoice paid on the deal"
            : "Payment confirmed",
      ),
    };
  }

  // Acceptance only counts when the customer said it *after* seeing the quote.
  if (sentQuote && s.accepted && after(s.signalAt.accepted, sentQuote.sentAt)) {
    return {
      action: { kind: "quote_accept", quoteId: sentQuote.id },
      ladder: "pipeline",
      from: stage,
      to: "quote_accepted",
      reason: evidence(ctx, `Customer accepted quote ${sentQuote.number}`),
    };
  }

  if (draftQuote && s.quoteRequested && draftQuote.total > 0) {
    return {
      action: { kind: "quote_send", quoteId: draftQuote.id },
      ladder: "pipeline",
      from: stage,
      to: "quote_sent",
      reason: evidence(ctx, `Customer asked for quote ${draftQuote.number}`),
    };
  }

  if (stage === "qualification") {
    // Transcript / discovery evidence — calendar row alone is not enough.
    if (s.meetingHeld || s.discoveryDone) {
      return {
        action: { kind: "deal_stage", to: "discover" },
        ladder: "pipeline",
        from: stage,
        to: "discover",
        reason: evidence(ctx, "Discovery conversation happened"),
      };
    }
    if (ctx.meetings > 0) {
      return wait(
        12,
        "Meeting on the timeline — waiting for transcript or discovery notes before Discover.",
      );
    }
    return wait(24, "Deal opened — waiting on a discovery conversation.");
  }

  if (stage === "discover") {
    if (s.pricingInterest || s.quoteRequested) {
      return {
        action: { kind: "deal_stage", to: "propose" },
        ladder: "pipeline",
        from: stage,
        to: "propose",
        reason: evidence(ctx, "Pricing discussion started"),
      };
    }
    return wait(24, "Discovery in progress — no pricing signal yet.");
  }

  if (stage === "propose") {
    if (sentQuote || s.negotiating) {
      return {
        action: { kind: "deal_stage", to: "negotiate" },
        ladder: "pipeline",
        from: stage,
        to: "negotiate",
        reason: evidence(
          ctx,
          sentQuote ? `Quote ${sentQuote.number} is with the customer` : "Terms under discussion",
        ),
      };
    }
    if (!deal.quotes.length) {
      return {
        action: { kind: "quote_draft" },
        ladder: "pipeline",
        from: stage,
        to: "quote_draft",
        reason: evidence(ctx, "Proposal stage with no quote yet"),
      };
    }
    return wait(24, "Quote drafted — waiting for a send signal.");
  }

  return wait(24, "Negotiating — waiting for acceptance or loss.");
}

/** CRM commercial rows already committed (manual accept / finance paid). */
export function commercialWinCommittedInDb(ctx: LifecycleContext): boolean {
  const deal = ctx.deal;
  if (!deal || deal.closed) return false;
  if (deal.quotes.some((q) => q.status === "accepted")) return true;
  if (deal.hasPaidInvoice) return true;
  return false;
}

/** When quote is accepted or invoice paid in CRM, do not wait on LLM/convert skip. */
export function enforceCommercialWinFromDb(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
): LifecycleDecision {
  if (!commercialWinCommittedInDb(ctx)) return decision;
  const deal = ctx.deal!;
  if (decision.action.kind === "close_won") return decision;

  const accepted = deal.quotes.find((q) => q.status === "accepted");
  const shouldOverride =
    decision.action.kind === "wait" ||
    decision.action.kind === "skip" ||
    decision.action.kind === "flag_for_review" ||
    (decision.ladder === "pipeline" && decision.to !== "closed_won");

  if (!shouldOverride) return decision;

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

export function shouldBypassHighRiskCloseWon(ctx: LifecycleContext): boolean {
  return commercialWinCommittedInDb(ctx);
}

const LADDER_NOTIFY_LABEL: Record<LifecycleLadder, string> = {
  lead_status: "Lead status",
  lifecycle: "Lifecycle",
  pipeline: "Pipeline",
  none: "Lifecycle",
};

/**
 * Domain explanation for a lifecycle move. The Python agent also uses
 * `reason` as LLM provenance (`llm_failed`, …); callers must restore the
 * explanation before persist. Missing / non-string values must not leak as
 * the JS word "undefined" in notifications.
 */
export function lifecycleReason(
  decision: Pick<LifecycleDecision, "reason" | "action"> | null | undefined,
): string {
  if (!decision) return "";
  if (typeof decision.reason === "string" && decision.reason.trim()) {
    return decision.reason.trim();
  }
  const action = decision.action;
  if (action && typeof action === "object" && "reason" in action) {
    const nested = (action as { reason?: unknown }).reason;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "";
}

export function withLifecycleReason(decision: LifecycleDecision): LifecycleDecision {
  return { ...decision, reason: lifecycleReason(decision) };
}

/** In-app / email body for a completed elevation. */
export function lifecycleAdvanceDetail(decision: LifecycleDecision): string {
  const label = LADDER_NOTIFY_LABEL[decision.ladder] ?? "Lifecycle";
  const from = (decision.from && String(decision.from).trim()) || "—";
  const to = (decision.to && String(decision.to).trim()) || "—";
  const transition = `${label} ${from} → ${to}`;
  const why = lifecycleReason(decision);
  return why ? `${transition}: ${why}` : transition;
}

export function decideLifecycleHeuristic(
  ctx: LifecycleContext,
): LifecycleDecision {
  if (ctx.contactStatus === "archived" || ctx.contactStatus === "inactive") {
    return skip("Contact is not active.");
  }
  if (ctx.contactType === "churned") {
    return skip("Churned contacts are managed manually.");
  }

  // Do not elevate on "meeting happened" when capture never landed.
  if (ctx.missingMeetingCapture && !ctx.signals.meetingHeld) {
    return wait(
      12,
      "Meeting ended without a transcript — admit Worktual Notetaker bot next time, or attach notes. Auto-advance waits for conversation evidence.",
    );
  }

  // Earliest unfinished ladder first: status, then convert, then pipeline.
  return (
    decideLeadStatus(ctx) ??
    decideConvert(ctx) ??
    decidePipeline(ctx) ??
    wait(24, "No elevation signal on the timeline.")
  );
}

/**
 * AI high-risk review runs in the Python LangGraph lifecycle agent
 * (own-server LLM). TS fallback is rules-only.
 */
export async function confirmHighRiskWithAi(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
): Promise<LifecycleDecision> {
  void ctx;
  return decision;
}
