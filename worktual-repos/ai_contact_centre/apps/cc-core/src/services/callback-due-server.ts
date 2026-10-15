const FALLBACK_QUEUE_CLOSE_TIME = "18:00";

function parseClock(value: string | null | undefined): { hours: number; minutes: number } {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return { hours: 18, minutes: 0 };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) {
    return { hours: 18, minutes: 0 };
  }
  return { hours, minutes };
}

function atLocalTime(base: Date, hours: number, minutes: number): Date {
  const next = new Date(base);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function resolveDefaultCallbackDueAt(
  now: Date,
  closeTime: string | null | undefined,
): Date {
  const { hours, minutes } = parseClock(closeTime?.trim() || FALLBACK_QUEUE_CLOSE_TIME);
  const todayClose = atLocalTime(now, hours, minutes);
  if (todayClose.getTime() > now.getTime()) {
    return todayClose;
  }
  return addDays(todayClose, 1);
}

export function resolveCallbackDuePreset(
  preset: "1h" | "4h" | "eod",
  now: Date,
  closeTime: string | null | undefined,
): Date {
  if (preset === "1h") {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (preset === "4h") {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  }
  return resolveDefaultCallbackDueAt(now, closeTime);
}
