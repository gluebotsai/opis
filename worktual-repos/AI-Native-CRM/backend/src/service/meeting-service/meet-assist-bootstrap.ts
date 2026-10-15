/**
 * Meet add-on (Path B): resolve CRM assist session + panel SSE token.
 */

import { prisma } from "@/dao/db/prisma";
import {
  buildMeetingActivityBody,
  meetCodeFromGoogleMeetUrl,
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
} from "@/lib/meeting-body";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { findCrmContactIdByEmail } from "@/dao/inbox/contact-by-email";
import {
  ensureAssistSessionForMeeting,
  getLatestHeardForAssistSession,
  rememberAssistTimeZone,
} from "@/service/ai/meeting-assist";
import { signMeetingAssistPanelToken } from "@/service/meeting-assist/panel-token";
import {
  findSessionIdByCaptureBotId,
  patchCaptureBotMeta,
  readCaptureBotMeta,
} from "@/service/transcripts/meeting-capture";
import { syncVexaLiveSegmentsForActivity } from "@/service/meeting-service/vexa-live-assist-sync";
import { isMeetingServiceConfigured } from "@/service/meeting-service/config";
import {
  lookupMeetingServiceByUrl,
  mapMeetingServiceStatus,
} from "@/service/meeting-service/client";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";
import { getPeopleByIds } from "@/dao/account/account-repository";
import { getContact } from "@/dao/contacts/contact-service";
import { findLeadSummary } from "@/dao/ai/lead-summary-store";
import { findScoringJobByContactId } from "@/dao/ai/lead-scoring-store";
import { getMeetingAssistChatHistory } from "@/service/ai/meeting-assist-chat-history";

async function findMeetingActivityByMeetCode(
  organizationId: bigint,
  meetCode: string,
): Promise<{
  id: string;
  contactId: string;
  body: string | null;
} | null> {
  const needle = meetCode.toLowerCase();
  const activities = await prisma.contactActivity.findMany({
    where: {
      organizationId,
      type: "meeting",
      body: { contains: needle, mode: "insensitive" },
    },
    orderBy: [{ dueAt: "desc" }, { updatedAt: "desc" }],
    take: 12,
    select: { id: true, contactId: true, body: true },
  });
  for (const row of activities) {
    const link = parseMeetingLinkFromBody(row.body);
    const code = link ? meetCodeFromGoogleMeetUrl(link) : null;
    if (code?.toLowerCase() === needle) {
      return row;
    }
  }
  return null;
}

async function resolveBootstrapContactId(input: {
  organizationId: bigint;
  userId: string;
  hostEmail?: string | null;
  contactHint?: string | null;
}): Promise<string | null> {
  const hint = input.contactHint?.trim();
  if (hint) return hint;

  const email = input.hostEmail?.trim().toLowerCase();
  if (email?.includes("@")) {
    const byEmail = await findCrmContactIdByEmail(
      email,
      String(input.organizationId),
    );
    if (byEmail) return byEmail;
  }

  let userId: bigint;
  try {
    userId = BigInt(input.userId);
  } catch {
    return null;
  }

  const owned = await prisma.contactProfile.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [{ ownerUserId: userId }, { createdByUserId: userId }],
    },
    orderBy: { updatedAt: "desc" },
    select: { accountContactId: true },
  });
  return owned?.accountContactId ?? null;
}

async function ensureLiveMeetingActivityForBootstrap(input: {
  organizationId: bigint;
  organizationIdStr: string;
  userId: string;
  contactId: string;
  meetingUrl: string;
  meetCode: string | null;
  hostEmail?: string | null;
  hostMeetName?: string | null;
}): Promise<{ id: string; contactId: string; body: string | null } | null> {
  if (input.meetCode) {
    const byCode = await findMeetingActivityByMeetCode(
      input.organizationId,
      input.meetCode,
    );
    if (byCode) return byCode;
  }

  const latest = await prisma.contactActivity.findFirst({
    where: {
      organizationId: input.organizationId,
      contactId: input.contactId,
      type: "meeting",
    },
    orderBy: { dueAt: "desc" },
    select: { id: true, contactId: true, body: true },
  });
  if (latest && input.meetCode) {
    const link = parseMeetingLinkFromBody(latest.body);
    const code = link ? meetCodeFromGoogleMeetUrl(link) : null;
    if (code?.toLowerCase() === input.meetCode.toLowerCase()) {
      return latest;
    }
  } else if (latest && !input.meetCode) {
    return latest;
  }

  const now = new Date();
  const organizerEmail =
    input.hostEmail?.trim().toLowerCase() || "host@worktual.local";
  const organizerName =
    input.hostMeetName?.trim() ||
    organizerEmail.split("@")[0] ||
    "Host";
  const whenLabel = now.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const body = buildMeetingActivityBody({
    topic: "Live Google Meet",
    whenLabel,
    organizerName,
    organizerEmail,
    guestEmails: [],
    provider: "google_meet",
    meetingLink: input.meetingUrl,
    externalMeetingId: input.meetCode,
  });
  const providerMessageId = input.meetCode
    ? `gmeet:live:${input.meetCode.toLowerCase()}`
    : undefined;

  if (providerMessageId) {
    const existing = await prisma.contactActivity.findUnique({
      where: { providerMessageId },
      select: { id: true, contactId: true, body: true },
    });
    if (existing) return existing;
  }

  const subject = input.meetCode
    ? `Google Meet (${input.meetCode})`
    : "Google Meet";
  const created = await createContactActivity(input.contactId, {
    type: "meeting",
    subject,
    body,
    dueAt: now,
    folder: "inbox",
    createdByUserId: input.userId,
    organizationId: input.organizationIdStr,
    providerMessageId,
  });
  return {
    id: created.id,
    contactId: input.contactId,
    body: created.body ?? body,
  };
}

async function bindAssistSessionToInflightMeeting(input: {
  organizationId: string;
  userId: string;
  meetingUrl: string;
  meetCode: string | null;
  meetingServiceId: string;
  meetingServiceStatus: string;
  meetingServiceError?: string | null;
  activity: { id: string; contactId: string; body: string | null };
}): Promise<{ sessionId: string; activityId: string } | null> {
  await ensureAssistSessionForMeeting({
    activityId: input.activity.id,
    contactId: input.activity.contactId,
    organizationId: input.organizationId,
    hostUserId: input.userId,
    provider: parseProviderFromMeetingBody(input.activity.body),
    externalMeetingId: input.meetCode,
    joinUrl: input.meetingUrl,
  });

  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId: input.activity.id },
    select: { id: true },
  });
  if (!session) return null;

  await patchCaptureBotMeta(session.id, {
    status: mapMeetingServiceStatus(
      input.meetingServiceStatus,
      input.meetingServiceError,
    ),
    botId: input.meetingServiceId,
    provider: "vexa",
    meetingServiceStatus: input.meetingServiceStatus,
  });

  invalidateBootstrapCache(input.organizationId, input.meetingUrl);
  return { sessionId: session.id, activityId: input.activity.id };
}

/**
 * `resolveAssistSessionForMeetUrl` and the bootstrap chain around it were the
 * single biggest source of Postgres pool-timeout errors ("Timed out fetching
 * a new connection", pool limit 5) — the Meet add-on retries bootstrap every
 * ~4s on failure, polls sync-live every ~2s, and every open tab does the same
 * lookup independently. The org+meetCode → session binding doesn't change
 * within a few seconds, so cache it briefly.
 */
const BOOTSTRAP_HIT_CACHE_TTL_MS = Number(
  process.env.MEET_BOOTSTRAP_CACHE_MS || 5_000,
);
const bootstrapHitCache = new Map<
  string,
  { value: { sessionId: string; activityId: string } | null; expiresAt: number }
>();

function bootstrapCacheKey(organizationId: string, meetingUrl: string): string {
  return `${organizationId}:${meetingUrl.trim().toLowerCase()}`;
}

export async function resolveAssistSessionForMeetUrl(input: {
  organizationId: string;
  meetingUrl: string;
}): Promise<{ sessionId: string; activityId: string } | null> {
  const cacheKey = bootstrapCacheKey(input.organizationId, input.meetingUrl);
  const cached = bootstrapHitCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const code = meetCodeFromGoogleMeetUrl(input.meetingUrl);
  if (!code) return null;
  const orgId = BigInt(input.organizationId);
  const needle = code.toLowerCase();

  const candidates = await prisma.meetingAssistSession.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { joinUrl: { contains: needle, mode: "insensitive" } },
        { externalMeetingId: { equals: needle, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { id: true, activityId: true, meta: true, status: true },
  });

  const setCache = (
    value: { sessionId: string; activityId: string } | null,
  ) => {
    bootstrapHitCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + BOOTSTRAP_HIT_CACHE_TTL_MS,
    });
    return value;
  };

  if (!candidates.length) return setCache(null);

  const scored = candidates.map((row) => {
    const cap = readCaptureBotMeta(row.meta);
    let score = 0;
    if (cap?.status === "joined") score += 3;
    if (cap?.status === "scheduled") score += 2;
    if (cap?.botId) score += 1;
    if (row.status === "active") score += 1;
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = scored[0]?.row;
  if (!pick) return setCache(null);
  return setCache({ sessionId: pick.id, activityId: pick.activityId });
}

/** Drop a cached bootstrap resolution — call once a session is created/updated
 * for this org+URL so the next lookup doesn't wait out the TTL. */
export function invalidateBootstrapCache(
  organizationId: string,
  meetingUrl: string,
): void {
  bootstrapHitCache.delete(bootstrapCacheKey(organizationId, meetingUrl));
}

/**
 * Resolve assist context the same way `/v1/assist/ask` does: from meeting-service's
 * own in-flight `Meeting` row (`inflight_by_url` — the same lookup Ask always
 * succeeds against), not from CRM-side URL/body text matching. This is the robust
 * path — it does not depend on the CRM activity body containing this exact Meet
 * link, or on a `meetingAssistSession` row having been created in advance, so it
 * doesn't race with meeting scheduling / notetaker dispatch the way URL matching can.
 */
async function resolveAssistSessionViaInflightNotetaker(input: {
  organizationId: string;
  userId: string;
  meetingUrl: string;
  hostEmail?: string | null;
  hostMeetName?: string | null;
}): Promise<{ sessionId: string; activityId: string } | null> {
  if (!isMeetingServiceConfigured()) return null;

  const looked = await lookupMeetingServiceByUrl({
    organizationId: input.organizationId,
    userId: input.userId,
    meetingUrl: input.meetingUrl,
  });
  if (!looked.ok) return null;

  const ms = looked.meeting;
  const meetCode = meetCodeFromGoogleMeetUrl(input.meetingUrl);
  const orgId = BigInt(input.organizationId);

  // Already-bound CRM session for this exact meeting-service bot id.
  const sessionIdByBot = await findSessionIdByCaptureBotId(ms.id);
  if (sessionIdByBot) {
    const linked = await prisma.meetingAssistSession.findUnique({
      where: { id: sessionIdByBot },
      select: { id: true, activityId: true, organizationId: true },
    });
    if (linked && linked.organizationId === orgId) {
      await prisma.meetingAssistSession.update({
        where: { id: linked.id },
        data: {
          ...(meetCode ? { externalMeetingId: meetCode } : {}),
          joinUrl: input.meetingUrl,
          status: "active",
        },
      });
      invalidateBootstrapCache(input.organizationId, input.meetingUrl);
      return { sessionId: linked.id, activityId: linked.activityId };
    }
  }

  if (meetCode) {
    const byCode = await findMeetingActivityByMeetCode(orgId, meetCode);
    if (byCode) {
      return bindAssistSessionToInflightMeeting({
        organizationId: input.organizationId,
        userId: input.userId,
        meetingUrl: input.meetingUrl,
        meetCode,
        meetingServiceId: ms.id,
        meetingServiceStatus: ms.status,
        meetingServiceError: ms.error_message,
        activity: byCode,
      });
    }
  }

  // Derive contactId from meeting-service entity binding, signed-in host email,
  // or the host user's owned contact — ad-hoc internal Meets often have no CRM row yet.
  let contactHint: string | null = null;
  if (ms.entity_type === "contact" && ms.entity_id?.trim()) {
    contactHint = ms.entity_id.trim();
  } else if (ms.entity_type === "deal" && ms.entity_id?.trim()) {
    const deal = await prisma.deal.findFirst({
      where: { id: ms.entity_id.trim(), organizationId: orgId },
      select: { contactId: true },
    });
    contactHint = deal?.contactId ?? null;
  }

  const contactId = await resolveBootstrapContactId({
    organizationId: orgId,
    userId: input.userId,
    hostEmail: input.hostEmail,
    contactHint,
  });
  if (!contactId) return null;

  const activity = await ensureLiveMeetingActivityForBootstrap({
    organizationId: orgId,
    organizationIdStr: input.organizationId,
    userId: input.userId,
    contactId,
    meetingUrl: input.meetingUrl,
    meetCode,
    hostEmail: input.hostEmail,
    hostMeetName: input.hostMeetName,
  });
  if (!activity) return null;

  return bindAssistSessionToInflightMeeting({
    organizationId: input.organizationId,
    userId: input.userId,
    meetingUrl: input.meetingUrl,
    meetCode,
    meetingServiceId: ms.id,
    meetingServiceStatus: ms.status,
    meetingServiceError: ms.error_message,
    activity,
  });
}

export async function handleMeetAssistBootstrap(input: {
  organizationId: string;
  userId: string;
  meetingUrl: string;
  /** Google account name of the person who opened the Meet panel. */
  hostMeetName?: string | null;
  hostEmail?: string | null;
  /** Google ID token subject. Persisted only; not used to bind a channel. */
  hostGoogleSub?: string | null;
  /** IANA zone from the rep's browser. */
  timeZone?: string | null;
}): Promise<
  | {
      ok: true;
      sessionId: string;
      activityId: string;
      panelToken: string;
      eventsPath: string;
      segmentsSynced: number;
      lastHeard: { speaker: string | null; text: string } | null;
      lastSuggestions: unknown;
      meetingKind: "customer" | "internal";
      contactId: string | null;
      contactName: string | null;
      contactCard: {
        name: string | null;
        title: string | null;
        company: string | null;
        email: string | null;
        industry: string | null;
        leadStatus: string | null;
        leadSource: string | null;
        score: number | null;
        fitScore: number | null;
        intentScore: number | null;
        summary: string | null;
      } | null;
      chatHistory: Awaited<ReturnType<typeof getMeetingAssistChatHistory>>;
      /** Bounded "mark as customer" picker options for this meeting. */
      customerPool: Array<{ email: string; name: string }>;
    }
  | { ok: false; error: string; status: number }
> {
  const meetingUrl = input.meetingUrl.trim();
  if (!meetingUrl) {
    return { ok: false, error: "meeting_url is required", status: 422 };
  }

  const orgId = BigInt(input.organizationId);

  // 1) Fast path: CRM session already has this exact Meet URL/code.
  let hit = await resolveAssistSessionForMeetUrl({
    organizationId: input.organizationId,
    meetingUrl,
  });

  // 2) Robust path: same resolution `/v1/assist/ask` relies on (meeting-service's
  // own in-flight Meeting row → entity → most-recent meeting activity). Ask never
  // 404s on a live call, so try this before giving up — it doesn't depend on the
  // CRM activity body literally containing this URL or on session pre-creation.
  if (!hit) {
    hit = await resolveAssistSessionViaInflightNotetaker({
      organizationId: input.organizationId,
      userId: input.userId,
      meetingUrl,
      hostEmail: input.hostEmail,
      hostMeetName: input.hostMeetName,
    });
  }

  // 3) Last resort: legacy body-text scan for the Meet code.
  if (!hit) {
    const code = meetCodeFromGoogleMeetUrl(meetingUrl);
    if (code) {
      const activity = await findMeetingActivityByMeetCode(orgId, code);
      if (activity) {
        await ensureAssistSessionForMeeting({
          activityId: activity.id,
          contactId: activity.contactId,
          organizationId: input.organizationId,
          hostUserId: input.userId,
          provider: parseProviderFromMeetingBody(activity.body),
          externalMeetingId: code,
          joinUrl: meetingUrl,
        });
        // The very first lookup above may have cached a "no session yet"
        // miss for this org+URL — drop it now that one was just created.
        invalidateBootstrapCache(input.organizationId, meetingUrl);
        hit = await resolveAssistSessionForMeetUrl({
          organizationId: input.organizationId,
          meetingUrl,
        });
      }
    }
  }
  if (!hit) {
    return {
      ok: false,
      error:
        "No CRM assist session for this Meet link. Schedule the meeting in CRM and send the notetaker first.",
      status: 404,
    };
  }

  await rememberAssistTimeZone(hit.sessionId, input.timeZone);

  if (input.hostMeetName?.trim() || input.hostEmail?.includes("@")) {
    // Every viewer who opens the panel (rep, pre-sales, ...) contributes
    // their own signed-in identity here — not just whoever bootstraps
    // first — so each of them is excluded from customer coaching.
    const { rememberInternalIdentity } = await import(
      "@/service/ai/meeting-attendee-lock"
    );
    const { clearAssistLiveContextCache } = await import(
      "@/service/ai/meeting-assist-live-context"
    );
    await rememberInternalIdentity(hit.sessionId, {
      name: input.hostMeetName,
      email: input.hostEmail,
      googleSub: input.hostGoogleSub,
    });
    clearAssistLiveContextCache(hit.sessionId);
  }

  const sync = await syncVexaLiveSegmentsForActivity(hit.activityId);

  const panelToken = signMeetingAssistPanelToken({
    userId: input.userId,
    organizationId: input.organizationId,
    sessionId: hit.sessionId,
  });

  const eventsPath = `/api/meeting-assist/sessions/${encodeURIComponent(hit.sessionId)}/events`;
  const { loadInternalRoster, clearInternalRosterCache } = await import(
    "@/service/ai/internal-meeting-roster"
  );
  const { loadAssistLiveContext } = await import(
    "@/service/ai/meeting-assist-live-context"
  );
  clearInternalRosterCache(hit.sessionId);
  const [lastHeard, sessionRow, roster, chatHistory, liveContext] = await Promise.all([
    getLatestHeardForAssistSession(hit.sessionId),
    prisma.meetingAssistSession.findUnique({
      where: { id: hit.sessionId },
      select: { lastSuggestions: true, contactId: true, activityId: true },
    }),
    loadInternalRoster(hit.sessionId).catch(() => null),
    getMeetingAssistChatHistory(hit.sessionId, input.userId),
    loadAssistLiveContext(hit.sessionId).catch(() => null),
  ]);
  const customerPool = liveContext?.customerPool ?? [];
  const meetingKind = roster?.kind === "internal" ? "internal" : "customer";
  let contactId = meetingKind === "customer" ? sessionRow?.contactId ?? null : null;
  if (meetingKind === "customer" && !contactId && sessionRow?.activityId) {
    const activity = await prisma.contactActivity.findUnique({
      where: { id: sessionRow.activityId },
      select: { contactId: true },
    });
    contactId = activity?.contactId ?? null;
  }
  const [contact, leadSummary, scoreJob] = contactId
    ? await Promise.all([
        getContact(contactId).catch(() => null),
        findLeadSummary(input.organizationId, contactId).catch(() => null),
        findScoringJobByContactId(contactId).catch(() => null),
      ])
    : [null, null, null];
  const person =
    contact?.person ??
    (contactId ? (await getPeopleByIds([contactId]))[0] ?? null : null);
  const contactName =
    contact?.displayName ||
    `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim() ||
    null;
  const contactCard = person
    ? {
        name: contactName,
        title: person.title || null,
        company: person.company?.name || null,
        email: person.email || null,
        industry: person.company?.industry || null,
        leadStatus: person.leadStatus || null,
        leadSource: contact?.crm.leadSource || null,
        score: typeof scoreJob?.score === "number" ? scoreJob.score : null,
        fitScore: typeof scoreJob?.fitScore === "number" ? scoreJob.fitScore : null,
        intentScore:
          typeof scoreJob?.intentScore === "number" ? scoreJob.intentScore : null,
        summary: leadSummary?.summary?.trim() || null,
      }
    : null;

  logMeetAssistPanel("meet_bootstrap", {
    sessionId: hit.sessionId,
    activityId: hit.activityId,
    meetingUrl,
    segmentsSynced: sync.inserted,
    lastHeardPreview: lastHeard?.text?.slice(0, 80) ?? null,
    hasLastSuggestions: Boolean(sessionRow?.lastSuggestions),
  });

  return {
    ok: true,
    sessionId: hit.sessionId,
    activityId: hit.activityId,
    panelToken,
    eventsPath,
    segmentsSynced: sync.inserted,
    lastHeard: meetingKind === "internal" ? null : lastHeard,
    lastSuggestions: meetingKind === "internal" ? null : sessionRow?.lastSuggestions ?? null,
    meetingKind,
    contactId,
    contactName,
    contactCard,
    chatHistory,
    customerPool,
  };
}
