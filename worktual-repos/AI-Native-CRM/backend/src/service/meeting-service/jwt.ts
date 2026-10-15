import { createHmac, timingSafeEqual } from "node:crypto";

import { meetingServiceJwtSecret } from "@/service/meeting-service/config";

export type MeetingServiceJwtPayload = {
  organization_id: string;
  sub: string;
  scopes?: string[];
  email?: string;
  /** Google account display name from the Meet add-on sign-in. */
  name?: string;
  /** Google ID token subject. Stored for later comparison; not a channel bind. */
  google_sub?: string;
  exp?: number;
};

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** HS256 JWT for meeting-service REST + WS (organization_id from token). */
export function mintMeetingServiceJwt(input: {
  organizationId: string;
  sub: string;
  scopes?: string[];
  email?: string | null;
  ttlSec?: number;
}): string | null {
  const secret = meetingServiceJwtSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSec ?? 8 * 60 * 60;
  const payload = {
    organization_id: input.organizationId,
    sub: input.sub,
    scopes: input.scopes ?? ["meetings:write"],
    ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
    iat: now,
    exp: now + ttl,
  };
  const encodedHeader = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyMeetingServiceJwt(
  token: string | null | undefined,
): MeetingServiceJwtPayload | null {
  const secret = meetingServiceJwtSecret();
  if (!secret || !token?.trim()) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  try {
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as MeetingServiceJwtPayload;
    if (!payload.organization_id?.trim()) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
