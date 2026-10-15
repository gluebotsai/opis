import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtPayload = {
  sub: string;
  tenant_id: string;
  email: string;
  role: "admin" | "agent";
  exp: number;
};

function signSegment(segment: string, secret: string): string {
  return createHmac("sha256", secret).update(segment).digest("base64url");
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
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
    if (!payload.sub || !payload.tenant_id || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
