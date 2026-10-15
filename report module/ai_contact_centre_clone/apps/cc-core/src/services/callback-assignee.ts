import { createLogger } from "@ai-contact-center/observability";

import { serializeEntityId } from "../lib/id-schema.js";
import type { DbClient } from "../lib/rls.js";
import { resolveRole } from "./auth.js";

const log = createLogger({ service: "cc-core-callback-assignee" });

const clearedOrganizations = new Set<string>();
let assigneeColumnNullable = false;

/** Same admin roles as login: admin, administrator, manager, supervisor. */
export function contactCenterRoleIsAdmin(roleName: string | null | undefined): boolean {
  return resolveRole(roleName) === "admin";
}

export async function listContactCenterAdminUserIds(
  db: DbClient,
  organizationId: string,
): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ user_id: bigint }[]>`
    SELECT DISTINCT supa.user_id
    FROM accounts.setup_user_product_access supa
    INNER JOIN accounts.setup_roles sr ON sr.id = supa.role_id
    WHERE supa.organization_id = ${organizationId}::bigint
      AND supa.product_id = 'contact-center'
      AND LOWER(TRIM(sr.name)) IN ('admin', 'administrator', 'manager', 'supervisor')
  `;
  return new Set(rows.map((row) => serializeEntityId(row.user_id)));
}

export async function assertCallbackAssigneeIsAgent(
  db: DbClient,
  organizationId: string,
  assignedUserId: string,
): Promise<void> {
  const adminIds = await listContactCenterAdminUserIds(db, organizationId);
  if (adminIds.has(assignedUserId)) {
    throw Object.assign(new Error("Callbacks cannot be assigned to an admin"), { status: 400 });
  }
}

async function ensureCallbackAssigneeNullable(db: DbClient): Promise<void> {
  if (assigneeColumnNullable) return;
  const rows = await db.$queryRaw<{ is_nullable: string }[]>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'ccass'
      AND table_name = 'agent_tasks'
      AND column_name = 'assigned_user_id'
    LIMIT 1
  `;
  if (rows[0]?.is_nullable !== "YES") {
    await db.$executeRaw`
      ALTER TABLE ccass.agent_tasks ALTER COLUMN assigned_user_id DROP NOT NULL
    `;
  }
  assigneeColumnNullable = true;
}

/** Open callbacks assigned to an admin become unassigned. Completed callbacks stay as history. */
export async function unassignOpenAdminCallbacks(
  db: DbClient,
  organizationId: string,
): Promise<void> {
  if (clearedOrganizations.has(organizationId)) return;
  try {
    await ensureCallbackAssigneeNullable(db);
    await db.$executeRaw`
      UPDATE ccass.agent_tasks t
      SET assigned_user_id = NULL,
          updated_at = NOW()
      WHERE t.organization_id = ${organizationId}::bigint
        AND t.task_type = 'callback'
        AND t.status = 'open'
        AND t.assigned_user_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM accounts.setup_user_product_access supa
          INNER JOIN accounts.setup_roles sr ON sr.id = supa.role_id
          WHERE supa.user_id = t.assigned_user_id
            AND supa.organization_id = t.organization_id
            AND supa.product_id = 'contact-center'
            AND LOWER(TRIM(sr.name)) IN ('admin', 'administrator', 'manager', 'supervisor')
        )
    `;
    clearedOrganizations.add(organizationId);
  } catch (error) {
    clearedOrganizations.add(organizationId);
    log.warn({ err: error, organizationId }, "could not unassign open callbacks from admins");
  }
}
