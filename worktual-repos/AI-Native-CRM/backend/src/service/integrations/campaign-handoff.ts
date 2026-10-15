/**
 * CRM → Campaign MS JWT for server-side calls (nurture cron, etc.).
 * Same token shape as Marketing embed (`issueCrmAccessJwt`).
 */

import { accountQuery } from "@/dao/db/account-pool";
import {
  issueCrmAccessJwt,
  type CrmAccessJwtScope,
} from "@/service/account/crm-access-jwt";
import {
  roleFromSetupUser,
  type SetupUserRow,
} from "@/service/account/setup-users";
import type { AppRole } from "@/service/auth/rbac";

const HANDOFF_ROLE_ORDER: AppRole[] = [
  "admin",
  "sales_manager",
  "marketing",
  "sales_rep",
];

function handoffRoleRank(role: AppRole): number {
  const idx = HANDOFF_ROLE_ORDER.indexOf(role);
  return idx >= 0 ? idx : HANDOFF_ROLE_ORDER.length;
}

/** Active CRM user in org suitable for Campaign API auth (prefer admin / sales_manager). */
export async function resolveCampaignHandoffScope(
  organizationId: string,
): Promise<CrmAccessJwtScope | null> {
  const orgId = organizationId?.trim();
  if (!orgId) return null;

  const { rows } = await accountQuery<
    Pick<SetupUserRow, "id" | "organization_id" | "crm_role_name">
  >(
    `SELECT u.id::text AS id,
            u.organization_id::text AS organization_id,
            r.name AS crm_role_name
     FROM accounts.setup_users u
     INNER JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.status = 'active'
       AND u.organization_id = $1::bigint
     ORDER BY u.id ASC
     LIMIT 50`,
    [orgId],
  );

  if (rows.length === 0) return null;

  let best = rows[0];
  let bestRank = handoffRoleRank(roleFromSetupUser(best.crm_role_name));
  for (const row of rows.slice(1)) {
    const rank = handoffRoleRank(roleFromSetupUser(row.crm_role_name));
    if (rank < bestRank) {
      best = row;
      bestRank = rank;
    }
  }

  const role = roleFromSetupUser(best.crm_role_name);
  return {
    userId: best.id,
    organizationId: orgId,
    role,
  };
}

export function mintCampaignHandoffJwt(
  scope: CrmAccessJwtScope,
): string | null {
  return issueCrmAccessJwt(scope);
}
