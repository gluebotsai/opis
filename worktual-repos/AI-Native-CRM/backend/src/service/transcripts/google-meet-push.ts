/**
 * Google Meet transcript.fileGenerated → Pub/Sub push → CRM.
 *
 * Ops: Workspace Events subscription on Meet spaces (or per-space) with
 * eventType google.workspace.meet.transcript.v2.fileGenerated → Pub/Sub topic
 * → push subscription to POST /api/webhooks/google-meet/transcript-push
 */

import { getValidGoogleAccessToken } from "@/service/google/access-token";
import { prisma } from "@/dao/db/prisma";
import { attachProviderTranscriptToMeeting } from "@/service/transcripts/attach-from-webhook";

const MEET_API = "https://meet.googleapis.com/v2";

type PubSubPushBody = {
  message?: {
    data?: string;
    messageId?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
};

function decodePubSubData(data: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(data, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function meetGetJson(
  accessToken: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  const path = name.replace(/^\//, "");
  const res = await fetch(`${MEET_API}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

async function listTranscriptEntries(
  accessToken: string,
  transcriptName: string,
): Promise<string> {
  const lines: string[] = [];
  let pageToken: string | undefined;
  do {
    const q = pageToken
      ? `pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
      : "pageSize=100";
    const res = await fetch(`${MEET_API}/${transcriptName}/entries?${q}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      transcriptEntries?: Array<{ text?: string }>;
      nextPageToken?: string;
    };
    for (const e of data.transcriptEntries || []) {
      const t = (e.text || "").trim();
      if (t) lines.push(t);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return lines.join("\n").trim();
}

function extractMeetCodeFromSpace(space: string | undefined): string | null {
  if (!space) return null;
  // spaces/xxx or meeting code in filter responses
  const code = space.match(/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})/i);
  return code?.[1]?.toLowerCase() || null;
}

async function pickHostAccessToken(): Promise<{
  userId: string;
  token: string;
} | null> {
  // Prefer an explicit ops user, else any Google-connected user with a token.
  const preferred = process.env.GOOGLE_MEET_TRANSCRIPT_HOST_USER_ID?.trim();
  if (preferred) {
    const token = await getValidGoogleAccessToken(preferred);
    if (token) return { userId: preferred, token };
  }

  const conn = await prisma.userIntegrationConnection.findFirst({
    where: { provider: "google" },
    orderBy: { updatedAt: "desc" },
    select: { userId: true },
  });
  if (!conn) return null;
  const token = await getValidGoogleAccessToken(conn.userId);
  if (!token) return null;
  return { userId: conn.userId, token };
}

/**
 * Process a Pub/Sub push body for Meet transcript.fileGenerated.
 */
export async function handleGoogleMeetTranscriptPush(
  body: unknown,
): Promise<{ ok: boolean; detail: string }> {
  const push = (body || {}) as PubSubPushBody;
  const dataB64 = push.message?.data;
  if (!dataB64) {
    return { ok: false, detail: "Missing Pub/Sub message.data" };
  }

  const payload = decodePubSubData(dataB64);
  if (!payload) return { ok: false, detail: "Invalid Pub/Sub data" };

  // Workspace Events CloudEvent-ish payloads vary; accept common shapes.
  const transcriptObj =
    (payload.transcript as Record<string, unknown> | undefined) ||
    ((payload.data as Record<string, unknown> | undefined)?.transcript as
      | Record<string, unknown>
      | undefined) ||
    payload;

  const transcriptName = String(
    transcriptObj.name ||
      payload.name ||
      (payload.transcript as string | undefined) ||
      "",
  ).trim();

  if (!transcriptName.includes("conferenceRecords/")) {
    return {
      ok: false,
      detail: `No transcript resource name in payload: ${JSON.stringify(payload).slice(0, 200)}`,
    };
  }

  const host = await pickHostAccessToken();
  if (!host) {
    return {
      ok: false,
      detail:
        "No Google-connected user to fetch Meet transcript (Connect Google or set GOOGLE_MEET_TRANSCRIPT_HOST_USER_ID).",
    };
  }

  const conferenceRecord = transcriptName.split("/transcripts/")[0];
  const record = await meetGetJson(host.token, conferenceRecord);
  const space = record
    ? String((record as { space?: string }).space || "")
    : "";

  // meeting_code may need a separate spaces.get; try conference record fields
  let meetCode =
    extractMeetCodeFromSpace(space) ||
    extractMeetCodeFromSpace(JSON.stringify(record || {}));

  if (!meetCode && space.startsWith("spaces/")) {
    const spaceRes = await meetGetJson(host.token, space);
    const meetingCode = spaceRes
      ? String(
          (spaceRes as { meetingCode?: string }).meetingCode ||
            (spaceRes as { name?: string }).name ||
            "",
        )
      : "";
    meetCode =
      extractMeetCodeFromSpace(meetingCode) ||
      (meetingCode.match(/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i)
        ? meetingCode.toLowerCase()
        : null);
  }

  const text = await listTranscriptEntries(host.token, transcriptName);
  if (!text) {
    return { ok: false, detail: "Transcript entries empty or not ready" };
  }

  const attached = await attachProviderTranscriptToMeeting({
    provider: "google_meet",
    meetCode,
    meetingId: meetCode,
    transcript: text,
    source: "google_meet_pubsub_push",
  });

  if (!attached.ok) {
    return {
      ok: false,
      detail: `${attached.error}${meetCode ? ` (meetCode=${meetCode})` : ""}`,
    };
  }

  return {
    ok: true,
    detail: `attached activity=${attached.activityId} chars=${attached.chars}`,
  };
}
