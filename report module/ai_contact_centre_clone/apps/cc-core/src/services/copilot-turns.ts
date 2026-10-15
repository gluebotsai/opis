import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { entityIdSchema, isEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";

export const recordCopilotTurnSchema = z.object({
  /** Client correlation id from NLP may be a UUID; only numeric ids are persisted. */
  id: z.string().optional(),
  conversationId: entityIdSchema.nullable().optional(),
  surface: z.string().max(64).optional(),
  agentInput: z.string().max(20_000).optional(),
  copilotResponse: z.string().max(100_000).optional(),
  suggestionText: z.string().max(100_000).optional(),
  skillKey: z.string().max(128).optional(),
  modelName: z.string().max(128).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  status: z.string().max(32).default("completed"),
  /** Client-observed conversation event sequence; stale suggestions are rejected. */
  expectedEventSequence: z.number().int().nonnegative().optional(),
  routingChain: z.array(z.string().min(1).max(128)).max(20).optional(),
  promptVersions: z.record(z.string(), z.string().max(128)).optional(),
  assistState: z.record(z.string(), z.unknown()).optional(),
});

export async function recordCopilotTurn(
  db: DbClient,
  organizationId: string,
  userId: string,
  role: string,
  input: z.infer<typeof recordCopilotTurnSchema>,
): Promise<{ id: string; stale?: boolean }> {
  const payload = recordCopilotTurnSchema.parse(input);

  if (payload.surface === "coworker" && payload.conversationId) {
    // Coworker must not attach turns to customer conversations/memory.
    throw Object.assign(
      new Error("Coworker surface cannot write conversation-scoped Copilot turns"),
      { status: 409 },
    );
  }

  if (payload.conversationId && payload.expectedEventSequence != null) {
    const sequenceRows = await db.$queryRaw<{ event_sequence: number | bigint }[]>`
      SELECT COALESCE(event_sequence, 0) AS event_sequence
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${payload.conversationId}::bigint
      LIMIT 1
    `;
    const currentSequence = Number(sequenceRows[0]?.event_sequence ?? 0);
    if (currentSequence !== payload.expectedEventSequence) {
      return { id: payload.id && isEntityId(payload.id) ? payload.id : "0", stale: true };
    }
  }

  const sessionRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ccass.copilot_sessions
    WHERE organization_id = ${organizationId}::bigint
      AND user_id = ${userId}::bigint
      AND status = 'active'
    ORDER BY last_activity_at DESC
    LIMIT 1
  `;

  let sessionId = sessionRows[0]?.id;
  if (!sessionId) {
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.copilot_sessions (
        organization_id, user_id, role, active_surface
      ) VALUES (
        ${organizationId}::bigint,
        ${userId}::bigint,
        ${role},
        ${payload.surface ?? null}
      )
      RETURNING id::text AS id
    `;
    sessionId = inserted[0]?.id;
    if (!sessionId) {
      throw Object.assign(new Error("Failed to create copilot session"), { status: 500 });
    }
  } else {
    await db.$executeRaw`
      UPDATE ccass.copilot_sessions
      SET active_surface = ${payload.surface ?? null}, last_activity_at = NOW()
      WHERE id = ${sessionId}::bigint
    `;
  }

  const clientTurnId = payload.id && isEntityId(payload.id) ? payload.id : null;
  const inserted = clientTurnId
    ? await db.$queryRaw<{ id: string }[]>`
        INSERT INTO ccass.copilot_turns (
          id, organization_id, session_id, conversation_id, surface,
          agent_input, copilot_response, suggestion_text, skill_key,
          model_name, latency_ms, status, routing_chain, prompt_versions, assist_state
        ) VALUES (
          ${clientTurnId}::bigint,
          ${organizationId}::bigint,
          ${sessionId}::bigint,
          ${payload.conversationId ?? null}::bigint,
          ${payload.surface ?? null},
          ${payload.agentInput ?? null},
          ${payload.copilotResponse ?? null},
          ${payload.suggestionText ?? null},
          ${payload.skillKey ?? null},
          ${payload.modelName ?? null},
          ${payload.latencyMs ?? null},
          ${payload.status},
          ${payload.routingChain ? JSON.stringify(payload.routingChain) : null}::jsonb,
          ${payload.promptVersions ? JSON.stringify(payload.promptVersions) : null}::jsonb,
          ${payload.assistState ? JSON.stringify(payload.assistState) : null}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          copilot_response = EXCLUDED.copilot_response,
          suggestion_text = EXCLUDED.suggestion_text,
          routing_chain = EXCLUDED.routing_chain,
          prompt_versions = EXCLUDED.prompt_versions,
          assist_state = EXCLUDED.assist_state,
          latency_ms = EXCLUDED.latency_ms,
          status = EXCLUDED.status
        RETURNING id::text AS id
      `
    : await db.$queryRaw<{ id: string }[]>`
        INSERT INTO ccass.copilot_turns (
          organization_id, session_id, conversation_id, surface,
          agent_input, copilot_response, suggestion_text, skill_key,
          model_name, latency_ms, status, routing_chain, prompt_versions, assist_state
        ) VALUES (
          ${organizationId}::bigint,
          ${sessionId}::bigint,
          ${payload.conversationId ?? null}::bigint,
          ${payload.surface ?? null},
          ${payload.agentInput ?? null},
          ${payload.copilotResponse ?? null},
          ${payload.suggestionText ?? null},
          ${payload.skillKey ?? null},
          ${payload.modelName ?? null},
          ${payload.latencyMs ?? null},
          ${payload.status},
          ${payload.routingChain ? JSON.stringify(payload.routingChain) : null}::jsonb,
          ${payload.promptVersions ? JSON.stringify(payload.promptVersions) : null}::jsonb,
          ${payload.assistState ? JSON.stringify(payload.assistState) : null}::jsonb
        )
        RETURNING id::text AS id
      `;
  const turnId = inserted[0]?.id;
  if (!turnId) {
    throw Object.assign(new Error("Failed to record copilot turn"), { status: 500 });
  }
  return { id: turnId };
}

export async function linkCopilotTurnToMessage(
  db: DbClient,
  organizationId: string,
  userId: string,
  turnId: string,
  messageId: string,
  finalText: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.copilot_turns t
    SET accepted = TRUE, sent_message_id = ${messageId}::bigint, final_text = ${finalText}
    FROM ccass.copilot_sessions s
    WHERE t.id = ${turnId}::bigint
      AND t.organization_id = ${organizationId}::bigint
      AND t.session_id = s.id
      AND s.user_id = ${userId}::bigint
  `;
}

export type CopilotTurnRecord = {
  id: string;
  sessionId: string;
  conversationId: string | null;
  surface: string | null;
  agentInput: string | null;
  copilotResponse: string | null;
  suggestionText: string | null;
  modelName: string | null;
  createdAt: string;
  assistState: Record<string, unknown> | null;
};

export async function listActiveCopilotTurns(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId?: string | null,
  limit = 20,
  surface?: string | null,
): Promise<CopilotTurnRecord[]> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      session_id: string;
      conversation_id: string | null;
      surface: string | null;
      agent_input: string | null;
      copilot_response: string | null;
      suggestion_text: string | null;
      model_name: string | null;
      created_at: Date;
      assist_state: Record<string, unknown> | null;
    }>
  >`
    SELECT t.id, t.session_id, t.conversation_id, t.surface, t.agent_input,
           t.copilot_response, t.suggestion_text, t.model_name, t.created_at,
           t.assist_state
    FROM ccass.copilot_turns t
    INNER JOIN ccass.copilot_sessions s ON s.id = t.session_id
    WHERE t.organization_id = ${organizationId}::bigint
      AND s.user_id = ${userId}::bigint
      AND s.status = 'active'
      AND (${conversationId ?? null}::bigint IS NULL OR t.conversation_id = ${conversationId ?? null}::bigint)
      AND (${surface ?? null}::text IS NULL OR t.surface = ${surface ?? null})
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `;
  return rows
    .map((row) => ({
      id: serializeEntityIdOptional(row.id)!,
      sessionId: serializeEntityIdOptional(row.session_id)!,
      conversationId: serializeEntityIdOptional(row.conversation_id),
      surface: row.surface,
      agentInput: row.agent_input,
      copilotResponse: row.copilot_response,
      suggestionText: row.suggestion_text,
      modelName: row.model_name,
      createdAt: row.created_at.toISOString(),
      assistState:
        row.assist_state && typeof row.assist_state === "object" && !Array.isArray(row.assist_state)
          ? row.assist_state
          : null,
    }))
    .reverse();
}
