import type { MeetingProvider } from "@/lib/meeting-provider";
import { meetingProviderLabel } from "@/lib/meeting-provider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseParticipantEmails(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s\n]+/)) {
    const email = part.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function normalizeEmailList(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function parseGuestsFromMeetingBody(body: string | null | undefined): string[] {
  if (!body?.trim()) return [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let inGuests = false;
  const guests: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const inline = trimmed.match(/^Guests:\s*(.+)$/i);
    if (inline?.[1]?.trim()) {
      return normalizeEmailList(parseParticipantEmails(inline[1]));
    }
    if (/^Guests:\s*$/i.test(trimmed)) {
      inGuests = true;
      continue;
    }
    if (!inGuests) continue;
    const match = trimmed.match(/^-\s*(.+)$/);
    if (match?.[1]) {
      guests.push(match[1].trim().toLowerCase());
      continue;
    }
    if (trimmed) break;
  }
  return normalizeEmailList(guests);
}

export function parseGoogleEventIdFromMeetingBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const match = body.match(/^Google Event:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

/** `gcal:{eventId}` stored on contact_activities.provider_message_id. */
export function parseGcalProviderMessageId(
  providerMessageId: string | null | undefined,
): string | null {
  const raw = providerMessageId?.trim() || "";
  if (!raw.toLowerCase().startsWith("gcal:")) return null;
  const id = raw.slice("gcal:".length).trim();
  return id || null;
}

export function parseProviderFromMeetingBody(
  body: string | null | undefined,
): MeetingProvider {
  if (!body) return "google_meet";
  const match = body.match(/^Provider:\s*(google_meet|zoom|teams)\s*$/im);
  if (match?.[1] === "zoom" || match?.[1] === "teams" || match?.[1] === "google_meet") {
    return match[1];
  }
  if (/zoom\.us/i.test(body)) return "zoom";
  if (/teams\.microsoft\.com/i.test(body)) return "teams";
  return "google_meet";
}

export function parseMeetingLinkFromBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const labeled = body.match(/^Meeting link:\s*(https?:\/\/\S+)/im);
  if (labeled?.[1]) return labeled[1];
  const legacyMeet = body.match(
    /^Google Meet:\s*(https?:\/\/meet\.google\.com\/[^\s]+)/im,
  );
  if (legacyMeet?.[1]) return legacyMeet[1];
  const zoom = body.match(/https?:\/\/[^\s/]*zoom\.us\/[^\s]+/i);
  if (zoom?.[0]) return zoom[0];
  const teams = body.match(/https?:\/\/teams\.microsoft\.com\/[^\s]+/i);
  if (teams?.[0]) return teams[0];
  const meet = body.match(/https?:\/\/meet\.google\.com\/[^\s]+/i);
  return meet?.[0] ?? null;
}

/** Google Meet code from a meet.google.com URL (`xxx-yyyy-zzz`). */
export function meetCodeFromGoogleMeetUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const m = url.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  const code = m?.[1]?.toLowerCase() || null;
  if (!code || code === "lookup") return null;
  return code;
}

/** @deprecated Use parseMeetingLinkFromBody */
export function parseMeetLinkFromMeetingBody(
  body: string | null | undefined,
): string | null {
  return parseMeetingLinkFromBody(body);
}

export function parseTopicFromMeetingBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = body.match(/^Topic:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function parseWhenLabelFromMeetingBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const match = body.match(/^When:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function parsePreviousWhenLabelFromMeetingBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const match = body.match(/^Previous When:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function parsePreviousDueAtFromMeetingBody(
  body: string | null | undefined,
): Date | null {
  if (!body) return null;
  const match = body.match(/^Previous DueAt:\s*(.+)$/im);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseIcsUidFromMeetingBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const match = body.match(/^ICS UID:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function parseIcsSequenceFromMeetingBody(
  body: string | null | undefined,
): number {
  if (!body) return 0;
  const match = body.match(/^ICS Sequence:\s*(\d+)\s*$/im);
  const n = match?.[1] ? Number(match[1]) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function isMeetingMarkedRescheduled(
  body: string | null | undefined,
): boolean {
  return Boolean(body && /^Rescheduled:\s*yes\s*$/im.test(body));
}

export function parseCalendarLinkFromMeetingBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const match = body.match(/^Calendar:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function parseOrganizerFromMeetingBody(body: string | null | undefined): {
  name: string;
  email: string;
} | null {
  if (!body) return null;
  const withEmail = body.match(
    /^Organizer:\s*(.+?)\s*\(([^)\s]+@[^)\s]+)\)\s*$/im,
  );
  if (withEmail) {
    return {
      name: withEmail[1].trim(),
      email: withEmail[2].trim().toLowerCase(),
    };
  }
  const emailOnly = body.match(/^Organizer:\s*([^\s@]+@[^\s@]+)\s*$/im);
  if (emailOnly) {
    const email = emailOnly[1].trim().toLowerCase();
    return { name: email.split("@")[0] || email, email };
  }
  return null;
}

export function buildMeetingActivityBody(args: {
  topic: string;
  whenLabel: string;
  organizerName: string;
  organizerEmail: string;
  guestEmails: string[];
  provider: MeetingProvider;
  meetingLink?: string | null;
  calendarLink?: string | null;
  googleEventId?: string | null;
  externalMeetingId?: string | null;
  previousWhenLabel?: string | null;
  previousDueAt?: Date | null;
  rescheduled?: boolean;
  icsUid?: string | null;
  icsSequence?: number | null;
}): string {
  const providerLabel = meetingProviderLabel(args.provider);
  const lines = [
    `Topic: ${args.topic}`,
    `When: ${args.whenLabel}`,
    args.previousWhenLabel ? `Previous When: ${args.previousWhenLabel}` : null,
    args.previousDueAt
      ? `Previous DueAt: ${args.previousDueAt.toISOString()}`
      : null,
    args.rescheduled ? "Rescheduled: yes" : null,
    `Provider: ${args.provider}`,
    "",
    args.meetingLink ? `Meeting link: ${args.meetingLink}` : null,
    args.calendarLink ? `Calendar: ${args.calendarLink}` : null,
    args.googleEventId ? `Google Event: ${args.googleEventId}` : null,
    args.externalMeetingId && args.provider !== "google_meet"
      ? `${providerLabel} Event: ${args.externalMeetingId}`
      : null,
    args.icsUid ? `ICS UID: ${args.icsUid}` : null,
    args.icsSequence != null ? `ICS Sequence: ${args.icsSequence}` : null,
    "",
    `Organizer: ${args.organizerName} (${args.organizerEmail})`,
    "",
    "Guests:",
    ...args.guestEmails.map((email) => `- ${email}`),
  ].filter((line) => line !== null) as string[];
  return lines.join("\n");
}

/** Slim timeline mirror for new appointment-backed meetings. */
export function buildSlimMeetingActivityBody(args: {
  whenLabel: string;
  meetingLink?: string | null;
  provider?: string;
}): string {
  const lines = [`When: ${args.whenLabel}`];
  if (args.meetingLink) lines.push(`Join: ${args.meetingLink}`);
  if (args.provider) lines.push(`Provider: ${args.provider}`);
  return lines.join("\n");
}
