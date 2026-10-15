/**
 * CDP customer_profile.preferences_json — 0/1 channel map + optional windows.
 * Matches agents/app/contacts/channel_preferences.py
 *
 * Flat flags (audience SQL): { email, whatsapp, push, web, sms } each 0 | 1.
 * Optional extras: timezone, timing, channel_timing.
 */

import {
  parseChannelTiming,
  parseSendWindow,
  safeTimezone,
} from "./contact-preference-timing.js";

export const PREFERENCE_CHANNELS = [
  "email",
  "whatsapp",
  "push",
  "web",
  "sms",
] as const;

export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

export type ChannelPreferences = Record<PreferenceChannel, 0 | 1>;

export type ContactPreferencesJson = ChannelPreferences & {
  timezone?: string;
  timing?: { days: string[]; start: string; end: string };
  channel_timing?: Record<
    string,
    { days: string[]; start: string; end: string }
  >;
};

const TIE_BREAK: PreferenceChannel[] = [
  "whatsapp",
  "email",
  "push",
  "web",
  "sms",
];

export function emptyPreferences(): ChannelPreferences {
  return {
    email: 0,
    whatsapp: 0,
    push: 0,
    web: 0,
    sms: 0,
  };
}

function asFlag(value: unknown): 0 | 1 {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value == null) return 0;
  if (typeof value === "number" && value === 1) return 1;
  const text = String(value).trim().toLowerCase();
  if (text === "1" || text === "true" || text === "yes") return 1;
  return 0;
}

function channelFlags(raw: Record<string, unknown>): ChannelPreferences {
  const out = emptyPreferences();
  const hasFlat = PREFERENCE_CHANNELS.some((c) => c in raw);
  const nested =
    !hasFlat &&
    raw.channels &&
    typeof raw.channels === "object" &&
    !Array.isArray(raw.channels)
      ? (raw.channels as Record<string, unknown>)
      : raw;

  for (const channel of PREFERENCE_CHANNELS) {
    if (channel in nested) {
      out[channel] = asFlag(nested[channel]);
      continue;
    }
    if (channel === "push") {
      if ("app_push" in nested) out.push = asFlag(nested.app_push);
      else if ("apppush" in nested) out.push = asFlag(nested.apppush);
    } else if (channel === "web") {
      if ("web_push" in nested) out.web = asFlag(nested.web_push);
      else if ("webpush" in nested) out.web = asFlag(nested.webpush);
    }
  }
  return out;
}

function extrasFrom(raw: Record<string, unknown>): Partial<ContactPreferencesJson> {
  const extras: Partial<ContactPreferencesJson> = {};
  if (raw.timezone) extras.timezone = safeTimezone(raw.timezone);
  const window = parseSendWindow(raw.timing);
  if (window) extras.timing = window;
  const channelTiming = parseChannelTiming(raw.channel_timing);
  if (Object.keys(channelTiming).length) extras.channel_timing = channelTiming;
  return extras;
}

export function normalizePreferencesJson(raw: unknown): ContactPreferencesJson {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyPreferences();
  }
  const obj = raw as Record<string, unknown>;
  return { ...channelFlags(obj), ...extrasFrom(obj) };
}

export function mergePreferencesJson(
  existing: unknown,
  incoming: unknown,
): ContactPreferencesJson {
  const base = normalizePreferencesJson(existing);
  const patch = normalizePreferencesJson(incoming);
  const out: ContactPreferencesJson = { ...base };
  for (const channel of PREFERENCE_CHANNELS) {
    out[channel] = patch[channel];
  }
  const incomingMap =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? (incoming as Record<string, unknown>)
      : {};
  if (incomingMap.timezone) {
    out.timezone = patch.timezone || safeTimezone(incomingMap.timezone);
  }
  if ("timing" in incomingMap) {
    const window = parseSendWindow(incomingMap.timing);
    if (window) out.timing = window;
  }
  if ("channel_timing" in incomingMap) {
    const channelTiming = parseChannelTiming(incomingMap.channel_timing);
    if (Object.keys(channelTiming).length) out.channel_timing = channelTiming;
  }
  return out;
}

export function isPreferenceChannel(raw: string): raw is PreferenceChannel {
  return (PREFERENCE_CHANNELS as readonly string[]).includes(
    String(raw || "").trim().toLowerCase(),
  );
}

/** Score email = opens + 2×clicks; other channels use engage counts when provided. */
export function preferencesFromEngagement(input: {
  email_open_count?: number;
  email_click_count?: number;
  email_unsubscribed?: boolean;
  whatsapp_engage_count?: number;
  push_engage_count?: number;
  web_engage_count?: number;
  sms_engage_count?: number;
}): ChannelPreferences {
  const scores: Record<PreferenceChannel, number> = {
    email: 0,
    whatsapp: Math.max(0, Number(input.whatsapp_engage_count) || 0),
    push: Math.max(0, Number(input.push_engage_count) || 0),
    web: Math.max(0, Number(input.web_engage_count) || 0),
    sms: Math.max(0, Number(input.sms_engage_count) || 0),
  };
  if (!input.email_unsubscribed) {
    const opens = Math.max(0, Number(input.email_open_count) || 0);
    const clicks = Math.max(0, Number(input.email_click_count) || 0);
    scores.email = opens + 2 * clicks;
  }

  const best = Math.max(...Object.values(scores));
  if (best <= 0) return emptyPreferences();

  const winners = PREFERENCE_CHANNELS.filter((c) => scores[c] >= best);
  const chosen =
    winners.length === 1
      ? winners[0]
      : TIE_BREAK.find((c) => winners.includes(c)) || winners[0];

  const out = emptyPreferences();
  out[chosen] = 1;
  return out;
}

/** SQL fragment: preferences_json channel flag is 1 / true. */
export function preferencesChannelIsOnSql(
  channelParamIndex: number,
): string {
  return `(
    coalesce(p.preferences_json->>$${channelParamIndex}, '0') IN ('1', 'true')
  )`;
}
