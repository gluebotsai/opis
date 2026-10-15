import { createHmac, timingSafeEqual } from "node:crypto";

type JwtPayload = {
  sub: string;
  tenant_id: string;
  email: string;
  role: "admin" | "agent";
  exp: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSegment(segment: string, secret: string): string {
  return createHmac("sha256", secret).update(segment).digest("base64url");
}

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 12;

export function signAccessToken(
  payload: Omit<JwtPayload, "exp">,
  secret: string,
  expiresInSeconds = DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  );
  const signature = signSegment(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = signSegment(`${header}.${body}`, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as JwtPayload;
    if (!payload.sub || !payload.tenant_id || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
