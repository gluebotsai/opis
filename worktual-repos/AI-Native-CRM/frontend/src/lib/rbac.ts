/**
 * Client-safe RBAC helpers (mirrors backend/src/service/auth/rbac for nav gating).
 */

export type AppRole =
  | "admin"
  | "sales_manager"
  | "sales_rep"
  | "presales"
  | "marketing"
  | "finance"
  | "viewer";

const ROLE_ALIASES: Record<string, AppRole> = {
  admin: "admin",
  administrator: "admin",
  sales_manager: "sales_manager",
  manager: "sales_manager",
  sales_rep: "sales_rep",
  sales: "sales_rep",
  rep: "sales_rep",
  presales: "presales",
  pre_sales: "presales",
  "pre-sales": "presales",
  marketing: "marketing",
  marketer: "marketing",
  finance: "finance",
  viewer: "viewer",
  read_only: "viewer",
};

export function normalizeRole(raw: string | null | undefined): AppRole {
  if (!raw?.trim()) return "sales_rep";
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return ROLE_ALIASES[key] ?? "sales_rep";
}

/** Manage tenant API keys / Developers — admin only. */
export function canManageApiKeys(role: AppRole): boolean {
  return role === "admin";
}

/** Org-level CRM settings (admin or sales manager). */
export function canEditOrgSettings(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Contact create / update / CSV import. */
export function canEditContacts(role: AppRole): boolean {
  return (
    role === "admin" ||
    role === "sales_manager" ||
    role === "sales_rep" ||
    role === "presales" ||
    role === "marketing"
  );
}

/** Product catalog mutations. */
export function canEditProducts(role: AppRole): boolean {
  return (
    role === "admin" ||
    role === "sales_manager" ||
    role === "sales_rep" ||
    role === "presales"
  );
}

/** Bulk CSV product import. */
export function canImportProducts(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Invoice mutations — admin or finance only. */
export function canEditFinance(role: AppRole): boolean {
  return role === "admin" || role === "finance";
}

/**
 * Configuration document templates (proposal / quote).
 * Higher officials only — not day-to-day sales reps.
 */
export function canManageDocumentTemplates(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/**
 * Configuration invoice templates (not live invoices).
 * Admins/managers set commercial docs; finance may also manage invoices.
 */
export function canEditInvoiceTemplates(role: AppRole): boolean {
  return (
    role === "admin" ||
    role === "finance" ||
    role === "sales_manager"
  );
}

/** Quotes / orders — sales-owned. */
export function canEditQuotes(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "sales_rep";
}

/** Deals / proposals mutations. */
export function canEditDeals(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "sales_rep";
}

/** View AI Agents dashboard — admin and sales_manager. */
export function canViewAgents(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Review / execute Compliance & Privacy Control requests — admin only. */
export function canManageCompliance(role: AppRole): boolean {
  return role === "admin";
}
