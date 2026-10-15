/** Default CCaaS (contact-center) role templates. Modules TBD later — CRUD flags for now. */

export const CCAAS_PRODUCT_ID = "contact-center";

export const CCAAS_DEFAULT_ROLE_TEMPLATES = [
  {
    key: "admin",
    name: "Admin",
    description: "Full CCaaS access (view, create, edit, delete, export). Modules TBD.",
    canView: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canExport: true,
  },
  {
    key: "agent",
    name: "Agent",
    description: "Agent CCaaS access (view only for now). Modules TBD.",
    canView: true,
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canExport: false,
  },
];
