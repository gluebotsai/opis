import type { PrismaClient } from "@ai-contact-center/db-cc";
import { z } from "zod";

import { type DbClient, withOrganizationContext } from "../lib/rls.js";
import { serializeEntityId } from "../lib/id-schema.js";

export const presenceStateSchema = z.enum([
  "offline",
  "ready",
  "not_ready",
  "break",
  "away",
  "busy",
  "after_contact_work",
]);

export type PresenceState = z.infer<typeof presenceStateSchema>;

const updatePresenceSchema = z.object({
  state: presenceStateSchema,
  reasonCode: z.string().optional(),
  source: z.string().optional().default("agent"),
  isVoiceCallTransfer: z.boolean().optional(),
});

type PresenceRow = {
  agent_id: string;
  organization_id: string;
  status: string;
  presence_state: string;
  reason_code: string | null;
  heartbeat_at: Date | null;
  lease_expires_at: Date | null;
  source: string;
  updated_at: Date;
  version: number;
};

export type AgentPresenceRecord = {
  agentId: string;
  organizationId: string;
  state: PresenceState;
  reasonCode: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
  version: number;
};

export function shouldPublishPresenceToUmn(
  source: string,
  userId: string | null | undefined,
): userId is string {
  return source !== "umn" && Boolean(userId);
}

function mapPresence(row: PresenceRow): AgentPresenceRecord {
  return {
    agentId: String(row.agent_id),
    organizationId: String(row.organization_id),
    state: (row.presence_state || row.status) as PresenceState,
    reasonCode: row.reason_code,
    heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

async function loadPresenceFromDb(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<PresenceRow | null> {
  const rows = await db.$queryRaw<PresenceRow[]>`
    SELECT * FROM ccass.agent_presence
    WHERE agent_id = ${agentId}::bigint AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function resolveUserId(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ setup_user_id: string | bigint | null }[]>`
    SELECT setup_user_id FROM ccass.agents
    WHERE id = ${agentId}::bigint AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const userId = rows[0]?.setup_user_id;
  return userId == null ? null : serializeEntityId(userId);
}

/** Postgres is authoritative; Redis pub/sub only transports presence intents. */
export async function resolveAgentPresenceState(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<PresenceState | null> {
  const row = await loadPresenceFromDb(db, organizationId, agentId);
  if (!row) return null;
  return (row.presence_state || row.status) as PresenceState;
}

async function waitForUmnPresence(
  db: DbClient,
  organizationId: string,
  agentId: string,
  state: PresenceState,
): Promise<AgentPresenceRecord> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = await loadPresenceFromDb(db, organizationId, agentId);
    if (row && (row.presence_state || row.status) === state) return mapPresence(row);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn("[presence] ack.timeout", { organizationId, agentId, state });
  throw Object.assign(new Error("Presence update was not acknowledged by UMN"), { status: 504 });
}

const PRESENCE_ACK_RETRY_LIMIT = 8;
const PRESENCE_ACK_RETRY_MS = 1000;

type PresenceAckJob = {
  generation: number;
  timer: ReturnType<typeof setTimeout>;
};

const presenceAckJobs = new Map<string, PresenceAckJob>();
let presenceAckGeneration = 0;

/** Keep republishing a voice/toolbar/login state until UMN stores it. */
export function shouldRetryUnackedPresence(input: {
  requested: string;
  stored: string | null;
  attempt: number;
}): boolean {
  if (input.attempt >= PRESENCE_ACK_RETRY_LIMIT) return false;
  return input.stored !== input.requested;
}

/** The badge shows the stored row. A requested state that is not stored is not shown. */
export function clientPresenceState(input: {
  requested: string;
  stored: string | null;
}): string | null {
  return input.stored;
}

/** A newer publish for the same agent cancels an older retry. */
export function presenceAckIsCurrent(input: {
  activeGeneration: number;
  tickGeneration: number;
}): boolean {
  return input.activeGeneration === input.tickGeneration;
}

function presenceAckKey(organizationId: string, agentId: string): string {
  return `${organizationId}:${agentId}`;
}

function cancelPresenceAck(organizationId: string, agentId: string): void {
  const key = presenceAckKey(organizationId, agentId);
  const existing = presenceAckJobs.get(key);
  if (!existing) return;
  clearTimeout(existing.timer);
  presenceAckJobs.delete(key);
}

function schedulePresenceAckRetry(
  prisma: PrismaClient,
  organizationId: string,
  agentId: string,
  userId: string,
  state: PresenceState,
  options: {
    isVoiceCallTransfer?: boolean;
    reasonCode?: string | null;
    source?: string;
    onAck?: (presence: AgentPresenceRecord) => void;
  },
): void {
  const key = presenceAckKey(organizationId, agentId);
  cancelPresenceAck(organizationId, agentId);
  const generation = ++presenceAckGeneration;
  let attempt = 0;

  const tick = async () => {
    const active = presenceAckJobs.get(key);
    if (!presenceAckIsCurrent({ activeGeneration: active?.generation ?? -1, tickGeneration: generation })) {
      return;
    }
    attempt += 1;
    let reschedule = false;
    let acked: AgentPresenceRecord | null = null;
    await withOrganizationContext(prisma, organizationId, async (db) => {
      const stillCurrent = presenceAckJobs.get(key);
      if (
        !presenceAckIsCurrent({
          activeGeneration: stillCurrent?.generation ?? -1,
          tickGeneration: generation,
        })
      ) {
        return;
      }
      const saved = await loadPresenceFromDb(db, organizationId, agentId);
      const stored = saved?.presence_state || saved?.status || null;
      if (!shouldRetryUnackedPresence({ requested: state, stored, attempt })) {
        if (presenceAckJobs.get(key)?.generation === generation) {
          presenceAckJobs.delete(key);
        }
        if (stored === state && saved) {
          console.info("[presence] acked", {
            organizationId,
            agentId,
            userId,
            state,
            source: options.source ?? "agent",
            attempt,
          });
          acked = mapPresence(saved);
        }
        return;
      }
      if (presenceAckJobs.get(key)?.generation !== generation) return;
      const { publishAgentPresenceToUmn } = await import("./umn-presence.js");
      await publishAgentPresenceToUmn(db, organizationId, userId, state, {
        isVoiceCallTransfer: options.isVoiceCallTransfer,
        reasonCode: options.reasonCode,
        source: options.source,
      });
      reschedule = true;
    });
    if (acked) options.onAck?.(acked);
    if (!reschedule) return;
    if (presenceAckJobs.get(key)?.generation !== generation) return;
    presenceAckJobs.set(key, {
      generation,
      timer: setTimeout(() => {
        void tick().catch((error) => {
          if (presenceAckJobs.get(key)?.generation === generation) presenceAckJobs.delete(key);
          console.warn("[presence] ack.retry-failed", {
            organizationId,
            agentId,
            state,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, PRESENCE_ACK_RETRY_MS),
    });
  };

  presenceAckJobs.set(key, {
    generation,
    timer: setTimeout(() => {
      void tick().catch((error) => {
        if (presenceAckJobs.get(key)?.generation === generation) presenceAckJobs.delete(key);
        console.warn("[presence] ack.retry-failed", {
          organizationId,
          agentId,
          state,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, PRESENCE_ACK_RETRY_MS),
  });
}

/** Publish an intent; UMN is the sole writer of ccass.agent_presence. */
export async function setAgentPresenceByAgentId(
  db: DbClient,
  organizationId: string,
  agentId: string,
  state: PresenceState,
  options: {
    userId?: string | null;
    reasonCode?: string | null;
    source?: string;
    isVoiceCallTransfer?: boolean;
    forcePublish?: boolean;
    prisma?: PrismaClient;
    onAck?: (presence: AgentPresenceRecord) => void;
  } = {},
): Promise<AgentPresenceRecord> {
  const userId = options.userId ?? (await resolveUserId(db, organizationId, agentId));
  if (!userId) {
    throw Object.assign(new Error("Agent has no setup user for presence publication"), {
      status: 409,
    });
  }
  cancelPresenceAck(organizationId, agentId);
  const current = await loadPresenceFromDb(db, organizationId, agentId);
  if (
    !options.forcePublish &&
    current &&
    (current.presence_state || current.status) === state
  ) {
    console.info("[presence] unchanged", {
      organizationId,
      agentId,
      userId,
      state,
      source: options.source ?? "agent",
    });
    return mapPresence(current);
  }
  const { publishAgentPresenceToUmn } = await import("./umn-presence.js");
  await publishAgentPresenceToUmn(db, organizationId, userId, state, {
    isVoiceCallTransfer: options.isVoiceCallTransfer,
    reasonCode: options.reasonCode,
    source: options.source,
  });
  if (options.forcePublish) {
    const saved = await loadPresenceFromDb(db, organizationId, agentId);
    if (saved && (saved.presence_state || saved.status) === state) return mapPresence(saved);
    console.info("[presence] sent to ACD, row not stored yet", {
      organizationId,
      agentId,
      userId,
      state,
      source: options.source ?? "agent",
      storedState: saved?.presence_state || saved?.status || null,
    });
    const stored = saved ?? current;
    if (options.prisma) {
      schedulePresenceAckRetry(options.prisma, organizationId, agentId, userId, state, {
        isVoiceCallTransfer: options.isVoiceCallTransfer,
        reasonCode: options.reasonCode,
        source: options.source,
        onAck: options.onAck,
      });
    }
    if (stored) return mapPresence(stored);
    throw Object.assign(new Error("Presence update was not acknowledged by UMN"), { status: 504 });
  }
  return waitForUmnPresence(db, organizationId, agentId, state);
}

export async function getAgentPresenceForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<AgentPresenceRecord | null> {
  const rows = await db.$queryRaw<PresenceRow[]>`
    SELECT ap.*
    FROM ccass.agent_presence ap
    INNER JOIN ccass.agents a ON a.id = ap.agent_id
    WHERE a.organization_id = ${organizationId}::bigint
      AND a.setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  return rows[0] ? mapPresence(rows[0]) : null;
}

export async function getAgentPresenceByAgentId(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<AgentPresenceRecord | null> {
  const row = await loadPresenceFromDb(db, organizationId, agentId);
  return row ? mapPresence(row) : null;
}

export async function updateAgentPresence(
  db: DbClient,
  organizationId: string,
  userId: string,
  input: z.infer<typeof updatePresenceSchema>,
  hooks: {
    prisma?: PrismaClient;
    onAck?: (presence: AgentPresenceRecord) => void;
  } = {},
): Promise<AgentPresenceRecord> {
  const payload = updatePresenceSchema.parse(input);

  if (payload.state === "not_ready" && !payload.reasonCode) {
    throw Object.assign(new Error("Not Ready requires a reason code"), { status: 400 });
  }

  const agentRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agent = agentRows[0];
  if (!agent) {
    throw Object.assign(new Error("Agent profile not found"), { status: 403 });
  }

  return setAgentPresenceByAgentId(
    db,
    organizationId,
    serializeEntityId(agent.id),
    payload.state,
    {
      userId,
      source: payload.source ?? "agent",
      isVoiceCallTransfer: payload.isVoiceCallTransfer,
      reasonCode: payload.reasonCode,
      forcePublish:
        payload.source === "toolbar" || payload.source === "voice" || payload.source === "login",
      prisma: hooks.prisma,
      onAck: hooks.onAck,
    },
  );
}

export async function heartbeatAgentPresence(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<AgentPresenceRecord | null> {
  return getAgentPresenceForUser(db, organizationId, userId);
}

export { updatePresenceSchema };
