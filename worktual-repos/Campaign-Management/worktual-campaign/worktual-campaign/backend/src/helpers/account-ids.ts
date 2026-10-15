/**
 * Account / CDP / campaign id helpers for worktual_bigint (numeric string ids).
 * Kept for call-site clarity; values pass through unless a legacy mapped UUID appears.
 */

const ORG_MAP_RE = /^00000000-0000-4000-a000-([0-9]{12})$/i;
const USER_MAP_RE = /^00000000-0000-4000-b000-([0-9]{12})$/i;

/** Normalize session tenant → accounts/CDP organization_id string. */
export function accountOrgParam(organizationId: string): string {
  const id = organizationId.trim();
  const m = ORG_MAP_RE.exec(id);
  if (m) return String(BigInt(m[1]!));
  return id;
}

/** Normalize session user id → accounts.setup_users id string. */
export function userUuidToAccountId(userId: string): string {
  const id = userId.trim();
  const m = USER_MAP_RE.exec(id);
  if (m) return String(BigInt(m[1]!));
  return id;
}

/** Prisma BigInt column bind from session/API string id. */
export function toDbId(id: string | number | bigint): bigint {
  return typeof id === "bigint" ? id : BigInt(String(id).trim());
}

/** API / JWT string id from Prisma BigInt. */
export function fromDbId(id: bigint | number | string | null | undefined): string {
  if (id == null) return "";
  return String(id);
}
