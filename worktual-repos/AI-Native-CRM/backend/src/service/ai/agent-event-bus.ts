import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getRedisPublisher } from "@/lib/redis";

export const AGENT_EVENT_VERSION = "1.0" as const;
export type AgentEventType =
  | "token"
  | "progress"
  | "final"
  | "uiRefresh"
  | "step"
  | "error";

export type AgentStreamEvent = {
  version: typeof AGENT_EVENT_VERSION;
  id: string;
  type: AgentEventType;
  organizationId: string;
  runId: string;
  traceId: string;
  conversationId?: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const instanceId = randomUUID();
const history = new Map<string, AgentStreamEvent[]>();
const subscribedChannels = new Set<string>();
let subscriber: Redis | null = null;

function channel(organizationId: string, runId: string): string {
  return `crm:agent-events:${organizationId}:${runId}`;
}

function historyKey(organizationId: string, runId: string): string {
  return `crm:agent-events-history:${organizationId}:${runId}`;
}

function remember(event: AgentStreamEvent): boolean {
  const key = channel(event.organizationId, event.runId);
  const events = history.get(key) ?? [];
  if (events.some((item) => item.id === event.id)) return false;
  events.push(event);
  history.set(key, events.slice(-200));
  return true;
}

function ensureSubscriber(): Redis | null {
  const url = (process.env.REDIS_URL || "").trim();
  if (!url) return null;
  if (subscriber) return subscriber;
  subscriber = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) =>
      attempt > 3 ? null : Math.min(attempt * 200, 1_000),
  });
  subscriber.on("message", (key, payload) => {
    try {
      const parsed = JSON.parse(payload) as {
        instanceId?: string;
        event?: AgentStreamEvent;
      };
      if (parsed.instanceId === instanceId || !parsed.event) return;
      if (remember(parsed.event)) emitter.emit(key, parsed.event);
    } catch {
      // Invalid pub/sub payloads are ignored and never reflected to clients.
    }
  });
  subscriber.on("error", (error) => {
    console.warn("Agent event Redis subscriber error", error.message);
  });
  return subscriber;
}

export async function publishAgentEvent(
  input: Omit<AgentStreamEvent, "version" | "id" | "occurredAt"> & {
    eventKey?: string;
  },
): Promise<AgentStreamEvent> {
  const { eventKey, ...payload } = input;
  const identity = eventKey || JSON.stringify(payload);
  const id = createHash("sha256")
    .update(`${payload.organizationId}:${payload.runId}:${identity}`)
    .digest("hex")
    .slice(0, 32);
  const event: AgentStreamEvent = {
    version: AGENT_EVENT_VERSION,
    id,
    occurredAt: new Date().toISOString(),
    ...payload,
  };
  const key = channel(event.organizationId, event.runId);
  const redis = getRedisPublisher();
  if (redis) {
    const claimed = await redis
      .set(
        `${historyKey(event.organizationId, event.runId)}:receipt:${id}`,
        instanceId,
        "EX",
        3_600,
        "NX",
      )
      .catch(() => "degraded");
    if (claimed === null) return event;
    if (remember(event)) emitter.emit(key, event);
    const encoded = JSON.stringify(event);
    await redis
      .multi()
      .rpush(historyKey(event.organizationId, event.runId), encoded)
      .ltrim(historyKey(event.organizationId, event.runId), -200, -1)
      .expire(historyKey(event.organizationId, event.runId), 3_600)
      .publish(key, JSON.stringify({ instanceId, event }))
      .exec()
      .catch((error) => {
        console.warn("Agent event Redis publish failed", error);
      });
  } else if (remember(event)) {
    emitter.emit(key, event);
  }
  return event;
}

export async function replayAgentEvents(
  organizationId: string,
  runId: string,
  afterId?: string,
): Promise<AgentStreamEvent[]> {
  let events = history.get(channel(organizationId, runId)) ?? [];
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const encoded = await redis.lrange(historyKey(organizationId, runId), 0, -1);
      const remote = encoded
        .map((item) => {
          try {
            return JSON.parse(item) as AgentStreamEvent;
          } catch {
            return null;
          }
        })
        .filter((item): item is AgentStreamEvent => Boolean(item));
      if (remote.length) events = remote;
    } catch {
      // Local bounded history remains available when Redis is degraded.
    }
  }
  if (!afterId) return [...events];
  const index = events.findIndex((event) => event.id === afterId);
  return index < 0 ? [...events] : events.slice(index + 1);
}

export async function subscribeAgentEvents(
  organizationId: string,
  runId: string,
  listener: (event: AgentStreamEvent) => void,
): Promise<() => void> {
  const key = channel(organizationId, runId);
  emitter.on(key, listener);
  const redis = ensureSubscriber();
  if (redis && !subscribedChannels.has(key)) {
    subscribedChannels.add(key);
    await redis.subscribe(key).catch((error) => {
      subscribedChannels.delete(key);
      console.warn("Agent event Redis subscribe failed", error);
    });
  }
  return () => {
    emitter.off(key, listener);
    if (redis && emitter.listenerCount(key) === 0 && subscribedChannels.delete(key)) {
      void redis.unsubscribe(key);
    }
  };
}

export async function closeAgentEventBus(): Promise<void> {
  emitter.removeAllListeners();
  history.clear();
  subscribedChannels.clear();
  if (subscriber) {
    const current = subscriber;
    subscriber = null;
    await current.quit().catch(() => current.disconnect());
  }
}
