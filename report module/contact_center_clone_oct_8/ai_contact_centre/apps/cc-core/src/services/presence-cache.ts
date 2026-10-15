import type { Redis } from "ioredis";

import {
  presenceAgentKey,
  presenceLeaseKey,
  presenceOrgAgentsSetKey,
  presenceReadySetKey,
  presenceUserKey,
} from "../lib/redis-keys.js";
import { getRedisClient } from "../lib/redis-client.js";
import type { AgentPresenceRecord, PresenceState } from "./presence.js";

export type CachedAgentPresence = AgentPresenceRecord & {
  userId: string | null;
  leaseExpiresAt: string | null;
  source: string;
};

const DEFAULT_LEASE_SECONDS = Number(process.env.PRESENCE_LEASE_SECONDS ?? 90);

function client(): Redis | null {
  return getRedisClient();
}

function isReadyState(state: PresenceState): boolean {
  return state === "ready";
}

/**
 * Offer / live-channel eligibility historically used ready|busy.
 * Prefer {@link isPresenceEligibleForChannel} for routing.
 * Kept as ready-only so drain-on-available for ringing channels stays correct.
 */
export function isRoutablePresenceState(state: PresenceState | string | null | undefined): boolean {
  return state === "ready";
}

/** Logged-in agents (any non-offline presence) can receive email under capacity. */
export function isLoggedInPresenceState(state: PresenceState | string | null | undefined): boolean {
  return Boolean(state) && state !== "offline";
}

/** All routing requires Ready presence; capacity is checked separately per channel. */
export function isPresenceEligibleForChannel(
  _channel: string,
  state: PresenceState | string | null | undefined,
): boolean {
  return state === "ready" || state === "available";
}

function isLeaseExpired(leaseExpiresAt: string | null): boolean {
  if (!leaseExpiresAt) return false;
  return Date.parse(leaseExpiresAt) <= Date.now();
}

export function effectivePresenceState(presence: CachedAgentPresence): PresenceState {
  if (isReadyState(presence.state) && isLeaseExpired(presence.leaseExpiresAt)) {
    return "offline";
  }
  return presence.state;
}

/** Write Redis first. Throws if Redis is configured and the write fails. */
export async function cacheAgentPresence(
  presence: CachedAgentPresence,
  options?: { leaseSeconds?: number },
): Promise<void> {
  const redis = client();
  if (!redis) return;

  const leaseSeconds = options?.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const agentKey = presenceAgentKey(presence.organizationId, presence.agentId);
  const payload = JSON.stringify(presence);

  const pipeline = redis.pipeline();
  pipeline.set(agentKey, payload);
  pipeline.sadd(presenceOrgAgentsSetKey(presence.organizationId), presence.agentId);

  if (presence.userId) {
    pipeline.set(presenceUserKey(presence.organizationId, presence.userId), presence.agentId);
  }

  const effectiveState = effectivePresenceState(presence);
  if (isReadyState(effectiveState)) {
    pipeline.sadd(presenceReadySetKey(presence.organizationId), presence.agentId);
    pipeline.set(
      presenceLeaseKey(presence.organizationId, presence.agentId),
      presence.leaseExpiresAt ?? new Date(Date.now() + leaseSeconds * 1000).toISOString(),
      "EX",
      leaseSeconds,
    );
  } else {
    pipeline.srem(presenceReadySetKey(presence.organizationId), presence.agentId);
    pipeline.del(presenceLeaseKey(presence.organizationId, presence.agentId));
  }

  const results = await pipeline.exec();
  if (!results) {
    throw new Error("Redis presence write failed");
  }
  for (const [error] of results) {
    if (error) {
      throw error instanceof Error ? error : new Error("Redis presence write failed");
    }
  }
}

export async function getCachedAgentPresence(
  organizationId: string,
  agentId: string,
): Promise<CachedAgentPresence | null> {
  const redis = client();
  if (!redis) return null;

  const raw = await redis.get(presenceAgentKey(organizationId, agentId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CachedAgentPresence;
    return {
      ...parsed,
      state: effectivePresenceState(parsed),
    };
  } catch {
    return null;
  }
}

export async function getCachedAgentPresenceByUserId(
  organizationId: string,
  userId: string,
): Promise<CachedAgentPresence | null> {
  const redis = client();
  if (!redis) return null;

  const agentId = await redis.get(presenceUserKey(organizationId, userId));
  if (!agentId) return null;
  return getCachedAgentPresence(organizationId, agentId);
}

export async function refreshPresenceLease(
  _organizationId: string,
  _agentId: string,
  presence: CachedAgentPresence,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<CachedAgentPresence> {
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const updated: CachedAgentPresence = {
    ...presence,
    heartbeatAt: new Date().toISOString(),
    leaseExpiresAt,
  };
  await cacheAgentPresence(updated, { leaseSeconds });
  return updated;
}

export async function isAgentReadyInCache(
  organizationId: string,
  agentId: string,
): Promise<boolean> {
  const redis = client();
  if (!redis) return false;

  const inSet = await redis.sismember(presenceReadySetKey(organizationId), agentId);
  if (!inSet) return false;

  const presence = await getCachedAgentPresence(organizationId, agentId);
  return presence !== null && isReadyState(effectivePresenceState(presence));
}

export async function isAgentRoutableInCache(
  organizationId: string,
  agentId: string,
  channel: string = "chat",
): Promise<boolean> {
  const presence = await getCachedAgentPresence(organizationId, agentId);
  if (!presence) return false;
  return isPresenceEligibleForChannel(channel, effectivePresenceState(presence));
}

export async function listReadyAgentIds(organizationId: string): Promise<string[]> {
  const redis = client();
  if (!redis) return [];

  const agentIds = await redis.smembers(presenceReadySetKey(organizationId));
  const ready: string[] = [];

  for (const agentId of agentIds) {
    if (await isAgentReadyInCache(organizationId, agentId)) {
      ready.push(agentId);
    }
  }

  return ready;
}

export async function listCachedOrgPresence(
  organizationId: string,
): Promise<CachedAgentPresence[]> {
  const redis = client();
  if (!redis) return [];

  const agentIds = await redis.smembers(presenceOrgAgentsSetKey(organizationId));
  const results: CachedAgentPresence[] = [];

  for (const agentId of agentIds) {
    const presence = await getCachedAgentPresence(organizationId, agentId);
    if (presence) results.push(presence);
  }

  return results;
}

export function toAgentPresenceRecord(presence: CachedAgentPresence): AgentPresenceRecord {
  return {
    agentId: presence.agentId,
    organizationId: presence.organizationId,
    state: effectivePresenceState(presence),
    reasonCode: presence.reasonCode,
    heartbeatAt: presence.heartbeatAt,
    updatedAt: presence.updatedAt,
    version: presence.version,
  };
}

export async function hydrateAgentPresenceCache(
  organizationId: string,
  agentId: string,
  userId: string | null,
  row: {
    presence_state: string;
    status: string;
    reason_code: string | null;
    heartbeat_at: Date | null;
    lease_expires_at: Date | null;
    updated_at: Date;
    source?: string;
    version?: number;
  },
): Promise<CachedAgentPresence> {
  const cached: CachedAgentPresence = {
    organizationId,
    agentId,
    userId,
    state: (row.presence_state || row.status) as PresenceState,
    reasonCode: row.reason_code,
    heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    version: row.version ?? 0,
    source: row.source ?? "system",
  };
  await cacheAgentPresence(cached);
  return cached;
}
