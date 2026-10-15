/**
 * Agent presence published to ACD and confirmed on the inbound channel.
 * Port of ai_contact_centre/apps/cc-core/src/services/umn-presence.ts.
 * CRM does not write ccass.agents. The badge follows the ACD reply, cached in Redis.
 *
 * Publish, subscribe, and the presence cache use the phone-system Redis
 * (TRANSCRIPT_REDIS_URL, else REDIS_URL). REDIS_URL alone is the CRM cache.
 * A Ready published only there never reaches ACD, so inbound calls and call
 * assist never start even though the badge can show Ready.
 */

import Redis from "ioredis";
import { accountQuery } from "@/dao/db/account-pool";

export type PresenceState = "ready" | "not_ready" | "busy" | "away";

export type AgentPresence = {
  state: PresenceState;
  statusName: string;
  confirmed: boolean;
};

export type PresenceUser = {
  id: string;
  organizationId: string;
  ext: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type PresenceQueue = {
  id: string;
  name: string;
  handlesInbound: boolean;
  handlesOutboundCampaign: boolean;
};

export type PresenceOutboundPayload = {
  ext: string;
  statusName: string;
  UserName: string;
  isVoice: number;
  isVoiceCallTransfer: number;
  domainId: number;
  email: string;
  userId: string;
  inboundCall: number;
  outboundCampaignCall: number;
  is_outbound_campaign_specific_agent: number;
  forced_presence: number;
  quId: string;
  queueName: string;
  isCrm: 1;
};

export type PresenceInbound = {
  domainId: string;
  statusName: string;
  ext: string;
  email: string;
};

const AGENT_STATES = new Set<PresenceState>(["ready", "not_ready", "busy", "away"]);
const SELECTABLE_STATES = new Set<PresenceState>(["ready", "not_ready", "away"]);

type Listener = (presence: AgentPresence) => void;

const listeners = new Map<string, Set<Listener>>();
let publisher: Redis | null = null;
let publisherUrl = "";
let subscriber: Redis | null = null;
let subscriberStarted = false;

/** Phone-system Redis. Same rule as SIP registration and live call captions. */
export function presenceRedisUrl(): string {
  return (
    process.env.TRANSCRIPT_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    ""
  );
}

function redisUrl(): string {
  return presenceRedisUrl();
}

function redisHostLabel(url: string): string {
  try {
    return new URL(url).host || "redis";
  } catch {
    return "redis";
  }
}

function redisOptions() {
  return {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1000)),
  };
}

function getPublisher(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  if (publisher && publisherUrl === url) return publisher;
  if (publisher) publisher.disconnect();
  publisherUrl = url;
  publisher = new Redis(url, redisOptions());
  publisher.on("error", (err) => {
    console.warn("[presence] Redis publish error", err.message);
  });
  return publisher;
}

export function presencePublishChannel(): string {
  return process.env.CRM_AGENT_PRESENCE_PUB?.trim() || "CRM_AGENT_PRESENCE_PUB";
}

export function presenceSubscribeChannel(): string {
  return process.env.CRM_AGENT_PRESENCE_SUB?.trim() || "CRM_AGENT_PRESENCE_SUB";
}

function cacheKey(organizationId: string, userId: string): string {
  return `crm:agent-presence:${organizationId}:${userId}`;
}

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export function isPresenceState(value: string): value is PresenceState {
  return AGENT_STATES.has(value as PresenceState);
}

export function isSelectablePresenceState(value: string): value is PresenceState {
  return SELECTABLE_STATES.has(value as PresenceState);
}

/** 3 = first login, 2 = Ready restored after an interaction, 0 = every other publish. */
export function forcedPresenceCode(source?: string | null, state?: string | null): number {
  if (source === "login") return 3;
  if (
    state === "ready" &&
    (source === "voice" ||
      source === "conversation_ended" ||
      source === "conversation_resolved" ||
      source === "conversation_transferred")
  ) {
    return 2;
  }
  return 0;
}

export function toStatusName(state: string): string {
  if (state === "ready") return "Ready";
  if (state === "not_ready") return "Not Ready";
  if (state === "busy") return "Busy";
  return "Away";
}

export function toPresenceState(statusName: string): PresenceState | null {
  const normalized = statusName
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ");
  if (normalized === "ready") return "ready";
  if (normalized === "not ready" || normalized === "not_ready") return "not_ready";
  if (normalized === "busy") return "busy";
  if (normalized === "away") return "away";
  return null;
}

function flag(value: unknown): number {
  return value === true || value === 1 || value === "1" || value === "t" ? 1 : 0;
}

export function domainIdNumber(organizationId: string): number {
  const asNumber = Number(organizationId);
  return Number.isSafeInteger(asNumber) ? asNumber : 0;
}

export function parseInboundPresence(raw: string): PresenceInbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const domainId = record.domainId == null ? "" : String(record.domainId).trim();
  const statusName = record.statusName == null ? "" : String(record.statusName).trim();
  const ext = record.ext == null ? "" : String(record.ext).trim();
  const email = record.email == null ? "" : String(record.email).trim();
  if (!domainId || !statusName) return null;
  return { domainId, statusName, ext, email };
}

export function buildPresencePayload(input: {
  user: PresenceUser;
  queue: PresenceQueue | null;
  state: string;
  isVoiceCallTransfer?: boolean;
  source?: string;
}): PresenceOutboundPayload {
  const { user, queue, state } = input;
  return {
    ext: user.ext,
    statusName: toStatusName(state),
    UserName: `${user.firstName} ${user.lastName}`.trim(),
    isVoice: state === "ready" ? 1 : 0,
    isVoiceCallTransfer: input.isVoiceCallTransfer ? 1 : 0,
    domainId: domainIdNumber(user.organizationId),
    email: user.email,
    userId: user.id,
    inboundCall: flag(queue?.handlesInbound),
    outboundCampaignCall: flag(queue?.handlesOutboundCampaign),
    is_outbound_campaign_specific_agent: flag(queue?.handlesOutboundCampaign),
    forced_presence: forcedPresenceCode(input.source, state),
    quId: queue?.id ?? "",
    queueName: queue?.name ?? "",
    isCrm: 1,
  };
}

function unconfirmed(): AgentPresence {
  return { state: "not_ready", statusName: "Not Ready", confirmed: false };
}

async function loadUser(userId: string): Promise<PresenceUser | null> {
  const id = userId.trim();
  if (!id) return null;
  const { rows } = await accountQuery<{
    id: string;
    organization_id: string;
    ext: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  }>(
    `SELECT id::text AS id,
            organization_id::text AS organization_id,
            ext::text AS ext,
            lower(work_email) AS email,
            first_name,
            last_name
     FROM accounts.setup_users
     WHERE id = $1::bigint
     LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    ext: row.ext?.trim() ?? "",
    email: row.email?.trim() ?? "",
    firstName: row.first_name?.trim() ?? "",
    lastName: row.last_name?.trim() ?? "",
  };
}

async function loadQueue(userId: string): Promise<PresenceQueue | null> {
  try {
    const { rows } = await accountQuery<{
      id: string;
      name: string | null;
      handles_inbound: unknown;
      handles_outbound_campaign: unknown;
    }>(
      `SELECT q.id::text AS id,
              q.name,
              qa.handles_inbound,
              qa.handles_outbound_campaign
       FROM accounts.setup_ccaas_queue_agents qa
       INNER JOIN accounts.setup_ccaas_queues q ON q.id = qa.queue_id
       WHERE qa.user_id = $1::bigint
       ORDER BY qa.id ASC
       LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name?.trim() ?? "",
      handlesInbound: flag(row.handles_inbound) === 1,
      handlesOutboundCampaign: flag(row.handles_outbound_campaign) === 1,
    };
  } catch (error) {
    console.warn(
      "[presence] queue lookup skipped",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function readCached(user: PresenceUser): Promise<AgentPresence | null> {
  const redis = getPublisher();
  if (!redis) return null;
  const raw = await redis.get(cacheKey(user.organizationId, user.id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: string };
    if (!parsed.state || !isPresenceState(parsed.state)) return null;
    return {
      state: parsed.state,
      statusName: toStatusName(parsed.state),
      confirmed: true,
    };
  } catch {
    return null;
  }
}

async function writeCached(userId: string, organizationId: string, state: PresenceState): Promise<void> {
  const redis = getPublisher();
  if (!redis) return;
  await redis.set(
    cacheKey(organizationId, userId),
    JSON.stringify({ state, statusName: toStatusName(state), updatedAt: new Date().toISOString() }),
  );
}

function notify(userId: string, presence: AgentPresence): void {
  const set = listeners.get(userId);
  if (!set) return;
  for (const listener of set) listener(presence);
}

export function subscribeAgentPresence(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(userId);
  };
}

async function findUserForInbound(inbound: PresenceInbound): Promise<PresenceUser | null> {
  if (inbound.ext) {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT id::text AS id
       FROM accounts.setup_users
       WHERE organization_id = $1::bigint AND ext::text = $2
       LIMIT 1`,
      [inbound.domainId, inbound.ext],
    );
    if (rows[0]) return loadUser(rows[0].id);
  }
  const email = inbound.email.trim().toLowerCase();
  if (!email) return null;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id
     FROM accounts.setup_users
     WHERE organization_id = $1::bigint AND lower(work_email) = $2
     LIMIT 1`,
    [inbound.domainId, email],
  );
  return rows[0] ? loadUser(rows[0].id) : null;
}

export async function applyInboundPresence(raw: string): Promise<void> {
  const inbound = parseInboundPresence(raw);
  if (!inbound) return;
  const state = toPresenceState(inbound.statusName);
  if (!state) return;
  const user = await findUserForInbound(inbound);
  if (!user || user.organizationId !== inbound.domainId) return;
  const presence: AgentPresence = {
    state,
    statusName: toStatusName(state),
    confirmed: true,
  };
  await writeCached(user.id, user.organizationId, state);
  notify(user.id, presence);
  console.info("[presence] ACD confirmed", {
    userId: user.id,
    organizationId: user.organizationId,
    ext: inbound.ext,
    email: inbound.email,
    state,
    statusName: presence.statusName,
  });
}

export function startAgentPresenceSubscriber(): void {
  if (subscriberStarted) return;
  const url = redisUrl();
  if (!url) return;
  subscriberStarted = true;
  subscriber = new Redis(url, redisOptions());
  subscriber.on("error", (err) => {
    console.warn("[presence] Redis subscribe error", err.message);
  });
  const channel = presenceSubscribeChannel();
  void subscriber.subscribe(channel).then(() => {
    console.info("[presence] subscribed", { channel, redis: redisHostLabel(url) });
  });
  subscriber.on("message", (received, message) => {
    if (received !== channel) return;
    void applyInboundPresence(message).catch((error) => {
      console.warn(
        "[presence] inbound apply failed",
        error instanceof Error ? error.message : error,
      );
    });
  });
}

export async function getAgentPresence(userId: string): Promise<AgentPresence> {
  const user = await loadUser(userId);
  if (!user) return unconfirmed();
  return (await readCached(user)) ?? unconfirmed();
}

async function publish(
  userId: string,
  state: PresenceState,
  source: string,
): Promise<AgentPresence> {
  const redis = getPublisher();
  if (!redis) throw fail("Presence is unavailable", 503);
  const user = await loadUser(userId);
  if (!user) throw fail("User not found", 404);
  if (!user.ext) throw fail("This user has no extension", 409);
  const queue = await loadQueue(userId);
  const payload = buildPresencePayload({ user, queue, state, source });
  const channel = presencePublishChannel();
  await redis.publish(channel, JSON.stringify(payload));
  const presence: AgentPresence = {
    state,
    statusName: payload.statusName,
    confirmed: true,
  };
  await writeCached(user.id, user.organizationId, state);
  notify(user.id, presence);
  console.info("[presence] sent to ACD", {
    channel,
    redis: redisHostLabel(redisUrl()),
    organizationId: user.organizationId,
    userId: user.id,
    ext: payload.ext,
    email: user.email,
    state,
    statusName: payload.statusName,
    source,
    forcedPresence: payload.forced_presence,
    isCrm: payload.isCrm,
  });
  return presence;
}

export async function initializeAgentPresence(userId: string): Promise<AgentPresence> {
  return publish(userId, "not_ready", "login");
}

export async function setAgentPresence(
  userId: string,
  state: string,
  source = "toolbar",
): Promise<AgentPresence> {
  if (state === "busy") {
    if (source !== "voice") throw fail("Busy is set while a call is in progress", 400);
    return publish(userId, "busy", source);
  }
  if (!isSelectablePresenceState(state)) throw fail("Unknown presence state", 400);
  return publish(userId, state, source);
}

/** Leave Ready when the CRM session ends. ACD still has to confirm. */
export async function releaseAgentPresence(userId: string): Promise<void> {
  try {
    await publish(userId, "not_ready", "logout");
  } catch (error) {
    console.warn(
      "[presence] logout publish skipped",
      error instanceof Error ? error.message : error,
    );
  }
  const user = await loadUser(userId).catch(() => null);
  const redis = getPublisher();
  if (user && redis) await redis.del(cacheKey(user.organizationId, user.id));
}
