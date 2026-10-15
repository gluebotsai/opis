import type { BusinessType, ModuleId } from "@/config/modules";
import { isModuleEnabledForType } from "@/config/modules";
import { resolveBusinessTypeFromCredentials } from "@/lib/business-type";
import { getServerUserId } from "@/service/account/session-cookie";
import { getRequestApiKeyAuth } from "@/service/account/request-context";
import { getSetupUserById } from "@/service/account/setup-users";
import { parseCrmRole, type AppRole } from "@/service/auth/rbac";
import { requireOrganizationId } from "@/dao/org/organization";

function parseBusinessType(raw: string | null | undefined): BusinessType | null {
  const v = raw?.trim().toLowerCase();
  if (v === "b2b" || v === "b2c" || v === "b2b2c") return v;
  return null;
}

/** Resolves the signed-in user's CRM role from accounts.setup_users / product access. */
export async function getCurrentUserRole(): Promise<AppRole> {
  // Tenant API keys are admin-created and act with admin privileges within scopes.
  if (getRequestApiKeyAuth()) return "admin";

  const userId = await getServerUserId();
  if (!userId) return "viewer";

  try {
    const user = await getSetupUserById(userId);
    if (!user || user.status !== "active") return "viewer";
    return parseCrmRole(user.crm_role_name) ?? "viewer";
  } catch (err) {
    console.error(
      "getCurrentUserRole failed",
      err instanceof Error ? err.message : err,
    );
    return "viewer";
  }
}

/**
 * Business type from accounts.organizations.business_type; email heuristic fallback.
 */
export async function getCurrentBusinessType(): Promise<BusinessType> {
  const userId = await getServerUserId();
  if (!userId) return "b2b";

  try {
    const user = await getSetupUserById(userId);
    return (
      parseBusinessType(user?.business_type) ??
      resolveBusinessTypeFromCredentials(user?.email ?? "")
    );
  } catch (err) {
    console.error(
      "getCurrentBusinessType failed",
      err instanceof Error ? err.message : err,
    );
    return "b2b";
  }
}

/**
 * Organization id from API key auth, or the signed-in user's organization.
 * Never invents a default tenant — throws if there is no session/key or no org.
 */
export async function getCurrentOrganizationId(): Promise<string> {
  const apiKey = getRequestApiKeyAuth();
  if (apiKey?.organizationId) {
    return requireOrganizationId(apiKey.organizationId);
  }

  const userId = await getServerUserId();
  if (!userId) {
    throw new ForbiddenError(
      "Not signed in — cannot resolve organization.",
    );
  }

  const user = await getSetupUserById(userId);
  const orgId = user?.organization_id?.trim();
  if (!orgId) {
    throw new ForbiddenError(
      "Your account has no organization. Ask an admin to assign a tenant.",
    );
  }
  return orgId;
}

/**
 * Prefer an explicit tenant id (record/header/body); otherwise the signed-in
 * user's tenant. Never falls back to a default organization.
 */
export async function resolveRequestOrganizationId(
  explicit?: string | null,
): Promise<string> {
  const id = explicit?.trim();
  if (id) return requireOrganizationId(id);
  return getCurrentOrganizationId();
}

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message = "You do not have permission to do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws ForbiddenError unless the current user's role passes `check`. */
export async function requireRole(
  check: (role: AppRole) => boolean,
  message?: string,
): Promise<AppRole> {
  const role = await getCurrentUserRole();
  if (!check(role)) {
    throw new ForbiddenError(message);
  }
  return role;
}

/**
 * Throws ForbiddenError unless `moduleId` is enabled for the signed-in user's
 * business type (e.g. B2C never has `finance`/`sales`). Role checks alone
 * (`requireRole`) are not enough — a B2C admin still passes `canEditFinance`
 * but must never be able to mutate finance/sales records via the API, even
 * though the UI hides those modules for that business type.
 */
export async function requireModuleEnabled(
  moduleId: ModuleId,
  message?: string,
): Promise<BusinessType> {
  const businessType = await getCurrentBusinessType();
  if (!isModuleEnabledForType(moduleId, businessType)) {
    throw new ForbiddenError(
      message ?? `This is not available for your business type.`,
    );
  }
  return businessType;
}
