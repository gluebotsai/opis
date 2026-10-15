/**
 * Session state for Meet channel bindings. Used when MEET_CHANNEL_BINDINGS
 * is shadow or 1. Shadow logs the verdict and leaves coaching on the
 * hostMeetName path. Roster failures stay unresolved: this module never
 * turns an unknown channel into a customer.
 */

import { prisma } from "@/dao/db/prisma";
import { meetCodeFromGoogleMeetUrl } from "@/lib/meeting-body";
import {
  decideChannelBinding,
  googleSubMatchesRoster,
  meetChannelBindingsMode,
  type ChannelBindingDecision,
  type ChannelBindingState,
  type RecentEmployeeSpeech,
} from "@/lib/meet-channel-bindings";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";
import { isInternalEmail, resolveInternalDomains } from "@/service/account/internal-domains";
import { listSetupUsersForOrg } from "@/service/account/setup-users";
import { parseCrmRole } from "@/service/auth/rbac";
import { getValidGoogleAccessToken } from "@/service/google/access-token";
import { resolveMeetRoster, type PeopleLookup } from "@/service/transcripts/meet-roster";

const ROSTER_RETRY_MS = 15_000;
const ROSTER_GIVE_UP_MS = 60_000;

type StoredBindingState = ChannelBindingState & {
  recentEmployee: RecentEmployeeSpeech | null;
  lookups: PeopleLookup[];
  rosterError: string | null;
  rosterFetchedAt: number;
  rosterStartedAt: number;
  googleSubMatchLogged: boolean;
};

function emptyState(): StoredBindingState {
  return {
    rosterStatus: "pending",
    roster: [],
    employeeEmails: [],
    bindings: [],
    recentEmployee: null,
    lookups: [],
    customerTiles: [],
    rosterError: null,
    rosterFetchedAt: 0,
    rosterStartedAt: 0,
    googleSubMatchLogged: false,
  };
}

function readState(meta: unknown): StoredBindingState {
  const base = emptyState();
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return base;
  const identity = (meta as { attendeeIdentity?: unknown }).attendeeIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return base;
  const raw = (identity as { channelBindingState?: unknown }).channelBindingState;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const row = raw as Partial<StoredBindingState>;
  return {
    rosterStatus:
      row.rosterStatus === "ready" || row.rosterStatus === "failed" || row.rosterStatus === "pending"
        ? row.rosterStatus
        : "pending",
    roster: Array.isArray(row.roster) ? row.roster : [],
    employeeEmails: Array.isArray(row.employeeEmails) ? row.employeeEmails : [],
    bindings: Array.isArray(row.bindings) ? row.bindings : [],
    recentEmployee:
      row.recentEmployee && typeof row.recentEmployee === "object"
        ? row.recentEmployee
        : null,
    lookups: Array.isArray(row.lookups) ? row.lookups : [],
    customerTiles: Array.isArray(row.customerTiles)
      ? row.customerTiles.filter((name): name is string => typeof name === "string")
      : [],
    rosterError: typeof row.rosterError === "string" ? row.rosterError : null,
    rosterFetchedAt: typeof row.rosterFetchedAt === "number" ? row.rosterFetchedAt : 0,
    rosterStartedAt: typeof row.rosterStartedAt === "number" ? row.rosterStartedAt : 0,
    googleSubMatchLogged: row.googleSubMatchLogged === true,
  };
}

async function employeeEmailsForOrg(
  organizationId: string,
  configuredEmails: string[],
): Promise<string[]> {
  const [users, domains] = await Promise.all([
    listSetupUsersForOrg(organizationId),
    resolveInternalDomains(organizationId),
  ]);
  const emails = new Set<string>();
  for (const user of users) {
    if (!parseCrmRole(user.crm_role_name)) continue;
    const email = user.email?.trim().toLowerCase();
    if (email?.includes("@")) emails.add(email);
  }
  for (const email of domains.overrideEmails) {
    if (isInternalEmail(email, domains)) emails.add(email.trim().toLowerCase());
  }
  for (const email of configuredEmails) emails.add(email);
  return [...emails];
}

/** Configured Google mailboxes of active CRM users. Meet join uses these, not the login address. */
async function employeeMailboxesForOrg(
  organizationId: string,
): Promise<Array<{ accountEmail: string; accessToken: string }>> {
  let organizationIdValue: bigint;
  try {
    organizationIdValue = BigInt(organizationId);
  } catch {
    return [];
  }
  const users = await listSetupUsersForOrg(organizationId);
  const userIds: bigint[] = [];
  for (const user of users) {
    if (!parseCrmRole(user.crm_role_name)) continue;
    try {
      userIds.push(BigInt(user.id));
    } catch {
      /* skip */
    }
  }
  if (!userIds.length) return [];
  const connections = await prisma.userIntegrationConnection.findMany({
    where: { organizationId: organizationIdValue, provider: "google", userId: { in: userIds } },
    select: { userId: true, accountEmail: true },
  });
  const mailboxes: Array<{ accountEmail: string; accessToken: string }> = [];
  for (const connection of connections) {
    const accountEmail = connection.accountEmail?.trim().toLowerCase() || "";
    if (!accountEmail.includes("@")) continue;
    const accessToken = await getValidGoogleAccessToken(String(connection.userId)).catch(() => null);
    if (!accessToken) continue;
    mailboxes.push({ accountEmail, accessToken });
  }
  return mailboxes;
}

async function refreshRoster(
  sessionId: string,
  state: StoredBindingState,
  now: number,
): Promise<StoredBindingState> {
  if (state.rosterFetchedAt && now - state.rosterFetchedAt < ROSTER_RETRY_MS) return state;
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { joinUrl: true, hostUserId: true, organizationId: true },
  });
  const startedAt = state.rosterStartedAt || now;
  const next: StoredBindingState = { ...state, rosterStartedAt: startedAt, rosterFetchedAt: now };
  if (!session?.hostUserId || !session.joinUrl) {
    next.rosterStatus = "failed";
    next.rosterError = "missing_session_link";
    return next;
  }
  const meetCode = meetCodeFromGoogleMeetUrl(session.joinUrl);
  const token = await getValidGoogleAccessToken(String(session.hostUserId)).catch(() => null);
  if (!meetCode || !token) {
    next.rosterError = !meetCode ? "missing_meet_code" : "no_organizer_token";
    next.rosterStatus = now - startedAt >= ROSTER_GIVE_UP_MS ? "failed" : "pending";
    return next;
  }
  let mailboxes: Array<{ accountEmail: string; accessToken: string }> = [];
  try {
    mailboxes = await employeeMailboxesForOrg(String(session.organizationId));
    next.employeeEmails = await employeeEmailsForOrg(
      String(session.organizationId),
      mailboxes.map((row) => row.accountEmail),
    );
  } catch {
    next.rosterStatus = "pending";
    return next;
  }
  if (next.employeeEmails.length === 0) {
    next.rosterStatus = "failed";
    return next;
  }
  const roster = await resolveMeetRoster({
    accessToken: token,
    meetCode,
    employeeMailboxes: mailboxes,
  }).catch(() => ({
    ok: false as const,
    error: "roster_threw",
    lookups: [] as PeopleLookup[],
    customers: [] as Array<{ userId: string | null; displayName: string }>,
  }));
  next.lookups = roster.lookups;
  next.rosterError = roster.ok ? null : roster.error;
  next.customerTiles = roster.ok ? roster.customers.map((row) => row.displayName) : [];
  if (!roster.ok) {
    const giveUp = now - startedAt >= ROSTER_GIVE_UP_MS || roster.error === "ambiguous_conference";
    next.rosterStatus = giveUp ? "failed" : "pending";
    return next;
  }
  next.roster = roster.entries;
  next.rosterStatus = "ready";
  return next;
}

function googleSubsFromMeta(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const identity = (meta as { attendeeIdentity?: unknown }).attendeeIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return [];
  const raw = (identity as { internalIdentities?: unknown }).internalIdentities;
  if (!Array.isArray(raw)) return [];
  const subs: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const sub = (item as { googleSub?: unknown }).googleSub;
    if (typeof sub === "string" && sub.trim()) subs.push(sub.trim());
  }
  return subs;
}

async function writeState(sessionId: string, state: StoredBindingState): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  if (!session) return;
  const base =
    session.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? { ...(session.meta as Record<string, unknown>) }
      : {};
  const prev =
    base.attendeeIdentity &&
    typeof base.attendeeIdentity === "object" &&
    !Array.isArray(base.attendeeIdentity)
      ? { ...(base.attendeeIdentity as Record<string, unknown>) }
      : {};
  base.attendeeIdentity = { ...prev, channelBindingState: state };
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: { meta: base as object },
  });
}

export async function decideSessionChannelBinding(input: {
  sessionId: string;
  channel: string;
  glow?: string | null;
  activityAtMs: number;
  utteranceText?: string | null;
  hostPath?: { role: string; email: string | null; name: string } | null;
}): Promise<ChannelBindingDecision> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: input.sessionId },
    select: { meta: true },
  });
  const loaded = readState(session?.meta);
  const refreshed = await refreshRoster(input.sessionId, loaded, input.activityAtMs);
  const decision = decideChannelBinding({
    channel: input.channel,
    glow: input.glow,
    activityAtMs: input.activityAtMs,
    utteranceText: input.utteranceText,
    state: refreshed,
    recentEmployee: refreshed.recentEmployee,
  });
  const stored: StoredBindingState = {
    ...decision.state,
    recentEmployee: decision.recentEmployee,
    lookups: refreshed.lookups,
    rosterError: refreshed.rosterError,
    rosterFetchedAt: refreshed.rosterFetchedAt,
    rosterStartedAt: refreshed.rosterStartedAt,
    googleSubMatchLogged: refreshed.googleSubMatchLogged,
  };
  if (
    !stored.googleSubMatchLogged &&
    (stored.lookups.length > 0 || stored.rosterStatus === "failed")
  ) {
    const googleSubs = googleSubsFromMeta(session?.meta);
    const compared = googleSubMatchesRoster({
      googleSubs,
      userIds: stored.lookups.map((row) => row.userId),
    });
    logMeetAssistPanel("channel_binding_google_sub", {
      sessionId: input.sessionId,
      googleSubs,
      userIds: stored.lookups.map((row) => row.userId),
      equal: compared.equal,
      matches: compared.matches,
    });
    stored.googleSubMatchLogged = true;
  }
  await writeState(input.sessionId, stored);
  logMeetAssistPanel("channel_binding", {
    sessionId: input.sessionId,
    mode: meetChannelBindingsMode(),
    channel: input.channel,
    roster: stored.roster.map((row) => ({
      email: row.email,
      userId: row.userId,
      earliestStartMs: row.earliestStartMs,
      latestEndMs: row.latestEndMs,
    })),
    rosterStatus: stored.rosterStatus,
    rosterError: stored.rosterError,
    emailResolutions: stored.lookups,
    binding: decision.log,
    bindingRole: decision.role,
    hostMeetName: input.hostPath ?? null,
  });
  return decision;
}
