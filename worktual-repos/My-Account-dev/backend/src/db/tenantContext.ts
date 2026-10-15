import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";

export interface TenantContext {
  isStaff: boolean;
  organizationId: string | null;
}

/**
 * Request-scoped DB tenancy context for Postgres RLS GUCs.
 * Staff/jobs default to isStaff=true so FORCE RLS does not hide rows.
 * Customer portal sets organizationId via runWithOrganizationContext.
 */
export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  return tenantContext.getStore() || { isStaff: true, organizationId: null };
}

export function runWithStaffContext<T>(fn: () => T): T {
  return tenantContext.run({ isStaff: true, organizationId: null }, fn);
}

export function runWithOrganizationContext<T>(
  organizationId: string | null | undefined,
  fn: () => T,
): T {
  return tenantContext.run(
    { isStaff: false, organizationId: organizationId || null },
    fn,
  );
}

export async function applyTenantSessionGucs(client: PoolClient): Promise<void> {
  const ctx = getTenantContext();
  // Use session-level (is_local=false) for the duration of this pooled checkout.
  if (ctx.isStaff || !ctx.organizationId) {
    await client.query(
      `SELECT set_config('app.is_staff', 'true', false), set_config('app.organization_id', '', false)`,
    );
    return;
  }
  await client.query(
    `SELECT set_config('app.is_staff', 'false', false), set_config('app.organization_id', $1, false)`,
    [String(ctx.organizationId)],
  );
}
