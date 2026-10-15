/**
 * Turnkey meeting-bot live captions for Assist (buyer needs no GCP/Preview).
 *
 * Ops configures MEETING_BOT_* once. On Assist start we dispatch a bot to the
 * Meet URL; realtime transcript webhooks land on /api/webhooks/meeting-bot/*.
 */

export type LiveAssistSource = "bot" | "meet_media" | "ask_only";

export function getLiveAssistSource(): LiveAssistSource {
  const raw = (
    process.env.MEETING_ASSIST_LIVE_SOURCE ||
    process.env.MEET_LIVE_TRANSCRIPT_MODE ||
    "bot"
  )
    .trim()
    .toLowerCase();
  if (raw === "meet_media" || raw === "media") return "meet_media";
  if (raw === "ask_only" || raw === "ask" || raw === "none") return "ask_only";
  return "bot";
}

export function recallBaseUrl(): string {
  return (
    process.env.MEETING_BOT_API_BASE_URL?.trim() ||
    process.env.RECALL_API_BASE_URL?.trim() ||
    "https://us-east-1.recall.ai/api/v1"
  ).replace(/\/$/, "");
}

export function recallApiKey(): string {
  return (
    process.env.MEETING_BOT_API_KEY?.trim() ||
    process.env.RECALL_API_KEY?.trim() ||
    ""
  );
}

export function webhookPublicBase(): string {
  return (
    process.env.MEETING_BOT_WEBHOOK_BASE_URL?.trim() ||
    process.env.CRM_API_PUBLIC_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    `http://127.0.0.1:${process.env.API_PORT || 4000}`
  ).replace(/\/$/, "");
}

export function isMeetingBotConfigured(): boolean {
  return Boolean(recallApiKey());
}

function normParticipantEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export async function startMeetingBotForAssist(input: {
  sessionId: string;
  meetingUrl: string;
  meetCode?: string | null;
  botName?: string | null;
}): Promise<
  | { ok: true; botId: string; provider: "recall" }
  | { ok: false; error: string }
> {
  const apiKey = recallApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Meeting bot is not configured. Set MEETING_BOT_API_KEY (Recall) on the server.",
    };
  }

  const meetingUrl = input.meetingUrl.trim();
  if (!meetingUrl) {
    return { ok: false, error: "Missing meeting URL to dispatch the caption bot." };
  }

  const realtimeUrl = `${webhookPublicBase()}/api/webhooks/meeting-bot/recall`;
  const botName =
    input.botName?.trim() ||
    process.env.MEETING_BOT_DISPLAY_NAME?.trim() ||
    "Worktual Assist";

  try {
    const res = await fetch(`${recallBaseUrl()}/bot/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: botName,
        metadata: {
          sessionId: input.sessionId,
          ...(input.meetCode ? { meetCode: input.meetCode } : {}),
          product: "worktual_assist",
        },
        recording_config: {
          transcript: {
            provider: {
              meeting_captions: {},
            },
          },
          realtime_endpoints: [
            {
              type: "webhook",
              url: realtimeUrl,
              events: ["transcript.data"],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = await res.text();
    if (!res.ok) {
      let detail = body.slice(0, 400);
      try {
        const parsed = JSON.parse(body) as { detail?: string; message?: string };
        detail = parsed.detail || parsed.message || detail;
      } catch {
        /* keep */
      }
      return { ok: false, error: `Meeting bot create failed (${res.status}): ${detail}` };
    }

    const data = JSON.parse(body) as { id?: string };
    if (!data.id) return { ok: false, error: "Meeting bot create returned no id." };
    return { ok: true, botId: data.id, provider: "recall" };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Meeting bot request failed: ${err.message}`
          : "Meeting bot request failed",
    };
  }
}

/** Normalize Recall realtime transcript.event → Assist chunk fields. */
export function parseRecallTranscriptEvent(payload: unknown): {
  text: string;
  speaker: string;
  speakerEmail: string | null;
  isHost: boolean;
  meetingUrl?: string | null;
  botId?: string | null;
  sessionIdFromMeta?: string | null;
  activityIdFromMeta?: string | null;
  meetCodeFromMeta?: string | null;
  productFromMeta?: string | null;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const event = String(root.event || "");
  if (event && event !== "transcript.data" && event !== "transcript.partial_data") {
    return null;
  }

  const dataWrap = (root.data as Record<string, unknown> | undefined) || root;
  const inner =
    (dataWrap.data as Record<string, unknown> | undefined) || dataWrap;
  const words = inner.words as Array<{ text?: string }> | undefined;
  const participant = inner.participant as
    | {
        name?: string | null;
        is_host?: boolean | null;
        email?: string | null;
      }
    | undefined;

  const text = Array.isArray(words)
    ? words
        .map((w) => (w?.text || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim()
    : typeof inner.text === "string"
      ? inner.text.trim()
      : "";
  if (!text) return null;

  const bot = (dataWrap.bot as Record<string, unknown> | undefined) || {};
  const metadata =
    (bot.metadata as Record<string, unknown> | undefined) ||
    (dataWrap.metadata as Record<string, unknown> | undefined) ||
    {};

  return {
    text,
    speaker: (participant?.name || participant?.email || "Guest").trim(),
    speakerEmail: normParticipantEmail(participant?.email),
    isHost: Boolean(participant?.is_host),
    botId: typeof bot.id === "string" ? bot.id : null,
    sessionIdFromMeta:
      typeof metadata.sessionId === "string" ? metadata.sessionId : null,
    activityIdFromMeta:
      typeof metadata.activityId === "string" ? metadata.activityId : null,
    meetCodeFromMeta:
      typeof metadata.meetCode === "string" ? metadata.meetCode : null,
    productFromMeta:
      typeof metadata.product === "string" ? metadata.product : null,
  };
}

/** Detect Recall done / status webhooks that mean full transcript is ready. */
export function parseRecallCaptureDoneEvent(payload: unknown): {
  event: string;
  botId: string | null;
  sessionIdFromMeta: string | null;
  activityIdFromMeta: string | null;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const event = String(root.event || "").toLowerCase();
  const doneLike =
    event.includes("transcript.done") ||
    event.includes("recording.done") ||
    event === "bot.done" ||
    (event.includes("bot.status_change") &&
      String(
        (root.data as Record<string, unknown> | undefined)?.status ||
          (
            (root.data as Record<string, unknown> | undefined)?.data as
              | Record<string, unknown>
              | undefined
          )?.code ||
          "",
      )
        .toLowerCase()
        .includes("done"));

  if (!doneLike && !event.includes("transcript.failed")) return null;

  const dataWrap = (root.data as Record<string, unknown> | undefined) || root;
  const bot =
    (dataWrap.bot as Record<string, unknown> | undefined) ||
    (typeof dataWrap.bot_id === "string"
      ? { id: dataWrap.bot_id }
      : dataWrap);
  const metadata =
    (bot.metadata as Record<string, unknown> | undefined) ||
    (dataWrap.metadata as Record<string, unknown> | undefined) ||
    {};

  const botId =
    (typeof bot.id === "string" && bot.id) ||
    (typeof dataWrap.bot_id === "string" && dataWrap.bot_id) ||
    null;

  return {
    event,
    botId,
    sessionIdFromMeta:
      typeof metadata.sessionId === "string" ? metadata.sessionId : null,
    activityIdFromMeta:
      typeof metadata.activityId === "string" ? metadata.activityId : null,
  };
}
