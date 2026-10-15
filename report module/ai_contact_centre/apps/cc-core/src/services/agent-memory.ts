import { z } from "zod";

import { entityIdSchema } from "../lib/id-schema.js";
import type { DbClient } from "../lib/rls.js";

export const agentMemoryScopeSchema = z.object({
  organizationId: entityIdSchema,
  userId: entityIdSchema,
  conversationId: entityIdSchema.nullable().optional(),
  memoryType: z.enum(["long_term", "preference_scratchpad"]),
});

export const upsertAgentMemorySchema = agentMemoryScopeSchema.extend({
  content: z.record(z.string(), z.unknown()),
  mode: z.enum(["append", "merge", "replace"]).default("replace"),
});

type MemoryRow = {
  id: string;
  conversation_id: string | null;
  content: unknown;
  version: number;
  updated_at: Date;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function readAgentMemory(
  db: DbClient,
  input: z.infer<typeof agentMemoryScopeSchema>,
): Promise<Array<{
  id: string;
  conversationId: string | null;
  content: Record<string, unknown>;
  version: number;
  updatedAt: string;
}>> {
  const scope = agentMemoryScopeSchema.parse(input);
  const rows = await db.$queryRaw<MemoryRow[]>`
    SELECT id::text AS id, conversation_id::text AS conversation_id,
           content, version, updated_at
    FROM ccass.copilot_memory
    WHERE organization_id = ${scope.organizationId}::bigint
      AND user_id = ${scope.userId}::bigint
      AND memory_type = ${scope.memoryType}
      AND (
        ${scope.conversationId ?? null}::bigint IS NULL
        OR conversation_id = ${scope.conversationId ?? null}::bigint
      )
    ORDER BY updated_at DESC
    LIMIT 50
  `;
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    content: asRecord(row.content),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function upsertAgentMemory(
  db: DbClient,
  input: z.infer<typeof upsertAgentMemorySchema>,
): Promise<{
  id: string;
  conversationId: string | null;
  content: Record<string, unknown>;
  version: number;
  updatedAt: string;
}> {
  const payload = upsertAgentMemorySchema.parse(input);
  const lockKey = [
    payload.organizationId,
    payload.userId,
    payload.conversationId ?? "global",
    payload.memoryType,
  ].join(":");
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

  const existing = (
    await db.$queryRaw<MemoryRow[]>`
      SELECT id::text AS id, conversation_id::text AS conversation_id,
             content, version, updated_at
      FROM ccass.copilot_memory
      WHERE organization_id = ${payload.organizationId}::bigint
        AND user_id = ${payload.userId}::bigint
        AND memory_type = ${payload.memoryType}
        AND conversation_id IS NOT DISTINCT FROM ${payload.conversationId ?? null}::bigint
      ORDER BY updated_at DESC
      LIMIT 1
    `
  )[0];

  const current = asRecord(existing?.content);
  let next = payload.content;
  if (payload.mode === "merge") {
    next = { ...current, ...payload.content };
  } else if (payload.mode === "append") {
    const currentItems = Array.isArray(current.items) ? current.items : [];
    const incomingItems = Array.isArray(payload.content.items)
      ? payload.content.items
      : [payload.content];
    next = { ...current, items: [...currentItems, ...incomingItems].slice(-200) };
  }
  const encoded = JSON.stringify(next);

  const rows = existing
    ? await db.$queryRaw<MemoryRow[]>`
        UPDATE ccass.copilot_memory
        SET content = ${encoded}::jsonb,
            provenance = 'nlp_agent',
            version = version + 1,
            updated_at = NOW()
        WHERE id = ${existing.id}::bigint
        RETURNING id::text AS id, conversation_id::text AS conversation_id,
                  content, version, updated_at
      `
    : await db.$queryRaw<MemoryRow[]>`
        INSERT INTO ccass.copilot_memory (
          organization_id, user_id, conversation_id, memory_type,
          content, provenance
        ) VALUES (
          ${payload.organizationId}::bigint,
          ${payload.userId}::bigint,
          ${payload.conversationId ?? null}::bigint,
          ${payload.memoryType},
          ${encoded}::jsonb,
          'nlp_agent'
        )
        RETURNING id::text AS id, conversation_id::text AS conversation_id,
                  content, version, updated_at
      `;
  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error("Failed to persist agent memory"), { status: 500 });
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    content: asRecord(row.content),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

