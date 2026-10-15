/**
 * Start / stop Meet Media worker jobs for customer-only live Assist.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import {
  getValidGoogleAccessToken,
  googleHasMeetMediaScope,
} from "@/service/google/access-token";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { publishMeetingAssistEvent } from "@/service/ai/meeting-assist-events";

export type MediaAssistMeta = {
  status:
    | "idle"
    | "starting"
    | "connecting"
    | "waiting_admit"
    | "listening"
    | "error"
    | "stopped";
  error?: string | null;
  traceId?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
};

function workerBaseUrl(): string {
  return (
    process.env.MEET_MEDIA_WORKER_URL?.trim() ||
    "http://127.0.0.1:4010"
  ).replace(/\/$/, "");
}

function workerSecret(): string {
  return (
    process.env.MEET_MEDIA_WORKER_SECRET?.trim() ||
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    ""
  );
}

function crmPublicBase(): string {
  return (
    process.env.CRM_API_PUBLIC_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    `http://127.0.0.1:${process.env.API_PORT || 4000}`
  ).replace(/\/$/, "");
}

function meetCodeFromSession(session: {
  externalMeetingId: string | null;
  joinUrl: string | null;
}): string | null {
  const fromExternal = session.externalMeetingId?.trim();
  if (fromExternal && /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(fromExternal)) {
    return fromExternal.toLowerCase();
  }
  const fromUrl = session.joinUrl?.match(
    /meet\.google\.com\/([a-z0-9-]+)/i,
  )?.[1];
  return fromUrl?.toLowerCase() || fromExternal?.toLowerCase() || null;
}

async function patchSessionMediaMeta(
  sessionId: string,
  mediaAssist: MediaAssistMeta,
) {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  const prev =
    session?.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? (session.meta as Record<string, unknown>)
      : {};
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: {
      meta: {
        ...prev,
        mediaAssist: {
          ...mediaAssist,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
  publishMeetingAssistEvent(sessionId, {
    type: "status",
    status: `media_${mediaAssist.status}`,
    message: mediaAssist.error || undefined,
  });
}

export async function updateMediaAssistStatus(input: {
  sessionId: string;
  status: MediaAssistMeta["status"];
  error?: string | null;
  traceId?: string | null;
}) {
  await patchSessionMediaMeta(input.sessionId, {
    status: input.status,
    error: input.error ?? null,
    traceId: input.traceId ?? null,
  });
  return { ok: true as const };
}

export async function startMeetMediaAssist(sessionId: string): Promise<
  | { ok: true; meetCode: string; status: string }
  | { ok: false; error: string }
> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      provider: true,
      externalMeetingId: true,
      joinUrl: true,
      hostUserId: true,
      contactId: true,
      activityId: true,
    },
  });
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "active") {
    return { ok: false, error: "Session is not active." };
  }
  if (session.provider !== "google_meet") {
    return { ok: false, error: "Meet Media Assist is only for Google Meet." };
  }
  if (!session.hostUserId) {
    return {
      ok: false,
      error: "Session has no host user — reconnect CRM from the Meet panel.",
    };
  }

  const meetCode = meetCodeFromSession(session);
  if (!meetCode) {
    return { ok: false, error: "Missing Meet code on session." };
  }

  const conn = await getCalendarConnection(session.hostUserId, "google");
  if (!conn) {
    return {
      ok: false,
      error: "Host has not connected Google. Connect Google Calendar/Meet OAuth.",
    };
  }
  if (!googleHasMeetMediaScope(conn.scope)) {
    return {
      ok: false,
      error:
        "Host Google connection is missing Meet Media scopes. Reconnect Google to grant meetings.conference.media.readonly + meetings.space.readonly.",
    };
  }

  const accessToken = await getValidGoogleAccessToken(session.hostUserId);
  if (!accessToken) {
    return { ok: false, error: "Could not refresh Google access token." };
  }

  const contact = await getContact(session.contactId);
  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;

  let salesNames: string[] = [];
  try {
    const { getUserLabelsByIds } = await import(
      "@/service/account/user-directory"
    );
    const labels = await getUserLabelsByIds([session.hostUserId]);
    const name = labels.get(session.hostUserId);
    if (name) salesNames = [name];
  } catch {
    /* optional */
  }

  await patchSessionMediaMeta(sessionId, {
    status: "starting",
    startedAt: new Date().toISOString(),
    error: null,
  });

  const secret = workerSecret();
  try {
    const res = await fetch(`${workerBaseUrl()}/jobs/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-internal-secret": secret } : {}),
      },
      body: JSON.stringify({
        sessionId,
        meetCode,
        joinUrl: session.joinUrl,
        accessToken,
        contactName,
        salesNames,
        hostUserId: session.hostUserId,
        activityId: session.activityId,
        crmBaseUrl: crmPublicBase(),
        crmInternalSecret: secret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      job?: { status?: string };
    };
    if (!res.ok || data.ok === false) {
      const error =
        data.error || `Meet Media worker error (${res.status})`;
      await patchSessionMediaMeta(sessionId, { status: "error", error });
      return { ok: false, error };
    }
    await patchSessionMediaMeta(sessionId, {
      status: (data.job?.status as MediaAssistMeta["status"]) || "connecting",
      startedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      meetCode,
      status: data.job?.status || "connecting",
    };
  } catch (err) {
    const error =
      err instanceof Error
        ? `Meet Media worker unreachable (${err.message}). Start meet-media-worker on :4010.`
        : "Meet Media worker unreachable.";
    await patchSessionMediaMeta(sessionId, { status: "error", error });
    return { ok: false, error };
  }
}

export async function stopMeetMediaAssist(sessionId: string) {
  const secret = workerSecret();
  try {
    await fetch(`${workerBaseUrl()}/jobs/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-internal-secret": secret } : {}),
      },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* worker may already be down */
  }
  await patchSessionMediaMeta(sessionId, { status: "stopped" });
  return { ok: true as const };
}

export async function getMeetMediaAssistStatus(sessionId: string) {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  const meta =
    session?.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? (session.meta as { mediaAssist?: MediaAssistMeta }).mediaAssist
      : null;
  return { ok: true as const, mediaAssist: meta ?? { status: "idle" as const } };
}
