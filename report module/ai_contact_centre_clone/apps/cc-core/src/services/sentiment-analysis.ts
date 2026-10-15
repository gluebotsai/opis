import { createLogger } from "@ai-contact-center/observability";

import type { PrismaClient } from "@ai-contact-center/db-cc";

import { withOrganizationContext, type DbClient } from "../lib/rls.js";
import { serializeEntityId } from "../lib/id-schema.js";
import {
  buildAgentSessionTranscript,
  type AgentSessionTurn,
} from "./wrap-up-suggest.js";
import type { MessageRecord } from "./conversations.js";
import { listConversationMessages } from "./conversations.js";
import { emitConversationSentimentUpdated } from "./realtime.js";

const NLP_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const SENTIMENT_ENABLED = process.env.SENTIMENT_ANALYSIS_ENABLED !== "false";

const logger = createLogger({ service: "cc-core-sentiment" });

export type SentimentLabel =
  | "very_positive"
  | "positive"
  | "neutral"
  | "negative"
  | "very_negative";

export type SentimentAxis = {
  label: SentimentLabel;
  score: number;
  confidence?: number;
  rationale?: string;
};

export type ConversationSentimentSnapshot = {
  customer: SentimentAxis;
  agent: SentimentAxis;
  updatedAt: string;
  messageId?: string;
  summary?: string;
};

type NlpSentimentAxis = {
  label: string;
  score: number;
  confidence?: number;
  rationale?: string;
};

type NlpTurnResponse = {
  customer: NlpSentimentAxis;
  agent: NlpSentimentAxis;
  signals?: Record<string, string>;
  model_name?: string;
};

type NlpSessionResponse = {
  customer: NlpSentimentAxis;
  agent: NlpSentimentAxis;
  summary?: string;
  model_name?: string;
};

const VALID_LABELS = new Set<SentimentLabel>([
  "very_positive",
  "positive",
  "neutral",
  "negative",
  "very_negative",
]);

function normalizeLabel(value: string): SentimentLabel {
  const normalized = value.trim().toLowerCase() as SentimentLabel;
  return VALID_LABELS.has(normalized) ? normalized : "neutral";
}

function normalizeAxis(raw: NlpSentimentAxis): SentimentAxis {
  const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 50)));
  return {
    label: normalizeLabel(String(raw.label ?? "neutral")),
    score,
    confidence:
      raw.confidence != null ? Math.max(0, Math.min(1, Number(raw.confidence))) : undefined,
    rationale: raw.rationale?.trim() || undefined,
  };
}

function nlpHeaders(organizationId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }
  return headers;
}

async function callSentimentTurn(input: {
  organizationId: string;
  conversationId: string;
  channel: string | null;
  triggerTurn: { role: "customer" | "agent"; text: string; messageId: string };
  transcript: AgentSessionTurn[];
}): Promise<NlpTurnResponse | null> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/workspace/sentiment/turn`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: JSON.stringify({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        channel: input.channel,
        trigger_turn: {
          role: input.triggerTurn.role,
          text: input.triggerTurn.text,
          message_id: input.triggerTurn.messageId,
        },
        transcript: input.transcript,
      }),
    });
    if (!response.ok) {
      logger.warn(
        {
          conversationId: input.conversationId,
          messageId: input.triggerTurn.messageId,
          status: response.status,
        },
        "sentiment turn NLP returned non-ok",
      );
      return null;
    }
    return (await response.json()) as NlpTurnResponse;
  } catch (error) {
    logger.warn({ err: error }, "sentiment turn NLP call failed");
    return null;
  }
}

async function callSentimentSession(input: {
  organizationId: string;
  conversationId: string;
  channel: string | null;
  transcript: AgentSessionTurn[];
}): Promise<NlpSessionResponse | null> {
  try {
    const response = await fetch(`${NLP_URL}/api/v1/workspace/sentiment/session`, {
      method: "POST",
      headers: nlpHeaders(input.organizationId),
      body: JSON.stringify({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        channel: input.channel,
        transcript: input.transcript,
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as NlpSessionResponse;
  } catch (error) {
    logger.warn({ err: error }, "sentiment session NLP call failed");
    return null;
  }
}

function stripMessageBody(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function mapMessagesToTranscript(messages: MessageRecord[]): AgentSessionTurn[] {
  const turns: AgentSessionTurn[] = [];
  for (const message of messages) {
    if (message.senderType !== "customer" && message.senderType !== "agent") continue;
    const text = stripMessageBody(message.body);
    if (!text) continue;
    turns.push({
      role: message.senderType,
      text,
      at: message.sentAt,
    });
  }
  return turns;
}

export async function getLatestConversationSentiment(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<ConversationSentimentSnapshot | null> {
  const rows = await db.$queryRaw<
    {
      message_id: bigint;
      customer_label: string;
      customer_score: number;
      agent_label: string;
      agent_score: number;
      confidence: Record<string, number> | null;
      rationale: Record<string, string> | null;
      summary: string | null;
      created_at: Date;
    }[]
  >`
    SELECT
      message_id,
      customer_label,
      customer_score,
      agent_label,
      agent_score,
      confidence,
      rationale,
      (
        SELECT NULLIF(trim(conversation.resolution_data #>> '{sentiment,summary}'), '')
        FROM ccass.conversations conversation
        WHERE conversation.organization_id = ${organizationId}::bigint
          AND conversation.id = ${conversationId}::bigint
      ) AS summary,
      created_at
    FROM ccass.conversation_sentiment_turns
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const snapshot: ConversationSentimentSnapshot = {
    customer: {
      label: normalizeLabel(row.customer_label),
      score: row.customer_score,
      confidence: row.confidence?.customer,
      rationale: row.rationale?.customer,
    },
    agent: {
      label: normalizeLabel(row.agent_label),
      score: row.agent_score,
      confidence: row.confidence?.agent,
      rationale: row.rationale?.agent,
    },
    updatedAt: row.created_at.toISOString(),
    messageId: serializeEntityId(row.message_id),
  };
  if (row.summary) snapshot.summary = row.summary;
  return snapshot;
}

function defaultCustomerAxis(): SentimentAxis {
  return { label: "neutral", score: 50, confidence: 0.5 };
}

function defaultAgentAxis(): SentimentAxis {
  return {
    label: "neutral",
    score: 50,
    confidence: 0.5,
    rationale: "No agent messages in transcript yet.",
  };
}

export function mergeSentimentAxesForTurn(
  triggerRole: "customer" | "agent",
  incoming: { customer: SentimentAxis; agent: SentimentAxis },
  previous: ConversationSentimentSnapshot | null,
): { customer: SentimentAxis; agent: SentimentAxis } {
  return {
    customer:
      triggerRole === "customer"
        ? incoming.customer
        : (previous?.customer ?? defaultCustomerAxis()),
    agent:
      triggerRole === "agent" ? incoming.agent : (previous?.agent ?? defaultAgentAxis()),
  };
}

async function persistSentimentSnapshot(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  triggerRole: "customer" | "agent" | "session",
  customer: SentimentAxis,
  agent: SentimentAxis,
  extras?: { signals?: Record<string, string>; modelName?: string | null },
): Promise<ConversationSentimentSnapshot> {
  const now = new Date();
  await db.$executeRaw`
    INSERT INTO ccass.conversation_sentiment_turns (
      organization_id, conversation_id, message_id, trigger_role,
      customer_label, customer_score, agent_label, agent_score,
      confidence, rationale, signals, model_name, trace_id, created_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${messageId}::bigint,
      ${triggerRole},
      ${customer.label},
      ${customer.score},
      ${agent.label},
      ${agent.score},
      ${JSON.stringify({
        customer: customer.confidence ?? null,
        agent: agent.confidence ?? null,
      })}::jsonb,
      ${JSON.stringify({
        customer: customer.rationale ?? null,
        agent: agent.rationale ?? null,
      })}::jsonb,
      ${JSON.stringify(extras?.signals ?? {})}::jsonb,
      ${extras?.modelName ?? null},
      ${`sentiment:${conversationId}:${messageId}`},
      ${now}
    )
    ON CONFLICT (organization_id, message_id) DO UPDATE SET
      trigger_role = EXCLUDED.trigger_role,
      customer_label = EXCLUDED.customer_label,
      customer_score = EXCLUDED.customer_score,
      agent_label = EXCLUDED.agent_label,
      agent_score = EXCLUDED.agent_score,
      confidence = EXCLUDED.confidence,
      rationale = EXCLUDED.rationale,
      signals = EXCLUDED.signals,
      model_name = EXCLUDED.model_name,
      trace_id = EXCLUDED.trace_id,
      created_at = EXCLUDED.created_at
  `;
  return {
    customer,
    agent,
    updatedAt: now.toISOString(),
    messageId,
  };
}

async function persistSentimentTurn(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  triggerRole: "customer" | "agent",
  result: NlpTurnResponse,
  previous: ConversationSentimentSnapshot | null,
): Promise<ConversationSentimentSnapshot> {
  const incoming = {
    customer: normalizeAxis(result.customer),
    agent: normalizeAxis(result.agent),
  };
  const merged = mergeSentimentAxesForTurn(triggerRole, incoming, previous);
  return persistSentimentSnapshot(
    db,
    organizationId,
    conversationId,
    messageId,
    triggerRole,
    merged.customer,
    merged.agent,
    { signals: result.signals, modelName: result.model_name ?? null },
  );
}

async function shouldAnalyzeConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<{ ok: boolean; channel: string | null; assignedAt: string | null }> {
  const rows = await db.$queryRaw<
    { channel: string; assigned_user_id: bigint | null; assigned_at: Date | null; status: string }[]
  >`
    SELECT channel, assigned_user_id, assigned_at, status
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { ok: false, channel: null, assignedAt: null };
  const active =
    row.assigned_user_id != null ||
    ["active", "assigned", "agent_connected"].includes(row.status.trim().toLowerCase());
  return {
    ok: active,
    channel: row.channel,
    assignedAt: row.assigned_at?.toISOString() ?? null,
  };
}

export async function analyzeConversationMessageSentiment(
  prisma: PrismaClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  senderType: string,
  messageBody: string,
): Promise<void> {
  if (!SENTIMENT_ENABLED) return;
  if (senderType !== "customer" && senderType !== "agent") return;

  const triggerRole = senderType as "customer" | "agent";
  const text = stripMessageBody(messageBody);
  if (!text) return;

  try {
    const setup = await withOrganizationContext(
      prisma,
      organizationId,
      async (db): Promise<
        | { ok: false }
        | {
            ok: true;
            channel: string | null;
            transcript: AgentSessionTurn[];
          }
      > => {
        const gate = await shouldAnalyzeConversation(db, organizationId, conversationId);
        if (!gate.ok) {
          logger.debug(
            { conversationId, messageId, triggerRole },
            "sentiment analysis skipped: conversation not active",
          );
          return { ok: false };
        }

        const messages = await listConversationMessages(db, organizationId, conversationId);
        const sessionMessages = messages.filter((message) => {
          if (message.senderType === "bot") return false;
          if (
            gate.assignedAt &&
            new Date(message.sentAt).getTime() < new Date(gate.assignedAt).getTime()
          ) {
            return false;
          }
          return message.senderType === "customer" || message.senderType === "agent";
        });

        return {
          ok: true,
          channel: gate.channel,
          transcript: mapMessagesToTranscript(sessionMessages),
        };
      },
    );

    if (!setup.ok) return;

    const nlpResult = await callSentimentTurn({
      organizationId,
      conversationId,
      channel: setup.channel,
      triggerTurn: { role: triggerRole, text, messageId },
      transcript: setup.transcript,
    });
    if (!nlpResult) {
      logger.warn(
        { conversationId, messageId, triggerRole },
        "sentiment analysis skipped: NLP turn result unavailable",
      );
      return;
    }

    const snapshot = await withOrganizationContext(prisma, organizationId, async (db) => {
      const previous = await getLatestConversationSentiment(db, organizationId, conversationId);
      return persistSentimentTurn(
        db,
        organizationId,
        conversationId,
        messageId,
        triggerRole,
        nlpResult,
        previous,
      );
    });
    emitConversationSentimentUpdated(organizationId, conversationId, snapshot);
    logger.info(
      {
        conversationId,
        messageId,
        triggerRole,
        customer: snapshot.customer,
        agent: snapshot.agent,
      },
      "sentiment analysis completed",
    );
  } catch (error) {
    logger.warn({ err: error, conversationId, messageId }, "sentiment analysis failed");
  }
}

export function scheduleConversationMessageSentiment(
  prisma: PrismaClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  senderType: string,
  messageBody: string,
): void {
  if (!SENTIMENT_ENABLED) return;
  void analyzeConversationMessageSentiment(
    prisma,
    organizationId,
    conversationId,
    messageId,
    senderType,
    messageBody,
  ).catch((error) => {
    logger.warn({ err: error, conversationId, messageId }, "scheduled sentiment analysis failed");
  });
}

export async function summarizeSessionSentimentForDisposition(
  prisma: PrismaClient,
  organizationId: string,
  conversationId: string,
): Promise<ConversationSentimentSnapshot | null> {
  if (!SENTIMENT_ENABLED) return null;

  const setup = await withOrganizationContext(prisma, organizationId, async (db) => {
    const rows = await db.$queryRaw<
      { channel: string; assigned_at: Date | null; resolution_data: Record<string, unknown> | null }[]
    >`
      SELECT channel, assigned_at, resolution_data
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${conversationId}::bigint
      LIMIT 1
    `;
    const conversation = rows[0];
    if (!conversation) return null;

    const messages = await listConversationMessages(db, organizationId, conversationId);
    return {
      channel: conversation.channel,
      assignedAt: conversation.assigned_at?.toISOString() ?? null,
      resolutionData: conversation.resolution_data,
      messages,
    };
  });

  if (!setup) return null;

  const transcript = buildAgentSessionTranscript(setup.messages, setup.assignedAt);
  if (transcript.length === 0) {
    return withOrganizationContext(prisma, organizationId, (db) =>
      getLatestConversationSentiment(db, organizationId, conversationId),
    );
  }

  const nlpResult = await callSentimentSession({
    organizationId,
    conversationId,
    channel: setup.channel,
    transcript,
  });

  if (!nlpResult) {
    return withOrganizationContext(prisma, organizationId, (db) =>
      getLatestConversationSentiment(db, organizationId, conversationId),
    );
  }

  const snapshot: ConversationSentimentSnapshot = {
    customer: normalizeAxis(nlpResult.customer),
    agent: normalizeAxis(nlpResult.agent),
    updatedAt: new Date().toISOString(),
  };
  if (nlpResult.summary?.trim()) snapshot.summary = nlpResult.summary.trim();

  const lastMessage = [...setup.messages]
    .reverse()
    .find((message) => message.senderType === "customer" || message.senderType === "agent");

  if (lastMessage?.id) {
    await withOrganizationContext(prisma, organizationId, async (db) =>
      persistSentimentSnapshot(
        db,
        organizationId,
        conversationId,
        lastMessage.id,
        "session",
        snapshot.customer,
        snapshot.agent,
        { modelName: nlpResult.model_name ?? null },
      ),
    );
    snapshot.messageId = lastMessage.id;
  }

  const resolutionData = {
    ...(setup.resolutionData && typeof setup.resolutionData === "object" ? setup.resolutionData : {}),
    sentiment: {
      customer: snapshot.customer,
      agent: snapshot.agent,
      summary: nlpResult.summary ?? null,
      computedAt: snapshot.updatedAt,
      modelName: nlpResult.model_name ?? null,
    },
  };

  await withOrganizationContext(prisma, organizationId, async (db) => {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET resolution_data = ${JSON.stringify(resolutionData)}::jsonb,
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${conversationId}::bigint
    `;
  });

  emitConversationSentimentUpdated(organizationId, conversationId, snapshot);
  return snapshot;
}

export function scheduleSessionSentimentOnDisposition(
  prisma: PrismaClient,
  organizationId: string,
  conversationId: string,
): void {
  if (!SENTIMENT_ENABLED) return;
  void summarizeSessionSentimentForDisposition(prisma, organizationId, conversationId).catch(
    (error) => {
      logger.warn({ err: error, conversationId }, "session sentiment on disposition failed");
    },
  );
}
