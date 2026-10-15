/**
 * In-process + optional Redis pub/sub for live meeting assist SSE / WS clients.
 *
 * Per-viewer isolation: every event is published on a partitioned
 * `(sessionId, viewerKey)` channel, not just `sessionId`. `viewerKey`
 * defaults to the broadcast pseudo-viewer `"*"` — today's single-shared-panel
 * flow is unchanged (every connected viewer subscribes to `"*"` in addition
 * to their own resolved viewer id). A future targeted publish (e.g. Internal
 * Meeting Assist role-based delivery) passes a specific `viewerId`, and only
 * that one viewer's subscription — server-side, never a client-side filter
 * on a multiplexed payload — ever receives it. See docs/... SSE isolation
 * plan: this is purely additive plumbing, no consumer yet.
 */

import type { LiveAssistLatencyTrace } from "@/lib/meeting-assist-latency";
import type { AssistResult } from "@/service/ai/meeting-assist";
import {
  getRedisSubscriber,
  isRedisConfigured,
  meetingAssistLiveChannel,
  redisPublish,
} from "@/lib/redis";
import { appendMeetingAssistChatHistory } from "@/service/ai/meeting-assist-chat-history";

export type MeetingAssistLiveEvent =
  | {
      type: "chunk";
      seq: number;
      speaker: string | null;
      speakerKey?: string | null;
      attendeeRole?: string | null;
      text: string;
      /** False while Whisper is still revising this utterance. */
      completed?: boolean;
      latency?: LiveAssistLatencyTrace | null;
      latencyDetail?: string | null;
    }
  | {
      type: "assist";
      result: AssistResult & { query?: string | null };
      latency?: LiveAssistLatencyTrace | null;
      latencyDetail?: string | null;
    }
  | { type: "status"; status: string; message?: string }
  | { type: "stt_partial"; text: string };

type Listener = (event: MeetingAssistLiveEvent) => void;

/** Broadcast pseudo-viewer — every connected viewer always listens on this. */
const BROADCAST_VIEWER_KEY = "*";

const listeners = new Map<string, Set<Listener>>();
const INSTANCE_ID = `pid-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const redisSubscribed = new Set<string>();
let redisBridgeReady = false;

type RedisEnvelope = {
  origin: string;
  event: MeetingAssistLiveEvent;
};

function partitionKey(sessionId: string, viewerKey: string): string {
  return `${sessionId.trim()}:${viewerKey.trim() || BROADCAST_VIEWER_KEY}`;
}

function ensureRedisBridge(): void {
  if (redisBridgeReady || !isRedisConfigured()) return;
  const sub = getRedisSubscriber();
  if (!sub) return;
  redisBridgeReady = true;

  sub.on("message", (channel, message) => {
    if (!channel.startsWith("meeting-assist:live:")) return;
    // Channel shape: meeting-assist:live:<sessionId>:<viewerKey>
    const key = channel.slice("meeting-assist:live:".length);
    try {
      const envelope = JSON.parse(message) as RedisEnvelope;
      if (!envelope?.event || envelope.origin === INSTANCE_ID) return;
      dispatchLocal(key, envelope.event);
    } catch {
      /* ignore bad payloads */
    }
  });
}

function dispatchLocal(key: string, event: MeetingAssistLiveEvent): void {
  const set = listeners.get(key);
  if (!set?.size) return;
  for (const listener of [...set]) {
    try {
      listener(event);
    } catch (err) {
      console.error("meeting assist event listener failed", err);
    }
  }
}

async function ensureChannelSubscription(
  sessionId: string,
  viewerKey: string,
): Promise<void> {
  ensureRedisBridge();
  const sub = getRedisSubscriber();
  if (!sub) return;
  const channel = meetingAssistLiveChannel(sessionId, viewerKey);
  if (redisSubscribed.has(channel)) return;
  redisSubscribed.add(channel);
  try {
    await sub.subscribe(channel);
  } catch (err) {
    redisSubscribed.delete(channel);
    console.warn("Redis subscribe failed", err);
  }
}

function subscribeOne(
  sessionId: string,
  viewerKey: string,
  listener: Listener,
): () => void {
  const key = partitionKey(sessionId, viewerKey);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  void ensureChannelSubscription(sessionId, viewerKey);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

/**
 * Subscribe one connected viewer. Always listens on the shared broadcast
 * channel (today's behavior); additionally listens on their own resolved
 * `viewerId` channel when provided, so a future targeted publish reaches
 * only them — never every viewer on the session.
 */
export function subscribeMeetingAssistEvents(
  sessionId: string,
  listener: Listener,
  options?: { viewerId?: string | null },
): () => void {
  const unsubBroadcast = subscribeOne(sessionId, BROADCAST_VIEWER_KEY, listener);
  const viewerId = options?.viewerId?.trim();
  const unsubViewer =
    viewerId && viewerId !== BROADCAST_VIEWER_KEY
      ? subscribeOne(sessionId, viewerId, listener)
      : null;
  return () => {
    unsubBroadcast();
    unsubViewer?.();
  };
}

/**
 * Publish a live event. Omit `viewerId` for today's shared-panel broadcast
 * (every connected viewer receives it, unchanged behavior). Pass a specific
 * `viewerId` to target only that one attendee's panel — filtering happens
 * here, server-side, before anything is written to a socket.
 */
export function publishMeetingAssistEvent(
  sessionId: string,
  event: MeetingAssistLiveEvent,
  options?: { viewerId?: string | null },
): void {
  const viewerKey = options?.viewerId?.trim() || BROADCAST_VIEWER_KEY;
  const key = partitionKey(sessionId, viewerKey);
  if (event.type === "chunk" || event.type === "assist") {
    void appendMeetingAssistChatHistory(sessionId, viewerKey, event);
  }
  dispatchLocal(key, event);

  const envelope: RedisEnvelope = { origin: INSTANCE_ID, event };
  void redisPublish(
    meetingAssistLiveChannel(sessionId, viewerKey),
    JSON.stringify(envelope),
  );
}
