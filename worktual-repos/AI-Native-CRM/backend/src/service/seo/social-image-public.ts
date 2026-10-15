import { createHmac, timingSafeEqual } from "node:crypto";

function mediaSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    "worktual-dev-session-secret-change-me"
  );
}

export function publicApiBase(): string | null {
  for (const key of [
    "CRM_API_PUBLIC_URL",
    "OAUTH_CALLBACK_ORIGIN",
    "NEXT_PUBLIC_APP_URL",
    "FRONTEND_ORIGIN",
  ] as const) {
    const raw = process.env[key]?.trim().replace(/\/$/, "") || "";
    if (raw.startsWith("https://")) return raw;
  }
  return null;
}

export function signSocialImageUrl(postId: string): string | null {
  const base = publicApiBase();
  if (!base) return null;
  const exp = String(Date.now() + 30 * 60 * 1000);
  const sig = createHmac("sha256", mediaSecret())
    .update(`${postId}.${exp}`)
    .digest("hex")
    .slice(0, 32);
  return `${base}/api/seo/public/social-image/${encodeURIComponent(postId)}?exp=${exp}&sig=${sig}`;
}

export function verifySocialImageSig(
  postId: string,
  exp: string,
  sig: string,
): boolean {
  const until = Number(exp);
  if (!postId || !sig || !Number.isFinite(until) || until < Date.now()) {
    return false;
  }
  const expected = createHmac("sha256", mediaSecret())
    .update(`${postId}.${exp}`)
    .digest("hex")
    .slice(0, 32);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function copyImageBytes(copy: unknown): { bytes: Buffer; mime: string } | null {
  if (!copy || typeof copy !== "object") return null;
  const rec = copy as Record<string, unknown>;
  const raw = String(rec.imageDataUrl || rec.imageUrl || "").trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(raw);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) return null;
    return { bytes, mime: match[1].toLowerCase() };
  } catch {
    return null;
  }
}
