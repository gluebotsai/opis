// @ts-nocheck
import { useCallback } from "react";
import {
  BarChart3,
  Building2,
  Headphones,
  Mail,
  PackageOpen,
  Users,
} from "lucide-react";

import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import { logout } from "../lib/auth.js";
import { SESSION_EXPIRED_LOGIN_URL, useSessionIdleLogout } from "../lib/sessionIdle.js";
import { ShellLayout } from "./ShellLayout.tsx";

const salesAdminNavItems = [
  { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
  { label: "Quote generation", path: "/products", icon: PackageOpen },
  { label: "Customers", path: "/customers", icon: Building2 },
  { label: "Sales agents", path: "/sales-oversight/agents", icon: Users },
  { label: "Support", path: "/support", icon: Headphones },
  { label: "Mail", path: "/mail", icon: Mail },
];

export function SalesAdminShell({ children, onOpenAccount }) {
  async function handleLogout() {
    await logout();
  }

  const handleIdleLogout = useCallback(async () => {
    await logout({ redirectTo: SESSION_EXPIRED_LOGIN_URL });
  }, []);

  useSessionIdleLogout(handleIdleLogout);

  return (
    <ShellLayout
      ariaLabel="Sales admin navigation"
      footer={<SidebarFooter onLogout={handleLogout} onOpenAccount={onOpenAccount} />}
      navItems={salesAdminNavItems}
      sectionLabel="Sales Admin"
      shellClassName="app-shell--sales-admin"
      sidebarClassName="sidebar--sales-admin"
    >
      {shellPageContent(children)}
    </ShellLayout>
  );
}
