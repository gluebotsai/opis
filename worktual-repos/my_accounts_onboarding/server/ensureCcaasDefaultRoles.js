import { pool } from "./db/pool.js";
import * as repo from "./repositories/raw/setupOrganization.repo.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import {
  CCAAS_DEFAULT_ROLE_TEMPLATES,
  CCAAS_PRODUCT_ID,
} from "../src/lib/setup/ccaasDefaultRoles.js";

async function organizationHasActiveCcaas(organizationId) {
  const subscriptions = await listSubscriptionsByOrganization(organizationId);
  return subscriptions.some(
    (sub) =>
      sub.productId === CCAAS_PRODUCT_ID && String(sub.status || "").toLowerCase() === "active",
  );
}

/**
 * Insert missing CCaaS default roles when contact-center is active.
 * Does not overwrite existing roles with the same name. Modules come later.
 */
export async function ensureCcaasDefaultRoles(organizationId) {
  if (!organizationId) {
    return { created: [], skipped: "missing_organization" };
  }

  if (!(await organizationHasActiveCcaas(organizationId))) {
    return { created: [], skipped: "no_active_ccaas" };
  }

  const created = [];
  for (const template of CCAAS_DEFAULT_ROLE_TEMPLATES) {
    const existing = await repo.findRoleByProductAndName(
      pool,
      organizationId,
      CCAAS_PRODUCT_ID,
      template.name,
    );
    if (existing) continue;

    await repo.insertRole(pool, organizationId, {
      name: template.name,
      description: template.description,
      productId: CCAAS_PRODUCT_ID,
      canView: template.canView !== false,
      canCreate: Boolean(template.canCreate),
      canEdit: Boolean(template.canEdit),
      canDelete: Boolean(template.canDelete),
      canExport: Boolean(template.canExport),
      modulePermissions: [],
    });
    created.push(template.name);
  }

  return { created, skipped: created.length ? null : "already_present" };
}
