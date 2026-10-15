/**
 * Role-based module + data access for Ticketing.
 * Roles mirror accounts.setup_roles: Admin / Agent / Resolver / Customer.
 */
import type { AuthUser } from "./types";

export type AppRole = AuthUser["role"];

/** Sidebar / view ids used by App + Sidebar */
export type AppModule =
  | "dashboard"
  | "search"
  | "assigned"
  | "team-queue"
  | "team-inbox"
  | "unassigned"
  | "work-board"
  | "create-ticket"
  | "agent-queues"
  | "kb"
  | "customers"
  | "analytics"
  | "audit"
  | "csat-reports"
  | "macros"
  | "priorities"
  | "escalation-directory"
  | "org-preferences"
  | "approvals"
  | "internal-chat"
  | "settings";

export type DataScope = "org" | "assignee" | "requester";

export type TicketListScope =
  | "default"
  | "assignee"
  | "requester"
  | "team"
  | "unassigned"
  | "org";

export type SettingsSection =
  | "profile"
  | "security"
  | "sessions"
  | "notifications"
  | "loginActivity";

const MODULES_BY_ROLE: Record<AppRole, AppModule[]> = {
  admin: [
    "dashboard",
    "search",
    "assigned",
    "team-queue",
    "team-inbox",
    "unassigned",
    "create-ticket",
    "agent-queues",
    "kb",
    "customers",
    "analytics",
    "audit",
    "csat-reports",
    "macros",
    "priorities",
    "escalation-directory",
    "org-preferences",
    "approvals",
    "internal-chat",
    "settings",
  ],
  agent: [
    "dashboard",
    "search",
    "assigned",
    "team-inbox",
    "unassigned",
    "create-ticket",
    "kb",
    "customers",
    "macros",
    "internal-chat",
    "settings",
  ],
  resolver: [
    "dashboard",
    "search",
    "assigned",
    "work-board",
    "kb",
    "internal-chat",
    "settings",
  ],
  customer: ["create-ticket", "assigned", "settings"],
  viewer: [
    "dashboard",
    "search",
    "assigned",
    "team-queue",
    "kb",
    "customers",
    "analytics",
    "settings",
  ],
};

const SETTINGS_BY_ROLE: Record<AppRole, SettingsSection[]> = {
  admin: [
    "profile",
    "security",
    "sessions",
    "notifications",
    "loginActivity",
  ],
  agent: [
    "profile",
    "security",
    "sessions",
    "notifications",
    "loginActivity",
  ],
  resolver: [
    "profile",
    "security",
    "sessions",
    "notifications",
    "loginActivity",
  ],
  customer: ["profile", "security"],
  viewer: ["profile", "security"],
};

export function modulesForRole(role: AppRole): AppModule[] {
  return MODULES_BY_ROLE[role] || MODULES_BY_ROLE.agent;
}

export function canAccessModule(role: AppRole, module: string): boolean {
  const resolved = module === "team-chat" ? "internal-chat" : module;
  return modulesForRole(role).includes(resolved as AppModule);
}

/** Ticket list when opening a ticket token from Internal Chat. */
export function ticketOpenModuleForRole(role: AppRole): AppModule {
  if (canAccessModule(role, "search")) return "search";
  if (canAccessModule(role, "team-queue")) return "team-queue";
  if (canAccessModule(role, "team-inbox")) return "team-inbox";
  if (canAccessModule(role, "assigned")) return "assigned";
  return defaultModuleForRole(role);
}

export function defaultModuleForRole(role: AppRole): AppModule {
  const mods = modulesForRole(role);
  if (mods.includes("dashboard")) return "dashboard";
  if (mods.includes("assigned")) return "assigned";
  return mods[0] || "settings";
}

/**
 * Best ticket list view when code wants "all tickets" / team-queue
 * but the role may not have that module (agents use team-inbox).
 */
export function ticketsListModuleForRole(role: AppRole): AppModule {
  if (canAccessModule(role, "team-queue")) return "team-queue";
  if (canAccessModule(role, "team-inbox")) return "team-inbox";
  if (canAccessModule(role, "assigned")) return "assigned";
  if (canAccessModule(role, "search")) return "search";
  return defaultModuleForRole(role);
}

/** Ticket list tabs (sidebar is one Tickets item). Search stays chat-only. */
export const TICKET_TAB_VIEWS = [
  "assigned",
  "team-inbox",
  "unassigned",
  "team-queue",
] as const;

export type TicketTabView = (typeof TICKET_TAB_VIEWS)[number];

export function isTicketTabView(view: string): view is TicketTabView {
  return (TICKET_TAB_VIEWS as readonly string[]).includes(view);
}

export function ticketTabsForRole(
  role: AppRole
): Array<{ id: TicketTabView; label: string }> {
  const tabs: Array<{ id: TicketTabView; label: string }> = [
    { id: "assigned", label: "My Tickets" },
    { id: "team-inbox", label: "Team Inbox" },
    { id: "unassigned", label: "Unassigned" },
    { id: "team-queue", label: "All Tickets" },
  ];
  return tabs.filter((tab) => canAccessModule(role, tab.id));
}

/** How ticket/metrics lists are scoped for this role by default */
export function dataScopeForRole(role: AppRole): DataScope {
  if (role === "admin" || role === "viewer") return "org";
  if (role === "customer") return "requester";
  return "assignee";
}

export function settingsSectionsForRole(role: AppRole): SettingsSection[] {
  return SETTINGS_BY_ROLE[role] || SETTINGS_BY_ROLE.agent;
}

export function canCreateTicket(role: AppRole): boolean {
  return role === "admin" || role === "agent" || role === "customer";
}

export function canMutateStaffData(role: AppRole): boolean {
  return role === "admin" || role === "agent" || role === "resolver";
}

/** Resolvers may read KB but not create/edit articles */
export function canMutateKnowledge(role: AppRole): boolean {
  return role === "admin" || role === "agent";
}

/** Resolvers see status/priority; they do not change catalog values. */
export function canSetTicketStatusPriority(role: AppRole): boolean {
  const key = String(role || "").trim().toLowerCase();
  return key === "admin" || key === "agent";
}

export function portalLabelForRole(role: AppRole): string {
  switch (role) {
    case "admin":
      return "ADMIN PORTAL";
    case "resolver":
      return "RESOLVER PORTAL";
    case "customer":
      return "CUSTOMER PORTAL";
    case "viewer":
      return "VIEWER PORTAL";
    default:
      return "AGENT PORTAL";
  }
}

export function roleDisplayLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "resolver":
      return "Resolver";
    case "customer":
      return "Customer";
    case "viewer":
      return "Viewer";
    case "agent":
      return "Agent";
    default:
      return role || "User";
  }
}
