/** Shared speaker/contact context for live Assist auto-coach. */

import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { buildMeetingSpeakerRoster } from "@/service/transcripts/speaker-resolve";
import {
  hostEmailFromMeta,
  hostMeetNameFromMeta,
  internalIdentitiesFromMeta,
} from "@/service/ai/meeting-attendee-lock";
import {
  buildAttendeePeople,
  type AttendeePerson,
} from "@/lib/meeting-attendee-identity";

export type AssistLiveContext = {
  sessionId: string;
  contactName: string | null;
  contactEmail: string | null;
  salesNames: string[];
  /** Extra org-side labels (panel sign-ins) beyond calendar reps. */
  internalNames: string[];
  customerNames: string[];
  guestNames: string[];
  otherAttendeeCount: number;
  hostMeetName: string | null;
  hostEmail: string | null;
  people: AttendeePerson[];
  /** Every email this meeting could seat a customer/colleague in — the
   * bounded set a "mark this channel" picker offers, and the size
   * elimination-by-exclusion uses to know when only one seat is left. */
  customerPool: Array<{ email: string; name: string }>;
  internalPool: Array<{ email: string; name: string }>;
};

/**
 * Contact name / rep roster barely change mid-call, but this used to be
 * re-fetched (session + activity + contact + roster, and the roster itself
 * re-fetches the contact plus a calendar-connection lookup per rep) on
 * *every* qualifying live-caption draft — a major contributor to the
 * shared Postgres pool ("Timed out fetching a new connection", pool
 * limit 5) starving `meet-bootstrap` and delaying recommendations. Cache
 * the resolved context for a few seconds per session.
 */
const CONTEXT_CACHE_TTL_MS = Number(
  process.env.LIVE_ASSIST_CONTEXT_CACHE_MS || 8_000,
);
const contextCache = new Map<
  string,
  { value: AssistLiveContext; expiresAt: number }
>();

export function clearAssistLiveContextCache(sessionId: string): void {
  contextCache.delete(sessionId.trim());
}

export async function loadAssistLiveContext(
  sessionId: string,
): Promise<AssistLiveContext | null> {
  const cached = contextCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      contactId: true,
      hostUserId: true,
      activityId: true,
      organizationId: true,
      meta: true,
    },
  });
  if (!session) return null;

  const [activity, contact] = await Promise.all([
    prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: { body: true },
    }),
    getContact(session.contactId),
  ]);
  const ownerUserId =
    contact?.person.ownerUserId || contact?.crm.ownerUserId || null;

  const roster = await buildMeetingSpeakerRoster({
    organizationId: String(session.organizationId),
    contactId: session.contactId,
    contact,
    activityBody: activity?.body,
    activityId: session.activityId,
    hostUserId: session.hostUserId ? String(session.hostUserId) : null,
    ownerUserId: ownerUserId ? String(ownerUserId) : null,
  });

  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  const contactEmail = contact?.person.email?.trim() || null;

  const salesNames: string[] = [];
  const customerNames: string[] = [];
  const guestNames: string[] = [];
  let otherAttendeeCount = 0;
  for (const [, entry] of roster) {
    if (entry.role === "rep" && !salesNames.includes(entry.label)) {
      salesNames.push(entry.label);
    }
    if (entry.role === "customer" && !customerNames.includes(entry.label)) {
      customerNames.push(entry.label);
    }
    if (entry.role === "guest" && !guestNames.includes(entry.label)) {
      guestNames.push(entry.label);
    }
    if (entry.role === "customer" || entry.role === "guest") {
      otherAttendeeCount += 1;
    }
  }
  if (contactName && !customerNames.includes(contactName)) {
    customerNames.unshift(contactName);
  }
  if (salesNames.length === 0 && session.hostUserId) {
    const { getUserLabelsByIds } = await import(
      "@/service/account/user-directory"
    );
    const labels = await getUserLabelsByIds([String(session.hostUserId)]);
    const name = labels.get(String(session.hostUserId));
    if (name) salesNames.push(name);
  }

  const hostMeetName = hostMeetNameFromMeta(session.meta);
  const hostEmail = hostEmailFromMeta(session.meta);
  // Every internal person who has opened the panel with their own signed-in
  // identity (rep, pre-sales, ...) — not just whoever bootstrapped first —
  // so elimination-by-exclusion has the full internal-side headcount and
  // none of these voices ever gets mistaken for the customer.
  const internalIdentities = internalIdentitiesFromMeta(session.meta);

  const rosterEntries: Array<{
    email: string;
    name: string;
    role: "rep" | "customer" | "guest";
    source: "contact" | "invitee" | "host" | "verified";
  }> = [...roster.entries()].map(([email, entry]) => ({
    email,
    name: entry.label,
    role: entry.role,
    source: entry.source,
  }));
  for (const identity of internalIdentities) {
    const existing = rosterEntries.find((entry) => entry.email === identity.email);
    if (existing) {
      existing.name = identity.name;
      existing.role = "rep";
      existing.source = "verified";
    } else {
      rosterEntries.push({
        email: identity.email,
        name: identity.name,
        role: "rep",
        source: "verified",
      });
    }
  }

  const people = buildAttendeePeople({
    roster: rosterEntries,
    customerEmail: contact?.person.email,
    customerName: contactName,
    hostEmail,
    hostName: hostMeetName || salesNames[0] || null,
  });

  const customerPool = people
    .filter((person) => person.role === "customer")
    .map((person) => ({ email: person.email, name: person.name }));
  const internalPool = people
    .filter((person) => person.role === "host")
    .map((person) => ({ email: person.email, name: person.name }));

  const internalNames: string[] = [];
  const pushInternalName = (label: string | null | undefined) => {
    const name = (label || "").trim();
    if (!name || internalNames.includes(name)) return;
    internalNames.push(name);
  };
  for (const identity of internalIdentities) pushInternalName(identity.name);
  for (const person of internalPool) pushInternalName(person.name);
  if (hostMeetName) pushInternalName(hostMeetName);
  for (const name of internalNames) {
    if (!salesNames.includes(name)) salesNames.push(name);
  }

  const result: AssistLiveContext = {
    sessionId: session.id,
    contactName,
    contactEmail,
    salesNames,
    internalNames,
    customerNames,
    guestNames,
    otherAttendeeCount,
    hostMeetName,
    hostEmail,
    people,
    customerPool,
    internalPool,
  };
  contextCache.set(sessionId, {
    value: result,
    expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS,
  });
  return result;
}
