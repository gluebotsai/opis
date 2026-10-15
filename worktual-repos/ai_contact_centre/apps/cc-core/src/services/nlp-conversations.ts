import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import {
  enrichContactFromConversation,
  hasProfileEnrichmentData,
  mergeContactCaptureSources,
} from "./contact-identity.js";
import { emitContactEnriched } from "./realtime.js";
import { entityIdSchema } from "../lib/id-schema.js";

export const recordNlpTurnSchema = z.object({
  customerText: z.string().min(1),
  botReply: z.string().optional(),
  customerMessageId: entityIdSchema.optional(),
  botMessageId: entityIdSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  intent: z.string().optional(),
  candidateSkills: z.array(z.string()).optional(),
  summary: z.string().max(1000).nullable().optional(),
  sentiment: z.string().max(50).nullable().optional(),
  importantFacts: z.array(z.string().max(300)).max(20).optional(),
  contactEntities: z
    .object({
      email: z.string().email().nullable().optional(),
      phone: z.string().max(50).nullable().optional(),
      firstName: z.string().max(100).nullable().optional(),
      lastName: z.string().max(100).nullable().optional(),
      displayName: z.string().max(200).nullable().optional(),
      company: z.string().max(200).nullable().optional(),
      city: z.string().max(160).nullable().optional(),
      country: z.string().max(160).nullable().optional(),
    })
    .optional(),
  knowledgeUsed: z.array(z.string().max(100)).max(10).optional(),
  handoffRecommended: z.boolean().optional(),
  handoffReason: z.string().optional(),
  skillKey: z.string().optional(),
  modelName: z.string().optional(),
  traceId: z.string().optional(),
  latencyMs: z.number().int().optional(),
  runtimeType: z
    .enum(["webchat_bot", "email_bot", "whatsapp_bot", "instagram_bot", "facebook_bot"])
    .optional()
    .default("webchat_bot"),
  selectedQueueKey: z.string().max(255).nullable().optional(),
  queueProfileVersion: z.string().max(64).nullable().optional(),
  grounded: z.boolean().nullable().optional(),
  guardPassed: z.boolean().nullable().optional(),
  guardReasons: z.array(z.string().max(300)).max(20).optional(),
  knowledgeReferences: z.array(z.string().max(300)).max(20).optional(),
  deliveryMessageId: entityIdSchema.nullable().optional(),
});

export type NlpConversationRecord = {
  id: string;
  organizationId: string;
  conversationId: string;
  runtimeType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
};

export type NlpTurnRecord = {
  id: string;
  nlpConversationId: string;
  conversationId: string;
  turnNumber: number;
  customerText: string;
  botReply: string | null;
  confidence: number | null;
  intent: string | null;
  handoffRecommended: boolean;
  handoffReason: string | null;
  traceId: string | null;
  createdAt: string;
};

type NlpConversationRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  runtime_type: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
};

type NlpTurnRow = {
  id: string;
  nlp_conversation_id: string;
  conversation_id: string;
  turn_number: number;
  customer_text: string;
  bot_reply: string | null;
  confidence: number | null;
  intent: string | null;
  handoff_recommended: boolean;
  handoff_reason: string | null;
  trace_id: string | null;
  created_at: Date;
};

function mapNlpConversation(row: NlpConversationRow): NlpConversationRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    conversationId: String(row.conversation_id),
    runtimeType: row.runtime_type,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    endReason: row.end_reason,
  };
}

function mapNlpTurn(row: NlpTurnRow): NlpTurnRecord {
  return {
    id: String(row.id),
    nlpConversationId: String(row.nlp_conversation_id),
    conversationId: String(row.conversation_id),
    turnNumber: row.turn_number,
    customerText: row.customer_text,
    botReply: row.bot_reply,
    confidence: row.confidence,
    intent: row.intent,
    handoffRecommended: row.handoff_recommended,
    handoffReason: row.handoff_reason,
    traceId: row.trace_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function ensureNlpConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  runtimeType:
    | "webchat_bot"
    | "email_bot"
    | "whatsapp_bot"
    | "instagram_bot"
    | "facebook_bot" = "webchat_bot",
): Promise<NlpConversationRecord> {
  const rows = await db.$queryRaw<NlpConversationRow[]>`
    INSERT INTO ccass.nlp_conversations (
      organization_id, conversation_id, runtime_type, status
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${runtimeType},
      'active'
    )
    ON CONFLICT (conversation_id) DO UPDATE
      SET updated_at = NOW()
    RETURNING *
  `;
  return mapNlpConversation(rows[0]!);
}

export async function endNlpConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  reason: string,
): Promise<NlpConversationRecord | null> {
  const rows = await db.$queryRaw<NlpConversationRow[]>`
    UPDATE ccass.nlp_conversations
    SET status = 'ended', end_reason = ${reason}, ended_at = NOW(), updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND status = 'active'
    RETURNING *
  `;
  return rows[0] ? mapNlpConversation(rows[0]) : null;
}

export async function recordNlpTurn(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: z.infer<typeof recordNlpTurnSchema>,
): Promise<NlpTurnRecord> {
  const payload = recordNlpTurnSchema.parse(input);
  const nlpConversation = await ensureNlpConversation(
    db,
    organizationId,
    conversationId,
    payload.runtimeType,
  );

  const countRows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM ccass.nlp_turns
    WHERE nlp_conversation_id = ${nlpConversation.id}::bigint
  `;
  const turnNumber = Number(countRows[0]?.count ?? 0n) + 1;

  const rows = await db.$queryRaw<NlpTurnRow[]>`
    INSERT INTO ccass.nlp_turns (
      organization_id, nlp_conversation_id, conversation_id, turn_number,
      customer_message_id, bot_message_id, customer_text, bot_reply,
      confidence, intent, candidate_skills, handoff_recommended, handoff_reason,
      skill_key, model_name, trace_id, latency_ms, selected_queue_key,
      queue_profile_version, grounded, guard_passed, guard_reasons,
      knowledge_references, delivery_message_id, summary, sentiment, important_facts
    ) VALUES (
      ${organizationId}::bigint,
      ${nlpConversation.id}::bigint,
      ${conversationId}::bigint,
      ${turnNumber},
      ${payload.customerMessageId ?? null}::bigint,
      ${payload.botMessageId ?? null}::bigint,
      ${payload.customerText},
      ${payload.botReply ?? null},
      ${payload.confidence ?? null},
      ${payload.intent ?? null},
      ${JSON.stringify(payload.candidateSkills ?? [])}::jsonb,
      ${payload.handoffRecommended ?? false},
      ${payload.handoffReason ?? null},
      ${payload.skillKey ?? null},
      ${payload.modelName ?? null},
      ${payload.traceId ?? null},
      ${payload.latencyMs ?? null},
      ${payload.selectedQueueKey ?? null},
      ${payload.queueProfileVersion ?? null},
      ${payload.grounded ?? null},
      ${payload.guardPassed ?? null},
      ${JSON.stringify(payload.guardReasons ?? [])}::jsonb,
      ${JSON.stringify(payload.knowledgeReferences ?? [])}::jsonb,
      ${payload.deliveryMessageId ?? null}::bigint,
      ${payload.summary ?? null},
      ${payload.sentiment ?? null},
      ${JSON.stringify(payload.importantFacts ?? [])}::jsonb
    )
    RETURNING *
  `;

  await db.$executeRaw`
    UPDATE ccass.nlp_conversations
    SET updated_at = NOW()
    WHERE id = ${nlpConversation.id}::bigint
  `;

  const enrichInput = mergeContactCaptureSources({
    customerText: payload.customerText,
    importantFacts: payload.importantFacts,
    contactEntities: payload.contactEntities,
  });
  if (hasProfileEnrichmentData(enrichInput)) {
    const enrichment = await enrichContactFromConversation(db, organizationId, conversationId, {
      ...enrichInput,
      sourceMessageId: payload.customerMessageId,
    });
    if (
      enrichment &&
      enrichment.outcome !== "no_change" &&
      enrichment.outcome !== "confirmation_required" &&
      !enrichment.idempotentReplay
    ) {
      emitContactEnriched(organizationId, conversationId, enrichment);
    }
  }

  return mapNlpTurn(rows[0]!);
}

export async function listNlpTurns(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<NlpTurnRecord[]> {
  const rows = await db.$queryRaw<NlpTurnRow[]>`
    SELECT t.*
    FROM ccass.nlp_turns t
    INNER JOIN ccass.nlp_conversations nc ON nc.id = t.nlp_conversation_id
    WHERE t.organization_id = ${organizationId}::bigint
      AND t.conversation_id = ${conversationId}::bigint
    ORDER BY t.turn_number ASC
  `;
  return rows.map(mapNlpTurn);
}
