import {
  jsonStringifyEntityPayload,
  serializeEntityIdOptional,
} from "@ai-contact-center/event-contracts/id-schema";

const NLP_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

function nlpHeaders(organizationId: string | number | bigint): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": serializeEntityIdOptional(organizationId)!,
  };
  if (INTERNAL_SERVICE_KEY) headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  return headers;
}

export type NlpContactEntities = {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  company: string | null;
  city: string | null;
  country: string | null;
};

function parseContactEntities(body: {
  contact_entities?: {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    display_name?: string | null;
    company?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
}): NlpContactEntities | undefined {
  if (!body.contact_entities) return undefined;
  const entities = body.contact_entities;
  return {
    email: entities.email ?? null,
    phone: entities.phone ?? null,
    firstName: entities.first_name ?? null,
    lastName: entities.last_name ?? null,
    displayName: entities.display_name ?? null,
    company: entities.company ?? null,
    city: entities.city ?? null,
    country: entities.country ?? null,
  };
}

export function hasContactEntities(
  entities: NlpContactEntities | null | undefined,
): entities is NlpContactEntities {
  return Boolean(
    entities &&
      Object.values(entities).some((value) => typeof value === "string" && value.trim().length > 0),
  );
}

export async function extractContactEntities(input: {
  organizationId: string;
  conversationId: string;
  message: string;
  channel: "webchat" | "email";
}): Promise<NlpContactEntities | null> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/contact-entities/extract`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: jsonStringifyEntityPayload({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        message: input.message,
        channel: input.channel,
      }),
    });
    if (!response.ok) return null;
    const entities = parseContactEntities(
      (await response.json()) as Parameters<typeof parseContactEntities>[0],
    );
    return hasContactEntities(entities) ? entities : null;
  } catch {
    return null;
  }
}

export type NlpWebchatTurn = {
  reply: string;
  confidence: number;
  intent: string | null;
  candidateSkills: string[];
  selectedQueueKey: string | null;
  summary: string | null;
  sentiment: string | null;
  importantFacts: string[];
  knowledgeUsed: string[];
  handoffRecommended: boolean;
  handoffReason: string | null;
  contactEntities?: NlpContactEntities;
  traceId: string | null;
  modelName: string;
};

export async function runWebchatNlpTurn(input: {
  organizationId: string;
  conversationId: string;
  message: string;
  tenantContext: Record<string, unknown>;
  transcript: { role: string; content: string }[];
  from?: "customer" | "agent";
  agentName?: string;
}): Promise<NlpWebchatTurn | null> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/webchat/turn`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: jsonStringifyEntityPayload({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        message: input.message,
        tenant_context: input.tenantContext,
        transcript: input.transcript,
        ...(input.from ? { from: input.from } : {}),
        ...(input.from === "agent" && input.agentName
          ? { agent_name: input.agentName }
          : {}),
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      reply: string;
      confidence: number;
      intent: string | null;
      candidate_skills: string[];
      selected_queue_key?: string | null;
      summary?: string | null;
      sentiment?: string | null;
      important_facts?: string[];
      knowledge_used?: string[];
      handoff_recommended: boolean;
      handoff_reason: string | null;
      contact_entities?: {
        email?: string | null;
        phone?: string | null;
        display_name?: string | null;
        company?: string | null;
        city?: string | null;
        country?: string | null;
      };
      trace_id?: string | null;
      model_name?: string;
    };
    return {
      reply: body.reply,
      confidence: body.confidence,
      intent: body.intent,
      candidateSkills: body.candidate_skills,
      selectedQueueKey: body.selected_queue_key ?? null,
      summary: body.summary ?? null,
      sentiment: body.sentiment ?? null,
      importantFacts: body.important_facts ?? [],
      knowledgeUsed: body.knowledge_used ?? [],
      handoffRecommended: body.handoff_recommended,
      handoffReason: body.handoff_reason,
      contactEntities: parseContactEntities(body),
      traceId: body.trace_id ?? null,
      modelName: body.model_name ?? "unknown",
    };
  } catch {
    return null;
  }
}

export type NlpEmailTurn = {
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
  handoffRecommended: boolean;
  handoffReason: string | null;
  guardPassed: boolean;
  guardReasons: string[];
  urgency: "normal" | "high" | "critical";
  contactEntities?: NlpContactEntities;
  traceId: string | null;
  modelName: string;
};

export async function runEmailNlpTurn(input: {
  organizationId: string;
  conversationId: string;
  subject: string;
  message: string;
  tenantContext: Record<string, unknown>;
  transcript: { role: string; content: string }[];
  queueProfiles: Array<{
    key: string;
    name: string;
    description: string;
    intents: string[];
    skills: string[];
  }>;
  confidenceThreshold: number;
}): Promise<NlpEmailTurn | null> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/email/turn`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: jsonStringifyEntityPayload({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        subject: input.subject,
        message: input.message,
        tenant_context: input.tenantContext,
        transcript: input.transcript,
        queue_profiles: input.queueProfiles,
        confidence_threshold: input.confidenceThreshold,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      reply: string | null;
      confidence: number;
      grounded: boolean;
      intent: string | null;
      selected_queue_key: string | null;
      candidate_skills: string[];
      summary: string | null;
      sentiment: string | null;
      important_facts: string[];
      knowledge_used: string[];
      handoff_recommended: boolean;
      handoff_reason: string | null;
      guard_passed: boolean;
      guard_reasons: string[];
      urgency?: "normal" | "high" | "critical";
      contact_entities?: {
        email?: string | null;
        phone?: string | null;
        display_name?: string | null;
        company?: string | null;
        city?: string | null;
        country?: string | null;
      };
      trace_id: string | null;
      model_name: string;
    };
    return {
      reply: body.reply,
      confidence: body.confidence,
      grounded: body.grounded,
      intent: body.intent,
      selectedQueueKey: body.selected_queue_key,
      candidateSkills: body.candidate_skills ?? [],
      summary: body.summary,
      sentiment: body.sentiment,
      importantFacts: body.important_facts ?? [],
      knowledgeUsed: body.knowledge_used ?? [],
      handoffRecommended: body.handoff_recommended,
      handoffReason: body.handoff_reason,
      guardPassed: body.guard_passed,
      guardReasons: body.guard_reasons ?? [],
      urgency: body.urgency ?? "normal",
      contactEntities: parseContactEntities(body),
      traceId: body.trace_id,
      modelName: body.model_name ?? "unknown",
    };
  } catch {
    return null;
  }
}

export async function classifyEmailPriority(input: {
  organizationId: string;
  conversationId: string;
  subject: string;
  message: string;
}): Promise<"normal" | "high" | "critical"> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/email/priority`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: jsonStringifyEntityPayload({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        subject: input.subject,
        message: input.message,
      }),
    });
    if (!response.ok) return "normal";
    const body = (await response.json()) as { urgency?: "normal" | "high" | "critical" };
    return body.urgency ?? "normal";
  } catch {
    return "normal";
  }
}
