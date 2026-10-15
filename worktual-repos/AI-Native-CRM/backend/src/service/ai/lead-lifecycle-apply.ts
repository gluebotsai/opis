/**
 * Write layer for the Lead Lifecycle Agent.
 *
 * Every elevation goes through the same service the UI uses — convert, quote,
 * and deal-stage rules (including the closed-won cascade) stay in one place.
 * This module only decides *which* service call to make and records the move on
 * the contact timeline.
 */

import { prisma } from "@/dao/db/prisma";
import { updateContact } from "@/dao/contacts/contact-service";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { convertLeadToDeal } from "@/dao/sales/convert-lead";
import { updateDealStage } from "@/dao/sales/deal-service";
import {
  resolveRegionalSalesOwner,
  type RegionalOwner,
} from "@/dao/sales/territory-assignment";
import { backfillCompanyOwnerFromContact } from "@/dao/companies/company-owner-backfill";
import {
  acceptQuote,
  createQuote,
} from "@/dao/sales/quote-service";
import { markQuoteSentCommand } from "@/service/sales/quote-commands";
import { runWithRequestUserId } from "@/service/account/request-context";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";
import { encodeNoteBody } from "@/lib/note-body";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  AGENT_NOTE_PREFIX,
  type LifecycleContext,
} from "@/service/ai/lead-lifecycle-context";
import {
  lifecycleAdvanceDetail,
  lifecycleReason,
  type LifecycleDecision,
} from "@/service/ai/lead-lifecycle-decide";
import { triggerDocumentAgentsAfterLifecycle } from "@/service/ai/lead-lifecycle-document-triggers";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { assignLeadFromScore } from "@/service/ai/lead-score-route";
import { beginLeadOwnerFollowup } from "@/service/ai/lead-assignment-followup";
import { gradeFromScore, bandFromScore, type LeadScoreResult } from "@/service/ai/lead-score";

export type ApplyOutcome = {
  applied: boolean;
  ladder: string;
  from: string | null;
  to: string | null;
  reason: string;
  dealId: string | null;
  quoteId: string | null;
  /** Set when the decision could not be carried out (missing data, guard). */
  blocked: string | null;
};

const LADDER_LABEL: Record<string, string> = {
  lead_status: "Lead status",
  lifecycle: "Lifecycle",
  pipeline: "Pipeline",
  none: "Lifecycle",
};

function escapeLifecycleHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function logTimeline(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
  detail: string,
): Promise<void> {
  const reason = lifecycleReason(decision);
  const detailTrim = detail.trim();

  // flag_for_review does NOT move the deal/lead — never headline as a completed
  // "qualification → discover" transition (that made the pipeline look out of sync).
  if (decision.action.kind === "flag_for_review") {
    const heldAt = decision.from ?? ctx.deal?.stage ?? "current stage";
    const proposed = decision.to ? `Proposed next: ${decision.to}.` : "";
    const headline = `${AGENT_NOTE_PREFIX} Held for review at ${heldAt} (not moved)`;
    const parts = [`<h3>${escapeLifecycleHtml(headline)}</h3>`];
    if (proposed) {
      parts.push(`<h4>Proposed</h4><p>${escapeLifecycleHtml(proposed)}</p>`);
    }
    if (reason && reason !== headline) {
      parts.push(`<h4>Reason</h4><p>${escapeLifecycleHtml(reason)}</p>`);
    }
    if (
      detailTrim &&
      detailTrim !== reason &&
      detailTrim !== headline &&
      detailTrim !== proposed
    ) {
      parts.push(`<h4>Detail</h4><p>${escapeLifecycleHtml(detailTrim)}</p>`);
    }
    try {
      await createContactActivity(ctx.contactId, {
        type: "note",
        subject: headline,
        body: encodeNoteBody({ html: parts.join("") }),
        createdByUserId: ctx.ownerUserId,
      });
    } catch (err) {
      console.error("lifecycle timeline note failed", err);
    }
    return;
  }

  // deal_stage is always a pipeline move — don't label notes "Lifecycle …"
  const ladder =
    decision.action.kind === "deal_stage" ? "pipeline" : decision.ladder;
  const label = LADDER_LABEL[ladder] ?? "Lifecycle";
  const transition = `${label} ${decision.from ?? "—"} → ${decision.to ?? "—"}`;
  const headline = `${AGENT_NOTE_PREFIX} ${transition}`;
  // Skip Change block — it duplicated the headline. Keep Reason/Detail only
  // when they add something beyond the transition line.
  const parts = [`<h3>${escapeLifecycleHtml(headline)}</h3>`];
  if (reason && reason !== transition && reason !== headline) {
    parts.push(
      `<h4>Reason</h4><p>${escapeLifecycleHtml(reason)}</p>`,
    );
  }
  if (
    detailTrim &&
    detailTrim !== transition &&
    detailTrim !== reason &&
    detailTrim !== headline
  ) {
    parts.push(
      `<h4>Detail</h4><p>${escapeLifecycleHtml(detailTrim)}</p>`,
    );
  }
  try {
    await createContactActivity(ctx.contactId, {
      type: "note",
      subject: headline,
      body: encodeNoteBody({ html: parts.join("") }),
      createdByUserId: ctx.ownerUserId,
    });
  } catch (err) {
    console.error("lifecycle timeline note failed", err);
  }
}

function notify(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
  extra: {
    dealId?: string | null;
    quoteId?: string | null;
    ownerUserId?: string | null;
  },
): void {
  notifyAdminsAsync({
    kind: "lead_lifecycle_advanced",
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    contactName: ctx.displayName,
    companyName: ctx.companyName,
    dealId: extra.dealId ?? ctx.deal?.id ?? null,
    quoteId: extra.quoteId ?? null,
    ownerUserId: extra.ownerUserId ?? ctx.ownerUserId,
    stage: decision.to,
    href: `/contact/${ctx.contactId}`,
    actorUserId: null,
    excludeUserId: null,
    detail: lifecycleAdvanceDetail(decision),
    metadata: {
      ladder: decision.ladder,
      from: decision.from,
      to: decision.to,
      action: decision.action.kind,
      autonomous: true,
    },
  });
}

/**
 * A draft quote needs a defensible price. Deal amount wins; otherwise the
 * catalog's single obvious priced product. Anything ambiguous is left alone.
 */
async function buildDraftQuoteLines(
  ctx: LifecycleContext,
): Promise<{ name: string; quantity: number; unitPrice: number; productId?: string | null }[] | null> {
  const amount = ctx.deal?.amount ?? null;
  if (amount && amount > 0) {
    return [
      {
        name: ctx.deal?.title?.trim() || "Proposed scope",
        quantity: 1,
        unitPrice: amount,
      },
    ];
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: "active",
      price: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, price: true },
    take: 2,
  });
  if (products.length === 1) {
    const product = products[0]!;
    return [
      {
        productId: product.id,
        name: product.name,
        quantity: 1,
        unitPrice: Number(product.price),
      },
    ];
  }

  // Phase 1 (no CDP catalog): allow a TBD narrative line so propose can proceed.
  // Owner confirmation still gates any customer-facing send.
  return [
    {
      name: `Proposal – ${ctx.deal?.title?.trim() || "scope"}`.slice(0, 200),
      quantity: 1,
      unitPrice: 0,
    },
  ];
}

async function clearReviewFlag(contactId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `
      UPDATE contact_profiles SET
        flagged_for_review = false,
        flag_reason = NULL,
        updated_at = NOW()
      WHERE account_contact_id = $1::text
        AND COALESCE(flagged_for_review, false) = true
      `,
      contactId,
    );
  } catch {
    /* column may be absent until migration */
  }
}

/** True when a newer human stage edit owns the ladder vs last agent apply. */
export function humanOwnsLifecycleLadder(
  ctx: LifecycleContext,
  lastAppliedAt: Date | null | undefined,
): boolean {
  if (ctx.lifecycleLastAction !== "manual_edit") return false;
  if (!ctx.lifecycleLastRunAt) return false;
  if (!lastAppliedAt) return true;
  return (
    new Date(ctx.lifecycleLastRunAt).getTime() > lastAppliedAt.getTime()
  );
}

/**
 * Stable key for "same review situation" — ignores LLM wording so cron/re-runs
 * do not spam the timeline when nothing material changed.
 */
export function lifecycleReviewFingerprint(
  ctx: LifecycleContext,
  decision: Pick<LifecycleDecision, "from" | "to">,
): string {
  const heldAt = (
    decision.from ??
    ctx.deal?.stage ??
    ctx.contactType ??
    ""
  )
    .trim()
    .toLowerCase();
  const proposed = (decision.to ?? "").trim().toLowerCase();
  const quoteStatuses = (ctx.deal?.quotes ?? [])
    .map((q) => q.status)
    .sort()
    .join(",");
  const ma = ctx.meetingAnalysis;
  const bant = [
    ctx.bant.budget ? "b" : "",
    ctx.bant.authority ? "a" : "",
    ctx.bant.need ? "n" : "",
    ctx.bant.timeline ? "t" : "",
  ].join("");
  return [
    heldAt,
    proposed,
    ctx.signals.quoteRequested ? "qr" : "",
    ctx.signals.meetingHeld ? "mh" : "",
    ctx.missingMeetingCapture ? "mmc" : "",
    quoteStatuses,
    ma?.outcome ?? "",
    ma?.nextStepAgreed ? "nsa" : "",
    String(Math.round((ma?.confidence ?? 0) * 10) / 10),
    bant,
  ].join("|");
}

/** Skip flag_for_review timeline/notify when we already flagged the same evidence. */
export function isRedundantFlagForReview(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
): boolean {
  if (decision.action.kind !== "flag_for_review") return false;
  if (ctx.lifecycleLastAction !== "flag_for_review") return false;
  const prev = (ctx.lifecycleLastReason || "").trim();
  const fp = lifecycleReviewFingerprint(ctx, decision);
  if (prev.startsWith("fp:")) {
    return prev === `fp:${fp}`;
  }
  // Legacy free-text stamp: already notified once — stay silent until evidence changes
  // (next successful flag stamps fp:… and future runs compare fingerprints).
  return true;
}

const HUMAN_OWNED_KINDS = new Set([
  "lead_status",
  "convert",
  "deal_stage",
]);

async function stampLifecycleMeta(
  contactId: string,
  action: string,
  reason: string | null | undefined,
): Promise<void> {
  try {
    const actionText = String(action ?? "").slice(0, 64);
    const reasonText = String(reason ?? "").slice(0, 2000);
    await prisma.contactProfile.update({
      where: { accountContactId: contactId },
      data: {
        lifecycleLastAction: actionText || "unknown",
        lifecycleLastReason: reasonText || "no_reason",
        lifecycleLastRunAt: new Date(),
      },
    });
  } catch (err) {
    console.error("lifecycle meta stamp failed", contactId, err);
  }
}

/**
 * Qualified leads must have a contact owner. Prefer existing → score-gated
 * assignment when sales-ready → regional routing. Company owner is not
 * inherited (account ownership ≠ lead assignment).
 */
async function ensureOwnerForQualified(
  ctx: LifecycleContext,
  options?: {
    assignment?: RegionalOwner | null;
    ownerUserId?: string | null;
  },
): Promise<{ ownerUserId: string | null; blocked: string | null }> {
  const asId = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  };
  let ownerUserId =
    asId(options?.ownerUserId) || asId(ctx.ownerUserId) || null;
  let emailedByScoreRoute = false;

  if (
    !ownerUserId &&
    (ctx.salesReady || (typeof ctx.score === "number" && ctx.score >= 40))
  ) {
    const score = ctx.score ?? 40;
    const scoreResult: LeadScoreResult = {
      score,
      grade: gradeFromScore(score),
      band: bandFromScore(score),
      fitScore: Math.min(50, score),
      intentScore: Math.min(50, Math.max(0, score - 20)),
      salesReady: true,
      rationale: "Lifecycle qualified — assign from score gate",
      factors: [],
      positiveReasons: [],
      negativeReasons: [],
      nextBestAction: "Assign sales owner",
      behaviouralPositiveReasons: [],
      behaviouralNegativeReasons: [],
      behaviouralReasons: [],
      pillars: { demographics: 0, firmographics: 0, behavioural: 0 },
      scoreBreakdown: {},
    };
    const routed = await assignLeadFromScore({
      contactId: ctx.contactId,
      organizationId: ctx.organizationId,
      scoreResult,
    });
    ownerUserId = routed.ownerUserId;
    emailedByScoreRoute = Boolean(routed.ownerUserId);
  }

  if (!ownerUserId && options?.assignment?.userId) {
    ownerUserId = options.assignment.userId;
  }

  if (!ownerUserId) {
    return {
      ownerUserId: null,
      blocked: "qualified_needs_owner",
    };
  }

  if (ownerUserId !== ctx.ownerUserId) {
    await updateContact(ctx.contactId, { ownerUserId }).catch((err) =>
      console.error("lifecycle: set contact owner on qualified failed", err),
    );
    if (!emailedByScoreRoute) {
      await beginLeadOwnerFollowup({
        contactId: ctx.contactId,
        organizationId: ctx.organizationId,
        ownerUserId,
        reason: options?.assignment?.reason || "Qualified lead assigned to a sales rep.",
        displayName: ctx.displayName,
        leadStatus: ctx.leadStatus,
      }).catch((err) =>
        console.error("lifecycle assignment email failed", ctx.contactId, err),
      );
    }
  }

  return { ownerUserId, blocked: null };
}

function enqueueRescoreAfterEngagement(ctx: LifecycleContext, to: string): void {
  if (to !== "qualifying" && to !== "qualified" && to !== "contacted") return;
  void enqueueLeadScoring({
    contactId: ctx.contactId,
    organizationId: ctx.organizationId,
    triggerReason: `lifecycle_${to}`,
    processImmediately: true,
  }).catch((err) =>
    console.error("lifecycle: rescore after engagement failed", err),
  );
}

async function resolveLastAppliedAt(
  ctx: LifecycleContext,
  override?: Date | null,
): Promise<Date | null> {
  if (override !== undefined) return override;
  try {
    const { findLifecycleJobByOrgContact } = await import(
      "@/dao/ai/lead-lifecycle-store"
    );
    const job = await findLifecycleJobByOrgContact(
      ctx.organizationId,
      ctx.contactId,
    );
    return job?.lastAppliedAt ?? null;
  } catch {
    return null;
  }
}

export async function applyLifecycleDecision(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
  options?: {
    assignment?: RegionalOwner | null;
    ownerUserId?: string | null;
    /** When omitted, looked up from the lifecycle job row. */
    lastAppliedAt?: Date | null;
  },
): Promise<ApplyOutcome> {
  const base: ApplyOutcome = {
    applied: false,
    ladder: decision.ladder,
    from: decision.from,
    to: decision.to,
    reason: decision.reason,
    dealId: ctx.deal?.id ?? null,
    quoteId: null,
    blocked: null,
  };

  if (HUMAN_OWNED_KINDS.has(decision.action.kind)) {
    const lastAppliedAt = await resolveLastAppliedAt(
      ctx,
      options?.lastAppliedAt,
    );
    if (humanOwnsLifecycleLadder(ctx, lastAppliedAt)) {
      return {
        ...base,
        blocked: "human_stage_owns_ladder",
        reason: "Human stage edit owns the ladder — agent will not overwrite",
      };
    }
  }

  let outcome: ApplyOutcome = base;

  switch (decision.action.kind) {
    case "lead_status": {
      if (
        (ctx.leadStatus || "").toLowerCase() ===
        decision.action.to.toLowerCase()
      ) {
        return { ...base, blocked: "already_at_target" };
      }

      if (decision.action.to === "qualified") {
        const owned = await ensureOwnerForQualified(ctx, options);
        if (owned.blocked) {
          return {
            ...base,
            applied: false,
            blocked: owned.blocked,
            reason:
              "Qualified needs a sales owner — assign a rep (or wait until score ≥ 40 routes one) before elevating",
          };
        }
      }

      await updateContact(ctx.contactId, {
        leadStatus: decision.action.to,
      });
      await logTimeline(ctx, decision, "");
      notify(ctx, decision, {});
      enqueueRescoreAfterEngagement(ctx, decision.action.to);
      outcome = { ...base, applied: true };
      break;
    }

    case "disqualify": {
      await updateContact(ctx.contactId, {
        leadStatus: "disqualified",
        disqualifyReason: decision.action.reason,
      });
      await logTimeline(ctx, decision, decision.action.reason);
      notifyAdminsAsync({
        kind: "lead_disqualified",
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        contactName: ctx.displayName,
        companyName: ctx.companyName,
        ownerUserId: ctx.ownerUserId,
        href: `/contact/${ctx.contactId}`,
        actorUserId: null,
        excludeUserId: null,
        detail: `Lifecycle agent: ${decision.reason}`,
      });
      outcome = { ...base, applied: true };
      break;
    }

    case "convert": {
      // Leads are pooled (unowned). Route the new opportunity to a sales owner
      // by region + business type before the deal is created so the rep owns it.
      // Prefer the Python assign-sales agent result when provided.
      let ownerUserId = options?.ownerUserId ?? ctx.ownerUserId;
      let assignment: RegionalOwner | null = options?.assignment ?? null;
      if (!ownerUserId) {
        const decided = await resolveRegionalSalesOwner({
          organizationId: ctx.organizationId,
          businessType: ctx.businessType,
          country: ctx.country,
          city: ctx.city,
          contactId: ctx.contactId,
          companyId: ctx.companyId,
          estimatedAmount: ctx.deal?.amount ?? null,
        });
        assignment = decided.status === "assigned" ? decided.owner : null;
        ownerUserId = assignment?.userId ?? null;
      }

      const result = await convertLeadToDeal({
        contactId: ctx.contactId,
        ownerUserId,
        actorUserId: ownerUserId,
      });

      if (result.alreadyConverted) {
        return {
          ...base,
          blocked: "already_converted",
          dealId: result.dealId,
        };
      }

      // The deal owner is set inside convertLeadToDeal; mirror it onto the
      // contact so the whole record follows the assigned rep.
      if (ownerUserId) {
        await updateContact(ctx.contactId, { ownerUserId }).catch((err) =>
          console.error(
            "lifecycle: set contact owner after convert failed",
            err,
          ),
        );
        await backfillCompanyOwnerFromContact({
          contactId: ctx.contactId,
          ownerUserId,
          companyId: ctx.companyId,
        });
      }

      // Record the auto-assignment as its own audited action so the Agents
      // dashboard can report the Sales assignment agent's activity.
      if (assignment) {
        await writeAuditLog({
          actorUserId: assignment.userId,
          action: "assign",
          entityType: "deal",
          entityId: result.dealId,
          organizationId: ctx.organizationId,
          meta: {
            agent: "sales_assignment",
            ownerUserId: assignment.userId,
            ownerName: assignment.name,
            ownerRole: assignment.role,
            matchedRegion: assignment.matchedRegion,
            businessType: ctx.businessType,
            country: ctx.country,
            reason: assignment.reason,
          },
        });
      }

      const assignmentNote = assignment
        ? ` Assigned to ${assignment.name} (${assignment.reason}).`
        : "";
      const converted: LifecycleDecision = {
        ...decision,
        to: "prospect",
      };
      await logTimeline(
        ctx,
        converted,
        `Opportunity opened at Qualify.${assignmentNote}`,
      );
      notify(ctx, converted, { dealId: result.dealId, ownerUserId });
      notifyAdminsAsync({
        kind: "lead_converted",
        organizationId: ctx.organizationId,
        contactId: ctx.contactId,
        contactName: ctx.displayName,
        companyName: ctx.companyName,
        dealId: result.dealId,
        ownerUserId,
        href: `/sales/${result.dealId}`,
        actorUserId: null,
        excludeUserId: null,
        detail: `Lifecycle agent converted this qualified lead. ${decision.reason}${assignmentNote}`,
      });
      outcome = { ...base, applied: true, dealId: result.dealId };
      break;
    }

    case "deal_stage": {
      if (!ctx.deal) return { ...base, blocked: "no_deal" };
      const current = ctx.deal.stage;
      const target = decision.action.to;
      if (current === target) {
        return { ...base, blocked: "already_at_target", dealId: ctx.deal.id };
      }
      // Never move backward or re-apply a stage the deal has already passed.
      const order = [
        "qualification",
        "discover",
        "propose",
        "negotiate",
      ] as const;
      const curIdx = order.indexOf(current as (typeof order)[number]);
      const tgtIdx = order.indexOf(target as (typeof order)[number]);
      if (curIdx >= 0 && tgtIdx >= 0 && curIdx > tgtIdx) {
        return { ...base, blocked: "already_past_target", dealId: ctx.deal.id };
      }
      if (
        current === "closed_won" ||
        current === "closed_lost"
      ) {
        return { ...base, blocked: "deal_closed", dealId: ctx.deal.id };
      }
      await updateDealStage(ctx.deal.id, target, {
        actorUserId: ctx.ownerUserId,
      });
      await logTimeline(ctx, decision, "");
      notify(ctx, decision, { dealId: ctx.deal.id });
      await triggerDocumentAgentsAfterLifecycle(ctx, decision);
      outcome = { ...base, applied: true };
      break;
    }

    case "quote_draft": {
      if (!ctx.deal) return { ...base, blocked: "no_deal" };
      const lines = await buildDraftQuoteLines(ctx);
      if (!lines) {
        return { ...base, blocked: "no_pricing_basis" };
      }
      const quote = await createQuote({
        dealId: ctx.deal.id,
        lines,
        organizationId: ctx.organizationId,
        createdByUserId: ctx.ownerUserId,
        notes:
          lines.some((l) => l.unitPrice === 0)
            ? `Drafted by the lifecycle agent (TBD pricing until CDP catalog). ${decision.reason}`
            : `Drafted by the lifecycle agent. ${decision.reason}`,
      });
      await logTimeline(ctx, decision, `Draft quote ${quote.number} created.`);
      notify(ctx, decision, { dealId: ctx.deal.id, quoteId: quote.id });
      await triggerDocumentAgentsAfterLifecycle(ctx, decision);
      outcome = { ...base, applied: true, quoteId: quote.id };
      break;
    }

    case "quote_send": {
      const quoteId = decision.action.quoteId;
      const sent = await runWithRequestUserId(ctx.ownerUserId, () =>
        markQuoteSentCommand(quoteId),
      );
      if (!sent.ok) {
        return {
          ...base,
          blocked: sent.error || "quote_send_blocked",
          quoteId,
        };
      }
      await logTimeline(ctx, decision, "Quote sent to the customer.");
      notify(ctx, decision, { quoteId });
      outcome = { ...base, applied: true, quoteId };
      break;
    }

    case "quote_accept": {
      const quoteId = decision.action.quoteId;
      const { quote, order } = await acceptQuote(quoteId, ctx.ownerUserId);
      const { notifyAfterQuoteAccepted } = await import(
        "@/service/email/commercial-notify"
      );
      await notifyAfterQuoteAccepted({
        organizationId: ctx.organizationId,
        quoteId,
        quoteNumber: quote.number ?? null,
        dealId: quote.dealId ?? ctx.deal?.id ?? null,
        dealTitle: quote.deal?.title ?? ctx.deal?.title ?? null,
        contactId: ctx.contactId,
        ownerUserId: quote.deal?.ownerUserId ?? ctx.ownerUserId,
        orderId: order?.id ?? null,
        actorUserId: ctx.ownerUserId,
      });
      await logTimeline(
        ctx,
        decision,
        "Quote accepted — order and invoice draft submitted for finance approval.",
      );
      notify(ctx, decision, { quoteId });
      outcome = { ...base, applied: true, quoteId };
      break;
    }

    case "close_won": {
      if (!ctx.deal) return { ...base, blocked: "no_deal" };
      if (ctx.deal.stage === "closed_won") {
        return { ...base, blocked: "already_at_target", dealId: ctx.deal.id };
      }
      await updateDealStage(ctx.deal.id, "closed_won", {
        actorUserId: ctx.ownerUserId,
      });
      await logTimeline(
        ctx,
        decision,
        "Deal closed won — contact promoted to Customer.",
      );
      notify(ctx, decision, { dealId: ctx.deal.id });
      await triggerDocumentAgentsAfterLifecycle(ctx, decision);
      outcome = { ...base, applied: true };
      break;
    }

    case "close_lost": {
      if (!ctx.deal) return { ...base, blocked: "no_deal" };
      if (ctx.deal.stage === "closed_lost") {
        return { ...base, blocked: "already_at_target", dealId: ctx.deal.id };
      }
      await updateDealStage(ctx.deal.id, "closed_lost", {
        lostReason: decision.action.reason,
        actorUserId: ctx.ownerUserId,
      });
      await logTimeline(ctx, decision, decision.action.reason);
      notify(ctx, decision, { dealId: ctx.deal.id });
      outcome = { ...base, applied: true };
      break;
    }

    case "flag_for_review": {
      const flagReason = decision.action.reason.slice(0, 500);
      const fingerprint = lifecycleReviewFingerprint(ctx, decision);
      const metaReason = `fp:${fingerprint}`.slice(0, 2000);
      // Same evidence already flagged — don't spam notes when LLM rephrases.
      if (isRedundantFlagForReview(ctx, decision)) {
        // Upgrade legacy free-text stamps to fp: so a later evidence change can notify once.
        if ((ctx.lifecycleLastReason || "").trim() !== metaReason) {
          try {
            await prisma.$executeRawUnsafe(
              `
              UPDATE contact_profiles SET
                lifecycle_last_reason = $2,
                lifecycle_last_run_at = NOW(),
                updated_at = NOW()
              WHERE account_contact_id = $1::text
                AND lifecycle_last_action = 'flag_for_review'
              `,
              ctx.contactId,
              metaReason,
            );
          } catch {
            /* ignore */
          }
        }
        return { ...base, blocked: "already_flagged", reason: flagReason };
      }
      await prisma.$executeRawUnsafe(
        `
        UPDATE contact_profiles SET
          flagged_for_review = true,
          flag_reason = $2,
          lifecycle_last_action = 'flag_for_review',
          lifecycle_last_reason = $3,
          lifecycle_last_run_at = NOW(),
          updated_at = NOW()
        WHERE account_contact_id = $1::text
        `,
        ctx.contactId,
        flagReason,
        metaReason,
      );
      await logTimeline(ctx, decision, flagReason);
      notify(ctx, decision, {});
      outcome = { ...base, applied: true };
      break;
    }

    default:
      return base;
  }

  if (
    outcome.applied &&
    decision.action.kind !== "flag_for_review"
  ) {
    await clearReviewFlag(ctx.contactId);
    await stampLifecycleMeta(
      ctx.contactId,
      decision.action.kind,
      lifecycleReason(decision),
    );
  }

  return outcome;
}

export async function auditLifecycleMove(
  ctx: LifecycleContext,
  outcome: ApplyOutcome,
): Promise<void> {
  if (!outcome.applied) return;
  try {
    await writeAuditLog({
      actorUserId: ctx.ownerUserId,
      action: "update",
      entityType: "contact",
      entityId: ctx.contactId,
      organizationId: ctx.organizationId,
      meta: {
        agent: "lead_lifecycle",
        outcome: "applied",
        ladder: outcome.ladder,
        from: outcome.from,
        to: outcome.to,
        dealId: outcome.dealId,
        quoteId: outcome.quoteId,
        reason: outcome.reason,
      },
    });
  } catch (err) {
    console.error("lifecycle audit log failed", err);
  }
}

/**
 * Append-only record of a failed lifecycle run so dashboard run counts stay
 * cumulative (the job table only holds the latest state per contact).
 */
export async function auditLifecycleFailure(input: {
  organizationId: string;
  contactId: string;
  ownerUserId?: string | null;
  error: string;
}): Promise<void> {
  try {
    await writeAuditLog({
      actorUserId: input.ownerUserId ?? null,
      action: "update",
      entityType: "contact",
      entityId: input.contactId,
      organizationId: input.organizationId,
      meta: {
        agent: "lead_lifecycle",
        outcome: "failed",
        ladder: "none",
        reason: input.error,
      },
    });
  } catch (err) {
    console.error("lifecycle failure audit log failed", err);
  }
}
