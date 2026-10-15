/**
 * Microsoft Graph change notifications for online meeting transcripts.
 * https://learn.microsoft.com/en-us/graph/teams-changenotifications-callrecording-and-calltranscript
 */

import { isTeamsConfigured } from "@/service/microsoft/teams-api";
import { fetchTeamsMeetingTranscript } from "@/service/transcripts/teams-transcript";
import { attachProviderTranscriptToMeeting } from "@/service/transcripts/attach-from-webhook";

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
  if (!res.ok) throw new Error(`Microsoft token failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Microsoft token missing");
  return data.access_token;
}

function webhookPublicBase(): string {
  return (
    process.env.MEETING_TRANSCRIPT_WEBHOOK_BASE_URL?.trim() ||
    process.env.CRM_API_PUBLIC_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    `http://127.0.0.1:${process.env.API_PORT || 4000}`
  ).replace(/\/$/, "");
}

/**
 * Create (or refresh) a tenant-wide Graph subscription for all online meeting transcripts.
 * Call once from ops after Teams app has OnlineMeetingTranscript.Read.All.
 */
export async function ensureTeamsTranscriptSubscription(): Promise<
  | { ok: true; subscriptionId: string; expirationDateTime: string }
  | { ok: false; error: string }
> {
  if (!isTeamsConfigured()) {
    return { ok: false, error: "Teams is not configured." };
  }

  const clientState =
    process.env.TEAMS_TRANSCRIPT_WEBHOOK_CLIENT_STATE?.trim() ||
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    "worktual-teams-transcripts";

  const notificationUrl = `${webhookPublicBase()}/api/webhooks/teams/transcript-notifications`;
  const lifecycleUrl = `${webhookPublicBase()}/api/webhooks/teams/transcript-lifecycle`;

  // Graph requires lifecycle URL when expiration > 1 hour for this resource.
  const expiration = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(); // ~50h

  try {
    const token = await getGraphAccessToken();
    const res = await fetch(`${MS_GRAPH}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        changeType: "created",
        notificationUrl,
        lifecycleNotificationUrl: lifecycleUrl,
        resource: "communications/onlineMeetings/getAllTranscripts",
        expirationDateTime: expiration,
        clientState,
        includeResourceData: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Graph subscription failed (${res.status}): ${body.slice(0, 400)}`,
      };
    }
    const data = JSON.parse(body) as {
      id?: string;
      expirationDateTime?: string;
    };
    if (!data.id) return { ok: false, error: "Subscription response missing id" };
    return {
      ok: true,
      subscriptionId: data.id,
      expirationDateTime: data.expirationDateTime || expiration,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to create Teams transcript subscription",
    };
  }
}

/**
 * Handle one Graph notification value item → fetch + attach transcript.
 */
export async function handleTeamsTranscriptNotification(item: {
  clientState?: string;
  resource?: string;
  resourceData?: { id?: string; "@odata.id"?: string };
}): Promise<{ ok: boolean; detail: string }> {
  const expected =
    process.env.TEAMS_TRANSCRIPT_WEBHOOK_CLIENT_STATE?.trim() ||
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    "worktual-teams-transcripts";
  if (item.clientState && item.clientState !== expected) {
    return { ok: false, detail: "clientState mismatch" };
  }

  // resource examples:
  // users/{userId}/onlineMeetings/{meetingId}/transcripts/{transcriptId}
  // communications/onlineMeetings/{meetingId}/transcripts/{transcriptId}
  const resource = item.resource || item.resourceData?.["@odata.id"] || "";
  const meetingMatch = resource.match(
    /onlineMeetings\/([^/]+)\/transcripts/i,
  );
  const meetingId = meetingMatch?.[1] || null;
  if (!meetingId) {
    return { ok: false, detail: `Could not parse meeting id from ${resource}` };
  }

  const fetched = await fetchTeamsMeetingTranscript(meetingId);
  if (!fetched.ok) {
    return { ok: false, detail: fetched.reason };
  }

  const attached = await attachProviderTranscriptToMeeting({
    provider: "teams",
    meetingId,
    transcript: fetched.text,
    source: "teams_graph_push",
  });
  if (!attached.ok) return { ok: false, detail: attached.error };
  return {
    ok: true,
    detail: `attached activity=${attached.activityId} chars=${attached.chars}`,
  };
}
