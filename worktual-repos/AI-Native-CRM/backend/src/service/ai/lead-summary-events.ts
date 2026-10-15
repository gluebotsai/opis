/**
 * In-process pub/sub so SSE clients refresh when a lead's timeline changes
 * (new call, meeting, note, email) and the autonomous summary should update.
 * Same Node process as the app (dev / single instance).
 */

export type LeadSummaryEventPayload = {
  contactId: string;
  reason?: string;
};

type Listener = (payload: LeadSummaryEventPayload) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeLeadSummaryEvents(
  contactId: string,
  listener: Listener,
): () => void {
  const key = contactId.trim();
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

export function publishLeadSummaryEvent(payload: LeadSummaryEventPayload): void {
  const set = listeners.get(payload.contactId.trim());
  if (!set?.size) return;
  for (const listener of [...set]) {
    try {
      listener(payload);
    } catch (err) {
      console.error("lead summary event listener failed", err);
    }
  }
}
