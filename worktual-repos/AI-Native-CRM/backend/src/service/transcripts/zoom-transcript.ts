/**
 * Zoom cloud recording transcript download (post-meeting).
 * Requires cloud recording + audio transcript enabled on the Zoom account/meeting.
 */

import { isZoomConfigured } from "@/service/zoom/zoom-api";

const ZOOM_API = "https://api.zoom.us/v2";

type ZoomTokenResponse = {
  access_token: string;
};

async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID!.trim();
  const clientId = process.env.ZOOM_CLIENT_ID!.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!.trim();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) {
    throw new Error(`Zoom token failed: ${await res.text()}`);
  }
  const data = (await res.json()) as ZoomTokenResponse;
  if (!data.access_token) throw new Error("Zoom token missing access_token");
  return data.access_token;
}

function stripVtt(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t === "WEBVTT") continue;
    if (/^\d+$/.test(t)) continue;
    if (/^\d{2}:\d{2}/.test(t)) continue;
    if (t.startsWith("NOTE")) continue;
    out.push(t);
  }
  return out.join("\n").trim();
}

type RecordingFile = {
  file_type?: string;
  file_extension?: string;
  download_url?: string;
  recording_type?: string;
};

/**
 * Download transcript text for a Zoom meeting id (numeric string).
 */
export async function fetchZoomMeetingTranscript(
  meetingId: string | null | undefined,
): Promise<
  | { ok: true; text: string; source: string }
  | { ok: false; reason: string; retryable: boolean }
> {
  if (!meetingId?.trim()) {
    return {
      ok: false,
      reason: "Missing Zoom meeting id.",
      retryable: false,
    };
  }
  if (!isZoomConfigured()) {
    return {
      ok: false,
      reason:
        "Zoom is not configured (ZOOM_ACCOUNT_ID / CLIENT_ID / CLIENT_SECRET).",
      retryable: false,
    };
  }

  try {
    const token = await getZoomAccessToken();
    const res = await fetch(
      `${ZOOM_API}/meetings/${encodeURIComponent(meetingId.trim())}/recordings`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (res.status === 404) {
      return {
        ok: false,
        reason:
          "Zoom recordings not ready yet (or cloud recording was off for this meeting).",
        retryable: true,
      };
    }
    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        reason: `Zoom recordings API failed (${res.status}): ${body.slice(0, 300)}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    }

    const data = (await res.json()) as {
      recording_files?: RecordingFile[];
      download_access_token?: string;
    };
    const files = data.recording_files || [];
    const transcriptFile =
      files.find((f) =>
        String(f.file_type || "")
          .toUpperCase()
          .includes("TRANSCRIPT"),
      ) ||
      files.find((f) =>
        String(f.file_extension || "")
          .toLowerCase()
          .includes("vtt"),
      ) ||
      files.find((f) =>
        String(f.recording_type || "")
          .toLowerCase()
          .includes("transcript"),
      );

    if (!transcriptFile?.download_url) {
      return {
        ok: false,
        reason:
          "No Zoom transcript file yet. Enable cloud recording + audio transcript, then wait for processing.",
        retryable: true,
      };
    }

    const downloadToken = data.download_access_token || token;
    const sep = transcriptFile.download_url.includes("?") ? "&" : "?";
    const downloadUrl = `${transcriptFile.download_url}${sep}access_token=${encodeURIComponent(downloadToken)}`;
    const fileRes = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!fileRes.ok) {
      return {
        ok: false,
        reason: `Zoom transcript download failed (${fileRes.status}).`,
        retryable: true,
      };
    }

    const raw = await fileRes.text();
    const text = stripVtt(raw) || raw.trim();
    if (!text) {
      return {
        ok: false,
        reason: "Zoom transcript file was empty.",
        retryable: true,
      };
    }

    return { ok: true, text, source: "zoom_cloud_transcript" };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `Zoom transcript fetch failed: ${err.message}`
          : "Zoom transcript fetch failed.",
      retryable: true,
    };
  }
}

/** Download transcript from an explicit Zoom download_url (webhook payload). */
export async function downloadZoomTranscriptUrl(
  downloadUrl: string,
  accessToken?: string | null,
): Promise<string | null> {
  try {
    let url = downloadUrl;
    if (accessToken && !url.includes("access_token=")) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}access_token=${encodeURIComponent(accessToken)}`;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const raw = await res.text();
    return stripVtt(raw) || raw.trim() || null;
  } catch {
    return null;
  }
}
