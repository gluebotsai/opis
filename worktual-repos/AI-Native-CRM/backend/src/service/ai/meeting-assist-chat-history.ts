/**
 * Short-lived chat history for the Meet side panel.
 *
 * Broadcast customer events and per-viewer internal events are kept separately
 * so targeted answers/fact checks never leak to another attendee. Redis makes
 * history survive API restarts; memory is a local-development fallback.
 */
import { getRedisPublisher } from "@/lib/redis";

export type MeetingAssistHistoryEntry = {
  at: number;
  event: unknown;
};

const MAX_ENTRIES = 100;
const TTL_SECONDS = 12 * 60 * 60;
const BROADCAST = "*";
const memory = new Map<string, MeetingAssistHistoryEntry[]>();

function key(sessionId: string, viewerId: string): string {
  return `meeting-assist:chat:${sessionId.trim()}:${viewerId.trim() || BROADCAST}`;
}

export async function appendMeetingAssistChatHistory(
  sessionId: string,
  viewerId: string | null | undefined,
  event: unknown,
): Promise<void> {
  const storageKey = key(sessionId, viewerId || BROADCAST);
  const entry: MeetingAssistHistoryEntry = { at: Date.now(), event };
  const redis = getRedisPublisher();
  if (redis) {
    try {
      await redis
        .multi()
        .rpush(storageKey, JSON.stringify(entry))
        .ltrim(storageKey, -MAX_ENTRIES, -1)
        .expire(storageKey, TTL_SECONDS)
        .exec();
      return;
    } catch (err) {
      console.warn("meeting assist chat history redis append failed", err);
    }
  }
  const rows = memory.get(storageKey) ?? [];
  rows.push(entry);
  if (rows.length > MAX_ENTRIES) rows.splice(0, rows.length - MAX_ENTRIES);
  memory.set(storageKey, rows);
}

export async function getMeetingAssistChatHistory(
  sessionId: string,
  viewerId: string,
): Promise<MeetingAssistHistoryEntry[]> {
  const keys = [key(sessionId, BROADCAST), key(sessionId, viewerId)];
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const [broadcast, targeted] = await Promise.all(
        keys.map((storageKey) => redis.lrange(storageKey, 0, -1)),
      );
      const parsed = [...broadcast, ...targeted]
        .map((raw) => {
          try {
            return JSON.parse(raw) as MeetingAssistHistoryEntry;
          } catch {
            return null;
          }
        })
        .filter((row): row is MeetingAssistHistoryEntry => Boolean(row));
      if (parsed.length) return parsed.sort((a, b) => a.at - b.at);
    } catch (err) {
      console.warn("meeting assist chat history redis read failed", err);
    }
  }
  return keys
    .flatMap((storageKey) => memory.get(storageKey) ?? [])
    .sort((a, b) => a.at - b.at);
}
