/**
 * Tenant helpers for CRM.
 *
 * Runtime code must never invent a tenant. Prefer:
 * - `getCurrentOrganizationId()` for request/session scope
 * - `resolveRequestOrganizationId(explicit?)` when an optional record/header id may be present
 * - `requireOrganizationId(explicit)` when a job/record must already carry its tenant
 *
 * `DEFAULT_ORGANIZATION_ID` exists only for legacy seeds/migrations — do not use it
 * as a runtime fallback.
 */
export const DEFAULT_ORGANIZATION_ID =
  process.env.DEFAULT_ORGANIZATION_ID?.trim() || "1000";

/**
 * Require an explicit organization id. Throws if missing — never falls back
 * to the legacy default tenant.
 */
export function requireOrganizationId(explicit?: string | null): string {
  const id = explicit?.trim();
  if (!id) {
    throw new Error(
      "organizationId is required. Use the signed-in user's tenant (getCurrentOrganizationId) or pass an explicit tenant id.",
    );
  }
  return id;
}

/**
 * @deprecated Use requireOrganizationId, getCurrentOrganizationId, or
 * resolveRequestOrganizationId. This no longer falls back to a default tenant.
 */
export function resolveOrganizationId(explicit?: string | null): string {
  return requireOrganizationId(explicit);
}

/** @deprecated Seeds only — never use as a runtime tenant fallback. */
export function getDefaultOrganizationId(): string {
  return DEFAULT_ORGANIZATION_ID;
}
