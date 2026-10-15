import type { MeetingProvider } from "@/lib/meeting-provider";

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

export function isMeetingMarkedRescheduled(
  body: string | null | undefined,
): boolean {
  return Boolean(body && /^Rescheduled:\s*yes\s*$/im.test(body));
}
