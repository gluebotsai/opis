import {
  jsonStringifyEntityPayload,
  serializeEntityIdOptional,
} from "@ai-contact-center/event-contracts/id-schema";

const CC_CORE_URL = process.env.CC_CORE_URL ?? "http://localhost:3000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

function internalHeaders(organizationId?: string | number | bigint): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (organizationId != null) headers["x-tenant-id"] = serializeEntityIdOptional(organizationId)!;
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }
  return headers;
}

export type IngestEmailConversationInput = {
  organizationId: string;
  externalThreadId: string;
  externalMessageId: string;
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  body: string;
  occurredAt: string;
  mailboxConnectionId?: string;
  mailboxEmail?: string;
  rfcMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  providerHeaders?: Record<string, string>;
  attachments?: Array<{
    attachmentId: string | null;
    fileName: string;
    contentType: string;
    byteSize: number;
    storageKey?: string;
  }>;
};

export type EmailMailboxPolicy = {
  connectionId: string;
  accountEmail: string;
  botEnabled: boolean;
  liveAgentEnabled: boolean;
  shadowMode: boolean;
  autoSendEnabled: boolean;
  confidenceThreshold: number;
  defaultQueueId: string | null;
  allowedQueueIds: string[];
  approvedServiceMessage: string | null;
  policyVersion: number;
};

export type IngestEmailConversationResult = {
  conversationId: string;
  messageId: string;
  created: boolean;
  duplicate: boolean;
  conversation: {
    id: string;
    organizationId: string;
    status: string;
    botActive: boolean;
    queueId: string | null;
  };
  automation: {
    policy: EmailMailboxPolicy | null;
    queueProfiles: Array<{
      key: string;
      queueId: string;
      name: string;
      description: string;
      intents: string[];
      skills: string[];
      classifierVersion: string;
    }>;
    tenantContext: Record<string, unknown>;
  };
};

export async function ingestInboundEmailConversation(
  input: IngestEmailConversationInput,
): Promise<IngestEmailConversationResult | null> {
  const response = await fetch(`${CC_CORE_URL}/internal/v1/email/conversations`, {
    method: "POST",
    headers: internalHeaders(input.organizationId),
    body: jsonStringifyEntityPayload(input),
  });
  if (!response.ok) {
    const responseBody = (await response.text()).slice(0, 2_000);
    throw new Error(
      `cc-core email ingest failed (${response.status}): ${responseBody || response.statusText}`,
    );
  }
  return (await response.json()) as IngestEmailConversationResult;
}

export type EmailBotDecisionInput = {
  customerMessageId: string;
  customerText: string;
  reply: string | null;
  confidence: number;
  grounded: boolean;
  intent: string | null;
  selectedQueueKey: string | null;
  candidateSkills: string[];
  summary: string | null;
  sentiment: string | null;
  importantFacts: string[];
  knowledgeUsed: string[];
  contactEntities?: {
    email?: string | null;
    phone?: string | null;
    displayName?: string | null;
    company?: string | null;
    city?: string | null;
    country?: string | null;
  };
  handoffRecommended: boolean;
  handoffReason: string | null;
  guardPassed: boolean;
  guardReasons: string[];
  urgency?: "normal" | "high" | "critical";
  traceId: string | null;
  modelName: string;
  latencyMs?: number;
  queueProfileVersion: string | null;
  delivery: {
    connectionId: string;
    recipientEmail: string;
    subject: string;
    providerThreadId: string;
    inReplyTo: string | null;
    references: string | null;
  } | null;
};

export async function commitEmailBotDecision(
  organizationId: string,
  conversationId: string,
  input: EmailBotDecisionInput,
): Promise<{
  acceptedForDelivery: boolean;
  messageId: string | null;
  deliveryId: string | null;
  deliveryStatus: string | null;
} | null> {
  try {
    const response = await fetch(
      `${CC_CORE_URL}/internal/v1/email/conversations/${conversationId}/bot-decision`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        body: jsonStringifyEntityPayload(input),
      },
    );
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 2_000);
      throw new Error(
        `cc-core email bot-decision failed (${response.status}): ${responseBody || response.statusText}`,
      );
    }
    return (await response.json()) as {
      acceptedForDelivery: boolean;
      messageId: string | null;
      deliveryId: string | null;
      deliveryStatus: string | null;
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    return null;
  }
}

export async function updateEmailDelivery(
  organizationId: string,
  deliveryId: string,
  input: {
    status: "sent" | "retry" | "failed" | "bounced";
    providerMessageId?: string | null;
    providerRfcMessageId?: string | null;
    error?: string | null;
    retryAfterSeconds?: number;
  },
): Promise<boolean> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/email/deliveries/${deliveryId}`, {
      method: "PATCH",
      headers: internalHeaders(organizationId),
      body: jsonStringifyEntityPayload(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type ClaimedEmailDelivery = {
  id: string;
  organizationId: string;
  connectionId: string;
  recipientEmail: string;
  subject: string;
  providerThreadId: string | null;
  inReplyTo: string | null;
  references: string | null;
  body: string;
  attemptCount: number;
};

export async function claimEmailDeliveries(limit = 10): Promise<ClaimedEmailDelivery[]> {
  try {
    const response = await fetch(`${CC_CORE_URL}/internal/v1/email/deliveries/claim`, {
      method: "POST",
      headers: internalHeaders(),
      body: jsonStringifyEntityPayload({ limit }),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { deliveries: ClaimedEmailDelivery[] };
    return body.deliveries;
  } catch {
    return [];
  }
}
