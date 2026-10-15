import {
  Headphones,
  LayoutDashboard,
  LogOut,
  Mail,
  PackageOpen,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SidebarFooter } from "../components/SidebarFooter.jsx";
import { logout } from "../lib/auth.js";
import { ShellLayout } from "./ShellLayout.jsx";

const primaryNavItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Lead creation", path: "/onboarding", icon: UserPlus },
  { label: "Quote generation", path: "/products", icon: PackageOpen },
  { label: "Support", path: "/support", icon: Headphones },
  { label: "Inbox", path: "/mail", icon: Mail },
  { label: "My Profile", path: "/account", icon: UserRound },
];

export function AppShell({ children }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <ShellLayout
      ariaLabel="Primary navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={primaryNavItems}
      sectionLabel="Workspace"
      showChevron
    >
      {children}
    </ShellLayout>
  );
}
