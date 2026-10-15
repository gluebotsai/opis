import type { LiveAssistLatencyTrace } from "@/lib/meeting-assist-latency";

const bySession = new Map<string, LiveAssistLatencyTrace>();

export function stashLiveLatencyTrace(
  sessionId: string,
  trace: LiveAssistLatencyTrace,
): void {
  bySession.set(sessionId, trace);
}

export function takeLiveLatencyTrace(sessionId: string): LiveAssistLatencyTrace | null {
  const hit = bySession.get(sessionId) ?? null;
  return hit;
}

export function clearLiveLatencyTrace(sessionId: string): void {
  bySession.delete(sessionId);
}
