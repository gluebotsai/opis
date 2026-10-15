export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID?.trim() ||
  "00000000-0000-4000-8000-000000000001";

export function resolveTenantId(explicit?: string | null): string {
  return explicit?.trim() || DEFAULT_TENANT_ID;
}
