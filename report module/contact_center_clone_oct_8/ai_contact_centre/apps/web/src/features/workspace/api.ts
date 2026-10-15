import { ccCoreHttp, readAuthFromStorage } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import axios from "axios";

import type {
  ConversationSentiment,
  CustomerInteractionHistory,
  CustomerOrder,
  CustomerTicket,
  WorkspaceConversation,
  WorkspaceConversationDirection,
  WorkspaceConversationStatus,
  WorkspaceDisposition,
  WorkspaceDispositionOption,
  WorkspaceMessage,
  WorkspaceWrapUpSuggestion,
  WorkspaceTransferAgent,
  WorkspaceTransferInput,
  WorkspaceTransferMetadata,
} from "./types";
import { resolveContactDisplayName } from "@/lib/contact-display-name";

import {
  mapWorkspaceChannel,
  formatQueueLabel,
  pickPreferredCustomerName,
  resolveWorkspaceConversationDirection,
  resolveWorkspaceCustomerName,
  truncatePreview,
} from "./workspace-utils";
import { resolveTransferOfferFlags } from "./inbox-matching";

export type ApiConversation = {
  id: string;
  organizationId: string;
  channel: string;
  direction?: WorkspaceConversationDirection;
  webchatId: string | null;
  visitorId: string | null;
  contactId?: string | null;
  queueId: string | null;
  queueName?: string | null;
  mailboxEmail?: string | null;
  assignedAgentId: string | null;
  assignedUserId: string | null;
  status: string;
  lifecycleState?: string;
  subject: string | null;
  handoffReason: string | null;
  botActive: boolean;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  endedAt?: string | null;
  endReason?: string | null;
  endActor?: string | null;
  dispositionCode?: string | null;
  dispositionNote?: string | null;
  resolutionCode?: string | null;
  resolutionSummary?: string | null;
  transferredAt?: string | null;
  transferId?: string | null;
  transfer?: WorkspaceTransferMetadata | null;
  transferMetadata?: WorkspaceTransferMetadata | null;
  transferHistory?: WorkspaceTransferMetadata[];
  metadata?: Record<string, unknown> | null;
  pendingOffer?: boolean;
  consultParticipant?: boolean;
  contact?: ApiContact | null;
};

export type ApiContact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  company: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  language?: string | null;
  sourceSystem?: string | null;
  customFields?: Record<string, unknown>;
};

const CONTACT_ADDRESS_KEYS = [
  "shipping_address",
  "shippingAddress",
  "default_address",
  "defaultAddress",
  "address",
  "address1",
] as const;

function addressText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parts = [
    "address1",
    "address2",
    "line1",
    "line2",
    "street",
    "city",
    "province",
    "region",
    "state",
    "zip",
    "postal_code",
    "postalCode",
    "country",
  ]
    .map((key) => (typeof record[key] === "string" ? record[key].trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatContactAddress(contact?: ApiContact | null): string | undefined {
  const fields = contact?.customFields;
  let street: string | undefined;
  if (fields) {
    for (const key of CONTACT_ADDRESS_KEYS) {
      const text = addressText(fields[key]);
      if (text) {
        street = text;
        break;
      }
    }
  }
  const location = formatContactLocation(contact);
  if (!street) return location;
  if (!location || street.toLowerCase().includes(location.toLowerCase())) return street;
  return `${street}, ${location}`;
}

function formatPreferredLanguage(code: string | null | undefined): string | undefined {
  const trimmed = code?.trim();
  if (!trimmed) return undefined;
  try {
    const label = new Intl.DisplayNames("en", { type: "language" }).of(trimmed);
    if (label && label.toLowerCase() !== trimmed.toLowerCase()) return label;
  } catch {
    return trimmed;
  }
  return trimmed;
}

function formatContactLocation(contact?: ApiContact | null): string | undefined {
  const parts = [contact?.city, contact?.region, contact?.country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function mergeWorkspaceCustomerFromContact(
  customer: WorkspaceConversation["customer"],
  contact?: ApiContact | null,
): WorkspaceConversation["customer"] {
  if (!contact) return customer;
  const name = resolveContactDisplayName(contact, customer.name);
  return {
    ...customer,
    contactId: contact.id,
    name: name.trim() || customer.name,
    email: contact.primaryEmail ?? "",
    phone: contact.primaryPhone ?? "",
    company: contact.company ?? undefined,
    location: formatContactLocation(contact),
    address: formatContactAddress(contact),
    language: formatPreferredLanguage(contact.language),
  };
}

export function mergeWorkspaceConversationUpdate(
  existing: WorkspaceConversation,
  conversation: WorkspaceConversation,
): WorkspaceConversation {
  const mergedCustomer = {
    ...existing.customer,
    ...conversation.customer,
    email: conversation.customer.email || existing.customer.email,
    phone: conversation.customer.phone || existing.customer.phone,
    company: conversation.customer.company || existing.customer.company,
    location: conversation.customer.location || existing.customer.location,
    address: conversation.customer.address || existing.customer.address,
    language: conversation.customer.language || existing.customer.language,
    contactId: conversation.customer.contactId ?? existing.customer.contactId,
    name: pickPreferredCustomerName(
      existing.customer.name,
      conversation.customer.name,
    ),
  };

  return {
    ...existing,
    ...conversation,
    assignedUserId: conversation.assignedUserId ?? existing.assignedUserId,
    messages:
      conversation.messages.length > 0 ? conversation.messages : existing.messages,
    preview: conversation.preview || existing.preview,
    customer: mergedCustomer,
    crossChannelSummary:
      conversation.crossChannelSummary && conversation.crossChannelSummary.length > 0
        ? conversation.crossChannelSummary
        : existing.crossChannelSummary,
    botMemory: conversation.botMemory ?? existing.botMemory,
    sentiment: conversation.sentiment ?? existing.sentiment,
    unreadCount: existing.unreadCount ?? 0,
    unread: (existing.unreadCount ?? 0) > 0 || existing.unread,
  };
}

export type ApiMessage = {
  id: string;
  conversationId: string;
  senderType: string;
  direction: string;
  visibility: string;
  body: string;
  deliveryState: string;
  messageType?: string;
  sentAt?: string;
  attachments?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    downloadUrl: string | null;
    status: "pending" | "available" | "blocked" | "expired";
  }>;
  createdAt: string;
  senderUserId?: string | null;
  senderName?: string | null;
  transcriptPhase?: "bot" | "live_agent" | null;
};

export type PresenceState =
  | "offline"
  | "ready"
  | "not_ready"
  | "break"
  | "away"
  | "busy"
  | "after_contact_work";

export const WORKSPACE_PRESENCE_UPDATED = "workspace:presence-updated";
export const WORKSPACE_VOICE_OPENED = "workspace:voice-opened";

export function plainTextMessageBody(body: string): string {
  if (!body.includes("<")) return body;
  if (typeof document === "undefined") return body.replace(/<[^>]*>/g, "");
  const element = document.createElement("div");
  element.innerHTML = body;
  return element.textContent?.trim() ?? body;
}

function mapStatus(status: string): WorkspaceConversationStatus {
  if (status === "queued" || status === "bot_active" || status === "assigned") return "waiting";
  if (status === "resolved" || status === "closed") return "resolved";
  return "active";
}

function mapMessage(message: ApiMessage): WorkspaceMessage {
  const role =
    message.senderType === "customer"
      ? "customer"
      : message.senderType === "agent"
        ? "agent"
        : message.senderType === "bot"
          ? "bot"
        : "system";
  return {
    id: message.id,
    role,
    content: message.body,
    sentAt: message.sentAt ?? message.createdAt,
    deliveryState:
      message.deliveryState === "pending" ||
      message.deliveryState === "sent" ||
      message.deliveryState === "read" ||
      message.deliveryState === "failed"
        ? message.deliveryState
        : "delivered",
    attachments: message.attachments,
    senderUserId: message.senderUserId ?? null,
    senderName: message.senderName ?? null,
    transcriptPhase: message.transcriptPhase ?? null,
  };
}

export function mapApiConversation(
  conversation: ApiConversation,
  messages: ApiMessage[] = [],
  transferredOverride?: boolean,
  botMemory?: WorkspaceConversation["botMemory"],
  contact?: ApiContact | null,
  crossChannelSummary?: WorkspaceConversation["crossChannelSummary"],
  sentiment?: ConversationSentiment | null,
): WorkspaceConversation {
  const channel = mapWorkspaceChannel(conversation.channel);
  const visitorEmail =
    conversation.visitorId && conversation.visitorId.includes("@")
      ? conversation.visitorId
      : "";
  const customerName = resolveWorkspaceCustomerName({
    contact,
    channel,
    visitorId: conversation.visitorId,
    visitorEmail,
    conversationSubject: conversation.subject,
  });
  const lastMessage = messages.at(-1);
  const currentUserId = readAuthFromStorage().userId;
  const metadataTransfer =
    conversation.metadata && typeof conversation.metadata.transfer === "object"
      ? (conversation.metadata.transfer as WorkspaceTransferMetadata)
      : null;
  const transfer =
    conversation.transfer ??
    conversation.transferMetadata ??
    conversation.transferHistory?.at(-1) ??
    metadataTransfer;
  const transferredHint =
    transferredOverride ??
    Boolean(
      conversation.transferId ||
        transfer?.transferredAt ||
        conversation.transferHistory?.length ||
        conversation.status === "transferred" ||
        conversation.lifecycleState === "transferred",
    );
  const { offerPending, transferred } = resolveTransferOfferFlags({
    status: conversation.status,
    assignedUserId: conversation.assignedUserId,
    currentUserId,
    pendingOffer: conversation.pendingOffer,
    transferredHint,
    transfer,
  });

  return {
    id: conversation.id,
    customer: {
      id: conversation.contactId ?? conversation.visitorId ?? conversation.id,
      contactId: conversation.contactId ?? contact?.id ?? null,
      name: customerName,
      email: contact?.primaryEmail ?? visitorEmail,
      phone:
        contact?.primaryPhone ??
        (channel === "whatsapp" ||
        channel === "instagram" ||
        channel === "facebook" ||
        channel === "voice"
          ? conversation.visitorId ?? ""
          : ""),
      company: contact?.company ?? undefined,
      location: formatContactLocation(contact),
      address: formatContactAddress(contact),
      language: formatPreferredLanguage(contact?.language),
      tier: "standard",
      tags: conversation.handoffReason ? [conversation.handoffReason] : [],
      lifetimeValue: "—",
      openTickets: 0,
      lastContact: conversation.updatedAt,
      notes: "",
    },
    channel,
    direction: resolveWorkspaceConversationDirection(
      conversation.direction,
      conversation.subject,
    ),
    queue: formatQueueLabel(conversation.queueId, conversation.queueName),
    mailboxEmail: conversation.mailboxEmail ?? null,
    status: mapStatus(conversation.status),
    subject:
      conversation.subject ??
      (channel === "email"
        ? "Email conversation"
        : channel === "whatsapp"
          ? "WhatsApp conversation"
          : channel === "instagram"
            ? "Instagram conversation"
            : channel === "facebook"
              ? "Facebook conversation"
              : channel === "voice"
                ? "Call"
                : "Webchat conversation"),
    preview: truncatePreview(plainTextMessageBody(lastMessage?.body ?? "")),
    updatedAt: conversation.updatedAt,
    waitMinutes: conversation.queuedAt
      ? Math.max(0, Math.round((Date.now() - Date.parse(conversation.queuedAt)) / 60_000))
      : undefined,
    unread: conversation.status === "queued" || conversation.status === "assigned",
    offerPending,
    consultParticipant: Boolean(conversation.consultParticipant),
    assignedUserId: conversation.assignedUserId,
    transferred,
    transfer: transfer ?? (conversation.transferredAt ? { transferredAt: conversation.transferredAt } : null),
    transferHistory: conversation.transferHistory ?? [],
    messages: messages.map(mapMessage),
    botMemory: botMemory ?? null,
    crossChannelSummary: crossChannelSummary ?? [],
    createdAt: conversation.createdAt,
    queuedAt: conversation.queuedAt,
    assignedAt: conversation.assignedAt,
    resolvedAt: conversation.resolvedAt,
    endedAt: conversation.endedAt ?? conversation.resolvedAt ?? null,
    endReason: conversation.endReason ?? null,
    endActor: conversation.endActor ?? null,
    handoffReason: conversation.handoffReason,
    dispositionCode: conversation.dispositionCode ?? null,
    dispositionNote: conversation.dispositionNote ?? null,
    resolutionCode: conversation.resolutionCode ?? null,
    resolutionSummary: conversation.resolutionSummary ?? null,
    botActive: conversation.botActive,
    sentiment: sentiment ?? null,
  };
}

export const WORKSPACE_INBOX_PAGE_SIZE = 20;

export type WorkspaceInboxPageKey = "open" | "transferred" | "closed";

export type WorkspaceInboxSlice = {
  conversations: WorkspaceConversation[];
  hasMore: boolean;
  fetched: number;
};

export type WorkspaceInboxFirstPages = {
  conversations: WorkspaceConversation[];
  hasMore: Record<WorkspaceInboxPageKey, boolean>;
  fetched: Record<WorkspaceInboxPageKey, number>;
};

function isTransferredSummary(conversation: ApiConversation) {
  return Boolean(
    conversation.transferredAt ||
      conversation.transferId ||
      conversation.transfer ||
      conversation.transferMetadata ||
      conversation.transferHistory?.length ||
      conversation.lifecycleState === "transferred" ||
      conversation.status === "transferred",
  );
}

function mapInboxSummaries(rows: ApiConversation[], transferredIds: Set<string>) {
  return rows.map((conversation) =>
    mapApiConversation(
      conversation,
      [],
      transferredIds.has(conversation.id) || undefined,
      undefined,
      conversation.contact ?? null,
    ),
  );
}

async function requestInboxSlice(inbox: WorkspaceInboxPageKey, offset: number) {
  const { data } = await ccCoreHttp.get<{ conversations?: ApiConversation[]; hasMore?: boolean }>(
    apiV1("/workspace/conversations"),
    { params: { inbox, limit: WORKSPACE_INBOX_PAGE_SIZE, offset } },
  );
  return {
    conversations: data.conversations ?? [],
    hasMore: data.hasMore === true,
  };
}

export const workspaceApi = {
  async listDispositions(): Promise<WorkspaceDispositionOption[]> {
    const { data } = await ccCoreHttp.get<{ dispositions: WorkspaceDispositionOption[] }>(
      apiV1("/workspace/dispositions"),
    );
    return data.dispositions;
  },

  async suggestWrapUp(conversationId: string): Promise<WorkspaceWrapUpSuggestion> {
    const { data } = await ccCoreHttp.get<{
      suggestion: WorkspaceWrapUpSuggestion;
    }>(apiV1(`/workspace/conversations/${conversationId}/wrap-up-suggest`));
    return data.suggestion;
  },

  async fetchSentiment(conversationId: string): Promise<ConversationSentiment | null> {
    const { data } = await ccCoreHttp.get<{ sentiment: ConversationSentiment | null }>(
      apiV1(`/workspace/conversations/${conversationId}/sentiment`),
    );
    return data.sentiment;
  },

  async fetchSessionSentiment(conversationId: string): Promise<ConversationSentiment | null> {
    const { data } = await ccCoreHttp.post<{ sentiment: ConversationSentiment | null }>(
      `${apiV1(`/workspace/conversations/${conversationId}/sentiment/session`)}`,
    );
    return data.sentiment;
  },

  async listConversationSummaries(): Promise<WorkspaceConversation[]> {
    const pages = await workspaceApi.listInboxFirstPages();
    return pages.conversations;
  },

  async listInboxPage(
    inbox: WorkspaceInboxPageKey,
    offset = 0,
  ): Promise<WorkspaceInboxSlice> {
    const slice = await requestInboxSlice(inbox, offset);
    const rows =
      inbox === "transferred" ? slice.conversations.filter(isTransferredSummary) : slice.conversations;
    const transferredIds =
      inbox === "transferred" ? new Set(rows.map((conversation) => conversation.id)) : new Set<string>();
    return {
      conversations: mapInboxSummaries(rows, transferredIds),
      hasMore: slice.hasMore,
      fetched: slice.conversations.length,
    };
  },

  async listInboxFirstPages(): Promise<WorkspaceInboxFirstPages> {
    const emptySlice = { conversations: [] as ApiConversation[], hasMore: false };
    const [open, transferred, closed] = await Promise.all([
      requestInboxSlice("open", 0),
      requestInboxSlice("transferred", 0).catch(() => emptySlice),
      requestInboxSlice("closed", 0).catch(() => emptySlice),
    ]);
    const transferredRows = transferred.conversations.filter(isTransferredSummary);
    const transferredIds = new Set(transferredRows.map((conversation) => conversation.id));
    const byId = new Map<string, ApiConversation>();
    for (const conversation of [...open.conversations, ...transferredRows, ...closed.conversations]) {
      byId.set(conversation.id, conversation);
    }
    return {
      conversations: mapInboxSummaries([...byId.values()], transferredIds),
      hasMore: {
        open: open.hasMore,
        transferred: transferred.hasMore,
        closed: closed.hasMore,
      },
      fetched: {
        open: open.conversations.length,
        transferred: transferred.conversations.length,
        closed: closed.conversations.length,
      },
    };
  },

  async listConversations(status?: string): Promise<WorkspaceConversation[]> {
    if (!status) return workspaceApi.listConversationSummaries();
    const { data } = await ccCoreHttp.get<{ conversations: ApiConversation[] }>(
      apiV1("/workspace/conversations"),
      { params: { status } },
    );
    return data.conversations.map((conversation) =>
      mapApiConversation(conversation, [], undefined, undefined, conversation.contact ?? null),
    );
  },

  async getConversation(
    id: string,
    includeMessages = false,
    options?: { contactId?: string | null },
  ): Promise<WorkspaceConversation> {
    const { data } = await ccCoreHttp.get<{
      conversation: ApiConversation;
      contact?: ApiContact | null;
      messages: ApiMessage[];
      botMemory?: WorkspaceConversation["botMemory"];
      sentiment?: ConversationSentiment | null;
    }>(`${apiV1(`/workspace/conversations/${id}`)}`, {
      params: {
        ...(includeMessages ? { includeMessages: "true" } : {}),
        ...(options?.contactId ? { contactId: options.contactId } : {}),
      },
    });
    return mapApiConversation(
      data.conversation,
      includeMessages ? data.messages : [],
      undefined,
      data.botMemory ?? null,
      data.contact ?? null,
      undefined,
      data.sentiment ?? null,
    );
  },

  async getConversationMessages(
    conversationId: string,
    offset = 0,
    limit = 30,
    anchor: "start" | "end" = "end",
  ): Promise<{
    messages: ApiMessage[];
    total: number;
    offset: number;
    hasMore: boolean;
  }> {
    const { data } = await ccCoreHttp.get<{
      messages: ApiMessage[];
      total: number;
      offset: number;
      hasMore: boolean;
    }>(`${apiV1(`/workspace/conversations/${conversationId}/messages`)}`, {
      params: { offset, limit, anchor },
    });
    return data;
  },

  async getCustomerInteractions(
    key: { visitorId?: string; contactId?: string },
    offset = 0,
    limit = 15,
  ): Promise<{
    interactions: CustomerInteractionHistory[];
    total: number;
    offset: number;
    hasMore: boolean;
  }> {
    const path = key.contactId
      ? `${apiV1(`/workspace/contacts/${encodeURIComponent(key.contactId)}/interactions`)}`
      : `${apiV1(`/workspace/visitors/${encodeURIComponent(key.visitorId ?? "")}/interactions`)}`;
    const { data } = await ccCoreHttp.get<{
      interactions: CustomerInteractionHistory[];
      total: number;
      offset: number;
      hasMore: boolean;
    }>(path, {
      params: { offset, limit },
    });
    return {
      ...data,
      interactions: data.interactions.map((interaction) => ({
        ...interaction,
        channel: mapWorkspaceChannel(interaction.channel),
      })),
    };
  },

  async getCustomerOrders(contactId: string): Promise<CustomerOrder[]> {
    const { data } = await ccCoreHttp.get<{ orders: CustomerOrder[] }>(
      apiV1(`/workspace/contacts/${encodeURIComponent(contactId)}/orders`),
    );
    return data.orders ?? [];
  },

  async getCustomerTickets(contactId: string): Promise<CustomerTicket[]> {
    const { data } = await ccCoreHttp.get<{ tickets: CustomerTicket[] }>(
      apiV1(`/workspace/contacts/${encodeURIComponent(contactId)}/tickets`),
    );
    return data.tickets ?? [];
  },

  async getContactOmniChannelSummary(contactId: string): Promise<{
    omniChannelSummary: string | null;
    updatedAt: string | null;
  }> {
    const { data } = await ccCoreHttp.get<{
      omniChannelSummary: string | null;
      updatedAt: string | null;
    }>(`${apiV1(`/workspace/contacts/${encodeURIComponent(contactId)}/omni-channel-summary`)}`);
    return data;
  },

  async getConversationContext(conversationId: string): Promise<{
    crossChannelSummary: WorkspaceConversation["crossChannelSummary"];
    contact?: ApiContact | null;
  }> {
    const { data } = await ccCoreHttp.get<{
      context: {
        crossChannelSummary?: WorkspaceConversation["crossChannelSummary"];
        customer?: { contact?: ApiContact | null };
      };
    }>(`${apiV1(`/workspace/conversations/${conversationId}/context`)}`);
    return {
      crossChannelSummary: data.context.crossChannelSummary ?? [],
      contact: data.context.customer?.contact ?? null,
    };
  },

  async sendReply(
    conversationId: string,
    body: string,
    copilotTurnId?: string,
  ): Promise<WorkspaceMessage> {
    const payload: { body: string; copilotTurnId?: string } = { body };
    if (copilotTurnId && /^\d+$/.test(copilotTurnId)) {
      payload.copilotTurnId = copilotTurnId;
    }
    const { data } = await ccCoreHttp.post<{ message: ApiMessage }>(
      `${apiV1(`/workspace/conversations/${conversationId}/messages`)}`,
      payload,
    );
    return mapMessage(data.message);
  },

  async updateTyping(conversationId: string, active: boolean): Promise<void> {
    await ccCoreHttp.post(`${apiV1(`/workspace/conversations/${conversationId}/typing`)}`, { active });
  },

  async markMessageRead(conversationId: string, messageId: string): Promise<void> {
    await ccCoreHttp.post(`${apiV1(`/workspace/conversations/${conversationId}/receipts`)}`, {
      messageId,
      status: "read",
      occurredAt: new Date().toISOString(),
    });
  },

  async getPresence(): Promise<{ state: PresenceState; reasonCode: string | null } | null> {
    const { data } = await ccCoreHttp.get<{
      presence: { state: PresenceState; reasonCode: string | null } | null;
    }>(apiV1("/workspace/presence"));
    return data.presence;
  },

  async initializePresence(): Promise<{
    presence: { state: PresenceState; reasonCode: string | null } | null;
    initialized: boolean;
  }> {
    const { data } = await ccCoreHttp.post<{
      presence: { state: PresenceState; reasonCode: string | null } | null;
      initialized: boolean;
    }>(apiV1("/workspace/presence/initialize"));
    return data;
  },

  async updatePresence(
    state: PresenceState,
    reasonCode?: string,
    options?: { isVoiceCallTransfer?: boolean; source?: string },
  ): Promise<{ state: PresenceState; reasonCode: string | null }> {
    const { data } = await ccCoreHttp.patch<{
      presence: { state: PresenceState; reasonCode: string | null };
    }>(apiV1("/workspace/presence"), {
      state,
      reasonCode,
      source: options?.source,
      isVoiceCallTransfer: options?.isVoiceCallTransfer,
    });
    return data.presence;
  },

  async heartbeatPresence(): Promise<{ state: PresenceState; reasonCode: string | null } | null> {
    const { data } = await ccCoreHttp.post<{
      presence: { state: PresenceState; reasonCode: string | null } | null;
    }>(apiV1("/workspace/presence/heartbeat"));
    return data.presence;
  },

  async escalateNotReadyPresence(): Promise<{ escalation: { id: string } }> {
    const { data } = await ccCoreHttp.post<{ escalation: { id: string } }>(
      apiV1("/workspace/presence/not-ready-escalate"),
    );
    return data;
  },

  async acceptOffer(conversationId: string): Promise<WorkspaceConversation> {
    await ccCoreHttp.post<{ conversation: ApiConversation }>(
      `${apiV1(`/workspace/conversations/${conversationId}/accept`)}`,
    );
    return workspaceApi.getConversation(conversationId);
  },

  async rejectOffer(conversationId: string): Promise<void> {
    await ccCoreHttp.post(`${apiV1(`/workspace/conversations/${conversationId}/reject`)}`);
  },

  async transferConversation(
    conversationId: string,
    input: WorkspaceTransferInput,
  ): Promise<WorkspaceConversation> {
    const { data } = await ccCoreHttp.post<{
      conversation: ApiConversation;
      transfer?: WorkspaceTransferMetadata;
    }>(
      `${apiV1(`/workspace/conversations/${conversationId}/transfer`)}`,
      {
        queueId: input.queueId,
        agentId: input.agentId,
        notes: input.notes,
      },
    );
    return {
      ...mapApiConversation(data.conversation),
      transfer: data.transfer ?? data.conversation.transfer ?? null,
      transferred: undefined,
    };
  },

  async listTransferTargets(
    conversationId: string,
    query: { queueId: string; search?: string; cursor?: string; voice?: boolean },
  ): Promise<{ agents: WorkspaceTransferAgent[]; nextCursor?: string }> {
    const { data } = await ccCoreHttp.get<{
      agents?: WorkspaceTransferAgent[];
      nextCursor?: string;
      targets?: Array<Omit<WorkspaceTransferAgent, "availableCapacity">>;
      offset?: number;
      hasMore?: boolean;
    }>(apiV1(`/workspace/conversations/${conversationId}/transfer-targets`), {
      params: {
        queueId: query.queueId,
        ...(query.search?.trim() ? { search: query.search.trim() } : {}),
        ...(query.voice ? { voice: true } : {}),
        ...(query.cursor
          ? { cursor: query.cursor, offset: Number.parseInt(query.cursor, 10) || 0 }
          : {}),
      },
    });
    const agents: WorkspaceTransferAgent[] = (data.agents ?? data.targets ?? []).map(
      (agent) => {
        const suppliedCapacity =
          "availableCapacity" in agent && typeof agent.availableCapacity === "number"
            ? agent.availableCapacity
            : undefined;
        return {
          ...agent,
          availableCapacity:
            suppliedCapacity ??
            Math.max(0, agent.maxConcurrency - agent.activeCount - agent.reservedCount),
        };
      },
    );
    return {
      agents,
      nextCursor:
        data.nextCursor ??
        (data.hasMore ? String((data.offset ?? 0) + agents.length) : undefined),
    };
  },

  async cancelTransfer(conversationId: string): Promise<WorkspaceConversation> {
    const { data } = await ccCoreHttp.post<{
      conversation: ApiConversation;
      transfer?: WorkspaceTransferMetadata;
    }>(apiV1(`/workspace/conversations/${conversationId}/transfer/cancel`));
    return {
      ...mapApiConversation(data.conversation),
      transfer: data.transfer ?? data.conversation.transfer ?? null,
      transferred: undefined,
    };
  },

  async completeTransfer(
    conversationId: string,
    details: WorkspaceDisposition,
  ): Promise<WorkspaceTransferMetadata> {
    const { data } = await ccCoreHttp.post<{
      transfer: WorkspaceTransferMetadata;
    }>(apiV1(`/workspace/conversations/${conversationId}/transfer/complete`), {
      summary: details.summary,
      dispositionCode: details.disposition,
      conclusion: details.conclusion,
    });
    return data.transfer;
  },

  async saveDisposition(
    conversationId: string,
    disposition: WorkspaceDisposition,
    options: { source?: "transfer" | "merge"; isFinal?: boolean } = {},
  ): Promise<void> {
    await ccCoreHttp.post(`${apiV1(`/workspace/conversations/${conversationId}/disposition`)}`, {
      code: disposition.disposition,
      note: disposition.summary,
      isFinal: options.isFinal ?? false,
      source: options.source ?? "transfer",
      resolution: {
        code: disposition.resolution,
        summary: disposition.summary,
        data: { conclusion: disposition.summary },
      },
    });
  },

  async resolveConversation(
    conversationId: string,
    disposition: WorkspaceDisposition,
  ): Promise<WorkspaceConversation> {
    try {
      const { data } = await ccCoreHttp.post<{ conversation: ApiConversation }>(
        `${apiV1(`/workspace/conversations/${conversationId}/end`)}`,
        {
          actor: "agent",
          reason: "agent_completed",
          disposition: {
            code: disposition.disposition,
            note: disposition.summary,
            isFinal: true,
            resolution: {
              code: disposition.resolution,
              summary: disposition.summary,
              data: { conclusion: disposition.summary },
            },
          },
          resolution: {
            code: disposition.resolution,
            summary: disposition.summary,
            data: { conclusion: disposition.summary },
          },
        },
      );
      return mapApiConversation(data.conversation);
    } catch (error) {
      if (
        !axios.isAxiosError(error) ||
        (error.response?.status !== 404 && error.response?.status !== 405)
      ) {
        throw error;
      }
      const { data } = await ccCoreHttp.post<{ conversation: ApiConversation }>(
        `${apiV1(`/workspace/conversations/${conversationId}/resolve`)}`,
        disposition,
      );
      return workspaceApi.getConversation(data.conversation.id);
    }
  },

  async controlVoiceCall(
    conversationId: string,
    action: "hold" | "unhold" | "mute" | "unmute",
  ): Promise<void> {
    await ccCoreHttp.post(apiV1(`/workspace/conversations/${conversationId}/call-control`), {
      action,
    });
  },

  async getActiveVoiceCall(): Promise<{
    conversation: WorkspaceConversation;
    sessionId: string;
  } | null> {
    const { data } = await ccCoreHttp.get<{
      conversation: ApiConversation | null;
      sessionId: string | null;
    }>(apiV1("/workspace/voice-call/active"));
    if (!data.conversation || !data.sessionId) return null;
    return {
      conversation: mapApiConversation(data.conversation),
      sessionId: data.sessionId,
    };
  },

  async ensureVoiceCall(input: {
    sessionId?: string | null;
    destination?: string | null;
  }): Promise<{ conversation: WorkspaceConversation; sessionId: string }> {
    const { data } = await ccCoreHttp.post<{
      conversation: ApiConversation;
      sessionId: string;
    }>(apiV1("/workspace/voice-call/ensure"), {
      sessionId: input.sessionId || undefined,
      destination: input.destination || undefined,
    });
    return {
      conversation: mapApiConversation(data.conversation),
      sessionId: data.sessionId,
    };
  },

  async finalizeVoiceCall(input: {
    conversationId?: string | null;
    sessionId?: string | null;
    reason:
      | "agent_declined"
      | "browser_disconnected"
      | "customer_disconnected"
      | "stale_voice_call_closed"
      | "abandoned"
      | "rejected";
  }): Promise<{ conversation: WorkspaceConversation | null }> {
    const { data } = await ccCoreHttp.post<{ conversation: ApiConversation | null }>(
      apiV1("/workspace/voice-call/finalize"),
      {
        conversationId: input.conversationId || undefined,
        sessionId: input.sessionId || undefined,
        reason: input.reason,
      },
    );
    return {
      conversation: data.conversation ? mapApiConversation(data.conversation) : null,
    };
  },

  async startSupervisorListen(
    conversationId: string,
  ): Promise<{ sessionId: string; agentExt: string }> {
    const { data } = await ccCoreHttp.post<{ sessionId: string; agentExt: string }>(
      apiV1(`/workspace/conversations/${conversationId}/voice/supervisor-listen`),
    );
    return data;
  },

  async switchSupervisorListen(
    conversationId: string,
    switchType: 1 | 2 | 3,
  ): Promise<{ sessionId: string }> {
    const { data } = await ccCoreHttp.post<{ sessionId: string }>(
      apiV1(`/workspace/conversations/${conversationId}/voice/supervisor-listen/switch`),
      { switchType },
    );
    return data;
  },

  async cancelSupervisorListen(conversationId: string): Promise<{ sessionId: string }> {
    const { data } = await ccCoreHttp.post<{ sessionId: string }>(
      apiV1(`/workspace/conversations/${conversationId}/voice/supervisor-listen/cancel`),
    );
    return data;
  },

  async inviteVoiceConsult(
    conversationId: string,
    input: { queueId: string; agentId: string; ext?: string },
  ): Promise<{ sessionId: string; ext: string; target: { email: string; name: string; userId: string } }> {
    const { data } = await ccCoreHttp.post<{
      sessionId: string;
      ext: string;
      target: { email: string; name: string; userId: string };
    }>(apiV1(`/workspace/conversations/${conversationId}/voice/transfer-invite`), input);
    return data;
  },

  async voiceTransferAction(
    conversationId: string,
    action: number,
  ): Promise<{ sessionId: string; action: number }> {
    const { data } = await ccCoreHttp.post<{ sessionId: string; action: number }>(
      apiV1(`/workspace/conversations/${conversationId}/voice/transfer-action`),
      { action },
    );
    return data;
  },

  async rejectVoiceConsult(conversationId: string): Promise<{ sessionId: string }> {
    const { data } = await ccCoreHttp.post<{ sessionId: string }>(
      apiV1(`/workspace/conversations/${conversationId}/voice/consult-reject`),
    );
    return data;
  },

  async markVoiceConsultAnswered(conversationId: string): Promise<{ sessionId: string }> {
    const { data } = await ccCoreHttp.post<{ sessionId: string }>(
      apiV1(`/workspace/conversations/${conversationId}/voice/consult-answered`),
    );
    return data;
  },
};
