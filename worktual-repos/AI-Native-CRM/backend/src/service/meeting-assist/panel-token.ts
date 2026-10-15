import { createHmac, timingSafeEqual } from "crypto";

/** Short-lived token for Meet / Zoom / Teams iframes (cookies often blocked). */
const PANEL_TOKEN_TTL_MS = 8 * 60 * 60_000;

function secret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    "worktual-dev-session-secret-change-me"
  );
}

export type MeetingAssistPanelTokenPayload = {
  userId: string;
  organizationId: string;
  /** When set, token is scoped to this assist session. */
  sessionId: string | null;
  exp: number;
};

export function signMeetingAssistPanelToken(input: {
  userId: string;
  organizationId: string;
  sessionId?: string | null;
  ttlMs?: number;
}): string {
  const payload: MeetingAssistPanelTokenPayload = {
    userId: input.userId,
    organizationId: input.organizationId,
    sessionId: input.sessionId?.trim() || null,
    exp: Date.now() + (input.ttlMs ?? PANEL_TOKEN_TTL_MS),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMeetingAssistPanelToken(
  token: string | null | undefined,
): MeetingAssistPanelTokenPayload | null {
  if (!token?.trim()) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as MeetingAssistPanelTokenPayload;
    if (!data.userId || !data.organizationId || !data.exp) return null;
    if (Date.now() > data.exp) return null;
    return {
      userId: data.userId,
      organizationId: data.organizationId,
      sessionId: data.sessionId?.trim() || null,
      exp: data.exp,
    };
  } catch {
    return null;
  }
}

/** Public SPA origin for panel deep links (Vite :5173 locally). */
export function publicAppOrigin(): string {
  return (
    process.env.FRONTEND_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
}

export function meetingAssistPanelPath(sessionId: string, token?: string): string {
  const path = `/meeting-assist/panel/${encodeURIComponent(sessionId)}`;
  if (!token) return path;
  return `${path}?token=${encodeURIComponent(token)}`;
}

export function meetingAssistPanelUrl(sessionId: string, token?: string): string {
  return `${publicAppOrigin()}${meetingAssistPanelPath(sessionId, token)}`;
}
