import { nameOverlap } from "@/lib/meeting-assist-speakers";

/**
 * Map a Meet audio channel to a CRM email.
 *
 * The channel (`ch-0`, `ch-1`) is whose microphone it is. The email is who
 * that person is. The tile name is only a hint. A lock is kept for the whole
 * call: the same channel does not get a new email because the glow flickers.
 * Assist coaches only when the locked email is the customer.
 *
 * Granting "customer"/"other" here never compares Meet's caption name/email
 * against a CRM contact's stored data — that comparison is exactly what let
 * a misconfigured or coincidentally-overlapping contact turn the rep's own
 * speech into customer coaching. A channel becomes "customer"/"other" only
 * via an explicit tap (`assignChannelEmail`, elsewhere) or via unambiguous
 * process-of-elimination once every other seat on this call is accounted
 * for (`tryElimination` below) — a real identifier-based deduction over a
 * closed, CRM-known roster, not a name/email string guess.
 *
 * The one name comparison this file still makes is linking a Meet caption
 * name to the internal/host identity (`hostMeetName`) that verified its own
 * Google sign-in on the Sales Assist panel — a safe, block-only direction:
 * it can only ever stop Assist from coaching someone, never wrongly start
 * it, and unlike a CRM contact's typed email/name it comes from a
 * server-verified Google ID token (see meeting-service/app/services/
 * google_id.py).
 */

export type AttendeeRole = "host" | "customer" | "other" | "unknown";

export type AttendeePerson = {
  email: string;
  name: string;
  role: "host" | "customer" | "other";
  /**
   * `host` is an account/calendar alias for the meeting owner, not proof of
   * another physical seat. `verified` means this person opened the panel and
   * verified that exact Google identity. Invitees remain real possible seats.
   */
  source?: "contact" | "invitee" | "host" | "verified";
};

export type AttendeeLock = {
  id: string;
  role: AttendeeRole;
  name: string;
  email: string | null;
  /**
   * Set only while MEET_CHANNEL_BINDINGS is on. `pending` and `employee`
   * are not coachable. Absent when the flag is off.
   */
  channelResolution?: "employee" | "pending" | "ambiguous" | "ready-unbound";
};

const UNRESOLVED = /^(speaker|unknown)$/i;

export function attendeeId(sessionId: string, channelId: string): string {
  return `meet:${sessionId}:${channelId}`;
}

/** `ch-0:2` and `ch-0` are the same microphone. */
export function channelIdFromSpeakerKey(speakerKey: string): string {
  const key = speakerKey.trim();
  const match = key.match(/^(ch-\d+)/i);
  return match ? match[1]!.toLowerCase() : key;
}

export function buildAttendeePeople(input: {
  roster: Array<{
    email: string;
    name: string;
    role: "rep" | "customer" | "guest";
    source?: "contact" | "invitee" | "host" | "verified";
  }>;
  customerEmail?: string | null;
  customerName?: string | null;
  hostEmail?: string | null;
  hostName?: string | null;
}): AttendeePerson[] {
  const byEmail = new Map<string, AttendeePerson>();
  const sourceRank = (source: AttendeePerson["source"]): number =>
    source === "verified" ? 4 : source === "invitee" ? 3 : source === "contact" ? 2 : 1;
  const put = (
    email: string | null | undefined,
    name: string | null | undefined,
    role: AttendeePerson["role"],
    source: AttendeePerson["source"],
  ) => {
    const e = (email || "").trim().toLowerCase();
    if (!e.includes("@")) return;
    const existing = byEmail.get(e);
    const nextName = (name || "").trim() || existing?.name || e;
    if (!existing || (existing.role !== "host" && role === "host") || (existing.role === "other" && role === "customer")) {
      byEmail.set(e, { email: e, name: nextName, role, source });
      return;
    }
    if (nextName && nextName !== e) existing.name = nextName;
    if (sourceRank(source) > sourceRank(existing.source)) {
      existing.source = source;
    }
  };

  for (const entry of input.roster) {
    const role = entry.role === "rep" ? "host" : entry.role === "customer" ? "customer" : "other";
    put(entry.email, entry.name, role, entry.source ?? "invitee");
  }
  put(input.customerEmail, input.customerName, "customer", "contact");
  put(input.hostEmail, input.hostName, "host", "verified");
  return [...byEmail.values()];
}

export function classifyAttendeeTurn(input: {
  sessionId: string;
  speakerKey: string;
  displayName?: string | null;
  people: AttendeePerson[];
  hostMeetName?: string | null;
  hostEmail?: string | null;
  /** Locks already stored for other channels on this call. */
  locks?: AttendeeLock[];
  existing?: AttendeeLock | null;
}): AttendeeLock {
  const channel = channelIdFromSpeakerKey(input.speakerKey || "");
  const id = channel ? attendeeId(input.sessionId, channel) : "";
  const name = (input.displayName || "").trim();
  const people = input.people.filter((p) => p.email.includes("@"));

  if (input.existing && input.existing.role !== "unknown") {
    // A channel can stay "customer" from an unresolved Speaker pass while
    // the rep later speaks with their real Meet name on the same mic —
    // reclaim the lock as host so Sales Assist does not coach rep speech.
    if (
      input.existing.role === "customer" &&
      name &&
      !UNRESOLVED.test(name) &&
      UNRESOLVED.test(input.existing.name)
    ) {
      const hostMatches = new Map<string, AttendeePerson>();
      for (const person of people) {
        if (person.role !== "host") continue;
        if (person.name && nameOverlap(name, person.name)) {
          hostMatches.set(person.email, person);
        }
      }
      const hostEmailHint = (input.hostEmail || "").trim().toLowerCase();
      if (
        input.hostMeetName &&
        hostEmailHint &&
        nameOverlap(name, input.hostMeetName)
      ) {
        const known = people.find((p) => p.email === hostEmailHint);
        if (known?.role === "host") hostMatches.set(known.email, known);
      }
      if (hostMatches.size === 1) {
        const person = [...hostMatches.values()][0]!;
        return { id, role: "host", name, email: person.email };
      }
    }
    return { ...input.existing, id: input.existing.id || id };
  }

  const unresolvedLabel = !name || UNRESOLVED.test(name);
  const label = name || "Speaker";

  /**
   * The only way an unresolved OR ambiguous line becomes "customer"/"other"
   * without a manual tap: every other seat on this call is already
   * accounted for (locked to a real email — by a prior identity match on
   * the host side, or by an earlier tap/elimination), so the one seat left
   * must be this person — regardless of what name Meet's caption showed.
   * Requires at least one prior lock: a totally fresh call with zero
   * context never guesses who is who from a bare seat count alone.
   */
  const tryElimination = (): AttendeeLock | null => {
    const priorLocks = (input.locks || []).filter((lock) => lock.role !== "unknown" && lock.email);
    if (priorLocks.length === 0) return null;
    const lockedEmails = new Set(priorLocks.map((lock) => lock.email!));
    const verifiedHostLocked = priorLocks.some((lock) => {
      const person = people.find((candidate) => candidate.email === lock.email);
      return person?.role === "host" && person.source === "verified";
    });
    // Account owner, contact owner, and connected-calendar mailboxes may all
    // be aliases for the organizer. Once an exact, panel-verified host email
    // is actually heard, those unverified owner aliases are not extra seats.
    // Real internal invitees remain in the candidate set and must still be
    // accounted for before an external channel can be elected.
    const eligiblePeople = verifiedHostLocked
      ? people.filter(
          (person) => !(person.role === "host" && person.source === "host"),
        )
      : people;
    const remaining = eligiblePeople.filter(
      (person) => !lockedEmails.has(person.email),
    );
    if (remaining.length !== 1) return null;
    const person = remaining[0]!;
    return { id, role: person.role, name: label, email: person.email };
  };

  if (unresolvedLabel) {
    const eliminated = tryElimination();
    if (eliminated) return eliminated;
    return { id, role: "unknown", name: label, email: null };
  }

  // Name-based matching from here only ever grants "host" (from a
  // server-verified Google sign-in identity) or detects a genuine
  // collision (two different roster entries share this exact name, which
  // must fall back to "unknown" rather than guess). A match against a
  // customer/other roster entry by name alone is NOT enough to grant that
  // role — that would be exactly the CRM-contact-name/email guess this
  // file exists to avoid — so it only rules out ambiguity before falling
  // through to elimination below.
  const matched = new Map<string, AttendeePerson>();
  for (const person of people) {
    if (person.name && nameOverlap(name, person.name)) {
      matched.set(person.email, person);
    }
  }
  const hostEmail = (input.hostEmail || "").trim().toLowerCase();
  if (input.hostMeetName && hostEmail && nameOverlap(name, input.hostMeetName)) {
    const known = people.find((p) => p.email === hostEmail);
    matched.set(hostEmail, known || { email: hostEmail, name: input.hostMeetName, role: "host" });
  }
  if (matched.size > 1) {
    return { id, role: "unknown", name, email: null };
  }
  if (matched.size === 1) {
    const person = [...matched.values()][0]!;
    if (person.role === "host") {
      return { id, role: "host", name, email: person.email };
    }
    // Matches a customer/other roster entry by name alone — not proof
    // enough to grant coaching; confirm via elimination instead.
  }

  const eliminated = tryElimination();
  if (eliminated) return eliminated;

  return { id, role: "unknown", name, email: null };
}
