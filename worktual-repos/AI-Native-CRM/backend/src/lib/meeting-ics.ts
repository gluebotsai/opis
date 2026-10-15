/**
 * Build a minimal RFC 5545 VCALENDAR REQUEST for meeting invites.
 * Helps receivers treat the message as a real calendar invite (better than link-only).
 */

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toIcsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

export function buildMeetingIcs(args: {
  uid: string;
  topic: string;
  description?: string;
  start: Date;
  end: Date;
  organizerEmail: string;
  organizerName?: string;
  attendeeEmails: string[];
  location?: string | null;
  meetingUrl?: string | null;
  /** iTIP method. REQUEST for invite/update, CANCEL to withdraw. */
  method?: "REQUEST" | "CANCEL";
  /** Increment on each update of the same UID so clients treat it as a reschedule. */
  sequence?: number;
}): string {
  const stamp = toIcsUtc(new Date());
  const dtStart = toIcsUtc(args.start);
  const dtEnd = toIcsUtc(args.end);
  const orgName = args.organizerName?.trim() || args.organizerEmail;
  const method = args.method ?? "REQUEST";
  const sequence = Math.max(0, Math.floor(args.sequence ?? 0));
  const descParts = [
    args.description?.trim(),
    args.meetingUrl ? `Join: ${args.meetingUrl}` : null,
  ].filter(Boolean);
  const description = descParts.join("\n");
  const location =
    args.location?.trim() || args.meetingUrl?.trim() || undefined;
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";

  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Worktual CRM//Meeting//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(args.topic)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    location ? `LOCATION:${icsEscape(location)}` : null,
    `ORGANIZER;CN=${icsEscape(orgName)}:mailto:${args.organizerEmail}`,
    ...args.attendeeEmails.map(
      (email) =>
        `ATTENDEE;CN=${icsEscape(email)};RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:${email}`,
    ),
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
