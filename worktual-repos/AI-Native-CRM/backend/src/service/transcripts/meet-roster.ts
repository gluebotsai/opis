/**
 * Live Meet roster for the meeting organizer's own token.
 *
 * conferenceRecords.list filter is the form in the Meet API reference:
 *   space.meeting_code = "abc-mnop-xyz" AND end_time IS NULL
 * participants.list filter `latest_end_time IS NULL` is the documented
 * "active participants" query.
 *
 * Email lookup is People API people.get(people/{account_id}), where
 * account_id is the trailing id of signedinUser.user (`users/{id}`).
 * people.get documents that resource name for a Google account. Scope is
 * directory.readonly, which the People API requires before it returns
 * Workspace domain profile data.
 *
 * The Meet participants guide also shows people.get with the trailing id of
 * conferenceRecords/.../participants/{id}. That is a different id from
 * users/{id}. This module does not call that form: a miss returns no email
 * and the participant stays unresolved.
 */

import type { MeetRosterEntry } from "@/lib/meet-channel-bindings";

const MEET_API = "https://meet.googleapis.com/v2";
const PEOPLE_API = "https://people.googleapis.com/v1";

export function conferenceRecordsFilter(meetCode: string): string {
  return `space.meeting_code = "${meetCode.trim().toLowerCase()}" AND end_time IS NULL`;
}

export function participantsListFilter(): string {
  return "latest_end_time IS NULL";
}

/** `users/123` → `people/123`. Anything else is not a Google account id. */
export function peopleResourceFromMeetUser(user: string): string | null {
  const raw = user.trim();
  if (!raw.startsWith("users/")) return null;
  const id = raw.slice("users/".length).trim();
  if (!id || id.includes("/")) return null;
  return `people/${id}`;
}

type SignedInParticipant = {
  userId: string;
  peopleResource: string;
  displayName: string;
  earliestStartMs: number;
  latestEndMs: number | null;
};

export type EmployeeMailbox = {
  accountEmail: string;
  accessToken: string;
};

export type RosterCustomer = {
  userId: string | null;
  displayName: string;
};

export function readSignedInParticipants(body: unknown): SignedInParticipant[] {
  if (!body || typeof body !== "object") return [];
  const rows = (body as { participants?: unknown }).participants;
  if (!Array.isArray(rows)) return [];
  const out: SignedInParticipant[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const signed = (row as { signedinUser?: { user?: unknown } }).signedinUser;
    const user = typeof signed?.user === "string" ? signed.user : "";
    const peopleResource = peopleResourceFromMeetUser(user);
    if (!peopleResource) continue;
    const start = Date.parse(
      String((row as { earliestStartTime?: unknown }).earliestStartTime || ""),
    );
    if (!Number.isFinite(start)) continue;
    const endRaw = (row as { latestEndTime?: unknown }).latestEndTime;
    const end =
      typeof endRaw === "string" && endRaw.trim() ? Date.parse(endRaw) : null;
    const displayName =
      typeof (signed as { displayName?: unknown }).displayName === "string"
        ? (signed as { displayName: string }).displayName.trim()
        : "";
    out.push({
      userId: user,
      peopleResource,
      displayName,
      earliestStartMs: start,
      latestEndMs: end != null && Number.isFinite(end) ? end : null,
    });
  }
  return out;
}

export function readPeopleEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as { emailAddresses?: unknown }).emailAddresses;
  if (!Array.isArray(rows)) return null;
  const values = rows
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const value = (row as { value?: unknown }).value;
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    })
    .filter((value) => value.includes("@"));
  return values[0] ?? null;
}

export function readConferenceRecordNames(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const rows = (body as { conferenceRecords?: unknown }).conferenceRecords;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) =>
      row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string"
        ? (row as { name: string }).name.trim()
        : "",
    )
    .filter((name) => name.startsWith("conferenceRecords/"));
}

async function meetGet(
  fetchImpl: typeof fetch,
  accessToken: string,
  url: string,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `meet_http_${res.status}` };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "meet_bad_json" };
  }
}

export type PeopleLookup = {
  userId: string;
  displayName: string;
  email: string | null;
  /** Null when an email was returned. Otherwise the exact failure. */
  error: string | null;
};

export type MeetRosterResolution =
  | { ok: true; entries: MeetRosterEntry[]; lookups: PeopleLookup[]; customers: RosterCustomer[] }
  | { ok: false; error: string; lookups: PeopleLookup[]; customers: RosterCustomer[] };

export async function resolveMeetRoster(input: {
  accessToken: string;
  meetCode: string;
  fetchImpl?: typeof fetch;
  /**
   * Configured Google mailboxes for CRM employees. People API returns an
   * email only to the token that owns that account, so each mailbox is asked
   * whether a participant `users/{id}` is itself. A returned address counts
   * only when it equals that mailbox.
   */
  employeeMailboxes?: EmployeeMailbox[];
}): Promise<MeetRosterResolution> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const code = input.meetCode.trim().toLowerCase();
  if (!code) return { ok: false, error: "missing_meet_code", lookups: [], customers: [] };
  const mailboxes = dedupeMailboxes(input.employeeMailboxes || []);
  const listTokens = [
    input.accessToken,
    ...mailboxes.map((row) => row.accessToken).filter((token) => token !== input.accessToken),
  ];
  let listedToken = "";
  let parent = "";
  let lastError = "no_active_conference";
  for (const token of listTokens) {
    const filter = encodeURIComponent(conferenceRecordsFilter(code));
    const listed = await meetGet(
      fetchImpl,
      token,
      `${MEET_API}/conferenceRecords?filter=${filter}&pageSize=10`,
    );
    if (!listed.ok) {
      lastError = listed.error;
      continue;
    }
    const records = readConferenceRecordNames(listed.body);
    if (records.length > 1) {
      return { ok: false, error: "ambiguous_conference", lookups: [], customers: [] };
    }
    if (records.length === 1) {
      listedToken = token;
      parent = records[0]!;
      break;
    }
  }
  if (!parent || !listedToken) {
    return { ok: false, error: lastError, lookups: [], customers: [] };
  }
  const participantFilter = encodeURIComponent(participantsListFilter());
  const participants = await meetGet(
    fetchImpl,
    listedToken,
    `${MEET_API}/${parent}/participants?filter=${participantFilter}&pageSize=100`,
  );
  if (!participants.ok) {
    return { ok: false, error: participants.error, lookups: [], customers: [] };
  }
  const signedIn = readSignedInParticipants(participants.body);
  const entries: MeetRosterEntry[] = [];
  const lookups: PeopleLookup[] = [];
  const customers: RosterCustomer[] = [];
  const recognizeWith = mailboxes.length
    ? mailboxes
    : [{ accountEmail: "", accessToken: input.accessToken }];
  for (const person of signedIn) {
    const recognized = await recognizeParticipant(fetchImpl, person, recognizeWith, mailboxes.length > 0);
    lookups.push(recognized.lookup);
    if (recognized.email) {
      entries.push({
        email: recognized.email,
        userId: person.userId,
        displayName: person.displayName,
        earliestStartMs: person.earliestStartMs,
        latestEndMs: person.latestEndMs,
      });
      continue;
    }
    if (person.displayName && !isBotTile(person.displayName)) {
      customers.push({ userId: person.userId, displayName: person.displayName });
    }
  }
  for (const other of readAnonymousParticipants(participants.body)) {
    if (!isBotTile(other.displayName)) customers.push(other);
  }
  // No resolved employee email is not an empty meeting. A lookup that
  // recognized nobody must not become "ready" and then coach every channel.
  if (entries.length === 0) {
    return { ok: false, error: "no_employee_emails", lookups, customers: [] };
  }
  return { ok: true, entries, lookups, customers };
}

function dedupeMailboxes(rows: EmployeeMailbox[]): EmployeeMailbox[] {
  const seen = new Set<string>();
  const out: EmployeeMailbox[] = [];
  for (const row of rows) {
    const accountEmail = row.accountEmail.trim().toLowerCase();
    const accessToken = row.accessToken.trim();
    if (!accountEmail.includes("@") || !accessToken || seen.has(accountEmail)) continue;
    seen.add(accountEmail);
    out.push({ accountEmail, accessToken });
  }
  return out;
}

function isBotTile(name: string): boolean {
  return /notetaker|worktual\s+capture/i.test(name.trim());
}

function readAnonymousParticipants(body: unknown): RosterCustomer[] {
  if (!body || typeof body !== "object") return [];
  const rows = (body as { participants?: unknown }).participants;
  if (!Array.isArray(rows)) return [];
  const out: RosterCustomer[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as {
      signedinUser?: unknown;
      anonymousUser?: { displayName?: unknown };
      phoneUser?: { displayName?: unknown };
    };
    if (record.signedinUser) continue;
    const raw = record.anonymousUser?.displayName ?? record.phoneUser?.displayName;
    const displayName = typeof raw === "string" ? raw.trim() : "";
    if (!displayName) continue;
    out.push({ userId: null, displayName });
  }
  return out;
}

async function recognizeParticipant(
  fetchImpl: typeof fetch,
  person: SignedInParticipant,
  mailboxes: EmployeeMailbox[],
  requireOwnMailbox: boolean,
): Promise<{ email: string | null; lookup: PeopleLookup }> {
  const id = person.peopleResource.slice("people/".length);
  const params = new URLSearchParams({
    personFields: "emailAddresses",
    sources: "READ_SOURCE_TYPE_PROFILE",
  });
  const url = `${PEOPLE_API}/people/${encodeURIComponent(id)}?${params.toString()}`;
  let lastError = "no_email";
  for (const mailbox of mailboxes) {
    const looked = await meetGet(fetchImpl, mailbox.accessToken, url);
    if (!looked.ok) {
      lastError = looked.error;
      continue;
    }
    const email = readPeopleEmail(looked.body);
    if (!email) continue;
    if (requireOwnMailbox && email !== mailbox.accountEmail) continue;
    return {
      email,
      lookup: { userId: person.userId, displayName: person.displayName, email, error: null },
    };
  }
  return {
    email: null,
    lookup: { userId: person.userId, displayName: person.displayName, email: null, error: lastError },
  };
}
