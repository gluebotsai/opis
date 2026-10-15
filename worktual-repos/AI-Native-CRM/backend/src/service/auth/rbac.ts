/**
 * Lightweight RBAC for enterprise CRM.
 * Role comes from accounts.setup_roles via setup_user_product_access (CRM product).
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
  return parseCrmRole(raw) ?? "sales_rep";
}

/** CRM product role, or null when the user has no CRM access or an unknown role. */
export function parseCrmRole(raw: string | null | undefined): AppRole | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return ROLE_ALIASES[key] ?? null;
}

export function canManageUsers(role: AppRole): boolean {
  return role === "admin";
}

/** Org vertical / tenant CRM settings (admin or sales_manager). */
export function canEditOrgSettings(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Admins may assign tasks to other users; everyone else is self-assigned. */
export function canAssignTaskAssignee(role: AppRole): boolean {
  return role === "admin";
}

/** Assign / reassign contact (lead) ownership to a sales user. */
export function canAssignContactOwner(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Assign / reassign deal ownership to a sales user. */
export function canAssignDealOwner(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

export function canApproveDiscounts(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

export function canViewAllRecords(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "finance";
}

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

/** Upload / AI-generate quote & invoice template designs (admin only). */
export function canUploadCommercialDocumentTemplates(role: AppRole): boolean {
  return role === "admin";
}

/**
 * Configuration invoice templates (not live invoice mutations).
 * Admins/managers set commercial docs; finance may also manage invoices.
 */
export function canEditInvoiceTemplates(role: AppRole): boolean {
  return (
    role === "admin" ||
    role === "finance" ||
    role === "sales_manager"
  );
}

export function canConvertLeads(role: AppRole): boolean {
  return role !== "viewer" && role !== "finance";
}

/** Quotes / orders are sales-owned; marketing and viewers cannot edit. */
export function canEditQuotes(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "sales_rep";
}

/** Deals / pipeline mutations. */
export function canEditDeals(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "sales_rep";
}

/** Contact create/update/delete (not finance-owned). */
export function canEditContacts(role: AppRole): boolean {
  return (
    role === "admin" ||
    role === "sales_manager" ||
    role === "sales_rep" ||
    role === "marketing"
  );
}

/** Company / location mutations. */
export function canEditCompanies(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "sales_rep";
}

/** Product catalog mutations. */
export function canEditProducts(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager" || role === "sales_rep";
}

/** Bulk CSV product import (higher risk than single edits). */
export function canImportProducts(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** View AI Agents dashboard — admin and sales_manager (ops oversight). */
export function canViewAgents(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Sales assignment capacity / territory — admin and sales_manager. */
export function canManageSalesAssignment(role: AppRole): boolean {
  return role === "admin" || role === "sales_manager";
}

export function canViewSalesAssignment(role: AppRole): boolean {
  return canManageSalesAssignment(role);
}

/** Commerce (contact-first) order create. */
export function canEditCommerce(role: AppRole): boolean {
  return (
    role === "admin" ||
    role === "sales_manager" ||
    role === "sales_rep" ||
    role === "marketing"
  );
}

/**
 * Review / execute Compliance & Privacy Control Agent requests
 * (data deletion, data access). Admin only — deletion authority belongs to
 * admins specifically, not a deal/contact owner who may be a sales rep with
 * no legal authority.
 */
export function canManageCompliance(role: AppRole): boolean {
  return role === "admin";
}
