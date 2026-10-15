import { AppError } from "./response-builders.js";
import {
  DEFAULT_LAUNCH_TIMEZONE,
  utcFromLocalParts,
} from "./campaign-timezone.js";

/** Past send_at within this window is treated as send now. Older past is 400. */
export const PERSONALISED_CRM_PAST_SLACK_MS = 2 * 60 * 1000;

export type PersonalisedCrmSendAtResolved = {
  sendAt: Date;
  timezone: string;
  scheduleMode: "now" | "at";
  status: "live" | "scheduled";
};

function parseSendAtInstant(
  raw: string,
  timezone: string,
): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso);

  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?::\d{2})?$/.exec(
    trimmed,
  );
  if (local) {
    return utcFromLocalParts(local[1], local[2], timezone);
  }
  return null;
}

/**
 * Missing send_at → now.
 * Future → scheduled at that instant.
 * Past within 2 minutes → send now.
 * Older past → 400.
 */
export function resolvePersonalisedCrmSendAt(input: {
  send_at?: string | null;
  timezone?: string | null;
  now?: Date;
}): PersonalisedCrmSendAtResolved {
  const timezone =
    String(input.timezone || "").trim() || DEFAULT_LAUNCH_TIMEZONE;
  const now = input.now && !Number.isNaN(input.now.getTime())
    ? input.now
    : new Date();
  const raw = String(input.send_at || "").trim();
  if (!raw) {
    return {
      sendAt: now,
      timezone,
      scheduleMode: "now",
      status: "live",
    };
  }

  const parsed = parseSendAtInstant(raw, timezone);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new AppError(
      "send_at must be an ISO timestamp or YYYY-MM-DD HH:mm in the given timezone.",
      400,
    );
  }

  const delta = parsed.getTime() - now.getTime();
  if (delta < -PERSONALISED_CRM_PAST_SLACK_MS) {
    throw new AppError(
      "send_at is in the past. Use a future time, omit send_at to send now, or send within two minutes of now.",
      400,
    );
  }

  if (delta > 5_000) {
    return {
      sendAt: parsed,
      timezone,
      scheduleMode: "at",
      status: "scheduled",
    };
  }

  return {
    sendAt: now,
    timezone,
    scheduleMode: "now",
    status: "live",
  };
}
