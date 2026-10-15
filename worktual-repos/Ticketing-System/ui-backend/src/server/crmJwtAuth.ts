import jwt from "jsonwebtoken";
import { getIdentityByAccountsUserId } from "./accountsSync";
import type { AuthUser } from "../types";

export type CrmAuthResult =
  | { status: "ok"; user: AuthUser }
  | { status: "forbidden"; error: string }
  | { status: "invalid" };

function accountsOrgFromClaims(payload: Record<string, unknown>): string {
  return String(
    payload.org_id ||
      payload.organization_id ||
      payload.tenant_id ||
      payload.organizationId ||
      ""
  ).trim();
}

function crmJwtConfigured(): boolean {
  return Boolean(String(process.env.CRM_JWT_ACCESS_SECRET || "").trim());
}

/** Verify CRM JWT and resolve identity (may fail entitlement). */
async function resolveCrmIdentity(
  bearerToken: string
): Promise<CrmAuthResult> {
  const secret = String(process.env.CRM_JWT_ACCESS_SECRET || "").trim();
  if (!secret) return { status: "invalid" };

  const issuer = process.env.CRM_JWT_ISSUER || "worktual-crm";
  const userIdClaim = process.env.CRM_JWT_USER_ID_CLAIM || "sub";

  try {
    const payload = jwt.verify(bearerToken, secret, {
      algorithms: ["HS256"],
      issuer,
    }) as Record<string, unknown>;

    const accountsUserId = String(
      payload[userIdClaim] || payload.sub || ""
    ).trim();
    const accountsOrgId = accountsOrgFromClaims(payload);
    if (!accountsUserId || !accountsOrgId) return { status: "invalid" };

    const identity = await getIdentityByAccountsUserId(
      accountsUserId,
      accountsOrgId
    );
    if (!identity) {
      return {
        status: "forbidden",
        error: "Ticketing product access required for this CRM user.",
      };
    }
    if (identity.role === "customer") {
      return { status: "forbidden", error: "Customer accounts use the support portal." };
    }

    return {
      status: "ok",
      user: {
        id: identity.id,
        myAccountUserId: identity.accountsUserId || undefined,
        name: identity.name,
        email: identity.email,
        initials: identity.initials,
        role: identity.role as AuthUser["role"],
        organizationId: identity.organizationId,
        organizationName: identity.companyName || undefined,
      },
    };
  } catch {
    return { status: "invalid" };
  }
}

export function isCrmJwtConfigured(): boolean {
  return crmJwtConfigured();
}

/**
 * Verify CRM-minted Bearer JWT (Path A). SPA/cookie JWT is tried first in requireAuth.
 * Requires active ticketing product entitlement — no auto-provision.
 */
export async function tryAuthenticateCrmBearer(
  bearerToken: string
): Promise<AuthUser | null> {
  const result = await resolveCrmIdentity(bearerToken);
  return result.status === "ok" ? result.user : null;
}

export async function authenticateCrmBearer(
  bearerToken: string
): Promise<CrmAuthResult> {
  return resolveCrmIdentity(bearerToken);
}
