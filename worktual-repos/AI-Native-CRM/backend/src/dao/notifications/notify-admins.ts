/**
 * CRM in-app notifications. Operational events go to the assigned owner;
 * escalation / admin-attention kinds go to org admins (and the owner).
 * Unassigned records fall back to admins. Fire-and-forget safe.
 */

import {
  listAdminUsers,
  getUserLabelsByIds,
} from "@/service/account/user-directory";
import {
  insertNotifications,
  type NotificationRow,
} from "@/dao/notifications/notification-store";
import { filterActiveUserIds } from "@/dao/notifications/notify-users";
import { publishUserNotification } from "@/service/notifications/notification-events";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { prisma } from "@/dao/db/prisma";

/** Operational commercial events also email configured mailboxes (bell stays here). */
const MAILBOX_EMAIL_KINDS = new Set<AdminNotificationKind>([
  "proposal_sent",
  "proposal_accepted",
  "proposal_rejected",
  "quote_sent",
  "quote_accepted",
  "quote_rejected",
  "lead_lifecycle_advanced",
  "meeting_miss",
]);

/** Owner + admin both receive mailbox email on these escalations. */
const MAILBOX_ADMIN_CC_KINDS = new Set<AdminNotificationKind>([
  "proposal_accepted",
  "quote_accepted",
]);

export type AdminNotificationKind =
  | "lead_created"
  | "lead_updated"
  | "lead_converted"
  | "lead_disqualified"
  | "lead_deleted"
  | "lead_activity"
  | "lead_enriched"
  | "lead_inbound"
  | "lead_nurture_queued"
  | "lead_nurtured"
  | "lead_lifecycle_advanced"
  | "lead_scored_hot"
  | "lead_score_lifted"
  | "deal_created"
  | "deal_stage_changed"
  | "deal_won"
  | "deal_lost"
  | "proposal_created"
  | "proposal_sent"
  | "proposal_accepted"
  | "proposal_rejected"
  | "quote_created"
  | "quote_sent"
  | "quote_accepted"
  | "quote_rejected"
  | "invoice_created"
  | "invoice_sent"
  | "invoice_paid"
  | "invoice_voided"
  | "invoice_overdue"
  | "order_created"
  | "contract_created"
  | "contract_renewal_due"
  | "meeting_miss";

/** @deprecated Prefer AdminNotificationKind */
export type LeadNotificationKind = AdminNotificationKind;

export type NotifyAdminsInput = {
  organizationId?: string | null;
  kind: AdminNotificationKind;
  /** Explicit deep link — preferred when set. */
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  quoteId?: string | null;
  quoteNumber?: string | null;
  orderId?: string | null;
  proposalId?: string | null;
  proposalTitle?: string | null;
  stage?: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  activityType?: string | null;
  activitySubject?: string | null;
  detail?: string | null;
  nextStep?: string | null;
  excludeUserId?: string | null;
  /** Assigned owner (deal / contact / invoice). Resolved from ids when omitted. */
  ownerUserId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Escalations and org-level attention — these still reach admins. */
export const ADMIN_ATTENTION_NOTIFICATION_KINDS = new Set<AdminNotificationKind>([
  "meeting_miss",
  "invoice_overdue",
  "lead_deleted",
]);

/** @deprecated Prefer NotifyAdminsInput */
export type NotifyAdminsOfLeadEventInput = NotifyAdminsInput;

async function resolveContactNames(
  contactId: string | null | undefined,
): Promise<{ contactName: string | null; companyName: string | null }> {
  if (!contactId?.trim()) return { contactName: null, companyName: null };
  try {
    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const [person] = await getPeopleByIds([contactId]);
    if (!person) return { contactName: null, companyName: null };
    const name = [person.firstName, person.lastName]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(" ");
    return {
      contactName: name || null,
      companyName: person.company?.name?.trim() || null,
    };
  } catch (err) {
    console.error("resolveContactNames for notify failed", err);
    return { contactName: null, companyName: null };
  }
}

function activityLabel(type: string | null | undefined): string {
  switch (type) {
    case "call":
      return "Call";
    case "meeting":
      return "Meeting";
    case "email":
      return "Email";
    case "sms":
      return "SMS";
    case "note":
      return "Note";
    case "task":
      return "Task";
    default:
      return "Activity";
  }
}

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "updated";
  return stage.replace(/_/g, " ");
}

function partyLabel(input: NotifyAdminsInput): string {
  const name = input.contactName?.trim();
  const company = input.companyName?.trim();
  if (name && company) return `${name} · ${company}`;
  if (name) return name;
  if (company) return company;
  if (input.dealTitle?.trim()) return input.dealTitle.trim();
  return "CRM";
}

function resolveHref(input: NotifyAdminsInput): string {
  if (input.href?.trim()) return input.href.trim();
  if (input.invoiceId) return `/finance/${input.invoiceId}`;
  if (input.orderId) return `/commerce/${input.orderId}`;
  if (input.dealId) return `/sales/${input.dealId}`;
  if (input.quoteId && input.dealId) return `/sales/${input.dealId}`;
  if (input.proposalId && input.dealId) return `/sales/${input.dealId}`;
  if (input.contactId) return `/contact/${input.contactId}`;
  switch (input.kind) {
    case "invoice_created":
    case "invoice_sent":
    case "invoice_paid":
    case "invoice_overdue":
      return "/finance";
    case "order_created":
      return "/commerce";
    case "quote_created":
    case "quote_sent":
    case "quote_accepted":
    case "quote_rejected":
      return "/sales/quotes";
    case "deal_created":
    case "deal_stage_changed":
    case "deal_won":
    case "deal_lost":
    case "proposal_created":
    case "proposal_sent":
    case "proposal_accepted":
    case "proposal_rejected":
    case "contract_created":
    case "contract_renewal_due":
      return "/sales";
    default:
      return "/contact";
  }
}

function resolveEntity(input: NotifyAdminsInput): {
  entityType: string | null;
  entityId: string | null;
} {
  if (input.entityType && input.entityId) {
    return { entityType: input.entityType, entityId: input.entityId };
  }
  if (input.invoiceId) return { entityType: "invoice", entityId: input.invoiceId };
  if (input.orderId) return { entityType: "order", entityId: input.orderId };
  if (input.quoteId) return { entityType: "quote", entityId: input.quoteId };
  if (input.proposalId)
    return { entityType: "proposal", entityId: input.proposalId };
  if (input.dealId) return { entityType: "deal", entityId: input.dealId };
  if (input.contactId) return { entityType: "contact", entityId: input.contactId };
  return { entityType: null, entityId: null };
}

function nurtureSentTitle(
  who: string,
  metadata: Record<string, unknown> | undefined,
): string {
  const transport = String(metadata?.transport ?? "");
  const channels = Array.isArray(metadata?.channels)
    ? metadata.channels.filter((channel): channel is string => typeof channel === "string")
    : [];
  const emailed = metadata?.emailed === true;
  if (transport === "voice_auto_bot") return `Nurture call started: ${who}`;
  if (emailed || transport === "fallback") return `Nurture email sent: ${who}`;
  if (channels.includes("whatsapp") && !channels.includes("email")) {
    return `Nurture WhatsApp sent: ${who}`;
  }
  if (channels.length > 0 && !channels.includes("email")) {
    return `Nurture message sent: ${who}`;
  }
  if (metadata?.emailed === false) return `Nurture message sent: ${who}`;
  return `Nurture email sent: ${who}`;
}

function documentLabelForNotify(input: NotifyAdminsInput): string | null {
  const quote = input.quoteNumber?.trim();
  const proposal = input.proposalTitle?.trim();
  const inv = input.invoiceNumber?.trim();
  const meeting = input.activitySubject?.trim();
  if (quote) return `Quote ${quote}`;
  if (proposal) return proposal.startsWith("Proposal") ? proposal : `Proposal ${proposal}`;
  if (inv) return inv.startsWith("Invoice") ? inv : `Invoice ${inv}`;
  if (input.kind === "meeting_miss" && meeting) return meeting;
  return null;
}

function buildCopy(input: NotifyAdminsInput): {
  title: string;
  body: string | null;
  href: string;
} {
  const who = partyLabel(input);
  const actor = input.actorLabel?.trim();
  const by = actor ? ` by ${actor}` : "";
  const href = resolveHref(input);
  const deal = input.dealTitle?.trim();
  const inv = input.invoiceNumber?.trim();
  const quote = input.quoteNumber?.trim();
  const proposal = input.proposalTitle?.trim();

  switch (input.kind) {
    case "lead_created":
      return {
        title: `New lead: ${who}`,
        body: `A new lead was created${by}.`,
        href,
      };
    case "lead_inbound":
      return {
        title: `Inbound lead: ${who}`,
        body: input.detail?.trim() || `Marketing sent a new lead${by}.`,
        href,
      };
    case "lead_updated":
      return {
        title: `Lead updated: ${who}`,
        body: input.detail?.trim() || `Lead details were updated${by}.`,
        href,
      };
    case "lead_converted":
      return {
        title: `Lead converted: ${who}`,
        body:
          input.detail?.trim() ||
          (deal ? `Converted to deal “${deal}”${by}.` : `Converted to a deal${by}.`),
        href,
      };
    case "lead_disqualified":
      return {
        title: `Lead disqualified: ${who}`,
        body: input.detail?.trim() || `Marked as disqualified${by}.`,
        href,
      };
    case "lead_deleted":
      return {
        title: `Lead deleted: ${who}`,
        body: `Lead was removed${by}.`,
        href: "/contact",
      };
    case "lead_activity": {
      const kind = activityLabel(input.activityType);
      const subject = input.activitySubject?.trim();
      const verb =
        input.activityType === "meeting"
          ? "scheduled"
          : input.activityType === "call"
            ? "logged"
            : "recorded";
      return {
        title: `${kind} ${verb}: ${who}`,
        body: subject
          ? `${kind}: “${subject}”${by}.`
          : `${kind} ${verb}${by}.`,
        href,
      };
    }
    case "lead_enriched":
      return {
        title: `Lead enriched: ${who}`,
        body:
          input.detail?.trim() ||
          (actor
            ? `Firmographic enrichment finished${by}.`
            : "Firmographic enrichment finished."),
        href,
      };
    case "lead_nurture_queued":
      return {
        title: `Lead queued for nurture: ${who}`,
        body:
          input.detail?.trim() ||
          `Score below sales-ready — nurture sequence will attempt re-engage when mailbox is ready.`,
        href,
      };
    case "lead_nurtured":
      return {
        title: nurtureSentTitle(who, input.metadata),
        body:
          input.detail?.trim() ||
          `Autonomous re-engage email sent via connected inbox${by}.`,
        href,
      };
    case "lead_lifecycle_advanced":
      return {
        title: `Lifecycle advanced: ${who}`,
        body:
          input.detail?.trim() ||
          `Lifecycle agent moved this contact to ${stageLabel(input.stage)}.`,
        href,
      };
    case "lead_scored_hot":
      return {
        title: `Sales-ready lead: ${who}`,
        body:
          input.detail?.trim() ||
          `Lead Scoring Agent marked this lead as high priority.`,
        href,
      };
    case "lead_score_lifted":
      return {
        title: `Lead intent rising: ${who}`,
        body:
          input.detail?.trim() ||
          `Lead score increased meaningfully — review next best action.`,
        href,
      };
    case "meeting_miss":
      return {
        title: `Meeting not conducted: ${who}`,
        body:
          input.detail?.trim() ||
          `No transcript/attendance evidence after the grace window — lead may not have joined, or capture failed.`,
        href,
      };
    case "deal_created":
      return {
        title: `Deal created: ${deal || who}`,
        body: `New opportunity opened${by}.`,
        href,
      };
    case "deal_stage_changed":
      return {
        title: `Deal stage: ${deal || who}`,
        body:
          input.detail?.trim() ||
          `Moved to ${stageLabel(input.stage)}${by}.`,
        href,
      };
    case "deal_won":
      return {
        title: `Deal won: ${deal || who}`,
        body: input.detail?.trim() || `Closed won${by}.`,
        href,
      };
    case "deal_lost":
      return {
        title: `Deal lost: ${deal || who}`,
        body: input.detail?.trim() || `Closed lost${by}.`,
        href,
      };
    case "proposal_created":
      return {
        title: `Proposal created: ${proposal || deal || who}`,
        body: `New proposal drafted${by}.`,
        href,
      };
    case "proposal_sent":
      return {
        title: `Proposal sent: ${proposal || deal || who}`,
        body: `Proposal shared with the customer${by}.`,
        href,
      };
    case "proposal_accepted":
      return {
        title: `Proposal accepted: ${proposal || deal || who}`,
        body: `Customer accepted the proposal${by}.`,
        href,
      };
    case "proposal_rejected":
      return {
        title: `Proposal rejected: ${proposal || deal || who}`,
        body: `Customer rejected the proposal${by}.`,
        href,
      };
    case "quote_created":
      return {
        title: `Quote created${quote ? `: ${quote}` : ""}`,
        body: deal
          ? `Quote drafted for “${deal}”${by}.`
          : `New quote drafted${by}.`,
        href,
      };
    case "quote_sent":
      return {
        title: `Quote sent${quote ? `: ${quote}` : ""}`,
        body: deal
          ? `Quote sent for “${deal}”${by}.`
          : `Quote sent to customer${by}.`,
        href,
      };
    case "quote_accepted":
      return {
        title: `Quote accepted${quote ? `: ${quote}` : ""}`,
        body: deal
          ? `Quote accepted for “${deal}”${by}.`
          : `Customer accepted the quote${by}.`,
        href,
      };
    case "quote_rejected":
      return {
        title: `Quote rejected${quote ? `: ${quote}` : ""}`,
        body: deal
          ? `Quote rejected for “${deal}”${by}.`
          : `Customer rejected the quote${by}.`,
        href,
      };
    case "invoice_created":
      return {
        title: `Invoice created${inv ? `: ${inv}` : ""}`,
        body: input.detail?.trim() || `Invoice drafted${by}.`,
        href,
      };
    case "invoice_sent":
      return {
        title: `Invoice sent${inv ? `: ${inv}` : ""}`,
        body: input.detail?.trim() || `Invoice emailed to customer${by}.`,
        href,
      };
    case "invoice_paid":
      return {
        title: `Invoice paid${inv ? `: ${inv}` : ""}`,
        body: input.detail?.trim() || `Payment recorded${by}.`,
        href,
      };
    case "invoice_overdue":
      return {
        title: `Invoice overdue${inv ? `: ${inv}` : ""}`,
        body:
          input.detail?.trim() ||
          `Invoice is past due${who !== "CRM" ? ` (${who})` : ""}.`,
        href,
      };
    case "order_created":
      return {
        title: `Order created: ${who}`,
        body: input.detail?.trim() || `Commerce order placed${by}.`,
        href,
      };
    case "contract_created":
      return {
        title: `Contract created: ${deal || who}`,
        body: input.detail?.trim() || `Contract generated from closed-won deal${by}.`,
        href,
      };
    case "contract_renewal_due":
      return {
        title: `Renewal due: ${deal || who}`,
        body:
          input.detail?.trim() ||
          `Contract renewal window opened${who !== "CRM" ? ` (${who})` : ""}.`,
        href,
      };
    default:
      return {
        title: `CRM update: ${who}`,
        body: input.detail ?? null,
        href,
      };
  }
}

export function pickNotificationRecipientIds(input: {
  kind: AdminNotificationKind;
  activeOwnerIds: string[];
  adminIds: string[];
  excludeUserId?: string | null;
}): string[] {
  const exclude = input.excludeUserId?.trim() || null;
  const ids = new Set<string>();
  const adminAttention = ADMIN_ATTENTION_NOTIFICATION_KINDS.has(input.kind);
  if (adminAttention) {
    for (const id of input.adminIds) ids.add(id);
    for (const id of input.activeOwnerIds) ids.add(id);
  } else if (input.activeOwnerIds.length > 0) {
    for (const id of input.activeOwnerIds) ids.add(id);
  } else {
    for (const id of input.adminIds) ids.add(id);
  }
  if (exclude) ids.delete(exclude);
  return [...ids];
}

async function resolveOwnerUserId(
  input: NotifyAdminsInput,
): Promise<string | null> {
  const explicit = input.ownerUserId?.trim();
  if (explicit) return explicit;
  try {
    if (input.dealId?.trim()) {
      const deal = await prisma.deal.findUnique({
        where: { id: input.dealId.trim() },
        select: { ownerUserId: true },
      });
      if (deal?.ownerUserId) return deal.ownerUserId;
    }
    if (input.quoteId?.trim()) {
      const quote = await prisma.quote.findUnique({
        where: { id: input.quoteId.trim() },
        select: {
          createdByUserId: true,
          deal: { select: { ownerUserId: true } },
        },
      });
      if (quote?.deal?.ownerUserId) return quote.deal.ownerUserId;
      if (quote?.createdByUserId) return quote.createdByUserId;
    }
    if (input.proposalId?.trim()) {
      const proposal = await prisma.proposal.findUnique({
        where: { id: input.proposalId.trim() },
        select: {
          createdByUserId: true,
          deal: { select: { ownerUserId: true } },
        },
      });
      if (proposal?.deal?.ownerUserId) return proposal.deal.ownerUserId;
      if (proposal?.createdByUserId) return proposal.createdByUserId;
    }
    if (input.invoiceId?.trim()) {
      const invoice = await prisma.invoice.findUnique({
        where: { id: input.invoiceId.trim() },
        select: {
          createdByUserId: true,
          deal: { select: { ownerUserId: true } },
        },
      });
      if (invoice?.deal?.ownerUserId) return invoice.deal.ownerUserId;
      if (invoice?.createdByUserId) return invoice.createdByUserId;
    }
    if (input.orderId?.trim()) {
      const order = await prisma.salesOrder.findUnique({
        where: { id: input.orderId.trim() },
        select: {
          createdByUserId: true,
          deal: { select: { ownerUserId: true } },
        },
      });
      if (order?.deal?.ownerUserId) return order.deal.ownerUserId;
      if (order?.createdByUserId) return order.createdByUserId;
    }
    if (input.contactId?.trim()) {
      const profile = await prisma.contactProfile.findFirst({
        where: { accountContactId: input.contactId.trim() },
        select: { ownerUserId: true },
      });
      if (profile?.ownerUserId) return profile.ownerUserId;
    }
  } catch (err) {
    console.error("resolveOwnerUserId for notify failed", err);
  }
  return null;
}

export async function notifyAdmins(
  input: NotifyAdminsInput,
): Promise<NotificationRow[]> {
  try {
    const organizationId = await resolveRequestOrganizationId(input.organizationId);
    const exclude =
      input.excludeUserId === undefined
        ? input.actorUserId?.trim() || null
        : input.excludeUserId?.trim() || null;

    const ownerUserId = await resolveOwnerUserId(input);
    const [admins, activeOwnerIds] = await Promise.all([
      listAdminUsers(organizationId),
      ownerUserId ? filterActiveUserIds([ownerUserId]) : Promise.resolve([]),
    ]);
    const recipientIds = pickNotificationRecipientIds({
      kind: input.kind,
      activeOwnerIds,
      adminIds: admins.map((a) => a.id),
      excludeUserId: exclude,
    });
    if (recipientIds.length === 0) return [];

    let contactName = input.contactName ?? null;
    let companyName = input.companyName ?? null;
    if ((!contactName || !companyName) && input.contactId) {
      const resolved = await resolveContactNames(input.contactId);
      contactName = contactName || resolved.contactName;
      companyName = companyName || resolved.companyName;
    }

    let actorLabel = input.actorLabel ?? null;
    if (!actorLabel && input.actorUserId) {
      const labels = await getUserLabelsByIds([input.actorUserId]);
      actorLabel = labels.get(input.actorUserId) ?? null;
    }

    const enriched: NotifyAdminsInput = {
      ...input,
      contactName,
      companyName,
      actorLabel,
    };
    const copy = buildCopy(enriched);
    const entity = resolveEntity(enriched);

    const created = await insertNotifications(
      recipientIds.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        actorUserId: input.actorUserId ?? null,
        kind: input.kind,
        title: copy.title,
        body: copy.body,
        href: copy.href,
        entityType: entity.entityType,
        entityId: entity.entityId,
        contactId: input.contactId ?? null,
        metadata: {
          ...input.metadata,
          activityType: input.activityType ?? null,
          companyName,
          contactName,
          ownerUserId: ownerUserId ?? null,
          dealId: input.dealId ?? null,
          invoiceId: input.invoiceId ?? null,
          quoteId: input.quoteId ?? null,
          orderId: input.orderId ?? null,
          proposalId: input.proposalId ?? null,
          stage: input.stage ?? null,
        },
      })),
    );

    for (const row of created) {
      publishUserNotification({
        userId: row.recipientUserId,
        organizationId,
        notificationId: row.id,
        kind: row.kind,
      });
    }

    if (MAILBOX_EMAIL_KINDS.has(input.kind)) {
      let emailRecipientIds = recipientIds;
      if (MAILBOX_ADMIN_CC_KINDS.has(input.kind)) {
        emailRecipientIds = [
          ...new Set([...recipientIds, ...admins.map((a) => a.id)]),
        ];
      }
      const { emailUsersViaCrmBot } = await import(
        "@/service/email/notify-crm-bot"
      );
      await emailUsersViaCrmBot({
        organizationId,
        recipientUserIds: emailRecipientIds,
        kind: input.kind,
        title: copy.title,
        body: copy.body ?? "",
        href: copy.href,
        entityType: entity.entityType,
        entityId: entity.entityId,
        contactId: input.contactId ?? null,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata,
        contactName: contactName,
        companyName: companyName,
        dealTitle: input.dealTitle ?? null,
        documentLabel: documentLabelForNotify(enriched),
        actorLabel: actorLabel,
        nextStep: input.nextStep ?? null,
      }).catch((err) =>
        console.error("notifyAdmins mailbox email failed", input.kind, err),
      );
    }

    return created;
  } catch (err) {
    console.error("notifyAdmins failed", err);
    return [];
  }
}

export function notifyAdminsAsync(input: NotifyAdminsInput): void {
  void notifyAdmins(input);
}

/** @deprecated Prefer notifyAdmins */
export async function notifyAdminsOfLeadEvent(
  input: NotifyAdminsOfLeadEventInput,
): Promise<NotificationRow[]> {
  return notifyAdmins(input);
}

/** @deprecated Prefer notifyAdminsAsync */
export function notifyAdminsOfLeadEventAsync(
  input: NotifyAdminsOfLeadEventInput,
): void {
  notifyAdminsAsync(input);
}
