/**
 * DAO for crm.agent_input_fingerprints — skip unchanged LLM cron work.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/dao/db/prisma";

function oid(organizationId: string): bigint {
  return BigInt(organizationId);
}

function newId(): string {
  return `aif_${randomBytes(12).toString("hex")}`;
}

export async function getAgentInputFingerprint(input: {
  organizationId: string;
  agent: string;
  entityType: string;
  entityId: string;
}): Promise<{ inputHash: string; lastLlmAt: Date | null } | null> {
  const row = await prisma.agentInputFingerprint.findUnique({
    where: {
      organizationId_agent_entityType_entityId: {
        organizationId: oid(input.organizationId),
        agent: input.agent,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    select: { inputHash: true, lastLlmAt: true },
  });
  return row
    ? { inputHash: row.inputHash, lastLlmAt: row.lastLlmAt }
    : null;
}

/** Peek-only: compare hash without writing (for pre-LLM gate). */
export async function shouldCallLlmForFingerprint(input: {
  organizationId: string;
  agent: string;
  entityType: string;
  entityId: string;
  inputHash: string;
}): Promise<boolean> {
  const existing = await getAgentInputFingerprint(input);
  if (!existing) return true;
  return existing.inputHash !== input.inputHash;
}

export async function markAgentInputFingerprint(input: {
  organizationId: string;
  agent: string;
  entityType: string;
  entityId: string;
  inputHash: string;
  llmRan: boolean;
}): Promise<void> {
  const now = new Date();
  await prisma.agentInputFingerprint.upsert({
    where: {
      organizationId_agent_entityType_entityId: {
        organizationId: oid(input.organizationId),
        agent: input.agent,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    create: {
      id: newId(),
      organizationId: oid(input.organizationId),
      agent: input.agent,
      entityType: input.entityType,
      entityId: input.entityId,
      inputHash: input.inputHash,
      lastCheckedAt: now,
      lastLlmAt: input.llmRan ? now : null,
    },
    update: {
      inputHash: input.inputHash,
      lastCheckedAt: now,
      ...(input.llmRan ? { lastLlmAt: now } : {}),
    },
  });
}
