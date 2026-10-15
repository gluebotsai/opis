import {
  jsonStringifyEntityPayload,
  serializeEntityIdOptional,
} from "@ai-contact-center/event-contracts/id-schema";

const CC_CORE_URL = process.env.CC_CORE_URL ?? "http://localhost:3000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

function internalHeaders(organizationId?: string | number | bigint): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }
  if (organizationId != null) {
    headers["x-tenant-id"] = serializeEntityIdOptional(organizationId)!;
  }
  return headers;
}

export type WebchatChatQueue = {
  id: string;
  name: string;
  description?: string | null;
  skills: string[];
  intents: string[];
};

export type WebchatContext = {
  organizationId: string;
  webchatId: string;
  greetingMessage: string;
  routingQueueId: string | null;
  chatQueues: WebchatChatQueue[];
  nlpEnabled: boolean;
  liveAgentEnabled: boolean;
  companyName: string | null;
  title: string;
  aliasTitle: string;
  description: string | null;
  industryType: string | null;
  businessType: string | null;
  websiteUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  primaryLocation: string | null;
  locations: Array<{
    label: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    timezone: string | null;
  }>;
  businessHours: {
    name: string;
    timezone: string | null;
    openTime: string | null;
    closeTime: string | null;
    workingDays: unknown;
  } | null;
  routingQueueName: string | null;
  capabilities: string[];
  approvedServiceMessage: string | null;
  confidenceThreshold: number;
};

export type ConversationRecord = {
  id: string;
  organizationId: string;
  status: string;
  botActive: boolean;
  queueId?: string | null;
  eventSequence?: number;
  contactProfile?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
    company: string | null;
    city: string | null;
    country: string | null;
  } | null;
};
export async function fetchWebchatContext(webchatId: string): Promise<WebchatContext | null> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/webchat/${webchatId}/context`, {
      headers: internalHeaders(),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      context: {
        organizationId: string;
        webchatId: string;
        greetingMessage: string;
        routingQueueId: string | null;
        chatQueues?: WebchatChatQueue[];
        nlpEnabled: boolean;
        liveAgentEnabled: boolean;
        companyName: string | null;
        title: string;
        aliasTitle: string;
        description: string | null;
        industryType: string | null;
        businessType: string | null;
        websiteUrl: string | null;
        publicEmail: string | null;
        publicPhone: string | null;
        primaryLocation: string | null;
        locations: WebchatContext["locations"];
        businessHours: WebchatContext["businessHours"];
        routingQueueName: string | null;
        capabilities: string[];
        approvedServiceMessage: string | null;
        confidenceThreshold?: number;
      };
    };
    const ctx = body.context;
    return {
      organizationId: ctx.organizationId,
      webchatId: ctx.webchatId,
      greetingMessage: ctx.greetingMessage,
      routingQueueId: ctx.routingQueueId,
      chatQueues: ctx.chatQueues ?? [],
      nlpEnabled: ctx.nlpEnabled,
      liveAgentEnabled: ctx.liveAgentEnabled,
      companyName: ctx.companyName,
      title: ctx.title,
      aliasTitle: ctx.aliasTitle,
      description: ctx.description,
      industryType: ctx.industryType,
      businessType: ctx.businessType,
      websiteUrl: ctx.websiteUrl,
      publicEmail: ctx.publicEmail,
      publicPhone: ctx.publicPhone,
      primaryLocation: ctx.primaryLocation,
      locations: ctx.locations ?? [],
      businessHours: ctx.businessHours ?? null,
      routingQueueName: ctx.routingQueueName,
      capabilities: ctx.capabilities,
        approvedServiceMessage: ctx.approvedServiceMessage,
        confidenceThreshold: ctx.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      };
  } catch {
    return null;
  }
}

export type ResumedWebchatMessage = {
  id: string;
  senderType: string;
  body: string;
  createdAt: string;
};

export async function resumeWebchatSession(input: {
  webchatId: string;
  visitorId: string;
  organizationId?: string;
}): Promise<{
  resumed: boolean;
  conversation: ConversationRecord | null;
  messages: ResumedWebchatMessage[];
  sessionId?: string;
} | null> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/webchat/${encodeURIComponent(input.webchatId)}/sessions/resume`,
      {
        method: "POST",
        headers: internalHeaders(input.organizationId),
        body: jsonStringifyEntityPayload({
          visitorId: input.visitorId,
          organizationId: input.organizationId,
        }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      resumed?: boolean;
      conversation: ConversationRecord | null;
      messages?: Array<{
        id: string;
        senderType: string;
        body: string;
        createdAt: string;
      }>;
      sessionId?: string;
    };
    return {
      resumed: Boolean(body.resumed && body.conversation),
      conversation: body.conversation,
      messages: body.messages ?? [],
      sessionId: body.sessionId,
    };
  } catch {
    return null;
  }
}

export async function markWebchatSessionDisconnected(
  organizationId: string,
  conversationId: string,
  graceSeconds = 45,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/session/disconnect`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload({ organizationId, graceSeconds }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function startConversation(input: {
  webchatId: string;
  visitorId: string;
  conversationId: string;
  externalThreadId?: string;
  pageUrl?: string;
  consent?: Record<string, unknown>;
  prechatAnswers?: Record<string, unknown>;
  queueId?: string | null;
  greetingBody?: string;
}): Promise<{
  conversation: ConversationRecord;
  organizationId: string;
  greetingMessage?: { id: string } | null;
}> {
  let response: Response;
  try {
    response = await fetch(`${CC_CORE_URL}/internal/v1/conversations`, {
      method: "POST",
      headers: internalHeaders(),
      body: jsonStringifyEntityPayload(input),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`Failed to persist webchat session: cc-core unreachable (${reason})`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to persist webchat session: cc-core returned ${response.status}${body ? ` — ${body.slice(0, 300)}` : ""}`,
    );
  }

  const body = (await response.json()) as {
    conversation?: ConversationRecord;
    greetingMessage?: { id: string } | null;
  };
  if (!body.conversation?.id) {
    throw new Error("Failed to persist webchat session: cc-core response missing conversation");
  }

  return {
    conversation: body.conversation,
    organizationId: body.conversation.organizationId,
    greetingMessage: body.greetingMessage ?? null,
  };
}

export async function appendMessage(
  organizationId: string,
  conversationId: string,
  input: {
    messageId?: string;
    senderType: "customer" | "bot" | "agent" | "system";
    body: string;
    direction?: "inbound" | "outbound";
    modelMetadata?: Record<string, unknown>;
  },
): Promise<{ id: string; reopened?: boolean } | null> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload({
        messageId: input.messageId,
        senderType: input.senderType,
        body: input.body,
        direction: input.direction ?? (input.senderType === "customer" ? "inbound" : "outbound"),
        modelMetadata: input.modelMetadata,
      }),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      message: { id: string };
      reopened?: boolean;
    };
    return { id: body.message.id, reopened: body.reopened };
  } catch {
    return null;
  }
}

export async function addAttachmentMetadata(
  organizationId: string,
  conversationId: string,
  messageId: string,
  input: {
    externalId?: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    checksumSha256?: string;
    downloadUrl?: string;
  },
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/messages/${messageId}/attachments`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload(input),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function recordWebchatReceipt(
  organizationId: string,
  conversationId: string,
  input: {
    messageId: string;
    status: "delivered" | "read";
    visitorId: string;
    occurredAt?: string;
  },
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/receipts`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload({
          messageId: input.messageId,
          status: input.status,
          recipientType: "visitor",
          recipientRef: input.visitorId,
          occurredAt: input.occurredAt,
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function publishWebchatTyping(
  organizationId: string,
  conversationId: string,
  active: boolean,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/typing`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload({ active, participant: "visitor" }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function endWebchatConversation(
  organizationId: string,
  conversationId: string,
  reason: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/conversations/${conversationId}/end`, {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload({ actor: "customer", reason }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function recordNlpTurn(
  organizationId: string,
  conversationId: string,
  input: {
    customerText: string;
    botReply?: string;
    customerMessageId?: string;
    botMessageId?: string;
    confidence?: number;
    intent?: string | null;
    candidateSkills?: string[];
    summary?: string | null;
    sentiment?: string | null;
    importantFacts?: string[];
    knowledgeUsed?: string[];
    handoffRecommended?: boolean;
    handoffReason?: string | null;
    modelName?: string;
    traceId?: string | null;
    runtimeType?: "webchat_bot" | "email_bot";
    selectedQueueKey?: string | null;
    queueProfileVersion?: string | null;
    grounded?: boolean;
    guardPassed?: boolean;
    guardReasons?: string[];
    knowledgeReferences?: string[];
    deliveryMessageId?: string | null;
    latencyMs?: number;
    contactEntities?: {
      email?: string | null;
      phone?: string | null;
      displayName?: string | null;
      company?: string | null;
      city?: string | null;
      country?: string | null;
    };
  },
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/nlp-turns`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload({
      customerText: input.customerText,
      botReply: input.botReply,
      customerMessageId: input.customerMessageId,
      botMessageId: input.botMessageId,
      confidence: input.confidence,
      intent: input.intent ?? undefined,
      candidateSkills: input.candidateSkills,
      summary: input.summary ?? undefined,
      sentiment: input.sentiment ?? undefined,
      importantFacts: input.importantFacts,
      knowledgeUsed: input.knowledgeUsed,
      handoffRecommended: input.handoffRecommended,
      handoffReason: input.handoffReason ?? undefined,
      modelName: input.modelName,
      traceId: input.traceId ?? undefined,
          runtimeType: input.runtimeType,
          selectedQueueKey: input.selectedQueueKey,
          queueProfileVersion: input.queueProfileVersion,
          grounded: input.grounded,
          guardPassed: input.guardPassed,
          guardReasons: input.guardReasons,
          knowledgeReferences: input.knowledgeReferences,
          deliveryMessageId: input.deliveryMessageId,
          latencyMs: input.latencyMs,
          contactEntities: input.contactEntities,
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function enrichConversationContact(
  organizationId: string,
  conversationId: string,
  contactEntities: {
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    company?: string | null;
    city?: string | null;
    country?: string | null;
  },
  sourceMessageId?: string,
  importantFacts?: string[],
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/contact/enrich`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload({
          contactEntities,
          sourceMessageId,
          importantFacts,
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function initiateHandoff(
  organizationId: string,
  conversationId: string,
  input: {
    reason: string;
    queueId?: string;
    selectedQueueKey?: string | null;
    intent?: string | null;
    message?: string | null;
    candidateSkills?: string[];
  },
): Promise<{
  queued: boolean;
  assignedUserId?: string;
  systemMessage?: { id: string; body: string };
} | null> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/conversations/${conversationId}/handoff`, {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload(input),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[cc-core] handoff failed for conversation ${conversationId}: ${response.status} ${detail}`,
      );
      return null;
    }
    const body = (await response.json()) as {
      queued: boolean;
      assignment: { userId: string } | null;
      systemMessage: { id: string; body: string } | null;
    };
    return {
      queued: body.queued,
      assignedUserId: body.assignment?.userId,
      systemMessage: body.systemMessage ?? undefined,
    };
  } catch (error) {
    console.error(`[cc-core] handoff request failed for conversation ${conversationId}:`, error);
    return null;
  }
}

export async function getConversation(
  organizationId: string,
  conversationId: string,
): Promise<{
  conversation: ConversationRecord;
  messages: {
    senderType: string;
    body: string;
    attachments?: Array<{ storageKey: string; status: string }>;
  }[];
} | null> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/conversations/${conversationId}`, {
      headers: internalHeaders(organizationId),
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      conversation: ConversationRecord;
      messages: {
        senderType: string;
        body: string;
        attachments?: Array<{ storageKey: string; status: string }>;
      }[];
    };
  } catch {
    return null;
  }
}

export async function getConversationState(
  organizationId: string,
  conversationId: string,
): Promise<ConversationRecord | null> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${conversationId}/state`,
      { headers: internalHeaders(organizationId) },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      conversation: ConversationRecord;
      contact?: ConversationRecord["contactProfile"];
    };
    return {
      ...body.conversation,
      contactProfile: body.contact ?? null,
    };
  } catch {
    return null;
  }
}
