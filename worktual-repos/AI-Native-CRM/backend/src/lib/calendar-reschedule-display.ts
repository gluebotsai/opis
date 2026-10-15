export type RescheduleDisplayEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  meetLink: string | null;
  contactId: string | null;
  contactName?: string | null;
  rescheduled: boolean;
  superseded: boolean;
};

function startMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function minuteKey(iso: string): string {
  const t = startMs(iso);
  if (!t) return iso;
  return String(Math.floor(t / 60_000));
}

function looksLikeMeeting(ev: RescheduleDisplayEvent): boolean {
  if (ev.meetLink) return true;
  if (ev.description?.includes("Provider:")) return true;
  return /^Meeting:/i.test(ev.title) || /demo/i.test(ev.title);
}

function identityKey(ev: RescheduleDisplayEvent): string {
  if (ev.contactId) return `c:${ev.contactId}`;
  const name = ev.contactName?.trim().toLowerCase();
  if (name) return `n:${name}`;
  return `id:${ev.id}`;
}

function slotRank(ev: RescheduleDisplayEvent): number {
  if (ev.superseded) return 3;
  if (ev.rescheduled) return 2;
  return 1;
}

/** One chip per contact+time: prefer Previous/Rescheduled over a duplicate plain invite. */
export function dedupeRescheduleSlots<T extends RescheduleDisplayEvent>(
  events: T[],
): T[] {
  const bySlot = new Map<string, T>();
  for (const ev of events) {
    const key = looksLikeMeeting(ev)
      ? `${identityKey(ev)}|${minuteKey(ev.startAt)}`
      : `id:${ev.id}`;
    const existing = bySlot.get(key);
    if (!existing || slotRank(ev) > slotRank(existing)) {
      bySlot.set(key, ev);
    }
  }
  return [...bySlot.values()].sort(
    (a, b) => startMs(a.startAt) - startMs(b.startAt),
  );
}

/**
 * Preserve CRM reschedule metadata (`Rescheduled: yes`, `:previous` ghosts).
 * Does not infer reschedule from multiple same-day meetings — a follow-up
 * booking after a completed call stays a separate event.
 */
export function applySameDayRescheduleDisplay<T extends RescheduleDisplayEvent>(
  events: T[],
): T[] {
  return dedupeRescheduleSlots(events);
}
