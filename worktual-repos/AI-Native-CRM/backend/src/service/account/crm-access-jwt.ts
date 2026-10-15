import { createHmac, randomUUID } from "node:crypto";

export const CRM_ACCESS_JWT_AUDIENCE = "campaign-ms";

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export type CrmAccessJwtScope = {
  userId: string;
  organizationId: string;
  role: string;
};

/** Issue a short-lived HS256 JWT for Campaign MS API + embed SSO. */
export function issueCrmAccessJwt(
  scope: CrmAccessJwtScope,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const secret = process.env.JWT_ACCESS_SECRET?.trim();
  if (!secret) return null;

  const configuredTtl = Number(process.env.JWT_ACCESS_TTL_SECONDS || 900);
  const ttl = Number.isFinite(configuredTtl)
    ? Math.min(3600, Math.max(60, configuredTtl))
    : 900;

  const payload = {
    iss: process.env.CRM_JWT_ISSUER?.trim() || "worktual-crm",
    aud: CRM_ACCESS_JWT_AUDIENCE,
    sub: String(scope.userId).trim(),
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    jti: randomUUID(),
    org_id: String(scope.organizationId).trim(),
    role: String(scope.role).trim(),
  };

  const encodedHeader = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}
