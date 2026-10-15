import { jsonStringifyEntityPayload } from "@ai-contact-center/event-contracts/id-schema";

const CC_CORE_URL = process.env.CC_CORE_URL ?? "http://localhost:3000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

function asEntityId(value: string | number | bigint): string {
  return String(value);
}

function internalHeaders(organizationId: string | number | bigint): Record<string, string> {
  const tenantId = asEntityId(organizationId);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": tenantId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }
  return headers;
}

export type IngestSocialConversationInput = {
  organizationId: string;
  channelConfigId: string;
  channelType: "whatsapp" | "instagram" | "facebook";
  externalThreadId: string;
  externalMessageId: string;
  customerRef: string;
  customerName?: string | null;
  body: string;
  messageType?: string;
  phoneNumberId?: string;
  pageId?: string;
  igBusinessAccountId?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

export type IngestSocialConversationResult = {
  conversationId: string;
  messageId: string;
  created: boolean;
  duplicate: boolean;
  botEligible?: boolean;
  policy?: {
    confidenceThreshold: number;
    handoffMessage: string | null;
    liveAgentEnabled: boolean;
  };
  conversation?: {
    id: string;
    status: string;
    botActive?: boolean;
    queueId?: string | null;
  };
  queueProfiles?: Array<{
    key: string;
    id: string;
    name: string;
    description: string | null;
    skills: string[];
    intents: string[];
  }>;
};

export async function ingestInboundSocialConversation(
  input: IngestSocialConversationInput,
): Promise<IngestSocialConversationResult | null> {
  try {
    const organizationId = asEntityId(input.organizationId);
    const payload = {
      ...input,
      organizationId,
      channelConfigId: asEntityId(input.channelConfigId),
    };
    const response = await fetch(`${CC_CORE_URL}/internal/v1/social/conversations`, {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload(payload),
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(
        "[cc-core-social-client] ingest failed",
        response.status,
        errorBody.slice(0, 500),
      );
      return null;
    }
    return (await response.json()) as IngestSocialConversationResult;
  } catch (error) {
    console.error(
      "[cc-core-social-client] ingest error",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function appendSocialMessage(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
  input: {
    senderType: "bot" | "system";
    body: string;
    modelMetadata?: Record<string, unknown>;
  },
): Promise<{ id: string } | null> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${asEntityId(conversationId)}/messages`,
      {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload({
        senderType: input.senderType,
        body: input.body,
        direction: "outbound",
        modelMetadata: input.modelMetadata,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { message: { id: string } };
    return { id: body.message.id };
  } catch {
    return null;
  }
}

export type SocialHandoffResult = {
  queued: boolean;
  assignment: { userId: string } | null;
  systemMessage?: { id?: string; body: string } | null;
};

export async function initiateSocialHandoff(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
  input: {
    reason: string;
    queueId?: string | number | bigint | null;
    selectedQueueKey?: string | null;
    candidateSkills?: string[];
    intent?: string | null;
    message?: string | null;
  },
): Promise<SocialHandoffResult | null> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${asEntityId(conversationId)}/handoff`,
      {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload({
        reason: input.reason,
        queueId: input.queueId == null ? undefined : asEntityId(input.queueId),
        selectedQueueKey: input.selectedQueueKey ?? undefined,
        candidateSkills: input.candidateSkills,
        intent: input.intent ?? undefined,
        message: input.message ?? undefined,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[cc-core] social handoff failed conversation=${conversationId} status=${response.status} detail=${detail}`,
      );
      return null;
    }
    return (await response.json()) as SocialHandoffResult;
  } catch (error) {
    console.error(`[cc-core] social handoff request failed conversation=${conversationId}`, error);
    return null;
  }
}

export async function recordSocialNlpTurn(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
  input: Record<string, unknown>,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${asEntityId(conversationId)}/nlp-turns`,
      {
      method: "POST",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload(input),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[cc-core] nlp-turn record failed conversation=${conversationId} status=${response.status} body=${body.slice(0, 500)}`,
      );
    }
    return response.ok;
  } catch (error) {
    console.error(`[cc-core] nlp-turn record request failed conversation=${conversationId}`, error);
    return false;
  }
}

export async function enrichSocialConversationContact(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
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
  customerText?: string,
  importantFacts?: string[],
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${asEntityId(conversationId)}/contact/enrich`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload({
          contactEntities,
          customerText,
          importantFacts,
          sourceMessageId,
        }),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[cc-core] contact enrich failed conversation=${conversationId} status=${response.status} body=${body.slice(0, 500)}`,
      );
    }
    return response.ok;
  } catch (error) {
    console.error(`[cc-core] contact enrich request failed conversation=${conversationId}`, error);
    return false;
  }
}

export type SessionMemoryResponse = {
  conversationId: string;
  turns: Array<{ customerText: string; botReply: string | null; createdAt: string }>;
  memory: {
    rollingSummary: string | null;
    extractedFacts: string[];
  } | null;
  transcript: Array<{ role: string; content: string }>;
  longTermSummary: string | null;
  extractedFacts: string[];
};

export async function fetchSessionMemory(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
  options: { turnLimit?: number } = {},
): Promise<SessionMemoryResponse | null> {
  try {
    const params = new URLSearchParams();
    if (options.turnLimit) params.set("turnLimit", String(options.turnLimit));
    const query = params.toString();
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${asEntityId(conversationId)}/memory${query ? `?${query}` : ""}`,
      {
        method: "GET",
        headers: internalHeaders(organizationId),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as SessionMemoryResponse;
  } catch {
    return null;
  }
}

export async function upsertConversationMemory(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
  input: {
    rollingSummary?: string | null;
    extractedFacts?: string[];
    modelName?: string;
  },
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/conversations/${asEntityId(conversationId)}/memory`,
      {
        method: "PUT",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload(input),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
