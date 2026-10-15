// @ts-nocheck
import { useCallback } from "react";
import {
  Headphones,
  LayoutDashboard,
  Mail,
  PackageOpen,
  Users,
} from "lucide-react";

import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import { logout } from "../lib/auth.js";
import { SESSION_EXPIRED_LOGIN_URL, useSessionIdleLogout } from "../lib/sessionIdle.js";
import { ShellLayout } from "./ShellLayout.tsx";

const primaryNavItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Quote generation", path: "/products", icon: PackageOpen },
  { label: "Customers", path: "/customers", icon: Users },
  { label: "Support", path: "/support", icon: Headphones },
  { label: "Mail", path: "/mail", icon: Mail },
];

export function AppShell({ children, onOpenAccount }) {
  async function handleLogout() {
    await logout();
  }

  const handleIdleLogout = useCallback(async () => {
    await logout({ redirectTo: SESSION_EXPIRED_LOGIN_URL });
  }, []);

  useSessionIdleLogout(handleIdleLogout);

  return (
    <ShellLayout
      ariaLabel="Primary navigation"
      footer={<SidebarFooter onLogout={handleLogout} onOpenAccount={onOpenAccount} />}
      navItems={primaryNavItems}
      sectionLabel="Workspace"
    >
      {shellPageContent(children)}
    </ShellLayout>
  );
}
