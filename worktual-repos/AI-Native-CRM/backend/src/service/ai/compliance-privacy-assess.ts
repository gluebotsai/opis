/**
 * Compliance & Privacy Control Agent — classifies one inbound email that
 * already matched the auto-reply agent's GDPR/CCPA/privacy keyword filter
 * (`email-auto-reply-job.ts`'s `SENSITIVE_PATTERNS`, category "compliance").
 *
 * That existing regex escalation (`needsManualResponse` + `notifyOwnerOrAdmins`)
 * stays exactly as-is — this agent is additive, never a replacement, so even
 * if the LLM is unavailable or misclassifies, a human still sees every
 * flagged email regardless.
 *
 * HITL rule (hard constraint): the only autonomous mutation this can cause is
 * a reversible marketing-opt-out flag. Data deletion / data access requests
 * are queued and admins are emailed (CRM bot) with an `[ACTION REQUIRED]` mark
 * and a deep link to `/privacy-requests/:id` — see
 * `executePrivacyRequestCommand` in `privacy-request-commands.ts`. This file
 * never deletes data and never sends anything to a customer itself.
 */

import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { listAdminUsers } from "@/service/account/user-directory";
import { notifyUsersViaCrmBot } from "@/service/email/notify-crm-bot";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  data_deletion: "Data deletion",
  data_access: "Data access",
  marketing_optout: "Marketing opt-out",
};

const REQUEST_TYPES = new Set([
  "data_deletion",
  "marketing_optout",
  "data_access",
  "other",
  "not_a_privacy_request",
]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

export type PrivacyClassification = {
  requestType: "data_deletion" | "marketing_optout" | "data_access" | "other" | "not_a_privacy_request";
  confidence: "high" | "medium" | "low";
  reason: string;
  draftConfirmation: string | null;
};

export type CompliancePrivacyResult = {
  ran: boolean;
  skipped?: string;
  requestType?: string;
  privacyRequestId?: string;
};

function normalizeClassification(raw: unknown): PrivacyClassification | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const requestType = String(obj.requestType || "").trim().toLowerCase();
  if (!REQUEST_TYPES.has(requestType)) return null;
  const confidence = String(obj.confidence || "").trim().toLowerCase();
  if (!CONFIDENCE_LEVELS.has(confidence)) return null;
  const reason = String(obj.reason || "").trim();
  if (!reason) return null;

  return {
    requestType: requestType as PrivacyClassification["requestType"],
    confidence: confidence as PrivacyClassification["confidence"],
    reason,
    draftConfirmation: obj.draftConfirmation ? String(obj.draftConfirmation).trim() : null,
  };
}

/**
 * Classify one flagged inbound email and act on it.
 * Idempotent via `PrivacyRequest.activityId` upsert — safe to call more than
 * once for the same activity.
 */
export async function runCompliancePrivacyAssess(input: {
  activityId: string;
  contactId?: string | null;
}): Promise<CompliancePrivacyResult> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      subject: true,
      body: true,
    },
  });
  if (!activity) return { ran: false, skipped: "not_found" };

  const body = activity.body?.trim() || "";
  if (!body) return { ran: false, skipped: "empty_body" };

  const organizationId = String(activity.organizationId);
  const contactId = input.contactId || activity.contactId;

  const contact = await getContact(contactId);
  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName].filter(Boolean).join(" ").trim() ||
    contact?.person.email ||
    null;

  const ai = await callAiServiceAgent<{ ok?: boolean; classification?: unknown }>(
    "compliance-privacy",
    {
      subject: activity.subject,
      body: body.slice(0, 8000),
      contactName,
      activityId: activity.id,
      contactId,
      organizationId,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const classification = normalizeClassification(ai?.classification);
  if (!ai?.ok || !classification) {
    return { ran: false, skipped: "no_classification" };
  }

  if (classification.requestType === "other" || classification.requestType === "not_a_privacy_request") {
    // No record, no extra notification — the existing sensitive_escalate
    // notification (already fired by the caller) remains the only signal.
    return { ran: true, skipped: "not_actionable", requestType: classification.requestType };
  }

  if (classification.requestType === "marketing_optout") {
    await prisma.contactProfile.updateMany({
      where: { accountContactId: contactId },
      data: { marketingOptOut: true, marketingOptOutAt: new Date() },
    });
    await writeAuditLog({
      action: "update",
      entityType: "contact",
      entityId: contactId,
      organizationId,
      meta: {
        agent: "compliance_privacy",
        outcome: "opt_out_applied",
        reason: classification.reason,
      },
    });
    const admins = await listAdminUsers(organizationId);
    const who = contactName ?? "Contact";
    await notifyUsersViaCrmBot({
      organizationId,
      recipientUserIds: admins.map((a) => a.id),
      kind: "compliance_privacy",
      title: `[Applied] Marketing opt-out: ${who}`,
      body: [
        "Mark: marketing opt-out (applied automatically — no approval needed).",
        "",
        classification.reason,
        "",
        "Open the contact in CRM to verify.",
      ].join("\n"),
      href: `/contact/${contactId}`,
      entityType: "contact",
      entityId: contactId,
      contactId,
      metadata: { agent: "compliance_privacy", requestType: "marketing_optout" },
    }).catch((err) => {
      console.error("compliance-privacy notify (opt-out) failed", err);
    });
    return { ran: true, requestType: "marketing_optout" };
  }

  // data_deletion or data_access — human-gated, queued for admin review.
  const saved = await prisma.privacyRequest.upsert({
    where: { activityId: activity.id },
    create: {
      organizationId: BigInt(organizationId),
      activityId: activity.id,
      contactId,
      requestType: classification.requestType,
      confidence: classification.confidence,
      reason: classification.reason,
      draftConfirmation: classification.draftConfirmation,
    },
    update: {
      requestType: classification.requestType,
      confidence: classification.confidence,
      reason: classification.reason,
      draftConfirmation: classification.draftConfirmation,
    },
    select: { id: true },
  });

  const admins = await listAdminUsers(organizationId);
  const typeLabel =
    REQUEST_TYPE_LABELS[classification.requestType] ?? classification.requestType;
  const who = contactName ?? "Contact";
  const bodyParts = [
    `Mark: ${typeLabel} · ${classification.confidence} confidence`,
    "",
    classification.reason,
  ];
  if (classification.draftConfirmation) {
    bodyParts.push(
      "",
      "Draft acknowledgment (send manually after you decide):",
      classification.draftConfirmation,
    );
  }
  bodyParts.push(
    "",
    "Open the link below, then Approve or Dismiss. Deletion never runs without your confirmation.",
  );
  await notifyUsersViaCrmBot({
    organizationId,
    recipientUserIds: admins.map((a) => a.id),
    kind: "compliance_privacy",
    title: `[ACTION REQUIRED] ${typeLabel}: ${who}`,
    body: bodyParts.join("\n"),
    href: `/privacy-requests/${saved.id}`,
    entityType: "privacy_request",
    entityId: saved.id,
    contactId,
    metadata: {
      agent: "compliance_privacy",
      requestType: classification.requestType,
      confidence: classification.confidence,
    },
  }).catch((err) => {
    console.error("compliance-privacy notify (queue) failed", err);
  });

  return { ran: true, requestType: classification.requestType, privacyRequestId: saved.id };
}

/** Fire-and-forget wrapper — call from the sensitive_escalate "compliance" branch. */
export function triggerCompliancePrivacyAssess(input: {
  activityId: string;
  contactId?: string | null;
}): void {
  void runCompliancePrivacyAssess(input).catch((err) => {
    console.error("compliance-privacy assess failed", input.activityId, err);
  });
}
