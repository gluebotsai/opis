import { createHmac, timingSafeEqual } from "crypto";

function oauthStateSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    "worktual-dev-session-secret-change-me"
  );
}

export function signOAuthState(
  userId: string,
  returnTo: string,
  intent?: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      returnTo,
      t: Date.now(),
      ...(intent ? { intent } : {}),
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", oauthStateSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(
  state: string,
): { userId: string; returnTo: string; intent: string | null } | null {
  const i = state.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = createHmac("sha256", oauthStateSecret())
    .update(payload)
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
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { userId?: string; returnTo?: string; t?: number; intent?: string };
    if (!data.userId) return null;
    if (data.t && Date.now() - data.t > 15 * 60_000) return null;
    return {
      userId: data.userId,
      returnTo: data.returnTo || "/contact",
      intent: data.intent?.trim() || null,
    };
  } catch {
    return null;
  }
}
