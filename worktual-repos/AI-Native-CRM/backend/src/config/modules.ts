import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Building2,
  Megaphone,
  TrendingUp,
  Package,
  ShoppingCart,
  Inbox,
  MessageSquare,
  Wallet,
  Headphones,
  BarChart3,
  Settings2,
  Columns3,
  CalendarDays,
  ListChecks,
  Mail,
  BookOpen,
  FileText,
  Receipt,
  PlusCircle,
  Activity,
  Library,
  Radar,
  Bot,
  Search,
} from "lucide-react";
import { normalizeRole, type AppRole } from "@/service/auth/rbac";

/**
 * PARALLEL B2B/B2C WORK: high-touch shared file — coordinate before editing.
 * Both business-type tracks touch this matrix; log changes in
 * docs/parallel-work-log.md and resolve merge conflicts by hand (see
 * docs/merge-validation-checklist.md). Silent invariant breaks here won't
 * always show as a git conflict.
 */

export type BusinessType = "b2b" | "b2c" | "b2b2c";

export type ModuleId =
  | "dashboard"
  | "inbox"
  | "contact"
  | "company"
  | "marketing"
  | "sales"
  | "activities"
  | "product"
  | "commerce"
  | "communication"
  | "finance"
  | "service"
  | "reports"
  | "agents"
  | "configuration";

export type SalesSubmoduleId = "pipeline" | "calendar";

export type ConfigurationSubmoduleId =
  | "email"
  | "price-books"
  | "proposal-templates"
  | "proposal-patterns"
  | "quote-templates"
  | "invoice-templates";

export interface CrmModule {
  id: ModuleId;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export interface AppSubmodule {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  status: "ready" | "coming_soon";
}

export type SalesSubmodule = AppSubmodule & { id: SalesSubmoduleId };
export type ConfigurationSubmodule = AppSubmodule & {
  id: ConfigurationSubmoduleId;
};

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  b2b: "B2B",
  b2c: "B2C",
  b2b2c: "B2B2C",
};

export const ALL_MODULES: Record<ModuleId, CrmModule> = {
  dashboard: {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Overview of pipeline, activity, and AI agent status.",
  },
  inbox: {
    id: "inbox",
    label: "Inbox",
    href: "/inbox",
    icon: Inbox,
    description: "Recent emails, calls, meetings, and notes across contacts.",
  },
  contact: {
    id: "contact",
    label: "Contact",
    href: "/contact",
    icon: Users,
    description: "People records across customers, partners, and leads.",
  },
  company: {
    id: "company",
    label: "Company",
    href: "/company",
    icon: Building2,
    description: "Accounts, partners, and channel organizations.",
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    href: "/marketing",
    icon: Megaphone,
    description:
      "Campaign modules (same surface as Campaign product) for marketing users.",
  },
  sales: {
    id: "sales",
    label: "Sales",
    href: "/sales",
    icon: TrendingUp,
    description: "Opportunities and revenue pipeline.",
  },
  activities: {
    id: "activities",
    label: "Activities",
    href: "/activities",
    icon: ListChecks,
    description:
      "Your tasks, calls, meetings, and emails. Notes stay on contacts.",
  },
  product: {
    id: "product",
    label: "Product",
    href: "/product",
    icon: Package,
    description: "Catalog, SKUs, pricing, and product content.",
  },
  commerce: {
    id: "commerce",
    label: "Commerce",
    href: "/commerce",
    icon: ShoppingCart,
    description: "Storefront orders, carts, and consumer checkout.",
  },
  communication: {
    id: "communication",
    label: "Communication",
    href: "/communication",
    icon: MessageSquare,
    description: "Channel setup and conversation preferences.",
  },
  finance: {
    id: "finance",
    label: "Finance",
    href: "/finance",
    icon: Wallet,
    description: "Invoices, settlements, and partner payouts.",
  },
  service: {
    id: "service",
    label: "Service",
    href: "/service",
    icon: Headphones,
    description:
      "Link to Service microservice (tickets live in its own DB).",
  },
  reports: {
    id: "reports",
    label: "Reports & Analytics",
    href: "/reports",
    icon: BarChart3,
    description: "Performance dashboards and operational insights.",
  },
  agents: {
    id: "agents",
    label: "Agents",
    href: "/agents",
    icon: Bot,
    description:
      "AI agent performance — enrichment, scoring, summary, nurture, lifecycle, and owner routing (Python LangGraph).",
  },
  configuration: {
    id: "configuration",
    label: "Configuration",
    href: "/configuration/email",
    icon: Settings2,
    description: "Connect Google or Microsoft email for your workspace.",
  },
};

/** Required Sales children — scaffold first, build one by one */
export const SALES_SUBMODULES: SalesSubmodule[] = [
  {
    id: "pipeline",
    label: "Pipeline",
    href: "/sales",
    icon: Columns3,
    description:
      "Track opportunities across Qualify → Discover → Propose → Negotiate.",
    status: "ready",
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/sales/calendar",
    icon: CalendarDays,
    description: "Plan meetings and never miss important sales activities.",
    status: "ready",
  },
];

export const CONFIGURATION_SUBMODULES: ConfigurationSubmodule[] = [
  {
    id: "email",
    label: "Email",
    href: "/configuration/email",
    icon: Mail,
    description: "Connect Google or Microsoft email for Inbox send/receive.",
    status: "ready",
  },
  {
    id: "price-books",
    label: "Price books",
    href: "/configuration/price-books",
    icon: BookOpen,
    description:
      "Optional multi-region rate cards (hidden for single-market catalogs; product price is primary).",
    status: "coming_soon",
  },
  {
    id: "proposal-templates",
    label: "Proposal templates",
    href: "/configuration/proposal-templates",
    icon: FileText,
    description:
      "Standard proposal skeleton used for customer-specific proposals on deals.",
    status: "ready",
  },
  {
    id: "proposal-patterns",
    label: "Proposal patterns",
    href: "/configuration/proposal-patterns",
    icon: Radar,
    description:
      "Upload historical proposals so agents learn writing patterns and use them when generating.",
    status: "ready",
  },
  {
    id: "quote-templates",
    label: "Quote templates",
    href: "/configuration/quote-templates",
    icon: Receipt,
    description:
      "Standard quotation document (terms, bank, tax notes) applied to all customer quotes.",
    status: "ready",
  },
  {
    id: "invoice-templates",
    label: "Invoice templates",
    href: "/configuration/invoice-templates",
    icon: Receipt,
    description:
      "Standard invoice document (line items, tax, payment) applied to Finance invoices.",
    status: "ready",
  },
];

/**
 * Campaign product modules mirrored in CRM for marketing-role login.
 * Same labels/order as campaign-ms; CRM-owned Inbox/Contacts reuse existing routes.
 */
export type MarketingCampaignNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

export const MARKETING_CAMPAIGN_NAV: MarketingCampaignNavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/marketing/dashboard",
    icon: LayoutDashboard,
    description: "Overview of campaign performance for your branch.",
  },
  {
    id: "inbox",
    label: "Inbox",
    href: "/marketing/inbox",
    icon: Inbox,
    description: "Campaign replies and marketing messages.",
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "/contact",
    icon: Users,
    description: "People records for campaign audiences.",
  },
  {
    id: "create_campaign",
    label: "Create campaign",
    href: "/marketing/create",
    icon: PlusCircle,
    description: "Campaign creation workspace (no form in Phase 1).",
  },
  {
    id: "monitoring",
    label: "Campaign monitoring",
    href: "/marketing/campaigns",
    icon: Activity,
    description: "Live, scheduled, and past campaigns.",
  },
  {
    id: "templates",
    label: "Template library",
    href: "/marketing/templates",
    icon: Library,
    description: "Reusable email, form, and landing templates.",
  },
  {
    id: "events",
    label: "Events tracking",
    href: "/marketing/events",
    icon: Radar,
    description: "Forms, webinars, coupons, and other campaign events.",
  },
  {
    id: "seo",
    label: "Digital Marketing",
    href: "/marketing/seo",
    icon: Search,
    description: "Keywords, SEO content, and social posts from Semrush research.",
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    href: "/reports",
    icon: BarChart3,
    description: "Campaign and funnel performance dashboards.",
  },
  {
    id: "configuration",
    label: "Configuration",
    href: "/configuration/email",
    icon: Settings2,
    description: "Connect email for Inbox send/receive.",
  },
];

export function getMarketingCampaignNavItemByPath(
  pathname: string,
): MarketingCampaignNavItem | null {
  if (pathname === "/marketing" || pathname === "/marketing/dashboard") {
    return MARKETING_CAMPAIGN_NAV.find((i) => i.id === "dashboard") ?? null;
  }
  if (pathname.startsWith("/reports")) {
    return MARKETING_CAMPAIGN_NAV.find((i) => i.id === "reports") ?? null;
  }
  if (pathname.startsWith("/marketing/inbox") || pathname === "/inbox") {
    return MARKETING_CAMPAIGN_NAV.find((i) => i.id === "inbox") ?? null;
  }
  if (pathname.startsWith("/contact")) {
    return MARKETING_CAMPAIGN_NAV.find((i) => i.id === "contacts") ?? null;
  }
  if (pathname.startsWith("/configuration")) {
    return MARKETING_CAMPAIGN_NAV.find((i) => i.id === "configuration") ?? null;
  }
  const exact = MARKETING_CAMPAIGN_NAV.find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
  return exact ?? null;
}

export const SALES_SUBMODULE_PATHS = new Set(
  SALES_SUBMODULES.filter((s) => s.id !== "pipeline").map((s) =>
    s.href.replace("/sales/", ""),
  ),
);

/** Module IDs enabled per business type */
export const MODULES_BY_BUSINESS_TYPE: Record<BusinessType, ModuleId[]> = {
  b2b: [
    "dashboard",
    "agents",
    "inbox",
    "contact",
    "company",
    "marketing",
    "sales",
    "activities",
    "product",
    "finance",
    "service",
    "reports",
    "configuration",
  ],
  b2c: [
    "dashboard",
    "agents",
    "inbox",
    "contact",
    "marketing",
    "activities",
    "product",
    "commerce",
    "service",
    "reports",
    "configuration",
  ],
  b2b2c: [
    "dashboard",
    "agents",
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
    "reports",
    "configuration",
  ],
};

/**
 * Module IDs allowed per CRM role. Final nav = business type ∩ role.
 * `"all"` means every module the business type enables.
 *
 * Design rules (enterprise — do not patch ad hoc):
 * 1. Anyone who uses Inbox to send/receive mail needs Configuration (email OAuth),
 *    except `viewer` (read-only; cannot connect mailboxes).
 * 2. Finance owns invoices but must reach deal context via deep link (not Sales nav).
 * 3. Sales owns quotes/orders but must open Finance for invoice status via deep link.
 * 4. Marketing does not own Sales/Finance/Service; Sales does not own Marketing/Finance nav.
 * 5. B2C never enables Finance (Commerce path) — enforced in MODULES_BY_BUSINESS_TYPE.
 */
export const MODULES_BY_ROLE: Record<AppRole, ModuleId[] | "all"> = {
  admin: "all",
  sales_manager: "all",
  sales_rep: [
    "dashboard",
    "inbox",
    "contact",
    "company",
    "sales",
    "activities",
    "product",
    "commerce",
    "service",
    "configuration",
  ],
  presales: [
    "dashboard",
    "inbox",
    "contact",
    "company",
    "sales",
    "activities",
    "product",
    "commerce",
    "service",
    "configuration",
  ],
  marketing: [
    "dashboard",
    "inbox",
    "contact",
    "company",
    "marketing",
    "activities",
    "product",
    "commerce",
    "reports",
    "configuration",
  ],
  finance: [
    "dashboard",
    "inbox",
    "contact",
    "company",
    "finance",
    "configuration",
  ],
  viewer: [
    "dashboard",
    "inbox",
    "contact",
    "company",
    "sales",
    "activities",
    "product",
    "commerce",
  ],
};

/**
 * Deep links: route access without sidebar entry.
 * Keep bidirectional revenue-path links here — not by stuffing modules into every role nav.
 */
export const MODULE_DEEP_LINKS_BY_ROLE: Partial<Record<AppRole, ModuleId[]>> = {
  /** Invoice / company rows → deal detail */
  finance: ["sales"],
  /** Accepted quote → invoice / Finance list */
  sales_rep: ["finance"],
  sales_manager: ["finance"],
  presales: ["finance"],
};

/** Dev-time guards so role/module mistakes fail fast. */
function assertModuleAccessInvariants(): void {
  if (MODULES_BY_BUSINESS_TYPE.b2c.includes("finance")) {
    throw new Error("Invariant: B2C must not enable Finance (Commerce path).");
  }
  for (const role of Object.keys(MODULES_BY_ROLE) as AppRole[]) {
    const mods = MODULES_BY_ROLE[role];
    if (mods === "all") continue;
    const needsMailSetup = mods.includes("inbox") && role !== "viewer";
    if (needsMailSetup && !mods.includes("configuration")) {
      throw new Error(
        `Invariant: role "${role}" has Inbox but not Configuration (email OAuth).`,
      );
    }
  }
}

assertModuleAccessInvariants();

export function getModulesForBusinessType(type: BusinessType): CrmModule[] {
  return MODULES_BY_BUSINESS_TYPE[type].map((id) => ALL_MODULES[id]);
}

/** Modules visible in the sidebar for this business type + role. */
export function getModulesForAccess(
  type: BusinessType,
  roleRaw: string | null | undefined,
): CrmModule[] {
  return moduleIdsForNav(type, roleRaw).map((id) => ALL_MODULES[id]);
}

export function moduleIdsForNav(
  type: BusinessType,
  roleRaw: string | null | undefined,
): ModuleId[] {
  const role = normalizeRole(roleRaw);
  const byType = MODULES_BY_BUSINESS_TYPE[type];
  const byRole = MODULES_BY_ROLE[role];
  let ids: ModuleId[];
  if (byRole === "all") ids = [...byType];
  else ids = byType.filter((id) => byRole.includes(id));
  if (role !== "marketing") {
    ids = ids.filter((id) => id !== "reports");
  }
  return ids;
}

/** Nav modules plus deep-link exceptions (route guard). */
export function moduleIdsForAccess(
  type: BusinessType,
  roleRaw: string | null | undefined,
): ModuleId[] {
  const role = normalizeRole(roleRaw);
  const nav = moduleIdsForNav(type, role);
  const deep = MODULE_DEEP_LINKS_BY_ROLE[role] ?? [];
  const byType = MODULES_BY_BUSINESS_TYPE[type];
  const extra = deep.filter((id) => byType.includes(id) && !nav.includes(id));
  return [...nav, ...extra];
}

export function isValidModuleId(id: string): id is ModuleId {
  return id in ALL_MODULES;
}

export function isModuleEnabledForType(
  moduleId: ModuleId,
  type: BusinessType,
): boolean {
  return MODULES_BY_BUSINESS_TYPE[type].includes(moduleId);
}

export function isModuleEnabledForAccess(
  moduleId: ModuleId,
  type: BusinessType,
  roleRaw: string | null | undefined,
): boolean {
  return moduleIdsForAccess(type, roleRaw).includes(moduleId);
}

export function getSalesSubmoduleByPath(
  pathname: string,
): SalesSubmodule | null {
  if (pathname === "/sales" || pathname === "/sales/new") {
    return SALES_SUBMODULES.find((s) => s.id === "pipeline") ?? null;
  }
  if (pathname.startsWith("/sales/calendar")) {
    return SALES_SUBMODULES.find((s) => s.id === "calendar") ?? null;
  }
  if (pathname.startsWith("/sales/")) {
    return SALES_SUBMODULES.find((s) => s.id === "pipeline") ?? null;
  }
  return null;
}

export function isSalesSubmoduleActive(
  sub: SalesSubmodule,
  pathname: string,
): boolean {
  if (sub.id === "pipeline") {
    if (pathname === "/sales" || pathname === "/sales/new") return true;
    if (pathname.startsWith("/sales/calendar")) return false;
    return pathname.startsWith("/sales/");
  }
  return pathname === sub.href || pathname.startsWith(`${sub.href}/`);
}

export function getConfigurationSubmoduleByPath(
  pathname: string,
): ConfigurationSubmodule | null {
  if (pathname.startsWith("/configuration/price-books")) {
    return CONFIGURATION_SUBMODULES.find((s) => s.id === "price-books") ?? null;
  }
  if (pathname.startsWith("/configuration/proposal-templates")) {
    return (
      CONFIGURATION_SUBMODULES.find((s) => s.id === "proposal-templates") ??
      null
    );
  }
  if (pathname.startsWith("/configuration/proposal-patterns")) {
    return (
      CONFIGURATION_SUBMODULES.find((s) => s.id === "proposal-patterns") ?? null
    );
  }
  if (pathname.startsWith("/configuration/quote-templates")) {
    return (
      CONFIGURATION_SUBMODULES.find((s) => s.id === "quote-templates") ?? null
    );
  }
  if (pathname.startsWith("/configuration/invoice-templates")) {
    return (
      CONFIGURATION_SUBMODULES.find((s) => s.id === "invoice-templates") ?? null
    );
  }
  if (
    pathname === "/configuration" ||
    pathname.startsWith("/configuration/email")
  ) {
    return CONFIGURATION_SUBMODULES.find((s) => s.id === "email") ?? null;
  }
  if (pathname.startsWith("/configuration/")) {
    return CONFIGURATION_SUBMODULES[0] ?? null;
  }
  return null;
}

export function isConfigurationSubmoduleActive(
  sub: ConfigurationSubmodule,
  pathname: string,
): boolean {
  return pathname === sub.href || pathname.startsWith(`${sub.href}/`);
}
