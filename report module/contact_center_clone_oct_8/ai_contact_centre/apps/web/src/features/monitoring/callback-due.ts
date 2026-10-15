export const CALLBACK_DUE_PRESETS = ["1h", "4h", "eod", "tomorrow", "custom"] as const;
export type CallbackDuePreset = (typeof CALLBACK_DUE_PRESETS)[number];

export const DEFAULT_CALLBACK_DUE_PRESET: CallbackDuePreset = "4h";
export const FALLBACK_QUEUE_CLOSE_TIME = "18:00";

export const CALLBACK_DUE_OPTIONS: Array<{ id: Exclude<CallbackDuePreset, "custom">; label: string }> = [
  { id: "1h", label: "In 1 hour" },
  { id: "4h", label: "In 4 hours" },
  { id: "eod", label: "Today EOD" },
  { id: "tomorrow", label: "Tomorrow 10:00" },
];

export function parseClock(value: string | null | undefined): { hours: number; minutes: number } {
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

export function resolveQueueCloseAt(
  now: Date,
  closeTime: string | null | undefined,
): { dueAt: Date; usedQueueClose: boolean } {
  const usedQueueClose = Boolean(closeTime?.trim());
  const { hours, minutes } = parseClock(closeTime?.trim() || FALLBACK_QUEUE_CLOSE_TIME);
  const todayClose = atLocalTime(now, hours, minutes);
  if (todayClose.getTime() > now.getTime()) {
    return { dueAt: todayClose, usedQueueClose };
  }
  return { dueAt: addDays(todayClose, 1), usedQueueClose };
}

export function resolveCallbackDueAt(
  preset: CallbackDuePreset,
  input: {
    now?: Date;
    closeTime?: string | null;
    customValue?: string | null;
  } = {},
): Date | null {
  const now = input.now ?? new Date();
  if (preset === "1h") {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (preset === "4h") {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  }
  if (preset === "eod") {
    return resolveQueueCloseAt(now, input.closeTime).dueAt;
  }
  if (preset === "tomorrow") {
    return atLocalTime(addDays(now, 1), 10, 0);
  }
  const custom = input.customValue?.trim();
  if (!custom) return null;
  const parsed = new Date(custom);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function toDatetimeLocalValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatCallbackDuePreview(
  dueAt: Date | null,
  options: { preset?: CallbackDuePreset; usedQueueClose?: boolean } = {},
): string {
  if (!dueAt) return "Pick a date and time";
  const formatted = dueAt.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  if (options.preset === "eod" && options.usedQueueClose) {
    return `Due ${formatted} (queue close)`;
  }
  return `Due ${formatted}`;
}
