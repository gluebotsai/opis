import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FileText,
  LayoutDashboard,
  Users,
  PlusCircle,
  Radar,
  Settings2,
} from "lucide-react";

export type ModuleId =
  | "dashboard"
  | "audience"
  | "create_campaign"
  | "drafts"
  | "monitoring"
  | "events"
  | "calendar"
  | "reports"
  | "configuration";

export type AppModule = {
  id: ModuleId;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** When true, only users with role admin see this module. */
  adminOnly?: boolean;
  /** When true, omit from sidebar nav; routes and deep links still work. */
  hideFromSidebar?: boolean;
  /** Nested nav items (shown under this module in the sidebar). */
  children?: AppModule[];
};

export const APP_MODULES: AppModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Overview of campaign performance for your branch.",
  },
  {
    id: "audience",
    label: "Audience",
    href: "/audience",
    icon: Users,
    description: "People from your account directory for campaign audiences.",
  },
  {
    id: "create_campaign",
    label: "Create campaign",
    href: "/campaigns/create",
    icon: PlusCircle,
    description: "Campaign creation workspace for your tenant and branch.",
  },
  {
    id: "drafts",
    label: "Drafts",
    href: "/campaigns/create?tool=drafts",
    icon: FileText,
    description: "Saved campaign drafts for your branch.",
  },
  {
    id: "monitoring",
    label: "Campaign monitoring",
    href: "/campaigns",
    icon: Activity,
    description: "Live, scheduled, and past campaigns.",
    hideFromSidebar: true,
  },
  {
    id: "events",
    label: "Events tracking",
    href: "/events",
    icon: Radar,
    description: "Forms, webinars, and other campaign events.",
    hideFromSidebar: true,
  },
  {
    id: "configuration",
    label: "Configuration",
    href: "/configuration",
    icon: Settings2,
    description: "Sending setup for email and other channels.",
    adminOnly: true,
    hideFromSidebar: true,
  },
];

function flattenModules(modules: AppModule[]): AppModule[] {
  const out: AppModule[] = [];
  for (const m of modules) {
    out.push(m);
    if (m.children?.length) out.push(...flattenModules(m.children));
  }
  return out;
}

export function modulesForRole(role: string | undefined | null): AppModule[] {
  const isAdmin =
    String(role || "")
      .trim()
      .toLowerCase() === "admin";
  return APP_MODULES.filter(
    (m) => (!m.adminOnly || isAdmin) && !m.hideFromSidebar,
  ).map((m) => ({
    ...m,
    children: m.children?.filter(
      (c) => (!c.adminOnly || isAdmin) && !c.hideFromSidebar,
    ),
  }));
}

type SessionPack = {
  modules?: { hide?: string[] };
  labels?: Partial<Record<ModuleId, string>>;
  descriptions?: Partial<Record<ModuleId, string>>;
} | null | undefined;

export function modulesForSession(
  role: string | undefined | null,
  pack?: SessionPack,
): AppModule[] {
  const hide = new Set(
    (pack?.modules?.hide || []).map((id) => String(id || "").trim()),
  );
  const labels = pack?.labels || {};
  const descriptions = pack?.descriptions || {};

  const relabel = (m: AppModule): AppModule => ({
    ...m,
    label: labels[m.id] || m.label,
    description: descriptions[m.id] || m.description,
    children: m.children
      ?.filter((c) => !hide.has(c.id))
      .map(relabel),
  });

  return modulesForRole(role)
    .filter((m) => !hide.has(m.id))
    .map(relabel);
}

function createToolFromSearch(search?: string): string | null {
  if (!search) return null;
  const q = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(q).get("tool");
}

export function getModuleByPath(
  pathname: string,
  search?: string,
): AppModule | null {
  const all = flattenModules(APP_MODULES);
  const tool = createToolFromSearch(search);
  if (
    (pathname === "/campaigns/create" || pathname === "/campaigns/new") &&
    tool === "drafts"
  ) {
    return all.find((m) => m.id === "drafts") ?? null;
  }
  if (
    pathname === "/campaigns/create" ||
    pathname.startsWith("/campaigns/create/") ||
    pathname === "/campaigns/new" ||
    pathname.startsWith("/campaigns/new/")
  ) {
    return all.find((m) => m.id === "create_campaign") ?? null;
  }
  if (
    pathname === "/campaigns/calendar" ||
    pathname.startsWith("/campaigns/calendar/")
  ) {
    return all.find((m) => m.id === "calendar") ?? null;
  }
  if (
    pathname === "/events" ||
    pathname.startsWith("/events/")
  ) {
    return all.find((m) => m.id === "events") ?? null;
  }
  if (
    pathname === "/campaigns" ||
    pathname.startsWith("/campaigns/monitor/") ||
    (pathname.startsWith("/campaigns/") &&
      !pathname.startsWith("/campaigns/create") &&
      !pathname.startsWith("/campaigns/new") &&
      !pathname.startsWith("/campaigns/calendar"))
  ) {
    return all.find((m) => m.id === "monitoring") ?? null;
  }
  return (
    all.find(
      (m) => pathname === m.href || pathname.startsWith(`${m.href}/`),
    ) ?? null
  );
}

/** Parent module when the current path matches a child (for breadcrumbs). */
export function getParentModule(
  pathname: string,
  search?: string,
): AppModule | null {
  const child = getModuleByPath(pathname, search);
  if (!child) return null;
  for (const m of APP_MODULES) {
    if (m.children?.some((c) => c.id === child.id)) return m;
  }
  return null;
}
