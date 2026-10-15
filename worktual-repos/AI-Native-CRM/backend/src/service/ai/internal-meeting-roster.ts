/**
 * Load invite emails and CRM users for an assist session.
 * Meeting type is a domain-free email check: a CRM customer who is not staff.
 */

import { findCrmContactIdByEmail } from "@/dao/inbox/contact-by-email";
import { prisma } from "@/dao/db/prisma";
import {
  parseGuestsFromMeetingBody,
  parseOrganizerFromMeetingBody,
} from "@/lib/meeting-body";
import {
  classifyInviteEmails,
  type InternalPerson,
  type InternalTopic,
  type MeetingKind,
} from "@/lib/internal-meeting";
import { resolveInternalDomains } from "@/service/account/internal-domains";
import {
  displayNameFromSetupUser,
  listSetupUsersForOrg,
} from "@/service/account/setup-users";
import { parseCrmRole } from "@/service/auth/rbac";

export type InternalRoster = {
  kind: MeetingKind;
  organizationId: string;
  people: InternalPerson[];
  overrideEmails: string[];
};

const cache = new Map<string, { at: number; roster: InternalRoster }>();
const CACHE_MS = 30_000;

function pushEmail(out: Set<string>, email: string | null | undefined): void {
  const value = email?.trim().toLowerCase();
  if (value?.includes("@")) out.add(value);
}

function internalTeamFromRole(
  roleName: string | null | undefined,
): Exclude<InternalTopic, "unclear"> | undefined {
  const role = (roleName || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (role === "salesrep" || role === "sales") return "sales";
  if (role === "presales") return "presales";
  if (role === "marketing" || role === "marketer") return "marketing";
  if (role === "finance") return "finance";
  if (role === "support" || role === "service" || role === "customersupport") {
    return "support";
  }
  return undefined;
}

export async function loadInternalRoster(sessionId: string): Promise<InternalRoster | null> {
  const key = sessionId.trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.roster;

  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: key },
    select: { organizationId: true, activityId: true, contactId: true, hostUserId: true },
  });
  if (!session) return null;
  const organizationId = String(session.organizationId);

  const [activity, appointment, domains, users] = await Promise.all([
    prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: { body: true, providerMessageId: true },
    }),
    prisma.appointment.findFirst({
      where: { activityId: session.activityId },
      select: { guestEmails: true },
    }),
    resolveInternalDomains(organizationId),
    listSetupUsersForOrg(organizationId).then((rows) =>
      rows.filter((user) => parseCrmRole(user.crm_role_name)),
    ),
  ]);

  const invite = new Set<string>();
  const organizer = parseOrganizerFromMeetingBody(activity?.body);
  pushEmail(invite, organizer?.email);
  for (const email of parseGuestsFromMeetingBody(activity?.body)) pushEmail(invite, email);
  const guests = appointment?.guestEmails;
  if (Array.isArray(guests)) {
    for (const email of guests) {
      if (typeof email === "string") pushEmail(invite, email);
    }
  }
  // Session contactId is CRM context for the assist row — not proof they are on
  // this call. Injecting contact.person.email here falsely marks internal and
  // ad-hoc Meets as customer when bootstrap anchors to any linked contact.

  if (session.hostUserId) {
    const hostId = String(session.hostUserId);
    const hostUser = users.find((row) => row.id === hostId);
    pushEmail(invite, hostUser?.email);
  }

  const staff = new Set<string>();
  const people: InternalPerson[] = [];
  for (const user of users) {
    if (!parseCrmRole(user.crm_role_name)) continue;
    const email = user.email?.trim().toLowerCase();
    if (!email) continue;
    staff.add(email);
    if (!invite.has(email)) continue;
    people.push({
      userId: user.id,
      email,
      name: displayNameFromSetupUser(user),
      role: parseCrmRole(user.crm_role_name) ?? "viewer",
      team: internalTeamFromRole(user.crm_role_name),
    });
  }
  for (const email of domains.overrideEmails) {
    const normalized = email.trim().toLowerCase();
    if (normalized) staff.add(normalized);
  }
  for (const email of domains.overrideEmails) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !invite.has(normalized)) continue;
    if (people.some((person) => person.email === normalized)) continue;
    const user = users.find((row) => row.email?.trim().toLowerCase() === normalized);
    if (!user) continue;
    people.push({
      userId: user.id,
      email: normalized,
      name: displayNameFromSetupUser(user),
      role: parseCrmRole(user.crm_role_name) ?? "viewer",
      team: internalTeamFromRole(user.crm_role_name),
    });
  }

  // Calendar invites use the Google account, which is often not the CRM work
  // email. A connected Google address is still that employee, so it must not
  // count as a customer when it is also saved on a contact.
  const userIds: bigint[] = [];
  for (const user of users) {
    try {
      userIds.push(BigInt(user.id));
    } catch {
      /* skip a non-numeric id */
    }
  }
  let organizationIdValue: bigint | null = null;
  try {
    organizationIdValue = BigInt(organizationId);
  } catch {
    organizationIdValue = null;
  }
  const googleEmails = new Map<string, string[]>();
  if (organizationIdValue != null && userIds.length) {
    const connections = await prisma.userIntegrationConnection.findMany({
      where: {
        organizationId: organizationIdValue,
        provider: "google",
        userId: { in: userIds },
      },
      select: { userId: true, accountEmail: true },
    });
    for (const connection of connections) {
      const email = connection.accountEmail?.trim().toLowerCase();
      if (!email?.includes("@")) continue;
      staff.add(email);
      const userId = String(connection.userId);
      const aliases = googleEmails.get(userId) ?? [];
      if (!aliases.includes(email)) aliases.push(email);
      googleEmails.set(userId, aliases);
      if (!invite.has(email)) continue;
      const existing = people.find((person) => person.userId === userId);
      if (existing) {
        const known = new Set(existing.emails ?? []);
        known.add(email);
        existing.emails = [...known];
        continue;
      }
      const user = users.find((row) => row.id === userId);
      if (!user) continue;
      people.push({
        userId,
        email,
        name: displayNameFromSetupUser(user),
        role: parseCrmRole(user.crm_role_name) ?? "viewer",
        team: internalTeamFromRole(user.crm_role_name),
      });
    }
  }

  const customerEmails: string[] = [];
  for (const email of invite) {
    if (staff.has(email)) continue;
    const contactId = await findCrmContactIdByEmail(email, organizationId);
    if (contactId) customerEmails.push(email);
  }

  let kind = classifyInviteEmails({
    inviteEmails: [...invite],
    customerEmails,
    staffEmails: [...staff],
  });
  const liveCaptureActivity =
    activity?.providerMessageId?.startsWith("gmeet:live:") === true;
  // Ad-hoc `gmeet:live:*` activities still bind a CRM contact for Sales Assist.
  if (liveCaptureActivity && kind === "customer" && !session.contactId?.trim()) {
    kind = "internal";
  }

  // Both people are CRM users with emails. The Meet tile does not repeat
  // those emails, so the internal roster keeps every user in the org and
  // the turn is matched to one of those emails.
  if (kind === "internal") {
    const seen = new Set(people.map((person) => person.userId));
    for (const user of users) {
      if (seen.has(user.id)) continue;
      const email = user.email?.trim().toLowerCase();
      if (!email) continue;
      seen.add(user.id);
      people.push({
        userId: user.id,
        email,
        name: displayNameFromSetupUser(user),
        role: parseCrmRole(user.crm_role_name) ?? "viewer",
        team: internalTeamFromRole(user.crm_role_name),
      });
    }
  }
  for (const person of people) {
    const aliases = googleEmails.get(person.userId);
    if (!aliases?.length) continue;
    const extra = new Set(person.emails ?? []);
    for (const email of aliases) {
      if (email !== person.email) extra.add(email);
    }
    if (extra.size) person.emails = [...extra];
  }

  const roster: InternalRoster = {
    kind,
    organizationId,
    people,
    overrideEmails: domains.overrideEmails,
  };
  cache.set(key, { at: Date.now(), roster });
  return roster;
}

export function clearInternalRosterCache(sessionId?: string): void {
  if (sessionId) cache.delete(sessionId.trim());
  else cache.clear();
}
