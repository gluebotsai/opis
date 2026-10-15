/**
 * Map meeting participant emails → CRM display names (reps + customer + guests).
 */

import { getContact, type ContactView } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import {
  parseGuestsFromMeetingBody,
} from "@/lib/meeting-body";
import { listAssignableUsers } from "@/service/account/user-directory";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import {
  isInternalEmail,
  resolveInternalDomains,
} from "@/service/account/internal-domains";

export type SpeakerRosterEntry = {
  label: string;
  role: "rep" | "customer" | "guest";
  /**
   * Why this email is in this meeting's roster. Invitees are real seats on
   * the invitation; host identities are account/calendar aliases and must
   * not each be counted as a separate physical attendee.
   */
  source: "contact" | "invitee" | "host";
};

export type SpeakerRoster = Map<string, SpeakerRosterEntry>;

function normEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase();
  return e?.includes("@") ? e : null;
}

function namesOverlap(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.includes(x)) return true;
  if (y.length >= 3 && x.includes(y)) return true;
  const xt = x.split(/\s+/).filter((t) => t.length > 1);
  const yt = y.split(/\s+/).filter((t) => t.length > 1);
  if (
    xt.length &&
    yt.length &&
    xt[0] === yt[0] &&
    xt[xt.length - 1] === yt[yt.length - 1]
  ) {
    return true;
  }
  return false;
}

export async function buildMeetingSpeakerRoster(input: {
  organizationId: string;
  contactId: string;
  activityBody?: string | null;
  /** Lets the roster read `Appointment.guestEmails` for this specific meeting. */
  activityId?: string | null;
  hostUserId?: string | null;
  ownerUserId?: string | null;
  /** Pass an already-fetched contact to skip a duplicate DB round trip. */
  contact?: ContactView | null;
}): Promise<SpeakerRoster> {
  const roster: SpeakerRoster = new Map();

  const add = (
    email: string | null | undefined,
    label: string,
    role: SpeakerRosterEntry["role"],
    source: SpeakerRosterEntry["source"],
  ) => {
    const n = normEmail(email);
    const name = label.trim();
    if (!n || !name) return;
    const existing = roster.get(n);
    if (!existing || (existing.role !== "rep" && role === "rep")) {
      roster.set(n, { label: name, role, source });
    }
  };

  const contact =
    input.contact !== undefined ? input.contact : await getContact(input.contactId);
  if (contact) {
    const customerName =
      contact.displayName?.trim() ||
      [contact.person.firstName, contact.person.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      "Customer";
    add(contact.person.email, customerName, "customer", "contact");
  }

  // Guest emails come from the invite (body text + Appointment.guestEmails —
  // "consider the guest emails also as customer" for anyone the customer
  // brought along, but a guest on an internal domain is a colleague joining
  // the call (pre-sales etc.), not a customer). Classify each guest by
  // domain instead of lumping every extra attendee into one bucket, so the
  // customer pool and internal pool used for elimination-by-exclusion are
  // actually bounded to *this* meeting's invitees.
  const domains = await resolveInternalDomains(input.organizationId).catch(
    () => null,
  );

  const guestEmails = new Set<string>();
  for (const guest of parseGuestsFromMeetingBody(input.activityBody)) {
    guestEmails.add(guest);
  }
  if (input.activityId) {
    const appointment = await prisma.appointment
      .findFirst({
        where: { activityId: input.activityId },
        select: { guestEmails: true },
      })
      .catch(() => null);
    const list = appointment?.guestEmails;
    if (Array.isArray(list)) {
      for (const email of list) {
        if (typeof email === "string") guestEmails.add(email);
      }
    }
  }
  for (const guest of guestEmails) {
    const local = guest.split("@")[0]?.replace(/[._]/g, " ") || "Guest";
    const internal = domains ? isInternalEmail(guest, domains) : null;
    // Unknown domain state (resolver failed) stays "guest" — a safe,
    // non-coaching-eligible default rather than guessing customer or rep.
    const role: SpeakerRosterEntry["role"] =
      internal === true ? "rep" : internal === false ? "customer" : "guest";
    add(guest, local, role, "invitee");
  }

  // Only the actual host/owner of *this* meeting are added as "rep" — never
  // every assignable user in the org. Adding the whole org roster here used
  // to make elimination-by-exclusion (see classifyAttendeeTurn) impossible
  // for any org with more than a couple of users, because the "known
  // people" pool never shrank to just the people actually on the call.
  const repIds = [
    ...new Set(
      [input.hostUserId, input.ownerUserId].filter(Boolean) as string[],
    ),
  ];
  if (repIds.length) {
    let reps: Awaited<ReturnType<typeof listAssignableUsers>> = [];
    try {
      reps = await listAssignableUsers(input.organizationId);
    } catch {
      /* optional */
    }
    for (const userId of repIds) {
      const rep = reps.find((r) => r.id === userId);
      if (rep?.email) add(rep.email, rep.name, "rep", "host");
      for (const provider of ["google", "microsoft"] as const) {
        const conn = await getCalendarConnection(userId, provider).catch(
          () => null,
        );
        const mailbox = conn?.accountEmail?.trim();
        if (mailbox?.includes("@")) {
          add(
            mailbox,
            rep?.name || mailbox.split("@")[0] || "Sales",
            "rep",
            "host",
          );
          break;
        }
      }
    }
  }

  return roster;
}

/** Resolve display label from email (canonical) and optional Meet display name. */
export function resolveSpeakerLabel(input: {
  roster: SpeakerRoster;
  speakerEmail?: string | null;
  speakerName?: string | null;
  /** Recall Meet captions: host = rep, guest = customer when email is missing. */
  isHost?: boolean | null;
  customerFallback?: string | null;
  repFallback?: string | null;
}): string {
  const email = normEmail(input.speakerEmail);
  if (email && input.roster.has(email)) {
    return input.roster.get(email)!.label;
  }

  const nameAsEmail = normEmail(input.speakerName);
  if (nameAsEmail && input.roster.has(nameAsEmail)) {
    return input.roster.get(nameAsEmail)!.label;
  }

  // Meet often sends the host display name for every utterance — use is_host.
  if (email == null && input.isHost != null) {
    if (input.isHost) {
      for (const [, entry] of input.roster) {
        if (entry.role === "rep") return entry.label;
      }
      if (input.repFallback?.trim()) return input.repFallback.trim();
    } else {
      for (const [, entry] of input.roster) {
        if (entry.role === "customer") return entry.label;
      }
      if (input.customerFallback?.trim()) return input.customerFallback.trim();
    }
  }

  const name = input.speakerName?.trim();
  if (name) {
    const repMatches: string[] = [];
    const customerMatches: string[] = [];
    for (const [, entry] of input.roster) {
      if (!namesOverlap(name, entry.label)) continue;
      if (entry.role === "rep") repMatches.push(entry.label);
      else if (entry.role === "customer") customerMatches.push(entry.label);
    }
    if (repMatches.length === 1 && customerMatches.length === 0) {
      return repMatches[0]!;
    }
    if (customerMatches.length === 1 && repMatches.length === 0) {
      return customerMatches[0]!;
    }
    if (repMatches.length === 1 && customerMatches.length === 1) {
      if (input.isHost === true) return repMatches[0]!;
      if (input.isHost === false) return customerMatches[0]!;
    }
    if (repMatches.length === 1) return repMatches[0]!;
    if (customerMatches.length === 1) return customerMatches[0]!;
    return name;
  }

  if (email) {
    const local = email.split("@")[0]?.replace(/[._]/g, " ") || "Guest";
    return local;
  }
  return input.customerFallback?.trim() || "Guest";
}

export function formatSpeakerLine(input: {
  roster: SpeakerRoster;
  speaker?: string | null;
  speakerEmail?: string | null;
  isHost?: boolean | null;
  customerFallback?: string | null;
  repFallback?: string | null;
  text: string;
}): string {
  const label = resolveSpeakerLabel({
    roster: input.roster,
    speakerEmail: input.speakerEmail,
    speakerName: input.speaker,
    isHost: input.isHost,
    customerFallback: input.customerFallback,
    repFallback: input.repFallback,
  });
  const text = input.text.trim();
  return text ? `${label}: ${text}` : "";
}
