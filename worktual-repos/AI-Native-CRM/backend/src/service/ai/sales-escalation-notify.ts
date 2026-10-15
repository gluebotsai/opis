/**
 * Escalations to sales managers and org admins.
 * In-app bell + CRM-bot HTML email — same channel as commercial notifications.
 */

import {
  listMeetingEscalationRecipients,
  getUserLabelsByIds,
  type EscalationRecipientVia,
} from "@/service/account/user-directory";
import { notifyUsersViaCrmBot } from "@/service/email/notify-crm-bot";

export type SalesEscalationInput = {
  organizationId: string;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  contactId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  ownerUserId?: string | null;
  actorUserId?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  dealTitle?: string | null;
  documentLabel?: string | null;
  nextStep?: string | null;
  /** When true, the deal/contact owner also receives the escalation. */
  includeOwner?: boolean;
  metadata?: Record<string, unknown>;
};

export async function notifySalesEscalation(
  input: SalesEscalationInput,
): Promise<{ notified: number; via: EscalationRecipientVia }> {
  const { recipients, via } = await listMeetingEscalationRecipients(
    input.organizationId,
  ).catch(() => ({
    recipients: [] as Awaited<
      ReturnType<typeof listMeetingEscalationRecipients>
    >["recipients"],
    via: "admin" as EscalationRecipientVia,
  }));

  const ids = new Set(recipients.map((r) => r.id));
  if (input.includeOwner && input.ownerUserId?.trim()) {
    ids.add(input.ownerUserId.trim());
  }

  const recipientUserIds = [...ids];
  if (recipientUserIds.length === 0) {
    return { notified: 0, via };
  }

  let actorLabel: string | null = null;
  if (input.actorUserId) {
    const labels = await getUserLabelsByIds([input.actorUserId]);
    actorLabel = labels.get(input.actorUserId) ?? null;
  }

  const result = await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds,
    kind: input.kind,
    title: input.title,
    body: input.body,
    href: input.href,
    entityType: input.entityType,
    entityId: input.entityId,
    contactId: input.contactId,
    actorUserId: input.actorUserId,
    contactName: input.contactName,
    companyName: input.companyName,
    dealTitle: input.dealTitle,
    documentLabel: input.documentLabel,
    actorLabel,
    nextStep: input.nextStep,
    metadata: { ...input.metadata, escalationVia: via },
  }).catch((err) => {
    console.error("notifySalesEscalation failed", input.kind, err);
    return { inApp: 0, emailed: 0 };
  });

  return { notified: result.inApp, via };
}
