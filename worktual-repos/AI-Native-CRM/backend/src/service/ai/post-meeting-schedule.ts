/**
 * Scheduling helpers for the B2B post-meeting process agent.
 * Customer-proposed slot → owner free/busy → book; else propose alternatives.
 */

import {
  findFreeSlots,
  fromLocalDateTimeString,
  isSlotFree,
  toLocalDateTimeString,
} from "@/service/ai/demo-booking";
import { scheduleMeetingCommand } from "@/service/calendar/schedule-meeting-command";
import { runWithRequestUserId } from "@/service/account/request-context";

const DURATION_MINUTES = 30;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Best-effort parse of phrases like "Tuesday at 3pm" / ISO strings into a Date.
 */
export function parseProposedMeetingStart(
  raw: string,
  timeZone: string,
  now = new Date(),
): Date | null {
  const text = raw.trim();
  if (!text) return null;

  // ISO / datetime-local
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    try {
      if (text.includes("T") && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
        return fromLocalDateTimeString(text.slice(0, 19), timeZone);
      }
      const d = new Date(text);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  const tomorrow = text.match(
    /tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (tomorrow) {
    let hour = Number(tomorrow[1]);
    const minute = Number(tomorrow[2] ?? "0");
    const ampm = tomorrow[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (!ampm && hour < 8) hour += 12;
    const day = new Date(now.getTime() + 24 * 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    try {
      return fromLocalDateTimeString(
        `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(hour)}:${pad(minute)}:00`,
        timeZone,
      );
    } catch {
      return null;
    }
  }

  const m = text.match(
    /(?:(next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (m) {
    const wantDow = WEEKDAYS[m[2]!.toLowerCase()]!;
    let hour = Number(m[3]);
    const minute = Number(m[4] ?? "0");
    const ampm = m[5]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (!ampm && hour < 8) hour += 12; // assume afternoon for bare "3"

    const cursor = new Date(now.getTime());
    for (let i = 1; i <= 14; i++) {
      const candidate = new Date(cursor.getTime() + i * 24 * 60 * 60_000);
      if (candidate.getDay() !== wantDow) continue;
      if (m[1] && i < 7) continue; // "next" → at least a week out when ambiguous
      const pad = (n: number) => String(n).padStart(2, "0");
      const y = candidate.getFullYear();
      const mo = candidate.getMonth() + 1;
      const d = candidate.getDate();
      // Use wall clock in owner TZ via fromLocalDateTimeString
      try {
        return fromLocalDateTimeString(
          `${y}-${pad(mo)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00`,
          timeZone,
        );
      } catch {
        return null;
      }
    }
  }

  const probe = Date.parse(text);
  if (Number.isFinite(probe)) return new Date(probe);
  return null;
}

export async function tryBookOwnerSlot(input: {
  ownerUserId: string;
  contactId: string;
  start: Date;
  topic?: string;
  timeZone?: string;
  durationMinutes?: number;
}): Promise<
  | { ok: true; booked: true; activityId: string }
  | { ok: true; booked: false; alternatives: Date[]; reason: string }
  | { ok: false; error: string }
> {
  const duration = input.durationMinutes ?? DURATION_MINUTES;
  const timeZone = input.timeZone || "Asia/Kolkata";
  const end = new Date(input.start.getTime() + duration * 60_000);

  if (input.start.getTime() < Date.now() - 60_000) {
    const alternatives = await findFreeSlots({
      mailboxUserId: input.ownerUserId,
      around: new Date(),
      durationMinutes: duration,
      limit: 3,
      timeZone,
    });
    return {
      ok: true,
      booked: false,
      alternatives,
      reason: "Proposed time is in the past",
    };
  }

  const free = await isSlotFree({
    mailboxUserId: input.ownerUserId,
    start: input.start,
    end,
  });

  if (!free) {
    const alternatives = await findFreeSlots({
      mailboxUserId: input.ownerUserId,
      around: input.start,
      durationMinutes: duration,
      limit: 3,
      timeZone,
    });
    return {
      ok: true,
      booked: false,
      alternatives,
      reason: "Owner calendar is busy",
    };
  }

  const whenLocal = toLocalDateTimeString(input.start, timeZone);
  const result = await runWithRequestUserId(input.ownerUserId, () =>
    scheduleMeetingCommand({
      contactId: input.contactId,
      when: whenLocal.slice(0, 16),
      whenIso: input.start.toISOString(),
      timeZone,
      topic: input.topic || "Follow-up meeting",
      durationMinutes: duration,
      meetingProvider: "google_meet",
    }),
  );

  if (!result.ok) {
    const alternatives = await findFreeSlots({
      mailboxUserId: input.ownerUserId,
      around: input.start,
      durationMinutes: duration,
      limit: 3,
      timeZone,
    });
    return {
      ok: true,
      booked: false,
      alternatives,
      reason: result.error,
    };
  }

  return { ok: true, booked: true, activityId: result.id };
}

export function formatSlotLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
