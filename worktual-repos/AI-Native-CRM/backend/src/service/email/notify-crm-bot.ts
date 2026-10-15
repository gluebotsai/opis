/**
 * Dual-channel notify: in-app bell + CRM-BOT mailbox email.
 * Used for agent-driven commercial events (draft ready, finance gate, etc.).
 */

import { notifyUsers } from "@/dao/notifications/notify-users";
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import { resolveSetupUserDeliveryEmails } from "@/service/account/setup-users";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { isHtmlEmailBody } from "@/lib/email-body";
import { resolveOrgBrand } from "@/lib/org-brand";
import { buildNotificationEmailHtml } from "@/service/email/notification-email-html";

export type CrmBotNotifyInput = {
  organizationId: string;
  recipientUserIds: Array<string | null | undefined>;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  contactId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  /** Extra delivery addresses (already resolved). */
  extraEmails?: string[];
  /** When false, skip in-app bell (email-only). Default true. */
  inApp?: boolean;
  /** Rich email context — bell stays single-line plain text. */
  contactName?: string | null;
  companyName?: string | null;
  dealTitle?: string | null;
  documentLabel?: string | null;
  actorLabel?: string | null;
  nextStep?: string | null;
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function defaultNextStep(kind: string): string | null {
  const k = kind.toLowerCase();
  if (k.includes("pending_finance") || k.includes("submitted_for_finance")) {
    return "Finance: review and approve or reject so Sales can send to the customer.";
  }
  if (k.includes("finance_approved")) {
    return "Sales: send the approved invoice to the customer when ready.";
  }
  if (k.includes("finance_rejected")) {
    return "Sales: revise the invoice and re-submit for Finance approval.";
  }
  if (k.includes("proposal_sent") || k.includes("quote_sent")) {
    return "Follow up with the customer if you have not heard back within 2 business days.";
  }
  if (k.includes("accepted") || k.includes("customer_accepted")) {
    return "Advance the deal and prepare the next commercial document.";
  }
  if (k.includes("declined") || k.includes("rejected")) {
    return "Review objections and schedule a follow-up conversation.";
  }
  if (k.includes("draft") || k.includes("created")) {
    return "Review the draft, confirm pricing, and send when ready.";
  }
  if (k.includes("coaching") || k.includes("performance")) {
    return "Review the call with the rep and use the focus areas in the next 1:1 if they recur.";
  }
  if (k.includes("meeting_mom") || k.includes("mom_send")) {
    return "Sales rep: open Configuration → Email and connect Google or Microsoft so meeting minutes send from their mailbox (not only the CRM bot).";
  }
  if (k.includes("meeting")) {
    return "Confirm whether the meeting happened, check capture/bot admit, then reschedule or mark as no-show.";
  }
  return null;
}

/**
 * Creates in-app notifications and emails the same recipients via the org
 * CRM bot mailbox. Recipients resolve to Configuration → Email connected
 * mailboxes when present — not login work_email.
 */
export async function notifyUsersViaCrmBot(
  input: CrmBotNotifyInput,
): Promise<{ inApp: number; emailed: number }> {
  const organizationId = await resolveRequestOrganizationId(
    input.organizationId,
  );
  const recipientUserIds = [
    ...new Set(
      input.recipientUserIds.filter((id): id is string => Boolean(id?.trim())),
    ),
  ];

  const created =
    input.inApp === false
      ? []
      : await notifyUsers({
          organizationId,
          recipientUserIds,
          kind: input.kind,
          title: input.title,
          body: input.body,
          href: input.href,
          entityType: input.entityType,
          entityId: input.entityId,
          contactId: input.contactId,
          actorUserId: input.actorUserId,
          metadata: input.metadata,
        });

  const emails = [
    ...new Set([
      ...(await resolveSetupUserDeliveryEmails(
        recipientUserIds,
        organizationId,
      )),
      ...(input.extraEmails ?? [])
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ]),
  ];

  let emailed = 0;
  const appBase = appBaseUrl();
  const crmHref = input.href
    ? `${appBase}${input.href.startsWith("/") ? input.href : `/${input.href}`}`
    : null;

  const brand = await resolveOrgBrand(organizationId);
  const emailBody = isHtmlEmailBody(input.body)
    ? input.body
    : buildNotificationEmailHtml({
        kind: input.kind,
        title: input.title,
        message: input.body,
        href: crmHref,
        sellerName: brand.sellerName,
        logoUrl: brand.logoUrl,
        contactName: input.contactName,
        companyName: input.companyName,
        dealTitle: input.dealTitle,
        documentLabel: input.documentLabel,
        actorLabel: input.actorLabel,
        nextStep: input.nextStep ?? defaultNextStep(input.kind),
      });

  for (const to of emails) {
    const sent = await sendCrmBotEmail({
      organizationId,
      to,
      subject: input.title,
      body: emailBody,
    }).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "send failed",
    }));
    if (sent.ok) emailed += 1;
    else {
      console.error("notifyUsersViaCrmBot email failed", to, sent.error);
    }
  }

  return { inApp: created.length, emailed };
}

/** Email configured mailboxes without creating duplicate in-app rows. */
export async function emailUsersViaCrmBot(
  input: CrmBotNotifyInput,
): Promise<{ emailed: number; resolvedEmails: string[] }> {
  const result = await notifyUsersViaCrmBot({ ...input, inApp: false });
  const organizationId = await resolveRequestOrganizationId(
    input.organizationId,
  );
  const resolvedEmails = await resolveSetupUserDeliveryEmails(
    input.recipientUserIds,
    organizationId,
  );
  return { emailed: result.emailed, resolvedEmails };
}
