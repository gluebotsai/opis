export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID?.trim() ||
  "1000";

export function resolveTenantId(explicit?: string | null): string {
  return explicit?.trim() || DEFAULT_TENANT_ID;
}
