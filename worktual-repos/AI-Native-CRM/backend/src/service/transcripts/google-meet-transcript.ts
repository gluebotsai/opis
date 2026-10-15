/**
 * Google Meet post-meeting transcript via Meet REST API
 * (conferenceRecords → transcripts → entries).
 *
 * Requires host Google OAuth with meetings.space.readonly and Meet transcription
 * enabled for the call. Entries are available for ~30 days after the conference.
 */

import { getValidGoogleAccessToken } from "@/service/google/access-token";
import { prisma } from "@/dao/db/prisma";

const MEET_API = "https://meet.googleapis.com/v2";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

type ConferenceRecord = { name?: string; space?: string };
type Transcript = { name?: string; state?: string };
type TranscriptEntry = {
  text?: string;
  participant?: string;
};

async function meetGet<T>(
  accessToken: string,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${MEET_API}/${path.replace(/^\//, "")}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  try {
    return { ok: true, data: JSON.parse(body) as T };
  } catch {
    return { ok: false, status: res.status, body };
  }
}

async function resolveMeetCodeFromCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<string | null> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    hangoutLink?: string;
    conferenceData?: {
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    };
  };
  const fromHangout = data.hangoutLink?.match(
    /meet\.google\.com\/([a-z0-9-]+)/i,
  )?.[1];
  if (fromHangout) return fromHangout.toLowerCase();
  for (const ep of data.conferenceData?.entryPoints || []) {
    const m = ep.uri?.match(/meet\.google\.com\/([a-z0-9-]+)/i)?.[1];
    if (m) return m.toLowerCase();
  }
  return null;
}

async function listConferenceRecordsByMeetCode(
  accessToken: string,
  meetCode: string,
): Promise<ConferenceRecord[]> {
  const filter = encodeURIComponent(`space.meeting_code="${meetCode}"`);
  const listed = await meetGet<{ conferenceRecords?: ConferenceRecord[] }>(
    accessToken,
    `conferenceRecords?filter=${filter}&pageSize=10`,
  );
  if (!listed.ok) return [];
  return listed.data.conferenceRecords || [];
}

async function collectTranscriptText(
  accessToken: string,
  conferenceRecordName: string,
): Promise<string | null> {
  const parent = conferenceRecordName.startsWith("conferenceRecords/")
    ? conferenceRecordName
    : `conferenceRecords/${conferenceRecordName}`;

  const transcriptsRes = await meetGet<{ transcripts?: Transcript[] }>(
    accessToken,
    `${parent}/transcripts?pageSize=20`,
  );
  if (!transcriptsRes.ok) return null;
  const transcripts = transcriptsRes.data.transcripts || [];
  if (transcripts.length === 0) return null;

  const lines: string[] = [];
  for (const t of transcripts) {
    if (!t.name) continue;
    let pageToken: string | undefined;
    do {
      const q = pageToken
        ? `pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
        : "pageSize=100";
      const entriesRes = await meetGet<{
        transcriptEntries?: TranscriptEntry[];
        nextPageToken?: string;
      }>(accessToken, `${t.name}/entries?${q}`);
      if (!entriesRes.ok) break;
      for (const e of entriesRes.data.transcriptEntries || []) {
        const text = (e.text || "").trim();
        if (!text) continue;
        lines.push(text);
      }
      pageToken = entriesRes.data.nextPageToken;
    } while (pageToken);
  }

  const joined = lines.join("\n").trim();
  return joined || null;
}

export async function fetchGoogleMeetTranscript(input: {
  meetCode?: string | null;
  calendarEventId?: string | null;
  hostUserId?: string | null;
}): Promise<
  | { ok: true; text: string; source: string }
  | { ok: false; reason: string; retryable: boolean }
> {
  const hostUserId = input.hostUserId?.trim();
  if (!hostUserId) {
    return {
      ok: false,
      reason:
        "Missing host user for Google Meet transcript (organizer must Connect Google).",
      retryable: false,
    };
  }

  const accessToken = await getValidGoogleAccessToken(hostUserId);
  if (!accessToken) {
    return {
      ok: false,
      reason: "Host has not connected Google (or token expired).",
      retryable: false,
    };
  }

  let meetCode = input.meetCode?.trim().toLowerCase() || null;
  const eventId = input.calendarEventId?.trim() || null;

  if (!meetCode && eventId) {
    meetCode = await resolveMeetCodeFromCalendarEvent(accessToken, eventId);
  }

  // Fallback: if calendarEventId looks like a Meet code
  if (
    !meetCode &&
    eventId &&
    /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(eventId)
  ) {
    meetCode = eventId.toLowerCase();
  }

  if (!meetCode) {
    return {
      ok: false,
      reason: "Could not resolve Google Meet code for this activity.",
      retryable: false,
    };
  }

  try {
    const records = await listConferenceRecordsByMeetCode(accessToken, meetCode);
    if (records.length === 0) {
      return {
        ok: false,
        reason:
          "No Meet conference record yet (call may still be processing, or transcription was off).",
        retryable: true,
      };
    }

    // Prefer the most recent record that has transcript text
    for (const record of [...records].reverse()) {
      if (!record.name) continue;
      const text = await collectTranscriptText(accessToken, record.name);
      if (text) {
        return { ok: true, text, source: "google_meet_transcript" };
      }
    }

    return {
      ok: false,
      reason:
        "Meet conference found but no transcript entries. Turn on Meet transcription for the call.",
      retryable: true,
    };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `Google Meet transcript fetch failed: ${err.message}`
          : "Google Meet transcript fetch failed.",
      retryable: true,
    };
  }
}

/** Resolve host user id from activity when session host is missing. */
export async function resolveMeetingHostUserId(
  activityId: string,
): Promise<string | null> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: { createdByUserId: true },
  });
  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: { hostUserId: true },
  });
  return session?.hostUserId || activity?.createdByUserId || null;
}
