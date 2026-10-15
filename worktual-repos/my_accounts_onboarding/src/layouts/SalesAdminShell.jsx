import {
  BarChart3,
  Headphones,
  Mail,
  PackageOpen,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SidebarFooter } from "../components/SidebarFooter.jsx";
import { logout } from "../lib/auth.js";
import { ShellLayout } from "./ShellLayout.jsx";

const salesAdminNavItems = [
  { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
  { label: "Lead creation", path: "/onboarding", icon: UserPlus },
  { label: "Quote generation", path: "/products", icon: PackageOpen },
  { label: "Sales agents", path: "/sales-admin/agents", icon: Users },
  { label: "Support", path: "/support", icon: Headphones },
  { label: "Inbox", path: "/mail", icon: Mail },
  { label: "My Profile", path: "/account", icon: UserRound },
];

export function SalesAdminShell({ children }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <ShellLayout
      ariaLabel="Sales admin navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={salesAdminNavItems}
      sectionLabel="Sales Admin"
      shellClassName="app-shell--sales-admin"
      sidebarClassName="sidebar--sales-admin"
    >
      {children}
    </ShellLayout>
  );
}
