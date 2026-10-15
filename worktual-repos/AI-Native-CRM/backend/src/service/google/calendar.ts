/**
 * Google OAuth (Gmail send + read). Calendar events live in Worktual CRM.
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and a redirect URI.
 * Enable Gmail API in Google Cloud Console.
 */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_EVENTS =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Invite delivery mode for the async flush after a fast write (none on insert/patch). */
const CALENDAR_SEND_UPDATES =
  process.env.GOOGLE_CALENDAR_SEND_UPDATES?.trim() || "externalOnly";

/** When true (default), create/patch use sendUpdates=none; invites flush in background. */
function googleCalendarDeferSendUpdates(): boolean {
  const raw = process.env.GOOGLE_CALENDAR_DEFER_SEND_UPDATES?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

function sendUpdatesForWrite(): string {
  return googleCalendarDeferSendUpdates() ? "none" : CALENDAR_SEND_UPDATES;
}

function googleCalendarFetchTimeoutMs(): number {
  const n = Number(process.env.GOOGLE_CALENDAR_FETCH_TIMEOUT_MS || 30_000);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 120_000) : 30_000;
}

async function googleCalendarFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ms = googleCalendarFetchTimeoutMs();
  const signal =
    init.signal ??
    AbortSignal.timeout(ms);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(
        `Google Calendar request timed out after ${Math.round(ms / 1000)}s. ` +
          "Try again — if this repeats, check network/firewall to googleapis.com.",
      );
    }
    throw err;
  }
}

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  // modify (superset of readonly) so "Delete forever" can also trash the
  // message in Gmail — otherwise the next sync reimports it.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  // Meet Media API (Developer Preview) — customer-only live Assist
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/meetings.conference.media.readonly",
  // People API: people.get(people/{account_id}) can return a Workspace
  // colleague's email when directory profile sharing is on. Domain profile
  // data is gated on this scope (People API intro). Not Admin SDK.
  "https://www.googleapis.com/auth/directory.readonly",
] as const;

const SCOPES = GOOGLE_SCOPES.join(" ");

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

/** Accounts / CRM-bot Gmail client, falling back to the inbox Google app. */
export function googleBotOAuthClient(): {
  clientId: string;
  clientSecret: string;
} | null {
  const accountsId = process.env.ACCOUNTS_GOOGLE_CLIENT_ID?.trim();
  const accountsSecret = process.env.ACCOUNTS_GOOGLE_CLIENT_SECRET?.trim();
  if (accountsId && accountsSecret) {
    return { clientId: accountsId, clientSecret: accountsSecret };
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  return null;
}

export function isGoogleBotConfigured(): boolean {
  return googleBotOAuthClient() != null;
}

/** @deprecated Prefer isGoogleConfigured */
export function isGoogleCalendarConfigured(): boolean {
  return isGoogleConfigured();
}

/**
 * Public browser origin for legacy Next redirects. Prefer FRONTEND_ORIGIN /
 * OAUTH_CALLBACK_ORIGIN via oauth-bff for split-stack.
 */
export function publicAppOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.FRONTEND_ORIGIN?.trim() ||
    process.env.GOOGLE_REDIRECT_URI?.trim()?.replace(/\/api\/google\/oauth\/callback\/?$/, "") ||
    process.env.OAUTH_CALLBACK_ORIGIN?.trim() ||
    "http://localhost:3000";
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (u.hostname === "0.0.0.0" || u.hostname === "::") {
      return "http://localhost:3000";
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:3000";
  }
}

export function googleRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI?.trim()) {
    const uri = process.env.GOOGLE_REDIRECT_URI.trim();
    if (!/0\.0\.0\.0|\[::\]/.test(uri)) return uri;
  }
  const callbackOrigin =
    process.env.OAUTH_CALLBACK_ORIGIN?.trim() ||
    process.env.API_PUBLIC_URL?.trim();
  if (callbackOrigin) {
    try {
      const u = new URL(
        callbackOrigin.includes("://")
          ? callbackOrigin
          : `http://${callbackOrigin}`,
      );
      return `${u.protocol}//${u.host}/api/google/oauth/callback`;
    } catch {
      /* fall through */
    }
  }
  return `${publicAppOrigin()}/api/google/oauth/callback`;
}

export function buildGoogleAuthUrl(
  state: string,
  opts?: { loginHint?: string | null; clientId?: string | null },
): string {
  const params = new URLSearchParams({
    client_id: opts?.clientId?.trim() || process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Always show Google account picker (HubSpot-style), then consent for scopes
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  const hint = opts?.loginHint?.trim();
  if (hint) params.set("login_hint", hint);
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeGoogleCode(
  code: string,
  client?: { clientId: string; clientSecret: string } | null,
): Promise<GoogleTokenResponse> {
  const clientId = client?.clientId?.trim() || process.env.GOOGLE_CLIENT_ID!;
  const clientSecret =
    client?.clientSecret?.trim() || process.env.GOOGLE_CLIENT_SECRET!;
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  return res.json() as Promise<GoogleTokenResponse>;
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const res = await googleCalendarFetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${text}`);
  }
  return res.json() as Promise<GoogleTokenResponse>;
}

export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

export type CreateGoogleMeetingInput = {
  accessToken: string;
  summary: string;
  description?: string;
  /** Wall-clock start, e.g. 2026-07-16T10:13:00 (no Z) */
  startDateTime: string;
  /** IANA timezone, e.g. Asia/Kolkata */
  timeZone: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
  /** When false, use externalMeetingLink instead of Google Meet conference. */
  includeGoogleMeet?: boolean;
  externalMeetingLink?: string | null;
};

export type CreatedGoogleMeeting = {
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
};

function ensureSeconds(dateTimeLocal: string): string {
  const raw = dateTimeLocal.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
    return raw.slice(0, 19);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    return `${raw}:00`;
  }
  throw new Error("Invalid start date/time.");
}

/** Add minutes to a local dateTime string without converting time zones. */
export function addMinutesToLocalDateTime(
  dateTimeLocal: string,
  minutes: number,
): string {
  const base = ensureSeconds(dateTimeLocal);
  const [datePart, timePart] = base.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map(Number);
  const total =
    Date.UTC(y, mo - 1, d, hh, mm, ss ?? 0) + minutes * 60_000;
  const x = new Date(total);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}:${pad(x.getUTCSeconds())}`;
}

export async function createGoogleCalendarMeeting(
  input: CreateGoogleMeetingInput,
): Promise<CreatedGoogleMeeting> {
  const duration = input.durationMinutes ?? 30;
  const startDateTime = ensureSeconds(input.startDateTime);
  const endDateTime = addMinutesToLocalDateTime(startDateTime, duration);
  const timeZone = input.timeZone.trim() || "UTC";
  const includeMeet = input.includeGoogleMeet !== false;
  const externalLink = input.externalMeetingLink?.trim() || null;

  const descriptionParts = [input.description?.trim()].filter(Boolean);
  if (!includeMeet && externalLink) {
    descriptionParts.push(`Join: ${externalLink}`);
  }

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: descriptionParts.length ? descriptionParts.join("\n\n") : undefined,
    location: !includeMeet && externalLink ? externalLink : undefined,
    start: {
      dateTime: startDateTime,
      timeZone,
    },
    end: {
      dateTime: endDateTime,
      timeZone,
    },
  };

  if (includeMeet) {
    const requestId = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    body.conferenceData = {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  if (input.attendeeEmails?.length) {
    const seen = new Set<string>();
    body.attendees = input.attendeeEmails
      .map((email) => email.trim().toLowerCase())
      .filter((email) => {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
        if (seen.has(email)) return false;
        seen.add(email);
        return true;
      })
      .map((email) => ({ email }));
  }

  const send = encodeURIComponent(sendUpdatesForWrite());
  const url = includeMeet
    ? `${GOOGLE_EVENTS}?conferenceDataVersion=1&sendUpdates=${send}`
    : `${GOOGLE_EVENTS}?sendUpdates=${send}`;
  const res = await googleCalendarFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar create failed: ${text}`);
  }

  const data = (await res.json()) as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: {
      entryPoints?: { entryPointType?: string; uri?: string }[];
    };
  };

  const meetFromEntries =
    data.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === "video",
    )?.uri ?? null;

  const created: CreatedGoogleMeeting = {
    eventId: data.id ?? "",
    htmlLink: data.htmlLink ?? null,
    meetLink: includeMeet
      ? meetFromEntries ?? data.hangoutLink ?? null
      : externalLink,
  };

  if (
    googleCalendarDeferSendUpdates() &&
    created.eventId &&
    input.attendeeEmails?.length
  ) {
    scheduleGoogleCalendarInviteDelivery({
      accessToken: input.accessToken,
      eventId: created.eventId,
    });
  }

  return created;
}

/** PATCH with sendUpdates so Google emails guests without blocking the schedule API. */
export async function flushGoogleCalendarSendUpdates(input: {
  accessToken: string;
  eventId: string;
}): Promise<void> {
  const send = encodeURIComponent(CALENDAR_SEND_UPDATES);
  const url = `${GOOGLE_EVENTS}/${encodeURIComponent(input.eventId)}?sendUpdates=${send}`;
  const res = await googleCalendarFetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reminders: { useDefault: true } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar sendUpdates failed: ${text}`);
  }
}

export function scheduleGoogleCalendarInviteDelivery(input: {
  accessToken: string;
  eventId: string;
}): void {
  void flushGoogleCalendarSendUpdates(input).catch((err) => {
    console.error(
      "google_calendar_invite_delivery_async_failed",
      input.eventId,
      err instanceof Error ? err.message : err,
    );
  });
}

export async function updateGoogleCalendarMeetingTime(input: {
  accessToken: string;
  eventId: string;
  startDateTime: string;
  timeZone: string;
  durationMinutes?: number;
  summary?: string;
  description?: string;
  attendeeEmails?: string[];
}): Promise<CreatedGoogleMeeting> {
  const duration = input.durationMinutes ?? 30;
  const startDateTime = ensureSeconds(input.startDateTime);
  const endDateTime = addMinutesToLocalDateTime(startDateTime, duration);
  const timeZone = input.timeZone.trim() || "UTC";
  const patch: Record<string, unknown> = {
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
  };
  if (input.summary?.trim()) patch.summary = input.summary.trim();
  if (input.description?.trim()) patch.description = input.description.trim();
  if (input.attendeeEmails?.length) {
    const seen = new Set<string>();
    patch.attendees = input.attendeeEmails
      .map((email) => email.trim().toLowerCase())
      .filter((email) => {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
        if (seen.has(email)) return false;
        seen.add(email);
        return true;
      })
      .map((email) => ({ email }));
  }

  const send = encodeURIComponent(sendUpdatesForWrite());
  const url = `${GOOGLE_EVENTS}/${encodeURIComponent(input.eventId)}?sendUpdates=${send}`;
  const res = await googleCalendarFetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar reschedule failed: ${text}`);
  }
  const data = (await res.json()) as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: {
      entryPoints?: { entryPointType?: string; uri?: string }[];
    };
  };
  const meetFromEntries =
    data.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === "video",
    )?.uri ?? null;
  const updated: CreatedGoogleMeeting = {
    eventId: data.id || input.eventId,
    htmlLink: data.htmlLink ?? null,
    meetLink: meetFromEntries ?? data.hangoutLink ?? null,
  };
  if (
    googleCalendarDeferSendUpdates() &&
    updated.eventId &&
    input.attendeeEmails?.length
  ) {
    scheduleGoogleCalendarInviteDelivery({
      accessToken: input.accessToken,
      eventId: updated.eventId,
    });
  }
  return updated;
}

export async function updateGoogleCalendarMeetingAttendees(input: {
  accessToken: string;
  eventId: string;
  attendeeEmails: string[];
}): Promise<void> {
  const attendees = input.attendeeEmails
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .map((email) => ({ email }));

  const url = `${GOOGLE_EVENTS}/${encodeURIComponent(input.eventId)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ attendees }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar update failed: ${text}`);
  }
}

export type GoogleCalendarListedEvent = {
  id: string;
  summary: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  htmlLink: string | null;
  meetLink: string | null;
  location: string | null;
  status: string | null;
  /** Attendee emails (lowercased) for CRM contact matching. */
  attendeeEmails: string[];
};

function extractMeetFromGoogleEvent(data: {
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
  description?: string | null;
  location?: string | null;
}): string | null {
  const fromEntries =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ?? null;
  if (fromEntries) return fromEntries;
  if (data.hangoutLink) return data.hangoutLink;
  const haystack = `${data.description ?? ""}\n${data.location ?? ""}`;
  const match = haystack.match(/https?:\/\/meet\.google\.com\/[^\s<>"']+/i);
  return match?.[0] ?? null;
}

function mapGoogleCalendarItem(item: {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; self?: boolean }[];
}): GoogleCalendarListedEvent | null {
  if (!item.id) return null;
  const allDay = Boolean(item.start?.date && !item.start?.dateTime);
  const startAt = item.start?.dateTime ?? item.start?.date ?? "";
  const endAt = item.end?.dateTime ?? item.end?.date ?? null;
  const attendeeEmails = [
    ...new Set(
      (item.attendees ?? [])
        .filter((a) => !a.self)
        .map((a) => (a.email || "").trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
  const emails =
    attendeeEmails.length > 0
      ? attendeeEmails
      : [
          ...new Set(
            (item.attendees ?? [])
              .map((a) => (a.email || "").trim().toLowerCase())
              .filter((e) => e.includes("@")),
          ),
        ];
  return {
    id: item.id,
    summary: item.summary?.trim() || "(No title)",
    description: item.description?.trim() || null,
    startAt,
    endAt,
    allDay,
    htmlLink: item.htmlLink ?? null,
    meetLink: extractMeetFromGoogleEvent(item),
    location: item.location?.trim() || null,
    status: item.status ?? null,
    attendeeEmails: emails,
  };
}

/** List primary-calendar events in [timeMin, timeMax) (ISO instants). */
export async function listGoogleCalendarEvents(input: {
  accessToken: string;
  timeMin: string;
  timeMax: string;
}): Promise<GoogleCalendarListedEvent[]> {
  const params = new URLSearchParams({
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`${GOOGLE_EVENTS}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar list failed: ${text}`);
  }

  const data = (await res.json()) as {
    items?: Parameters<typeof mapGoogleCalendarItem>[0][];
  };

  const out: GoogleCalendarListedEvent[] = [];
  for (const item of data.items ?? []) {
    const mapped = mapGoogleCalendarItem(item);
    if (!mapped || mapped.status === "cancelled") continue;
    if (!mapped.startAt) continue;
    out.push(mapped);
  }

  return out;
}

export type GoogleCalendarSyncPage = {
  events: GoogleCalendarListedEvent[];
  nextSyncToken: string | null;
  resetRequired: boolean;
};

/**
 * Incremental events.list (includes cancelled). 410 → caller must full-sync.
 */
export async function listGoogleCalendarEventChanges(input: {
  accessToken: string;
  syncToken?: string | null;
  timeMin?: string;
  timeMax?: string;
}): Promise<GoogleCalendarSyncPage> {
  const params = new URLSearchParams({
    maxResults: "250",
    showDeleted: "true",
  });
  if (input.syncToken?.trim()) {
    params.set("syncToken", input.syncToken.trim());
  } else {
    params.set("singleEvents", "true");
    if (input.timeMin) params.set("timeMin", input.timeMin);
    if (input.timeMax) params.set("timeMax", input.timeMax);
  }
  const res = await fetch(`${GOOGLE_EVENTS}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
  });
  if (res.status === 410) {
    return { events: [], nextSyncToken: null, resetRequired: true };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar sync list failed: ${text}`);
  }
  const data = (await res.json()) as {
    items?: Parameters<typeof mapGoogleCalendarItem>[0][];
    nextSyncToken?: string;
    nextPageToken?: string;
  };
  const events: GoogleCalendarListedEvent[] = [];
  for (const item of data.items ?? []) {
    const mapped = mapGoogleCalendarItem(item);
    if (mapped) events.push(mapped);
  }
  let nextSyncToken = data.nextSyncToken ?? null;
  let pageToken = data.nextPageToken;
  while (pageToken && !nextSyncToken) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("pageToken", pageToken);
    const pageRes = await fetch(`${GOOGLE_EVENTS}?${pageParams.toString()}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      cache: "no-store",
    });
    if (!pageRes.ok) break;
    const page = (await pageRes.json()) as {
      items?: Parameters<typeof mapGoogleCalendarItem>[0][];
      nextSyncToken?: string;
      nextPageToken?: string;
    };
    for (const item of page.items ?? []) {
      const mapped = mapGoogleCalendarItem(item);
      if (mapped) events.push(mapped);
    }
    nextSyncToken = page.nextSyncToken ?? null;
    pageToken = page.nextPageToken;
  }
  return { events, nextSyncToken, resetRequired: false };
}

export type GoogleCalendarWatchResult = {
  channelId: string;
  resourceId: string;
  expiration: Date | null;
};

export async function watchGoogleCalendarEvents(input: {
  accessToken: string;
  channelId: string;
  address: string;
  token: string;
  expirationMs?: number;
}): Promise<GoogleCalendarWatchResult> {
  const body: Record<string, unknown> = {
    id: input.channelId,
    type: "web_hook",
    address: input.address,
    token: input.token,
  };
  if (input.expirationMs) body.expiration = String(input.expirationMs);
  const res = await fetch(`${GOOGLE_EVENTS}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar watch failed: ${text}`);
  }
  const data = (await res.json()) as {
    id?: string;
    resourceId?: string;
    expiration?: string;
  };
  if (!data.resourceId) {
    throw new Error("Google Calendar watch returned no resourceId");
  }
  return {
    channelId: data.id || input.channelId,
    resourceId: data.resourceId,
    expiration: data.expiration ? new Date(Number(data.expiration)) : null,
  };
}

export async function stopGoogleCalendarWatch(input: {
  accessToken: string;
  channelId: string;
  resourceId: string;
}): Promise<void> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: input.channelId,
      resourceId: input.resourceId,
    }),
  });
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar stop watch failed: ${text}`);
  }
}

/** Cancel (delete) a Google Calendar event on the user's primary calendar. */
export async function cancelGoogleCalendarEvent(input: {
  accessToken: string;
  eventId: string;
}): Promise<void> {
  const url = `${GOOGLE_EVENTS}/${encodeURIComponent(input.eventId)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar cancel failed: ${text}`);
  }
}

const GOOGLE_FREEBUSY = "https://www.googleapis.com/calendar/v3/freeBusy";

export type GoogleBusyPeriod = { start: Date; end: Date };

/** Busy intervals on the user's primary calendar in [timeMin, timeMax]. */
export async function queryGoogleFreeBusy(input: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<GoogleBusyPeriod[]> {
  const res = await fetch(GOOGLE_FREEBUSY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      items: [{ id: "primary" }],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google FreeBusy failed: ${text}`);
  }
  const data = (await res.json()) as {
    calendars?: {
      primary?: { busy?: Array<{ start?: string; end?: string }> };
    };
  };
  const busy = data.calendars?.primary?.busy ?? [];
  const out: GoogleBusyPeriod[] = [];
  for (const b of busy) {
    if (!b.start || !b.end) continue;
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * Busy periods using FreeBusy when scoped, otherwise primary-calendar event
 * listing (works with calendar.events which our OAuth already requests).
 */
export async function queryGoogleBusyPeriods(input: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<GoogleBusyPeriod[]> {
  try {
    return await queryGoogleFreeBusy(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      !/insufficient|403|PERMISSION|scope/i.test(msg) &&
      !/FreeBusy failed/i.test(msg)
    ) {
      throw err;
    }
  }

  const events = await listGoogleCalendarEvents({
    accessToken: input.accessToken,
    timeMin: input.timeMin.toISOString(),
    timeMax: input.timeMax.toISOString(),
  });
  const out: GoogleBusyPeriod[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const start = new Date(ev.startAt);
    const end = ev.endAt
      ? new Date(ev.endAt)
      : new Date(start.getTime() + 30 * 60_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    // All-day events: treat the whole local day as busy.
    out.push({ start, end });
  }
  return out;
}
