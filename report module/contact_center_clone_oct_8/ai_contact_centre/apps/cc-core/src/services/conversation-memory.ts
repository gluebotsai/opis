import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { listNlpTurns, type NlpTurnRecord } from "./nlp-conversations.js";
import { entityIdSchema } from "../lib/id-schema.js";

export const upsertConversationMemorySchema = z.object({
  rollingSummary: z.string().max(20_000).nullable().optional(),
  extractedFacts: z.array(z.string().max(500)).max(50).optional(),
  modelName: z.string().max(128).optional(),
  latestSummarizedMessageId: entityIdSchema.nullable().optional(),
  tokenEstimate: z.number().int().nonnegative().optional(),
});

export type ConversationMemoryRecord = {
  id: string;
  organizationId: string;
  conversationId: string;
  rollingSummary: string | null;
  extractedFacts: string[];
  latestSummarizedMessageId: string | null;
  modelName: string | null;
  tokenEstimate: number | null;
  version: number;
  updatedAt: string;
};

export const DEFAULT_SHORT_TERM_MEMORY_HOURS = 24;
export const DEFAULT_BOT_TRANSCRIPT_TURN_LIMIT = 20;

export type BotTranscriptItem = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SessionMemoryPayload = {
  conversationId: string;
  turns: NlpTurnRecord[];
  memory: ConversationMemoryRecord | null;
  /** Short-term turns from the last 24h rendered for NLP transcript. */
  transcript: BotTranscriptItem[];
  /** Long-term summary (current session memory or prior closed session). */
  longTermSummary: string | null;
  /** Merged structured facts for NLP context. */
  extractedFacts: string[];
};

export function nlpTurnsToTranscript(turns: NlpTurnRecord[]): BotTranscriptItem[] {
  const transcript: BotTranscriptItem[] = [];
  for (const turn of turns) {
    const customer = turn.customerText.trim();
    if (customer) {
      transcript.push({ role: "user", content: customer });
    }
    const bot = turn.botReply?.trim();
    if (bot) {
      transcript.push({ role: "assistant", content: bot });
    }
  }
  return transcript;
}

function mergeUniqueFacts(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const fact of group ?? []) {
      const trimmed = fact.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged.slice(0, 50);
}

function isWithinShortTermWindow(isoTimestamp: string, shortTermHours: number): boolean {
  const createdAt = Date.parse(isoTimestamp);
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt <= shortTermHours * 60 * 60 * 1000;
}

type ConversationMemoryRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  rolling_summary: string | null;
  extracted_facts: unknown;
  latest_summarized_message_id: string | null;
  model_name: string | null;
  token_estimate: number | null;
  version: number;
  updated_at: Date;
};

function rowEntityId(value: string | bigint | number | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

function mapConversationMemory(row: ConversationMemoryRow): ConversationMemoryRecord {
  const facts = Array.isArray(row.extracted_facts)
    ? row.extracted_facts.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: rowEntityId(row.id)!,
    organizationId: rowEntityId(row.organization_id)!,
    conversationId: rowEntityId(row.conversation_id)!,
    rollingSummary: row.rolling_summary,
    extractedFacts: facts,
    latestSummarizedMessageId: rowEntityId(row.latest_summarized_message_id),
    modelName: row.model_name,
    tokenEstimate: row.token_estimate,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getConversationMemory(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<ConversationMemoryRecord | null> {
  const rows = await db.$queryRaw<ConversationMemoryRow[]>`
    SELECT *
    FROM ccass.conversation_memory
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
    LIMIT 1
  `;
  return rows[0] ? mapConversationMemory(rows[0]) : null;
}

export async function getSessionMemory(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  options?: {
    turnLimit?: number;
    shortTermHours?: number;
    includePreviousSessionMemory?: boolean;
  },
): Promise<SessionMemoryPayload> {
  const turnLimit = Math.min(
    Math.max(options?.turnLimit ?? DEFAULT_BOT_TRANSCRIPT_TURN_LIMIT, 1),
    100,
  );
  const shortTermHours = options?.shortTermHours ?? DEFAULT_SHORT_TERM_MEMORY_HOURS;
  const includePreviousSessionMemory = options?.includePreviousSessionMemory !== false;

  const allTurns = await listNlpTurns(db, organizationId, conversationId);
  const turns = allTurns
    .filter((turn) => isWithinShortTermWindow(turn.createdAt, shortTermHours))
    .slice(-turnLimit);

  const memory = await getConversationMemory(db, organizationId, conversationId);

  let previousMemory: ConversationMemoryRecord | null = null;
  if (includePreviousSessionMemory) {
    const previousRows = await db.$queryRaw<{ previous_conversation_id: string | null }[]>`
      SELECT previous_conversation_id
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${conversationId}::bigint
      LIMIT 1
    `;
    const previousConversationId = previousRows[0]?.previous_conversation_id;
    if (previousConversationId) {
      previousMemory = await getConversationMemory(db, organizationId, previousConversationId);
    }
  }

  const longTermSummary =
    memory?.rollingSummary?.trim() ||
    previousMemory?.rollingSummary?.trim() ||
    null;
  const extractedFacts = mergeUniqueFacts(
    previousMemory?.extractedFacts,
    memory?.extractedFacts,
  );

  return {
    conversationId,
    turns,
    memory,
    transcript: nlpTurnsToTranscript(turns),
    longTermSummary,
    extractedFacts,
  };
}

export async function upsertConversationMemory(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: z.infer<typeof upsertConversationMemorySchema>,
): Promise<ConversationMemoryRecord> {
  const payload = upsertConversationMemorySchema.parse(input);
  const existing = await getConversationMemory(db, organizationId, conversationId);
  const rollingSummary =
    payload.rollingSummary !== undefined ? payload.rollingSummary : (existing?.rollingSummary ?? null);
  const extractedFacts =
    payload.extractedFacts !== undefined ? payload.extractedFacts : (existing?.extractedFacts ?? []);
  const modelName =
    payload.modelName !== undefined ? payload.modelName : (existing?.modelName ?? null);
  const latestSummarizedMessageId =
    payload.latestSummarizedMessageId !== undefined
      ? payload.latestSummarizedMessageId
      : (existing?.latestSummarizedMessageId ?? null);
  const tokenEstimate =
    payload.tokenEstimate !== undefined ? payload.tokenEstimate : (existing?.tokenEstimate ?? null);
  const version = (existing?.version ?? 0) + 1;

  const rows = await db.$queryRaw<ConversationMemoryRow[]>`
    INSERT INTO ccass.conversation_memory (
      organization_id, conversation_id, rolling_summary, extracted_facts,
      latest_summarized_message_id, model_name, token_estimate, version, updated_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${rollingSummary},
      ${JSON.stringify(extractedFacts)}::jsonb,
      ${latestSummarizedMessageId}::bigint,
      ${modelName},
      ${tokenEstimate},
      ${version},
      NOW()
    )
    ON CONFLICT (conversation_id) DO UPDATE SET
      rolling_summary = EXCLUDED.rolling_summary,
      extracted_facts = EXCLUDED.extracted_facts,
      latest_summarized_message_id = EXCLUDED.latest_summarized_message_id,
      model_name = EXCLUDED.model_name,
      token_estimate = EXCLUDED.token_estimate,
      version = ccass.conversation_memory.version + 1,
      updated_at = NOW()
    RETURNING *
  `;
  return mapConversationMemory(rows[0]!);
}
