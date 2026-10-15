/**
 * Microsoft Teams / Graph online meeting transcript (post-meeting).
 * Needs application permission OnlineMeetingTranscript.Read.All (admin consent).
 */

import { isTeamsConfigured } from "@/service/microsoft/teams-api";

const MS_TOKEN = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const MS_GRAPH = "https://graph.microsoft.com/v1.0";

async function getGraphAccessToken(): Promise<string> {
  const { microsoftAppTenant } = await import("@/service/microsoft/oauth");
  const tenant = microsoftAppTenant();
  const clientId = process.env.MICROSOFT_CLIENT_ID!.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!.trim();

  const res = await fetch(MS_TOKEN(tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token failed: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Microsoft token missing access_token");
  return data.access_token;
}

function organizerUserId(): string {
  return process.env.MICROSOFT_ORGANIZER_USER_ID!.trim();
}

/**
 * Fetch full transcript for a Teams onlineMeeting id stored as "Teams Event: …".
 */
export async function fetchTeamsMeetingTranscript(
  onlineMeetingId: string | null | undefined,
): Promise<
  | { ok: true; text: string; source: string }
  | { ok: false; reason: string; retryable: boolean }
> {
  if (!onlineMeetingId?.trim()) {
    return {
      ok: false,
      reason: "Missing Teams online meeting id.",
      retryable: false,
    };
  }
  if (!isTeamsConfigured()) {
    return {
      ok: false,
      reason:
        "Teams is not configured (MICROSOFT_TENANT_ID / CLIENT_* / ORGANIZER_USER_ID).",
      retryable: false,
    };
  }

  try {
    const token = await getGraphAccessToken();
    const userId = encodeURIComponent(organizerUserId());
    const meetingId = encodeURIComponent(onlineMeetingId.trim());

    const listRes = await fetch(
      `${MS_GRAPH}/users/${userId}/onlineMeetings/${meetingId}/transcripts`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (listRes.status === 404) {
      return {
        ok: false,
        reason:
          "Teams transcript not found yet (transcription may be off, or still processing).",
        retryable: true,
      };
    }
    if (listRes.status === 403) {
      return {
        ok: false,
        reason:
          "Teams Graph denied transcript access. Grant OnlineMeetingTranscript.Read.All (admin consent).",
        retryable: false,
      };
    }
    if (!listRes.ok) {
      const body = await listRes.text();
      return {
        ok: false,
        reason: `Teams transcripts list failed (${listRes.status}): ${body.slice(0, 300)}`,
        retryable: listRes.status === 429 || listRes.status >= 500,
      };
    }

    const list = (await listRes.json()) as {
      value?: Array<{ id?: string; transcriptContentUrl?: string }>;
    };
    const transcripts = list.value || [];
    if (transcripts.length === 0) {
      return {
        ok: false,
        reason:
          "No Teams transcripts yet. Enable meeting transcription, then wait after the call ends.",
        retryable: true,
      };
    }

    const parts: string[] = [];
    for (const t of transcripts) {
      const contentUrl =
        t.transcriptContentUrl ||
        (t.id
          ? `${MS_GRAPH}/users/${userId}/onlineMeetings/${meetingId}/transcripts/${encodeURIComponent(t.id)}/content`
          : null);
      if (!contentUrl) continue;

      const contentRes = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/vtt",
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!contentRes.ok) continue;
      const raw = await contentRes.text();
      const cleaned = stripVttLike(raw);
      if (cleaned) parts.push(cleaned);
    }

    const text = parts.join("\n\n").trim();
    if (!text) {
      return {
        ok: false,
        reason: "Teams transcript content was empty or not downloadable yet.",
        retryable: true,
      };
    }

    return { ok: true, text, source: "teams_graph_transcript" };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `Teams transcript fetch failed: ${err.message}`
          : "Teams transcript fetch failed.",
      retryable: true,
    };
  }
}

function stripVttLike(raw: string): string {
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
