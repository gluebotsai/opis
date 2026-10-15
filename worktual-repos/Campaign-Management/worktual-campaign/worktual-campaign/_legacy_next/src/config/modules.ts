import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  PlusCircle,
  Activity,
  Library,
  Radar,
  BarChart3,
} from "lucide-react";

export type ModuleId =
  | "dashboard"
  | "contacts"
  | "create_campaign"
  | "monitoring"
  | "templates"
  | "events"
  | "reports";

export type AppModule = {
  id: ModuleId;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
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
    id: "contacts",
    label: "Contacts",
    href: "/contacts",
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
    id: "monitoring",
    label: "Campaign monitoring",
    href: "/campaigns",
    icon: Activity,
    description: "Live, scheduled, and past campaigns.",
  },
  {
    id: "templates",
    label: "Template library",
    href: "/templates",
    icon: Library,
    description: "Reusable email, form, and landing templates.",
  },
  {
    id: "events",
    label: "Events tracking",
    href: "/events",
    icon: Radar,
    description: "Forms, webinars, coupons, and other campaign events.",
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    href: "/reports",
    icon: BarChart3,
    description: "Campaign and funnel performance dashboards.",
  },
];

export function getModuleByPath(pathname: string): AppModule | null {
  if (
    pathname === "/campaigns/create" ||
    pathname.startsWith("/campaigns/create/") ||
    pathname === "/campaigns/new" ||
    pathname.startsWith("/campaigns/new/")
  ) {
    return APP_MODULES.find((m) => m.id === "create_campaign") ?? null;
  }
  if (pathname === "/campaigns" || pathname.startsWith("/campaigns/")) {
    return APP_MODULES.find((m) => m.id === "monitoring") ?? null;
  }
  return (
    APP_MODULES.find(
      (m) => pathname === m.href || pathname.startsWith(`${m.href}/`),
    ) ?? null
  );
}
