import { BarChart3, Mail, Settings2, UserCircle, Users, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SidebarFooter } from "../components/SidebarFooter.jsx";
import { logout } from "../lib/auth.js";
import { ShellLayout } from "./ShellLayout.jsx";

const adminNavItems = [
  { label: "User credentials", path: "/admin/users", icon: Users },
  { label: "Cancellation requests", path: "/admin/cancellation-requests", icon: XCircle },
  { label: "Product pricing", path: "/admin/pricing", icon: Settings2 },
  { label: "Sales oversight", path: "/admin/sales", icon: BarChart3 },
  { label: "Inbox", path: "/admin/mail", icon: Mail },
  { label: "My account", path: "/admin/account", icon: UserCircle },
];

export function AdminShell({ children }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <ShellLayout
      ariaLabel="Admin navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={adminNavItems}
      sectionLabel="Admin"
      shellClassName="app-shell--admin"
      sidebarClassName="sidebar--admin"
    >
      {children}
    </ShellLayout>
  );
}
