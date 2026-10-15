import { pool } from "./db/pool.js";
import * as repo from "./repositories/raw/setupOrganization.repo.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import { CRM_PRODUCT_ID, listCrmModulesForBusinessType, normalizeCrmModulePermissions, resolveCrmBusinessTypeKey } from "../src/lib/setup/crmModules.js";
import { CRM_DEFAULT_ROLE_TEMPLATES } from "../src/lib/setup/crmDefaultRoles.js";

function resolveTemplateModules(template, businessType) {
  if (template.modules === "all") {
    return listCrmModulesForBusinessType(businessType).map((entry) => entry.id);
  }
  return normalizeCrmModulePermissions(template.modules, businessType);
}

async function organizationHasActiveCrm(organizationId) {
  const subscriptions = await listSubscriptionsByOrganization(organizationId);
  return subscriptions.some(
    (sub) => sub.productId === CRM_PRODUCT_ID && String(sub.status || "").toLowerCase() === "active",
  );
}

/**
 * Insert missing CRM default roles for an org when CRM is active and business type is set.
 * Does not overwrite existing roles with the same name.
 */
export async function ensureCrmDefaultRoles(organizationId) {
  if (!organizationId) {
    return { created: [], skipped: "missing_organization" };
  }

  if (!(await organizationHasActiveCrm(organizationId))) {
    return { created: [], skipped: "no_active_crm" };
  }

  const profile = await repo.selectBusinessProfile(pool, organizationId);
  const businessType = profile?.business_type || "";
  if (!resolveCrmBusinessTypeKey(businessType)) {
    return { created: [], skipped: "missing_business_type" };
  }

  const created = [];
  for (const template of CRM_DEFAULT_ROLE_TEMPLATES) {
    const existing = await repo.findRoleByProductAndName(
      pool,
      organizationId,
      CRM_PRODUCT_ID,
      template.name,
    );
    if (existing) continue;

    const modulePermissions = resolveTemplateModules(template, businessType);
    await repo.insertRole(pool, organizationId, {
      name: template.name,
      description: template.description,
      productId: CRM_PRODUCT_ID,
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      modulePermissions,
    });
    created.push(template.name);
  }

  return { created, skipped: created.length ? null : "already_present" };
}
