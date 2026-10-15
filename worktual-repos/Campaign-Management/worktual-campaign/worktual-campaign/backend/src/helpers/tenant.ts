import { AppError } from "./response-builders.js";

/**
 * Organization id is always the user's organization_id from accounts.setup_users.
 * On worktual_bigint this is a numeric string (e.g. "1000").
 */
export function resolveOrganizationId(
  organizationId: string | null | undefined,
): string {
  const id = organizationId?.trim();
  if (!id) {
    throw new AppError(
      "Your account has no organization. Contact an admin to complete setup.",
      403,
    );
  }
  return id;
}

/** @deprecated use resolveOrganizationId */
export const resolveTenantId = resolveOrganizationId;
