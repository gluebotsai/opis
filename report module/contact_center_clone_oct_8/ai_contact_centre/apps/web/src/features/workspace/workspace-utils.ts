import type { ContactDisplayNameInput } from "@/lib/contact-display-name";
import { resolveContactDisplayName } from "@/lib/contact-display-name";

import type {
  WorkspaceChannel,
  WorkspaceConversationDirection,
  WorkspaceConversationStatus,
} from "./types";

export function isEmailChannel(channel: WorkspaceChannel) {
  return channel === "email";
}

export function isVoiceChannel(channel: WorkspaceChannel | string) {
  return channel === "voice" || channel === "call" || channel === "phone";
}

/** Keep an already-open thread in spoken order. A newer line still goes at the end. */
export function insertMessageBySentAt<T extends { id: string; sentAt: string }>(
  messages: T[],
  message: T,
): T[] {
  if (messages.some((item) => item.id === message.id)) return messages;
  const nextTime = Date.parse(message.sentAt);
  if (!Number.isFinite(nextTime)) return [...messages, message];
  const insertAt = messages.findIndex((item) => {
    const time = Date.parse(item.sentAt);
    return Number.isFinite(time) && time > nextTime;
  });
  if (insertAt === -1) return [...messages, message];
  return [...messages.slice(0, insertAt), message, ...messages.slice(insertAt)];
}

/** Customer closed a live web chat before the agent saved a disposition. */
export function shouldOpenWebchatCustomerDisposition(conversation: {
  channel: WorkspaceChannel | string;
  endActor?: string | null;
  dispositionCode?: string | null;
}): boolean {
  return (
    conversation.channel === "chat" &&
    conversation.endActor === "customer" &&
    !conversation.dispositionCode?.trim()
  );
}

export function resolveWorkspaceConversationDirection(
  direction?: string | null,
  subject?: string | null,
): WorkspaceConversationDirection {
  if (direction === "outbound") return "outbound";
  const normalizedSubject = subject?.trim().toLowerCase() ?? "";
  // Voice rows created before direction was persisted defaulted to inbound.
  if (normalizedSubject.startsWith("outbound")) return "outbound";
  return "inbound";
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NUMERIC_ID_PATTERN = /^\d+$/;

export function formatQueueLabel(
  queue: string | null | undefined,
  queueName?: string | null,
): string {
  if (queueName?.trim()) return queueName.trim();
  if (!queue || queue === "Unassigned") return "Unassigned";
  if (UUID_PATTERN.test(queue) || NUMERIC_ID_PATTERN.test(queue)) return "Support queue";
  return queue;
}

export function incomingOfferTitle(channel: WorkspaceChannel): string {
  if (channel === "voice") return "Incoming call";
  if (channel === "email") return "Incoming email";
  if (channel === "chat") return "Incoming web chat";
  return `Incoming ${workspaceChannelMeta(channel).label} chat`;
}

export function incomingOfferComposerHint(channel: WorkspaceChannel): string {
  switch (channel) {
    case "email":
      return "Accept the incoming email to start replying.";
    case "whatsapp":
      return "Accept the incoming WhatsApp message to start replying.";
    case "instagram":
      return "Accept the incoming Instagram message to start replying.";
    case "facebook":
      return "Accept the incoming Facebook message to start replying.";
    case "voice":
      return "Accept the incoming call to start replying.";
    default:
      return "Accept the incoming chat to start replying.";
  }
}

export function formatDeliveryStateLabel(
  state?: "pending" | "sent" | "delivered" | "read" | "failed",
): string | null {
  switch (state) {
    case "pending":
      return "Sending…";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "failed":
      return "Failed to send";
    default:
      return null;
  }
}

export function emailDisplayName(email: string): string {
  const local = email.split("@")[0]?.trim();
  if (!local) return email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const GENERIC_CUSTOMER_NAMES = new Set(["unknown contact", "webchat visitor"]);
const GENERIC_SOCIAL_SUBJECTS = new Set([
  "whatsapp",
  "instagram",
  "facebook",
  "e2e customer",
  "webchat conversation",
]);

export function isGenericCustomerName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase();
  return !normalized || GENERIC_CUSTOMER_NAMES.has(normalized);
}

export function isVisitorIdDisplayName(name?: string | null): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return true;
  if (isGenericCustomerName(trimmed)) return true;
  if (/^visitor_[0-9a-f-]+$/i.test(trimmed)) return true;
  if (/^v_[0-9a-f-]+$/i.test(trimmed)) return true;
  if (UUID_PATTERN.test(trimmed)) return true;
  if (/^visitor\s+[0-9a-f-]{36}$/i.test(trimmed)) return true;
  return false;
}

export function pickPreferredCustomerName(
  existing?: string | null,
  incoming?: string | null,
): string {
  const existingName = existing?.trim() ?? "";
  const incomingName = incoming?.trim() ?? "";
  if (!incomingName) return existingName;
  if (!existingName) return incomingName;

  const existingIsVisitor = isVisitorIdDisplayName(existingName);
  const incomingIsVisitor = isVisitorIdDisplayName(incomingName);
  if (!existingIsVisitor && incomingIsVisitor) return existingName;
  if (existingIsVisitor && !incomingIsVisitor) return incomingName;
  return incomingName;
}

export function isEmailLocalPartName(name?: string | null): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return false;
  return (
    !trimmed.includes(" ") &&
    !trimmed.includes("@") &&
    /^[a-z0-9._+-]+$/i.test(trimmed) &&
    trimmed.length >= 3
  );
}

function isGenericSocialSubject(subject?: string | null): boolean {
  const normalized = subject?.trim().toLowerCase();
  return !normalized || GENERIC_SOCIAL_SUBJECTS.has(normalized);
}

function isSocialMessagingChannel(channel: WorkspaceChannel): boolean {
  return channel === "whatsapp" || channel === "instagram" || channel === "facebook";
}

export function formatVisitorDisplayName(visitorId?: string | null): string {
  const trimmed = visitorId?.trim();
  if (!trimmed) return "Webchat visitor";
  return trimmed.replace(/^v_/, "Visitor ");
}

const GENERIC_EMAIL_SUBJECTS = new Set([
  "email conversation",
  ...GENERIC_SOCIAL_SUBJECTS,
]);

export function isGenericEmailSubject(subject?: string | null): boolean {
  const normalized = subject?.trim().toLowerCase();
  return !normalized || GENERIC_EMAIL_SUBJECTS.has(normalized);
}

export function resolveWorkspaceCustomerName(input: {
  contact?: ContactDisplayNameInput | null;
  channel: WorkspaceChannel;
  visitorId?: string | null;
  visitorEmail?: string;
  conversationSubject?: string | null;
}): string {
  if (input.contact) {
    const fromContact = resolveContactDisplayName(input.contact);
    if (fromContact && fromContact !== "Unknown contact" && !isGenericCustomerName(fromContact)) {
      return fromContact;
    }
  }

  const socialSubject =
    isSocialMessagingChannel(input.channel) &&
    input.conversationSubject?.trim() &&
    !isGenericSocialSubject(input.conversationSubject)
      ? input.conversationSubject.trim()
      : null;

  if (isSocialMessagingChannel(input.channel)) {
    if (socialSubject) return socialSubject;
    if (input.visitorId?.trim()) return input.visitorId.trim();
    if (input.channel === "instagram") return "Instagram contact";
    if (input.channel === "facebook") return "Facebook contact";
    return "WhatsApp contact";
  }

  if (input.channel === "email" && input.visitorEmail) {
    return emailDisplayName(input.visitorEmail);
  }
  return formatVisitorDisplayName(input.visitorId);
}

export function resolveWorkspaceConversationTitle(input: {
  customerName: string;
  channel: WorkspaceChannel;
  subject?: string | null;
}): string {
  return input.customerName.trim() || input.subject?.trim() || "Customer";
}

export function resolveWorkspaceEmailSubjectLine(subject?: string | null): string | null {
  const trimmed = subject?.trim();
  if (!trimmed || isGenericEmailSubject(trimmed)) return null;
  return trimmed;
}

export function truncatePreview(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const withoutLongUrls = normalized.replace(/https?:\/\/\S+/gi, (url) =>
    url.length > 56 ? `${url.slice(0, 53)}…` : url,
  );
  if (withoutLongUrls.length <= maxLength) return withoutLongUrls;
  return `${withoutLongUrls.slice(0, maxLength).trimEnd()}…`;
}

export function formatEmailBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/https?:\/\/\S+/gi, (url) =>
      url.length > 72 ? `${url.slice(0, 69)}…` : url,
    );
}

export function mapWorkspaceChannel(channel: string): WorkspaceChannel {
  switch (channel) {
    case "email":
      return "email";
    case "whatsapp":
      return "whatsapp";
    case "voice":
    case "call":
    case "phone":
      return "voice";
    case "instagram":
      return "instagram";
    case "facebook":
      return "facebook";
    case "webchat":
    case "chat":
    default:
      return "chat";
  }
}

export const CHANNEL_META: Record<WorkspaceChannel, { label: string; tone: string }> = {
  chat: { label: "Web chat", tone: "bg-neutral-100 text-neutral-700" },
  email: { label: "Email", tone: "bg-neutral-100 text-neutral-700" },
  whatsapp: { label: "WhatsApp", tone: "bg-neutral-100 text-neutral-700" },
  voice: { label: "Call", tone: "bg-neutral-100 text-neutral-700" },
  instagram: { label: "Instagram", tone: "bg-neutral-100 text-neutral-700" },
  facebook: { label: "Facebook", tone: "bg-neutral-100 text-neutral-700" },
};

export function workspaceChannelMeta(channel: string) {
  return CHANNEL_META[mapWorkspaceChannel(channel)];
}

export const STATUS_META: Record<
  WorkspaceConversationStatus,
  { label: string; tone: string }
> = {
  waiting: { label: "Waiting", tone: "bg-amber-50 text-amber-700" },
  active: { label: "Active", tone: "bg-emerald-50 text-emerald-700" },
  resolved: { label: "Resolved", tone: "bg-neutral-100 text-neutral-600" },
};

export function formatConversationTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)}h`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Inbox clock: end time once finished, assign time while it is still running. */
export function inboxActivityAt(conversation: {
  status: string;
  updatedAt: string;
  createdAt?: string;
  queuedAt?: string | null;
  assignedAt?: string | null;
  resolvedAt?: string | null;
  endedAt?: string | null;
  transferred?: boolean;
  transfer?: { transferredAt?: string | null } | null;
}): string {
  if (conversation.transferred && conversation.transfer?.transferredAt) {
    return conversation.transfer.transferredAt;
  }
  if (conversation.status === "resolved") {
    return conversation.endedAt || conversation.resolvedAt || conversation.updatedAt;
  }
  return (
    conversation.assignedAt ||
    conversation.queuedAt ||
    conversation.createdAt ||
    conversation.updatedAt
  );
}

export function compareInboxActivityDesc(
  left: Parameters<typeof inboxActivityAt>[0],
  right: Parameters<typeof inboxActivityAt>[0],
): number {
  const leftTime = Date.parse(inboxActivityAt(left));
  const rightTime = Date.parse(inboxActivityAt(right));
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

export function customerInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function tierTone(tier: string) {
  switch (tier) {
    case "enterprise":
      return "bg-neutral-900 text-white";
    case "gold":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}
