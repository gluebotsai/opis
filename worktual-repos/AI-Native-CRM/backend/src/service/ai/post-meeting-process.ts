/**
 * B2B post-meeting process orchestrator.
 * Triggered after a meeting transcript is attached. Creates proposal/quote
 * drafts (never auto-emails customers), books free slots, and enqueues owner
 * confirmations for customer-facing scheduling and commercial closes.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { updateDealStage } from "@/dao/sales/deal-service";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { analyzePostMeeting, type PostMeetingAnalysis } from "@/service/ai/post-meeting-analyze";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import {
  buildProposalBrief,
  ensureOpenDealForContact,
  notifySalesOfCommercialDraft,
  persistCommercialDrafts,
} from "@/service/ai/proposal-brief";
import {
  enqueueProcessConfirmation,
  getProcessConfirmation,
  markProcessConfirmation,
  type ProcessActionKind,
} from "@/service/ai/process-confirmations";
import {
  formatSlotLabel,
  parseProposedMeetingStart,
  tryBookOwnerSlot,
} from "@/service/ai/post-meeting-schedule";
import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { applyLifecycleDecision } from "@/service/ai/lead-lifecycle-apply";
import {
  isHighRisk,
  type LifecycleDecision,
  decideLifecycleHeuristic,
  withLifecycleReason,
} from "@/service/ai/lead-lifecycle-decide";
import type { LifecycleContext } from "@/service/ai/lead-lifecycle-context";
import { buildLifecycleContext } from "@/service/ai/lead-lifecycle-context";
import { enforceEvidenceBar } from "@/service/ai/lead-lifecycle-evidence";
import { markQuoteSentCommand } from "@/service/sales/quote-commands";
import { runWithRequestUserId } from "@/service/account/request-context";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";

export type PostMeetingProcessResult = {
  ran: boolean;
  skippedReason?: string;
  analysisStored?: boolean;
  briefCreated?: boolean;
  bookedMeeting?: boolean;
  confirmations: string[];
};

function mergeInsights(
  prior: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject {
  const base =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : {};
  const processPrior =
    base.postMeetingProcess &&
    typeof base.postMeetingProcess === "object" &&
    !Array.isArray(base.postMeetingProcess)
      ? (base.postMeetingProcess as Record<string, unknown>)
      : {};
  return {
    ...base,
    postMeetingProcess: {
      ...processPrior,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  } as Prisma.InputJsonObject;
}

/**
 * Gate lifecycle high-risk actions behind owner confirmation.
 * Returns true when the decision was queued (caller should not apply).
 */
export async function enqueueLifecycleHighRiskIfNeeded(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
): Promise<{ queued: boolean; confirmationId?: string }> {
  if (!isHighRisk(decision.action)) return { queued: false };
  if (!ctx.ownerUserId) {
    console.warn(
      "lifecycle high-risk skipped — no contact owner",
      ctx.contactId,
      decision.action.kind,
    );
    return { queued: true };
  }

  const kindMap: Record<string, ProcessActionKind> = {
    quote_send: "quote_send",
    quote_accept: "quote_accept",
    close_won: "close_won",
    close_lost: "close_lost",
    disqualify: "disqualify",
  };
  const actionKind = kindMap[decision.action.kind];
  if (!actionKind) return { queued: false };

  const row = await enqueueProcessConfirmation({
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    ownerUserId: ctx.ownerUserId,
    dealId: ctx.deal?.id ?? null,
    actionKind,
    title: `Approve: ${decision.action.kind.replace(/_/g, " ")}`,
    summary: decision.reason,
    payload: {
      source: "lead_lifecycle",
      decision,
    },
  });

  return { queued: true, confirmationId: row.id };
}

function wantsCommercialDrafts(analysis: PostMeetingAnalysis): boolean {
  return Boolean(
    analysis.wantsProposalDraft ||
      analysis.requirementsSufficientForProposal ||
      analysis.wantsQuoteDraft,
  );
}

export { wantsCommercialDrafts };

/** Post-meeting commercial work does not run lifecycle-lead; sync lead ladder here. */
async function promoteLeadAfterPostMeeting(
  contactId: string,
  organizationId: string,
): Promise<void> {
  const ctx = await buildLifecycleContext(contactId, organizationId);
  if (!ctx || ctx.contactType !== "lead") return;
  const status = (ctx.leadStatus || "new").toLowerCase();
  if (status === "qualified" || status === "disqualified") return;

  const heuristic = decideLifecycleHeuristic(ctx);
  const decision: LifecycleDecision =
    heuristic.action.kind === "lead_status" &&
    heuristic.action.to === "qualified"
      ? heuristic
      : {
          action: { kind: "lead_status", to: "qualified" },
          ladder: "lead_status",
          from: ctx.leadStatus,
          to: "qualified",
          reason:
            "Post-meeting pipeline completed — meeting transcript captured and commercial drafts prepared",
        };

  const gated = enforceEvidenceBar(ctx, decision);
  if (gated.action.kind !== "lead_status" || gated.action.to !== "qualified") {
    return;
  }

  await applyLifecycleDecision(ctx, gated).catch((err) => {
    console.error("post-meeting lead_status promote failed", contactId, err);
  });
}

export async function runPostMeetingProcess(input: {
  activityId: string;
  contactId?: string | null;
}): Promise<PostMeetingProcessResult> {
  const confirmations: string[] = [];

  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      type: true,
      subject: true,
      transcriptText: true,
      transcriptInsights: true,
      organizationId: true,
    },
  });
  if (!activity?.transcriptText?.trim()) {
    return { ran: false, skippedReason: "no_transcript", confirmations };
  }

  const priorInsightsRoot =
    activity.transcriptInsights &&
    typeof activity.transcriptInsights === "object" &&
    !Array.isArray(activity.transcriptInsights)
      ? (activity.transcriptInsights as Record<string, unknown>)
      : null;
  const priorPostMeetingEarly =
    priorInsightsRoot?.postMeetingProcess &&
    typeof priorInsightsRoot.postMeetingProcess === "object" &&
    !Array.isArray(priorInsightsRoot.postMeetingProcess)
      ? (priorInsightsRoot.postMeetingProcess as Record<string, unknown>)
      : null;
  if (priorPostMeetingEarly?.ranAt) {
    return {
      ran: false,
      skippedReason: "already_ran",
      confirmations,
    };
  }

  const ranAt = new Date().toISOString();
  let transcriptInsights: Prisma.InputJsonValue = mergeInsights(
    activity.transcriptInsights,
    {
      ranAt,
      status: "running",
    },
  );
  await prisma.contactActivity.update({
    where: { id: activity.id },
    data: { transcriptInsights },
  });

  const contactId = input.contactId || activity.contactId;
  const contact = await getContact(contactId);
  if (!contact) {
    return { ran: false, skippedReason: "contact_not_found", confirmations };
  }

  const organizationId = await resolveRequestOrganizationId(
    activity.organizationId,
  );
  const seller = await loadSellerOrganization(organizationId);

  // B2B / B2B2C only for Phase 1 (skip pure B2C orgs / contacts)
  const sellerBiz = (seller?.businessType || "").toLowerCase();
  const contactTags = (contact.person.tags || []).map((t) => t.toLowerCase());
  const isB2c =
    sellerBiz === "b2c" ||
    (contactTags.includes("b2c") && !contactTags.includes("b2b"));
  if (isB2c) {
    return { ran: false, skippedReason: "b2c_skipped", confirmations };
  }

  const ownerUserId = contact.crm.ownerUserId?.trim() || null;

  const analysis = await analyzePostMeeting({
    transcript: activity.transcriptText,
    seller,
    contactName: [contact.person.firstName, contact.person.lastName]
      .filter(Boolean)
      .join(" "),
    activityId: activity.id,
    contactId,
    organizationId,
  });

  transcriptInsights = mergeInsights(transcriptInsights, {
    analysis,
    sellerOrgId: seller?.id ?? null,
  });
  await prisma.contactActivity.update({
    where: { id: activity.id },
    data: { transcriptInsights },
  });

  const openDeal = await prisma.deal.findFirst({
    where: {
      organizationId,
      contactId,
      closedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, stage: true, title: true },
  });

  // Safe auto: early stage move when meeting happened
  if (
    openDeal &&
    (openDeal.stage === "qualification" || openDeal.stage === "discover") &&
    analysis.stageHint &&
    ["discover", "propose"].includes(analysis.stageHint)
  ) {
    const target =
      analysis.stageHint === "propose" &&
      analysis.requirementsSufficientForProposal
        ? "propose"
        : openDeal.stage === "qualification"
          ? "discover"
          : openDeal.stage;
    if (target !== openDeal.stage) {
      try {
        await updateDealStage(openDeal.id, target);
      } catch (err) {
        console.error("post-meeting stage move failed", openDeal.id, err);
      }
    }
  }

  let briefCreated = false;
  const priorInsights =
    transcriptInsights &&
    typeof transcriptInsights === "object" &&
    !Array.isArray(transcriptInsights)
      ? (transcriptInsights as Record<string, unknown>)
      : null;
  const priorPostMeeting =
    priorInsights?.postMeetingProcess &&
    typeof priorInsights.postMeetingProcess === "object" &&
    !Array.isArray(priorInsights.postMeetingProcess)
      ? (priorInsights.postMeetingProcess as Record<string, unknown>)
      : null;
  const commercialDraftAlreadyNotified = Boolean(priorPostMeeting?.proposalBrief);

  if (wantsCommercialDrafts(analysis) && !commercialDraftAlreadyNotified) {
    try {
      const contactName = [contact.person.firstName, contact.person.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || contact.person.email || "Contact";

      let dealId = openDeal?.id ?? null;
      if (!dealId) {
        dealId = await ensureOpenDealForContact({
          contactId,
          organizationId,
          ownerUserId,
          title:
            analysis.requestedThemes[0] ||
            activity.subject.replace(/^Meeting:\s*/i, "").trim() ||
            `Opportunity – ${contactName}`,
          companyId: contact.person.companyId,
          contactName,
          contactEmail: contact.person.email,
        });
      }

      const brief = buildProposalBrief({
        analysis,
        seller,
        activityId: activity.id,
        dealId,
      });
      const persisted = await persistCommercialDrafts({
        contactId,
        organizationId,
        ownerUserId,
        meetingActivityId: activity.id,
        dealId,
        brief,
        analysis,
        contactName,
      });
      briefCreated = true;

      if (ownerUserId) {
        await notifySalesOfCommercialDraft({
          organizationId,
          ownerUserId,
          contactId,
          contactName,
          proposalId: persisted.proposalId,
          quoteId: persisted.quoteId,
          quotePending: persisted.quotePending,
          dealId: persisted.dealId,
        }).catch((err) =>
          console.error("notifySalesOfCommercialDraft failed", err),
        );
      } else {
        const { notifyUnassignedCommercialDraft } = await import(
          "@/service/email/commercial-notify"
        );
        await notifyUnassignedCommercialDraft({
          organizationId,
          contactId,
          contactName,
          proposalId: persisted.proposalId,
          quoteId: persisted.quoteId,
          quotePending: persisted.quotePending,
          dealId: persisted.dealId,
        }).catch((err) =>
          console.error("notifyUnassignedCommercialDraft failed", err),
        );
      }
    } catch (err) {
      console.error(
        "post-meeting commercial drafts failed",
        activity.id,
        contactId,
        err,
      );
    }
  } else if (commercialDraftAlreadyNotified) {
    briefCreated = true;
  }

  let bookedMeeting = false;
  if (analysis.wantsAnotherMeeting && ownerUserId) {
    const tz = analysis.proposedSlot?.timeZone || "Asia/Kolkata";
    const start = analysis.proposedSlot
      ? parseProposedMeetingStart(
          analysis.proposedSlot.startIso || analysis.proposedSlot.raw,
          tz,
        )
      : null;

    if (start) {
      const book = await tryBookOwnerSlot({
        ownerUserId,
        contactId,
        start,
        topic: `Follow-up: ${activity.subject || "meeting"}`,
        timeZone: tz,
      });

      if (book.ok && book.booked) {
        bookedMeeting = true;
        await createContactActivity(contactId, {
          type: "note",
          subject: "Post-meeting agent booked follow-up",
          body: `Booked ${formatSlotLabel(start, tz)} (owner calendar was free).`,
          createdByUserId: ownerUserId,
        });
      } else if (book.ok && !book.booked) {
        const alts = book.alternatives.map((d) => ({
          iso: d.toISOString(),
          label: formatSlotLabel(d, tz),
        }));
        const conf = await enqueueProcessConfirmation({
          organizationId,
          contactId,
          ownerUserId,
          activityId: activity.id,
          dealId: openDeal?.id ?? null,
          actionKind: "propose_slots_email",
          title: "Approve alternate meeting times email",
          summary: `${book.reason}. Choose which slots to offer the customer.`,
          payload: {
            source: "post_meeting_process",
            proposedRaw: analysis.proposedSlot,
            reason: book.reason,
            alternatives: alts,
            timeZone: tz,
          },
        });
        confirmations.push(conf.id);
      }
    } else {
      // No parseable slot — generate alternatives around now and ask owner
      const book = await tryBookOwnerSlot({
        ownerUserId,
        contactId,
        start: new Date(Date.now() - 120_000), // force past → alternatives path
        timeZone: tz,
      });
      if (book.ok && !book.booked && book.alternatives.length) {
        const alts = book.alternatives.map((d) => ({
          iso: d.toISOString(),
          label: formatSlotLabel(d, tz),
        }));
        const conf = await enqueueProcessConfirmation({
          organizationId,
          contactId,
          ownerUserId,
          activityId: activity.id,
          dealId: openDeal?.id ?? null,
          actionKind: "propose_slots_email",
          title: "Approve meeting times email",
          summary: "Customer wants another meeting; confirm slots to offer.",
          payload: {
            source: "post_meeting_process",
            alternatives: alts,
            timeZone: tz,
          },
        });
        confirmations.push(conf.id);
      }
    }
  }

  if (analysis.stageHint === "lost" && ownerUserId) {
    const conf = await enqueueProcessConfirmation({
      organizationId,
      contactId,
      ownerUserId,
      activityId: activity.id,
      dealId: openDeal?.id ?? null,
      actionKind: "close_lost",
      title: "Approve close lost",
      summary: analysis.objections[0] || "Transcript suggests loss.",
      payload: {
        source: "post_meeting_process",
        decision: {
          action: { kind: "close_lost", reason: analysis.objections[0] || "Lost" },
          ladder: "pipeline",
          from: openDeal?.stage ?? null,
          to: "closed_lost",
          reason: analysis.objections[0] || "Lost signal in transcript",
        },
      },
    });
    confirmations.push(conf.id);
  }

  await writeAuditLog({
    actorUserId: ownerUserId,
    action: "update",
    entityType: "contact_activity",
    entityId: activity.id,
    organizationId,
    meta: {
      agent: "post_meeting_process",
      outcome: "completed",
      briefCreated,
      bookedMeeting,
      confirmations: confirmations.length,
      contactId,
    },
  });

  // Commercial drafts and deal stage moves do not update lead status — promote
  // qualifying leads once meeting evidence and drafts exist, then re-run lifecycle.
  if (briefCreated || openDeal) {
    await promoteLeadAfterPostMeeting(contactId, organizationId);
  }

  transcriptInsights = mergeInsights(transcriptInsights, {
    ranAt,
    status: "completed",
    completedAt: new Date().toISOString(),
    briefCreated,
    bookedMeeting,
  });
  await prisma.contactActivity.update({
    where: { id: activity.id },
    data: { transcriptInsights },
  });

  triggerLeadLifecycle({
    contactId,
    organizationId,
    triggerReason: "post_meeting_completed",
    processImmediately: true,
  });

  return {
    ran: true,
    analysisStored: true,
    briefCreated,
    bookedMeeting,
    confirmations,
  };
}

export function triggerPostMeetingProcess(input: {
  activityId: string;
  contactId?: string | null;
}): void {
  void runPostMeetingProcess(input).catch((err) => {
    console.error("post-meeting process failed", input.activityId, err);
    void writeAuditLog({
      action: "update",
      entityType: "contact_activity",
      entityId: input.activityId,
      meta: {
        agent: "post_meeting_process",
        outcome: "failed",
        reason: err instanceof Error ? err.message : "unknown",
        contactId: input.contactId ?? null,
      },
    });
  });
}

export async function decideProcessConfirmation(input: {
  confirmationId: string;
  userId: string;
  decision: "approved" | "rejected";
  /** Optional slot ISO when approving propose_slots_email / book_meeting */
  selectedSlotIso?: string | null;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const row = await getProcessConfirmation(input.confirmationId);
  if (!row) return { ok: false, error: "Confirmation not found.", status: 404 };
  if (row.ownerUserId !== input.userId) {
    return { ok: false, error: "Only the contact owner can decide.", status: 403 };
  }
  if (row.status !== "pending") {
    return { ok: false, error: "Already decided.", status: 409 };
  }

  if (input.decision === "rejected") {
    await markProcessConfirmation(row.id, {
      status: "rejected",
      decidedByUserId: input.userId,
      resultNote: input.note ?? "Rejected by owner",
    });
    return { ok: true };
  }

  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};

  const contact = await getContact(row.contactId);
  if (!contact) return { ok: false, error: "Contact not found.", status: 404 };
  const email = contact.person.email?.trim();
  const contactName = [contact.person.firstName, contact.person.lastName]
    .filter(Boolean)
    .join(" ");

  try {
    switch (row.actionKind) {
      case "email_proposal": {
        // Legacy confirmations: drafts are never auto-emailed to customers.
        await createContactActivity(row.contactId, {
          type: "note",
          subject: "Proposal draft — send manually",
          body: "Post-meeting drafts are saved for your review. CRM will not email the customer automatically; open the proposal/quote and send when ready.",
          createdByUserId: input.userId,
        });
        break;
      }

      case "quote_send": {
        const decision = payload.decision as LifecycleDecision | undefined;
        const quoteId =
          decision?.action && "quoteId" in decision.action
            ? String(
                (decision.action as { quoteId?: string }).quoteId || "",
              ).trim()
            : typeof payload.quoteId === "string"
              ? payload.quoteId
              : "";
        if (!quoteId) {
          return { ok: false, error: "Missing quote id.", status: 400 };
        }
        const sent = await runWithRequestUserId(input.userId, () =>
          markQuoteSentCommand(quoteId),
        );
        if (!sent.ok) {
          return {
            ok: false,
            error: sent.error || "Failed to send quote.",
            status: 400,
          };
        }
        break;
      }

      case "propose_slots_email": {
        if (!email) {
          return { ok: false, error: "Contact has no email.", status: 400 };
        }
        const alts = Array.isArray(payload.alternatives)
          ? (payload.alternatives as Array<{ iso?: string; label?: string }>)
          : [];
        const selected = input.selectedSlotIso?.trim();
        const tz =
          typeof payload.timeZone === "string" ? payload.timeZone : "Asia/Kolkata";

        if (selected) {
          const start = new Date(selected);
          if (Number.isNaN(start.getTime())) {
            return { ok: false, error: "Invalid selected slot.", status: 400 };
          }
          const book = await tryBookOwnerSlot({
            ownerUserId: input.userId,
            contactId: row.contactId,
            start,
            topic: "Follow-up meeting",
            timeZone: tz,
          });
          if (!book.ok || !book.booked) {
            return {
              ok: false,
              error:
                !book.ok
                  ? book.error
                  : book.reason || "Could not book selected slot.",
              status: 400,
            };
          }
        } else {
          const lines = alts
            .map((a) => `• ${a.label || a.iso}`)
            .filter(Boolean)
            .join("\n");
          const sent = await sendConnectedEmailForUser({
            userId: input.userId,
            to: email,
            subject: "Suggested times for our follow-up",
            body: [
              `Hi ${contactName || "there"},`,
              "",
              "Thanks again for our conversation. Here are a few times that work on our side:",
              "",
              lines || "(owner will follow up shortly)",
              "",
              "Reply with whichever works best and we'll send the invite.",
              "",
              "Best regards",
            ].join("\n"),
            preferredProvider: null,
          });
          if (!sent.ok) return { ok: false, error: sent.error, status: 400 };
          await createContactActivity(row.contactId, {
            type: "note",
            subject: "Alternate meeting times offered",
            body: lines,
            createdByUserId: input.userId,
          });
        }
        break;
      }

      case "book_meeting": {
        const iso =
          input.selectedSlotIso ||
          (typeof payload.startIso === "string" ? payload.startIso : null);
        if (!iso) {
          return { ok: false, error: "Missing meeting time.", status: 400 };
        }
        const start = new Date(iso);
        const tz =
          typeof payload.timeZone === "string" ? payload.timeZone : "Asia/Kolkata";
        const book = await tryBookOwnerSlot({
          ownerUserId: input.userId,
          contactId: row.contactId,
          start,
          topic:
            typeof payload.topic === "string"
              ? payload.topic
              : "Follow-up meeting",
          timeZone: tz,
        });
        if (!book.ok || !book.booked) {
          return {
            ok: false,
            error: !book.ok ? book.error : book.reason || "Booking failed.",
            status: 400,
          };
        }
        break;
      }

      case "quote_accept":
      case "close_won":
      case "close_lost":
      case "disqualify": {
        const decision = payload.decision as LifecycleDecision | undefined;
        if (!decision) {
          return { ok: false, error: "Missing lifecycle decision payload.", status: 400 };
        }
        // Rebuild minimal context for apply
        const { buildLifecycleContext } = await import(
          "@/service/ai/lead-lifecycle-context"
        );
        const ctx = await buildLifecycleContext(row.contactId);
        if (!ctx) {
          return { ok: false, error: "Could not load contact context.", status: 400 };
        }
        const outcome = await applyLifecycleDecision(
          ctx,
          withLifecycleReason(decision),
        );
        if (!outcome.applied) {
          return {
            ok: false,
            error: outcome.blocked || "Could not apply action.",
            status: 400,
          };
        }
        break;
      }

      default:
        return {
          ok: false,
          error: `Unknown action kind: ${row.actionKind}`,
          status: 400,
        };
    }
  } catch (err) {
    console.error("decideProcessConfirmation apply failed", row.id, err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Apply failed.",
      status: 500,
    };
  }

  await markProcessConfirmation(row.id, {
    status: "approved",
    decidedByUserId: input.userId,
    resultNote: input.note ?? "Approved and executed",
  });
  return { ok: true };
}
