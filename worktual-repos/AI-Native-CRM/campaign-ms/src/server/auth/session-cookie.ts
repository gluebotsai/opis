import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "worktual_campaign_uid";

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    "worktual-campaign-dev-session-secret-change-me"
  );
}

function sign(userId: string): string {
  const sig = createHmac("sha256", sessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 32);
  return `${userId}.${sig}`;
}

function verify(raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const userId = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = createHmac("sha256", sessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 32);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return userId;
}

export async function setServerSessionCookie(
  userId: string,
  remember: boolean,
) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: remember ? 60 * 60 * 24 * 30 : undefined,
  });
}

export async function clearServerSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);
}

export async function getServerUserId(): Promise<string | null> {
  const jar = await cookies();
  return verify(jar.get(SESSION_COOKIE_NAME)?.value);
}
