/**
 * Unified live Assist starter: meeting bot (default) or Meet Media.
 * Buyers never configure bots — Worktual ops sets MEETING_BOT_API_KEY once.
 */

import { prisma } from "@/dao/db/prisma";
import {
  getLiveAssistSource,
  isMeetingBotConfigured,
  startMeetingBotForAssist,
} from "@/service/meeting-assist/meeting-bot";
import {
  isMeetingServiceConfigured,
  notetakerProvider,
} from "@/service/meeting-service/config";
import {
  startMeetMediaAssist,
  updateMediaAssistStatus,
  type MediaAssistMeta,
} from "@/service/meeting-assist/meet-media";
import { publishMeetingAssistEvent } from "@/service/ai/meeting-assist-events";
import { readCaptureBotMeta } from "@/service/transcripts/meeting-capture";

type BotAssistStatus = MediaAssistMeta["status"];

function meetCodeFromSession(session: {
  externalMeetingId: string | null;
  joinUrl: string | null;
}): string | null {
  const fromExternal = session.externalMeetingId?.trim();
  if (
    fromExternal &&
    /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(fromExternal)
  ) {
    return fromExternal.toLowerCase();
  }
  const fromUrl = session.joinUrl?.match(
    /meet\.google\.com\/([a-z0-9-]+)/i,
  )?.[1];
  return fromUrl?.toLowerCase() || null;
}

/**
 * Prefer the CRM activity join link (Meet / Zoom / Teams).
 * Only synthesize a Google Meet URL when we have a Meet code — never turn a
 * Zoom meeting id into meet.google.com/….
 */
function meetingUrlFromSession(session: {
  provider?: string | null;
  externalMeetingId: string | null;
  joinUrl: string | null;
}): string | null {
  const join = session.joinUrl?.trim() || null;
  if (join) {
    if (
      /meet\.google\.com/i.test(join) ||
      /zoom\.us\//i.test(join) ||
      /zoom\.com\//i.test(join) ||
      /teams\.microsoft\.com/i.test(join) ||
      /teams\.live\.com/i.test(join)
    ) {
      return join;
    }
    // Absolute http(s) join links from CRM — pass through to Recall.
    if (/^https?:\/\//i.test(join)) return join;
  }

  const meetCode = meetCodeFromSession(session);
  if (meetCode) return `https://meet.google.com/${meetCode}`;

  // Zoom often stores numeric meeting id without a full URL — build a join link.
  const provider = (session.provider || "").toLowerCase();
  const external = session.externalMeetingId?.trim();
  if (
    (provider === "zoom" || /zoom/i.test(join || "")) &&
    external &&
    /^\d{9,}$/.test(external)
  ) {
    return `https://zoom.us/j/${external}`;
  }

  return null;
}

function readBotAssistMeta(meta: unknown): {
  status?: string;
  botId?: string | null;
  provider?: string | null;
} | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const raw = (meta as Record<string, unknown>).botAssist;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  return {
    status: typeof b.status === "string" ? b.status : undefined,
    botId: typeof b.botId === "string" ? b.botId : null,
    provider: typeof b.provider === "string" ? b.provider : null,
  };
}

/**
 * Prefer an in-call Capture or Assist bot already on this session so we do not
 * knock a second "Worktual Assist" into the lobby.
 */
function findReusableInCallBot(meta: unknown): {
  botId: string;
  provider: string;
  source: "capture" | "assist";
} | null {
  const assist = readBotAssistMeta(meta);
  if (
    assist?.botId &&
    assist.status &&
    ["starting", "waiting_admit", "listening", "connecting"].includes(
      assist.status,
    )
  ) {
    return {
      botId: assist.botId,
      provider: assist.provider || "recall",
      source: "assist",
    };
  }

  const capture = readCaptureBotMeta(meta);
  if (
    capture?.botId &&
    (capture.status === "scheduled" || capture.status === "joined")
  ) {
    return {
      botId: capture.botId,
      provider: capture.provider || "recall",
      source: "capture",
    };
  }

  return null;
}

async function patchBotMeta(
  sessionId: string,
  botAssist: {
    status: BotAssistStatus;
    error?: string | null;
    botId?: string | null;
    provider?: string | null;
  },
) {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  const prev =
    session?.meta &&
    typeof session.meta === "object" &&
    !Array.isArray(session.meta)
      ? (session.meta as Record<string, unknown>)
      : {};
  const prevBot =
    prev.botAssist &&
    typeof prev.botAssist === "object" &&
    !Array.isArray(prev.botAssist)
      ? (prev.botAssist as Record<string, unknown>)
      : {};
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: {
      meta: {
        ...prev,
        botAssist: {
          ...prevBot,
          ...botAssist,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
  publishMeetingAssistEvent(sessionId, {
    type: "status",
    status: `media_${botAssist.status}`,
    message:
      botAssist.status === "waiting_admit"
        ? "Admit the Worktual bot in the meeting lobby if prompted."
        : botAssist.error || undefined,
  });
}

/**
 * Move Assist from waiting_admit → listening once customer captions arrive.
 * No-op if already listening or not in a waiting state.
 */
export async function markLiveAssistListening(sessionId: string): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  if (!session) return;

  const assist = readBotAssistMeta(session.meta);
  const status = assist?.status;
  if (status === "listening") return;
  if (
    status &&
    status !== "waiting_admit" &&
    status !== "starting" &&
    status !== "connecting"
  ) {
    return;
  }

  await patchBotMeta(sessionId, {
    status: "listening",
    botId: assist?.botId ?? null,
    provider: assist?.provider ?? "recall",
    error: null,
  });
  await updateMediaAssistStatus({
    sessionId,
    status: "listening",
  });
}

/**
 * Start live customer transcript for an Assist session.
 * Default: meeting bot (turnkey for product buyers).
 */
export async function startLiveCustomerAssist(sessionId: string): Promise<
  | { ok: true; mode: string; liveStatus: string; botId?: string }
  | { ok: false; error: string; mode: string }
> {
  const mode = getLiveAssistSource();

  if (mode === "ask_only") {
    return {
      ok: false,
      mode,
      error:
        "Live captions are disabled (MEETING_ASSIST_LIVE_SOURCE=ask_only). Use Ask in the panel.",
    };
  }

  if (mode === "meet_media") {
    const result = await startMeetMediaAssist(sessionId);
    if (!result.ok) return { ok: false, mode, error: result.error };
    return { ok: true, mode, liveStatus: result.status };
  }

  // Vexa path: notetaker is sent from CRM (Send notetaker), not from Assist media/start.
  if (isMeetingServiceConfigured() && notetakerProvider() === "vexa") {
    return {
      ok: false,
      mode,
      error:
        "Send the notetaker from the CRM meeting activity first, then open Worktual Assist in Meet.",
    };
  }

  // bot (default) — legacy Recall
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      provider: true,
      joinUrl: true,
      externalMeetingId: true,
      meta: true,
    },
  });
  if (!session) return { ok: false, mode, error: "Session not found." };
  if (session.status !== "active") {
    return { ok: false, mode, error: "Session is not active." };
  }

  if (!isMeetingBotConfigured()) {
    await patchBotMeta(sessionId, {
      status: "error",
      error:
        "Meeting bot API key not set. Ops: set MEETING_BOT_API_KEY (Recall).",
    });
    return {
      ok: false,
      mode,
      error:
        "Meeting bot is not configured on the server. Contact Worktual ops (MEETING_BOT_API_KEY).",
    };
  }

  const meetingUrl = meetingUrlFromSession(session);
  const meetCode = meetCodeFromSession(session);
  if (!meetingUrl) {
    return {
      ok: false,
      mode,
      error:
        session.provider === "zoom"
          ? "Missing Zoom join URL on this session. Schedule the meeting from CRM with a zoom.us link, then Start Assist again."
          : "Missing meeting join URL on this session.",
    };
  }

  const reusable = findReusableInCallBot(session.meta);
  if (reusable) {
    const liveStatus: BotAssistStatus =
      reusable.source === "assist" &&
      readBotAssistMeta(session.meta)?.status === "listening"
        ? "listening"
        : "waiting_admit";
    await patchBotMeta(sessionId, {
      status: liveStatus,
      botId: reusable.botId,
      provider: reusable.provider,
      error: null,
    });
    await updateMediaAssistStatus({
      sessionId,
      status: liveStatus,
    });
    return {
      ok: true,
      mode,
      liveStatus,
      botId: reusable.botId,
    };
  }

  await patchBotMeta(sessionId, { status: "starting", error: null });
  // Also mirror into mediaAssist so older UI status keys work.
  await updateMediaAssistStatus({
    sessionId,
    status: "starting",
  });

  const started = await startMeetingBotForAssist({
    sessionId,
    meetingUrl,
    meetCode,
  });
  if (!started.ok) {
    await patchBotMeta(sessionId, { status: "error", error: started.error });
    await updateMediaAssistStatus({
      sessionId,
      status: "error",
      error: started.error,
    });
    return { ok: false, mode, error: started.error };
  }

  // Create OK ≠ listening — host must admit the bot (Zoom Waiting Room / Meet lobby).
  await patchBotMeta(sessionId, {
    status: "waiting_admit",
    botId: started.botId,
    provider: started.provider,
    error: null,
  });
  await updateMediaAssistStatus({
    sessionId,
    status: "waiting_admit",
  });

  return {
    ok: true,
    mode,
    liveStatus: "waiting_admit",
    botId: started.botId,
  };
}
