/**
 * Post-score routing: Assign (≥40 or explicit sales intent) or Nurture (<40).
 * Never silently unassigns when score drops after ownership is set.
 */

import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { listContactActivities } from "@/dao/contacts/contact-activity-service";
import { resolveRegionalSalesOwner } from "@/dao/sales/territory-assignment";
import { backfillCompanyOwnerFromContact } from "@/dao/companies/company-owner-backfill";
import { notifyOwnerOrAdmins } from "@/dao/notifications/notify-users";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { enqueueLeadNurture } from "@/service/ai/lead-nurture-job";
import { sendLeadAssignmentWelcome } from "@/service/ai/lead-assignment-welcome";
import {
  beginLeadOwnerFollowup,
  notifyNoSalesRepForLead,
} from "@/service/ai/lead-assignment-followup";
import { skipPendingAutoReplyForContact } from "@/dao/ai/email-auto-reply-store";
import { prisma } from "@/dao/db/prisma";
import {
  SALES_READY_SCORE,
  type LeadScoreResult,
} from "@/service/ai/lead-score";
import { getCurrentBusinessType } from "@/service/auth/require-role";

const EXPLICIT_INTENT_RE =
  /\b(book\s+(a\s+)?demo|request(ed)?\s+(a\s+)?demo|talk\s+to\s+sales|speak\s+(to|with)\s+sales|pricing|quote|ready\s+to\s+buy|schedule\s+(a\s+)?(call|meeting|demo)|can we schedule|works\s+for\s+me|works\s+for\s+us|that\s+time\s+works)\b|\d{1,2}[\.:][0-5]\d\s*(am|pm)/i;

export type LeadScoreRouteResult = {
  path: "assign" | "nurture" | "noop" | "going_cold";
  ownerUserId: string | null;
  slaDeadline: string | null;
  reason: string;
};

export async function detectExplicitSalesIntent(
  contactId: string,
): Promise<boolean> {
  try {
    const activities = await listContactActivities(contactId, 25);
    for (const a of activities) {
      const blob = `${a.subject ?? ""}\n${a.body ?? ""}`;
      if (EXPLICIT_INTENT_RE.test(blob)) return true;
    }
  } catch (err) {
    console.error("detectExplicitSalesIntent failed", err);
  }
  return false;
}

/**
 * Score-gated assignment when total ≥ 40 (or forced sales intent) and no owner.
 */
export async function assignLeadFromScore(input: {
  contactId: string;
  organizationId: string;
  scoreResult: LeadScoreResult;
  forceSalesIntent?: boolean;
}): Promise<LeadScoreRouteResult> {
  const contact = await getContact(input.contactId);
  if (!contact) {
    return {
      path: "noop",
      ownerUserId: null,
      slaDeadline: null,
      reason: "contact_not_found",
    };
  }

  if (contact.person.ownerUserId) {
    return {
      path: "noop",
      ownerUserId: contact.person.ownerUserId,
      slaDeadline: null,
      reason: "already_owned",
    };
  }

  const band = input.scoreResult.band;
  const businessType = await getCurrentBusinessType().catch(() => null);

  const decision = await resolveRegionalSalesOwner({
    organizationId: input.organizationId,
    businessType,
    country: contact.person.country ?? null,
    city: contact.person.city,
    contactId: input.contactId,
    companyId: contact.person.companyId,
    locationId: contact.person.locationId,
    estimatedAmount: null,
  });

  if (decision.status === "unassigned") {
    await notifyNoSalesRepForLead({
      contactId: input.contactId,
      organizationId: input.organizationId,
      displayName: contact.displayName,
      reason: decision.reason,
      score: input.scoreResult.score,
      band,
    });
    return {
      path: "assign",
      ownerUserId: null,
      slaDeadline: null,
      reason: "escalated_no_eligible_rep",
    };
  }

  const owner = decision.owner;

  const reason = [
    `score=${input.scoreResult.score}`,
    `band=${band}`,
    input.forceSalesIntent ? "explicit_sales_intent" : null,
    owner.reason,
  ]
    .filter(Boolean)
    .join("; ");

  await updateContact(input.contactId, { ownerUserId: owner.userId });
  await backfillCompanyOwnerFromContact({
    contactId: input.contactId,
    ownerUserId: owner.userId,
    companyId: contact.person.companyId,
  });
  const sla = await beginLeadOwnerFollowup({
    contactId: input.contactId,
    organizationId: input.organizationId,
    ownerUserId: owner.userId,
    reason,
    displayName: contact.displayName,
    band,
    leadStatus: contact.person.leadStatus,
    score: input.scoreResult.score,
  });

  await skipPendingAutoReplyForContact(
    input.contactId,
    "contact_assigned_to_sales",
  ).catch((err) =>
    console.error("skip auto-reply after assignment failed", err),
  );

  await writeAuditLog({
    action: "update",
    entityType: "contact",
    entityId: input.contactId,
    organizationId: input.organizationId,
    meta: {
      source: "lead_assignment_agent",
      ownerUserId: owner.userId,
      reason,
      slaDeadline: sla.toISOString(),
      score: input.scoreResult.score,
      fitScore: input.scoreResult.fitScore,
      intentScore: input.scoreResult.intentScore,
    },
  });

  void sendLeadAssignmentWelcome({
    contactId: input.contactId,
    organizationId: input.organizationId,
    ownerUserId: owner.userId,
    scoreResult: input.scoreResult,
  }).catch((err) => {
    console.error("assignment welcome email failed", input.contactId, err);
  });

  return {
    path: "assign",
    ownerUserId: owner.userId,
    slaDeadline: sla.toISOString(),
    reason,
  };
}

/**
 * Route after score: assign, nurture, or flag going-cold (never unassign).
 */
export async function routeLeadAfterScore(input: {
  contactId: string;
  organizationId: string;
  scoreResult: LeadScoreResult;
  previousScore?: number | null;
  forceSalesIntent?: boolean;
}): Promise<LeadScoreRouteResult> {
  const contact = await getContact(input.contactId);
  if (!contact) {
    return {
      path: "noop",
      ownerUserId: null,
      slaDeadline: null,
      reason: "contact_not_found",
    };
  }

  const force =
    input.forceSalesIntent ??
    (await detectExplicitSalesIntent(input.contactId));
  const salesReady =
    force || input.scoreResult.score >= SALES_READY_SCORE;

  const previous = input.previousScore;
  const wasReady =
    previous != null && previous >= SALES_READY_SCORE;
  const ownerId = contact.person.ownerUserId;

  // Score drop below gate after assignment — notify only, keep owner.
  if (
    ownerId &&
    wasReady &&
    input.scoreResult.score < SALES_READY_SCORE
  ) {
    await notifyOwnerOrAdmins({
      organizationId: input.organizationId,
      ownerUserId: ownerId,
      kind: "lead_going_cold",
      title: "Assigned lead going cold",
      body: `${contact.displayName} score dropped to ${input.scoreResult.score}/100. Owner unchanged — re-engage or reassign manually.`,
      href: `/contact/${input.contactId}`,
      contactId: input.contactId,
      entityType: "contact",
      entityId: input.contactId,
      metadata: {
        score: input.scoreResult.score,
        previousScore: previous,
      },
    });
    return {
      path: "going_cold",
      ownerUserId: ownerId,
      slaDeadline: null,
      reason: "score_drop_owner_retained",
    };
  }

  if (salesReady) {
    // Exit nurture overlay when crossing into sales-ready.
    await prisma.$executeRawUnsafe(
      `
      UPDATE contact_profiles SET
        nurture_status = CASE
          WHEN nurture_status IS NOT NULL THEN 'exited_sales_ready'
          ELSE nurture_status
        END,
        updated_at = NOW()
      WHERE account_contact_id = $1::text
      `,
      input.contactId,
    );
    await prisma.$executeRawUnsafe(
      `
      UPDATE lead_nurture_jobs SET
        nurture_status = 'exited_sales_ready',
        status = 'skipped',
        decision = 'skip_sales_ready',
        completed_at = NOW(),
        updated_at = NOW()
      WHERE organization_id = $1::bigint
        AND contact_id = $2::text
        AND status IN ('pending', 'analyzing', 'waited', 'failed')
      `,
      input.organizationId,
      input.contactId,
    ).catch(() => null);

    return assignLeadFromScore({
      contactId: input.contactId,
      organizationId: input.organizationId,
      scoreResult: input.scoreResult,
      forceSalesIntent: force,
    });
  }

  // Below gate — nurture only when the CRM contact is unowned (pooled).
  // Company owner does not count; claimed leads stay with the human (no auto-nurture).
  if (ownerId) {
    return {
      path: "noop",
      ownerUserId: ownerId,
      slaDeadline: null,
      reason: "owned_below_gate_no_nurture",
    };
  }

  const intensity =
    input.scoreResult.score >= 20 ? "active_cold" : "deep_cold";

  const nurturePrior = await prisma.$queryRawUnsafe<
    Array<{ nurture_status: string | null }>
  >(
    `
    SELECT nurture_status
    FROM contact_profiles
    WHERE account_contact_id = $1::text
    LIMIT 1
    `,
    input.contactId,
  );
  const priorNurtureStatus = nurturePrior[0]?.nurture_status ?? null;
  const startingNurtureFresh =
    !priorNurtureStatus || priorNurtureStatus === "exited_sales_ready";

  await prisma.$executeRawUnsafe(
    `
    UPDATE contact_profiles SET
      nurture_status = $2,
      nurture_started_at = COALESCE(nurture_started_at, NOW()),
      nurture_sequence_step = COALESCE(nurture_sequence_step, 0),
      updated_at = NOW()
    WHERE account_contact_id = $1::text
    `,
    input.contactId,
    intensity,
  );

  await enqueueLeadNurture({
    contactId: input.contactId,
    organizationId: input.organizationId,
    processImmediately: true,
  }).catch((err) => console.error("nurture enqueue after score failed", err));

  if (startingNurtureFresh) {
    notifyAdminsOfLeadEventAsync({
      kind: "lead_nurture_queued",
      organizationId: input.organizationId,
      contactId: input.contactId,
      contactName: contact.displayName,
      ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
      detail: `Score ${input.scoreResult.score}/100 → nurture (${intensity}). No email sent yet.`,
    });
  }

  return {
    path: "nurture",
    ownerUserId: null,
    slaDeadline: null,
    reason: intensity,
  };
}
