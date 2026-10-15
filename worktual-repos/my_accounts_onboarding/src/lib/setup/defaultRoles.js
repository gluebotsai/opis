import { CRM_PRODUCT_ID } from "./crmModules.js";
import { CRM_DEFAULT_ROLE_TEMPLATES } from "./crmDefaultRoles.js";
import { CCAAS_PRODUCT_ID, CCAAS_DEFAULT_ROLE_TEMPLATES } from "./ccaasDefaultRoles.js";

/** Custom role create/edit is disabled until product modules are fully defined. */
export const CUSTOM_SETUP_ROLES_ENABLED = false;

const DEFAULT_NAMES_BY_PRODUCT = {
  [CRM_PRODUCT_ID]: new Set(
    CRM_DEFAULT_ROLE_TEMPLATES.map((entry) => entry.name.trim().toLowerCase()),
  ),
  [CCAAS_PRODUCT_ID]: new Set(
    CCAAS_DEFAULT_ROLE_TEMPLATES.map((entry) => entry.name.trim().toLowerCase()),
  ),
};

export function isDefaultSetupRole(productId, name) {
  const productKey = String(productId || "").trim();
  const nameKey = String(name || "").trim().toLowerCase();
  if (!productKey || !nameKey) return false;
  const names = DEFAULT_NAMES_BY_PRODUCT[productKey];
  return Boolean(names?.has(nameKey));
}

export function isDefaultSetupRoleRow(role) {
  return isDefaultSetupRole(role?.productId, role?.name);
}

/** Roles admins may assign on People (defaults only while custom roles are off). */
export function selectableSetupRoles(roles) {
  const list = Array.isArray(roles) ? roles : [];
  if (CUSTOM_SETUP_ROLES_ENABLED) return list;
  return list.filter(isDefaultSetupRoleRow);
}
