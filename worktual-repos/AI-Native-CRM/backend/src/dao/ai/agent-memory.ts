/**
 * Durable CRM agent memory — structured slots on crm.agent_memories.
 * Hydrated into coworker catalog next to client STM.
 */

import { prisma } from "@/dao/db/prisma";

export type AgentMemoryScopeType = "org" | "user" | "contact" | "deal";

export type AgentMemorySlot = {
  scopeType: AgentMemoryScopeType;
  scopeId: string;
  slotKey: string;
  slotValue: unknown;
  source: string | null;
  expiresAt: string | null;
  updatedAt: string;
};

const ALLOWED_KEYS = new Set([
  "prefs",
  "last_intent",
  "open_ask",
  "entity_hint",
  "tone",
  "follow_up",
  "note",
]);

export function isAllowedMemorySlotKey(key: string): boolean {
  return ALLOWED_KEYS.has(key.trim());
}

export function isAllowedMemoryScopeType(
  value: string,
): value is AgentMemoryScopeType {
  return value === "org" || value === "user" || value === "contact" || value === "deal";
}

function organizationIdValue(value: string): bigint | null {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? BigInt(normalized) : null;
}

export async function listAgentMemories(input: {
  organizationId: string;
  userId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  limit?: number;
}): Promise<AgentMemorySlot[]> {
  const orgId = organizationIdValue(input.organizationId);
  if (orgId === null) return [];

  const or: Array<{
    scopeType: string;
    scopeId: string;
  }> = [{ scopeType: "org", scopeId: "" }];
  if (input.userId?.trim()) {
    or.push({ scopeType: "user", scopeId: input.userId.trim() });
  }
  if (input.contactId?.trim()) {
    or.push({ scopeType: "contact", scopeId: input.contactId.trim() });
  }
  if (input.dealId?.trim()) {
    or.push({ scopeType: "deal", scopeId: input.dealId.trim() });
  }

  const now = new Date();
  const rows = await prisma.agentMemory.findMany({
    where: {
      organizationId: orgId,
      OR: or,
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(100, Math.max(1, input.limit ?? 40)),
  });

  return rows.map((r) => ({
    scopeType: r.scopeType as AgentMemoryScopeType,
    scopeId: r.scopeId,
    slotKey: r.slotKey,
    slotValue: r.slotValue,
    source: r.source,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Flat map for prompt: `user:prefs` → value, etc. */
export function memoriesToPromptMap(
  slots: AgentMemorySlot[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of slots) {
    const key =
      s.scopeType === "org"
        ? `org:${s.slotKey}`
        : `${s.scopeType}:${s.scopeId.slice(0, 8)}:${s.slotKey}`;
    out[key] = s.slotValue;
  }
  return out;
}

export async function upsertAgentMemory(input: {
  organizationId: string;
  scopeType: AgentMemoryScopeType;
  scopeId?: string | null;
  slotKey: string;
  slotValue: unknown;
  source?: string | null;
  expiresAt?: Date | null;
}): Promise<AgentMemorySlot | null> {
  const organizationId = organizationIdValue(input.organizationId);
  const slotKey = input.slotKey.trim();
  if (organizationId === null || !slotKey || !isAllowedMemorySlotKey(slotKey)) {
    return null;
  }
  const scopeType = input.scopeType;
  const scopeId =
    scopeType === "org" ? "" : (input.scopeId || "").trim().slice(0, 64);
  if (scopeType !== "org" && !scopeId) return null;

  const row = await prisma.agentMemory.upsert({
    where: {
      organizationId_scopeType_scopeId_slotKey: {
        organizationId,
        scopeType,
        scopeId,
        slotKey,
      },
    },
    create: {
      organizationId,
      scopeType,
      scopeId,
      slotKey,
      slotValue: input.slotValue as object,
      source: input.source ?? "chat",
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      slotValue: input.slotValue as object,
      source: input.source ?? "chat",
      expiresAt: input.expiresAt ?? null,
    },
  });

  return {
    scopeType: row.scopeType as AgentMemoryScopeType,
    scopeId: row.scopeId,
    slotKey: row.slotKey,
    slotValue: row.slotValue,
    source: row.source,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function clearAgentMemory(input: {
  organizationId: string;
  scopeType: AgentMemoryScopeType;
  scopeId?: string | null;
  slotKey?: string | null;
}): Promise<number> {
  const organizationId = organizationIdValue(input.organizationId);
  if (organizationId === null) return 0;
  const scopeId =
    input.scopeType === "org" ? "" : (input.scopeId || "").trim();
  const where: {
    organizationId: bigint;
    scopeType: string;
    scopeId?: string;
    slotKey?: string;
  } = {
    organizationId,
    scopeType: input.scopeType,
  };
  if (input.scopeType !== "org") {
    if (!scopeId) return 0;
    where.scopeId = scopeId;
  } else {
    where.scopeId = "";
  }
  if (input.slotKey?.trim()) {
    where.slotKey = input.slotKey.trim();
  }
  const result = await prisma.agentMemory.deleteMany({ where });
  return result.count;
}
