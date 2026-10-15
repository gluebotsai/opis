export type WorkspaceChannel =
  | "chat"
  | "email"
  | "whatsapp"
  | "voice"
  | "instagram"
  | "facebook";

export type WorkspaceConversationStatus = "waiting" | "active" | "resolved";

export type WorkspaceConversationDirection = "inbound" | "outbound";

export type ContactEnrichmentOutcome =
  | "created"
  | "enriched"
  | "linked_existing"
  | "merged_existing"
  | "no_change";

export type WorkspaceTransferState =
  | "requested"
  | "offered"
  | "accepted"
  | "completed"
  | "rejected"
  | "expired"
  | "cancelled"
  | "queued";

export type WorkspaceTransferMetadata = {
  id?: string | null;
  conversationId?: string | null;
  state?: WorkspaceTransferState | string | null;
  transferredAt?: string | null;
  fromQueueId?: string | null;
  fromAgentId?: string | null;
  fromUserId?: string | null;
  toQueueId?: string | null;
  requestedAgentId?: string | null;
  offeredAgentId?: string | null;
  acceptedAgentId?: string | null;
  acceptedUserId?: string | null;
  toUserId?: string | null;
  notes?: string | null;
  requestedAt?: string | null;
  offeredAt?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  rejectedAt?: string | null;
  expiredAt?: string | null;
  cancelledAt?: string | null;
  outcomeReason?: string | null;
  dispositionCode?: string | null;
  sourceAgentName?: string | null;
  sourceUserName?: string | null;
  fromAgentName?: string | null;
  targetAgentName?: string | null;
  requestedAgentName?: string | null;
  offeredAgentName?: string | null;
  acceptedAgentName?: string | null;
  sourceQueueName?: string | null;
  targetQueueName?: string | null;
  toQueueName?: string | null;
};

export type WorkspaceDisposition = {
  resolution: string;
  disposition: string;
  conclusion: string;
  summary: string;
};

export type WorkspaceDispositionOption = {
  id: string;
  code: string;
  label: string;
  description?: string | null;
  requiresNote?: boolean;
  requiresResolution?: boolean;
};

export type WorkspaceWrapUpSuggestion = {
  summary: string;
  resolution: "resolved" | "unresolved" | "transferred";
  dispositionCode: string | null;
};

export type WorkspaceTransferInput = {
  queueId: string;
  agentId: string;
  notes?: string;
};

export type WorkspaceTransferAgent = {
  agentId: string;
  userId: string;
  name: string;
  email?: string | null;
  employeeId?: string | null;
  ext?: string | null;
  queueId: string;
  presence: string;
  activeCount: number;
  reservedCount: number;
  maxConcurrency: number;
  availableCapacity: number;
};

export type WorkspaceMessage = {
  id: string;
  role: "customer" | "agent" | "bot" | "system";
  content: string;
  sentAt: string;
  deliveryState?: "pending" | "sent" | "delivered" | "read" | "failed";
  attachments?: WorkspaceAttachment[];
  senderUserId?: string | null;
  senderName?: string | null;
  /** Voice transcript: bot while the voice bot owns the call, live_agent after handoff. */
  transcriptPhase?: "bot" | "live_agent" | null;
};

export type WorkspaceAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  downloadUrl: string | null;
  status: "pending" | "available" | "blocked" | "expired";
};

export type WorkspaceCustomer = {
  id: string;
  contactId?: string | null;
  contactEnrichmentOutcome?: ContactEnrichmentOutcome;
  name: string;
  email: string;
  phone: string;
  company?: string;
  location?: string;
  address?: string;
  language?: string;
  tier: "standard" | "gold" | "enterprise";
  tags: string[];
  lifetimeValue: string;
  openTickets: number;
  lastContact: string;
  notes: string;
};

export type CustomerInteractionHistory = {
  id: string;
  conversationId: string;
  messageId: string;
  channel: WorkspaceChannel;
  queue: string;
  subject: string;
  summary: string;
  occurredAt: string;
  createdAt?: string;
  endedAt?: string | null;
  resolvedAt?: string | null;
  endReason?: string | null;
  dispositionCode?: string | null;
  resolutionCode?: string | null;
  handoffReason?: string | null;
  status?: string;
  agentConnected?: boolean;
  direction?: WorkspaceConversationDirection;
  botMemory?: {
    rollingSummary: string | null;
    extractedFacts: string[];
  } | null;
};

export type CustomerOrderLine = {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  imageUrl: string | null;
};

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string | null;
  totalAmount: string;
  currency: string;
  createdAt: string;
  address: string | null;
  deliveryDate: string | null;
  tracking: string | null;
  courier: string | null;
  deliveryStatus: string | null;
  orderUrl: string | null;
  lines: CustomerOrderLine[];
};

export type CustomerTicketNote = {
  id: string;
  authorName: string;
  body: string;
  visibility: string | null;
  createdAt: string;
};

export type CustomerTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  channel: string;
  assigneeName: string | null;
  resolverName: string | null;
  queueName: string | null;
  category: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  csatScore: number | null;
  csatComment: string | null;
  aiSummary: string | null;
  orderId: string | null;
  productId: string | null;
  interactionId: string | null;
  createdAt: string;
  notes: CustomerTicketNote[];
};

export type CrossChannelSummary = {
  channel: string;
  conversationId: string;
  summary: string;
  occurredAt: string;
};

export type WorkspaceConversation = {
  id: string;
  customer: WorkspaceCustomer;
  channel: WorkspaceChannel;
  direction: WorkspaceConversationDirection;
  queue: string;
  mailboxEmail?: string | null;
  status: WorkspaceConversationStatus;
  subject: string;
  preview: string;
  updatedAt: string;
  waitMinutes?: number;
  unread: boolean;
  unreadCount?: number;
  offerPending?: boolean;
  consultParticipant?: boolean;
  assignedUserId?: string | null;
  transferred?: boolean;
  transfer?: WorkspaceTransferMetadata | null;
  transferHistory?: WorkspaceTransferMetadata[];
  messages: WorkspaceMessage[];
  visitorTyping?: boolean;
  botMemory?: {
    rollingSummary: string | null;
    extractedFacts: string[];
  } | null;
  crossChannelSummary?: CrossChannelSummary[];
  createdAt?: string;
  queuedAt?: string | null;
  assignedAt?: string | null;
  resolvedAt?: string | null;
  endedAt?: string | null;
  endReason?: string | null;
  endActor?: string | null;
  handoffReason?: string | null;
  dispositionCode?: string | null;
  dispositionNote?: string | null;
  resolutionCode?: string | null;
  resolutionSummary?: string | null;
  botActive?: boolean;
  sentiment?: ConversationSentiment | null;
};

export type WorkspaceInboxTab = "open" | "transferred" | "closed";

export type WorkspaceAiPrivateNote = {
  kind: string;
  text: string;
};

export type WorkspaceAiActionProposal = {
  id: string;
  actionType: string;
  summary: string;
  collectedInputs: Record<string, unknown>;
  missingInputs: string[];
  confirmationText: string;
  status: "proposed" | "submitted" | "dismissed";
  resultText?: string;
};

export type WorkspaceAiSuggestion = {
  status: "loading" | "ready" | "error";
  text: string;
  replyDraft?: string;
  privateNotes?: WorkspaceAiPrivateNote[];
  actionProposal?: WorkspaceAiActionProposal | null;
  revision?: number;
  sourceMessageId?: string;
  copilotTurnId?: string;
};

import type { ConversationSentiment } from "@/features/workspace/sentiment";

export type { ConversationSentiment };
