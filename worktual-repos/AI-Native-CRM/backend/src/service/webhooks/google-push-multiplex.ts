/**
 * Routes Google Calendar HTTPS push and Gmail Pub/Sub push on one URL
 * (e.g. mcp-push → /api/webhooks/google-calendar/push).
 */

import { handleGoogleCalendarPushHeaders } from "@/service/calendar/google-calendar-push";
import { handleGmailPubSubPush } from "@/service/inbox/gmail-push";

export type GooglePushKind = "calendar" | "gmail_pubsub" | "ignored";

export type GooglePushHandleResult = {
  kind: GooglePushKind;
  ok: boolean;
  detail: string;
  imported?: number;
};

type HeaderMap = Record<string, string | string[] | undefined>;

function headerString(headers: HeaderMap, name: string): string {
  const raw = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(raw)) return String(raw[0] || "");
  return String(raw || "");
}

export function isGoogleCalendarPushHeaders(headers: HeaderMap): boolean {
  return Boolean(headerString(headers, "x-goog-channel-id").trim());
}

export function isGmailPubSubPushBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const message = (body as { message?: { data?: unknown } }).message;
  return typeof message?.data === "string" && message.data.length > 0;
}

export function detectGooglePushKind(
  headers: HeaderMap,
  body: unknown,
): GooglePushKind {
  if (isGoogleCalendarPushHeaders(headers)) return "calendar";
  if (isGmailPubSubPushBody(body)) return "gmail_pubsub";
  return "ignored";
}

/** Optional shared-secret checks per transport (both may be configured on one URL). */
export function verifyGooglePushAuth(input: {
  kind: GooglePushKind;
  query: { token?: string } | undefined;
  headers: HeaderMap;
}): { authorized: boolean } {
  if (input.kind === "calendar") {
    const expected = process.env.CALENDAR_PUSH_VERIFICATION_TOKEN?.trim();
    if (!expected) return { authorized: true };
    const got = String(input.query?.token || "");
    return { authorized: got === expected };
  }
  if (input.kind === "gmail_pubsub") {
    const expected = process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN?.trim();
    if (!expected) return { authorized: true };
    const got = String(
      input.query?.token ||
        headerString(input.headers, "x-goog-channel-token") ||
        headerString(input.headers, "x-internal-secret") ||
        "",
    );
    return { authorized: got === expected };
  }
  return { authorized: true };
}

export async function handleGooglePushMultiplex(input: {
  body: unknown;
  headers: HeaderMap;
  query?: { token?: string } | undefined;
}): Promise<GooglePushHandleResult> {
  const kind = detectGooglePushKind(input.headers, input.body);
  if (kind === "ignored") {
    return { kind, ok: true, detail: "ignored (not calendar or gmail pubsub)" };
  }

  const auth = verifyGooglePushAuth({
    kind,
    query: input.query,
    headers: input.headers,
  });
  if (!auth.authorized) {
    return { kind, ok: false, detail: "unauthorized" };
  }

  if (kind === "calendar") {
    const result = await handleGoogleCalendarPushHeaders({
      channelId: headerString(input.headers, "x-goog-channel-id"),
      channelToken: headerString(input.headers, "x-goog-channel-token"),
      resourceState: headerString(input.headers, "x-goog-resource-state"),
      messageNumber: headerString(input.headers, "x-goog-message-number") || undefined,
      resourceId: headerString(input.headers, "x-goog-resource-id") || undefined,
    });
    return { kind, ok: result.ok, detail: result.detail };
  }

  const gmail = await handleGmailPubSubPush(input.body);
  return {
    kind,
    ok: gmail.ok,
    detail: gmail.detail,
    imported: gmail.imported,
  };
}
