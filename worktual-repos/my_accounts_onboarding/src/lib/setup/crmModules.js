/** CRM module access catalogs by organization business type. */

export const CRM_PRODUCT_ID = "crm";

const MODULE = {
  dashboard: { id: "dashboard", label: "Dashboard" },
  inbox: { id: "inbox", label: "Inbox" },
  contact: { id: "contact", label: "Contact" },
  company: { id: "company", label: "Company" },
  marketing: { id: "marketing", label: "Marketing" },
  sales: { id: "sales", label: "Sales" },
  activities: { id: "activities", label: "Activities" },
  product: { id: "product", label: "Product" },
  finance: { id: "finance", label: "Finance" },
  commerce: { id: "commerce", label: "Commerce" },
  service: { id: "service", label: "Service" },
  reports_analytics: { id: "reports_analytics", label: "Reports & Analytics" },
  configuration: { id: "configuration", label: "Configuration" },
};

function modules(...ids) {
  return ids.map((id) => MODULE[id]).filter(Boolean);
}

/**
 * Canonical keys: B2B | B2C | B2B2C
 * UI/DB value "B2B & B2C" maps to B2B2C.
 */
export const CRM_MODULES_BY_BUSINESS_TYPE = {
  B2B: modules(
    "dashboard",
    "inbox",
    "contact",
    "company",
    "marketing",
    "sales",
    "activities",
    "product",
    "finance",
    "service",
    "reports_analytics",
    "configuration",
  ),
  B2C: modules(
    "dashboard",
    "inbox",
    "contact",
    "marketing",
    "activities",
    "product",
    "commerce",
    "service",
    "reports_analytics",
    "configuration",
  ),
  B2B2C: modules(
    "dashboard",
    "inbox",
    "contact",
    "company",
    "marketing",
    "sales",
    "activities",
    "product",
    "commerce",
    "finance",
    "service",
    "reports_analytics",
    "configuration",
  ),
};

export function resolveCrmBusinessTypeKey(businessType) {
  const raw = String(businessType || "").trim();
  if (!raw) return "";
  if (raw === "B2B" || raw === "B2C") return raw;
  if (raw === "B2B2C" || raw === "B2B & B2C" || /b2b\s*&\s*b2c/i.test(raw)) {
    return "B2B2C";
  }
  return "";
}

export function listCrmModulesForBusinessType(businessType) {
  const key = resolveCrmBusinessTypeKey(businessType);
  if (!key) return [];
  return CRM_MODULES_BY_BUSINESS_TYPE[key].map((entry) => ({ ...entry }));
}

export function getCrmModuleLabel(moduleId) {
  return MODULE[moduleId]?.label || moduleId;
}

/** Keep only module ids allowed for the org business type (stable order from catalog). */
export function normalizeCrmModulePermissions(ids, businessType) {
  const allowed = listCrmModulesForBusinessType(businessType);
  const allowedIds = new Set(allowed.map((entry) => entry.id));
  const incoming = Array.isArray(ids) ? ids : [];
  const selected = new Set(
    incoming.map((id) => String(id || "").trim()).filter((id) => allowedIds.has(id)),
  );
  return allowed.map((entry) => entry.id).filter((id) => selected.has(id));
}

export function isCrmProduct(productId) {
  return String(productId || "").trim() === CRM_PRODUCT_ID;
}
