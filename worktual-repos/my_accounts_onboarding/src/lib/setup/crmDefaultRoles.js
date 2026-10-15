/**
 * Default CRM role templates.
 * Module lists are intersected with the org business-type catalog
 * (`normalizeCrmModulePermissions`) so Commerce/Company/etc. appear only when allowed.
 */

export const CRM_DEFAULT_ROLE_TEMPLATES = [
  {
    key: "admin",
    name: "Admin",
    description: "Full CRM module access for this organization's business type.",
    modules: "all",
  },
  {
    key: "manager",
    name: "Manager",
    description: "Full CRM module access for this organization's business type.",
    modules: "all",
  },
  {
    key: "sales_rep",
    name: "Sales Rep",
    description:
      "Sales-focused CRM access (no Marketing or Finance). Commerce included when the business type allows it.",
    modules: [
      "dashboard",
      "inbox",
      "contact",
      "company",
      "sales",
      "activities",
      "product",
      "commerce",
      "service",
      "reports_analytics",
      "configuration",
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    description:
      "Marketing-focused CRM access (no Sales, Finance, or Service). Commerce included when the business type allows it.",
    modules: [
      "dashboard",
      "inbox",
      "contact",
      "company",
      "marketing",
      "activities",
      "product",
      "commerce",
      "reports_analytics",
      "configuration",
    ],
  },
  {
    key: "finance",
    name: "Finance",
    description: "Finance-focused CRM access (Dashboard, Inbox, Contact, Company, Finance, Reports).",
    modules: ["dashboard", "inbox", "contact", "company", "finance", "reports_analytics"],
  },
];
