// @ts-nocheck
import { useEffect, useState } from "react";
import {
  BarChart3,
  Handshake,
  KeyRound,
  Mail,
  Percent,
  Receipt,
  Settings2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { AccountSettingsOverlay } from "../components/AccountSettingsOverlay.tsx";
import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import { logout } from "../lib/auth.js";
import { ShellLayout } from "./ShellLayout.tsx";

const adminNavItems = [
  { label: "User credentials", path: "/admin/users", icon: Users },
  { label: "Customer portal users", path: "/admin/customer-portal-users", icon: KeyRound },
  { label: "Partners", path: "/admin/partners", icon: UserPlus },
  { label: "Commission slabs", path: "/admin/commission-slabs", icon: Percent },
  { label: "Invoice settings", path: "/admin/invoice-settings", icon: Receipt },
  { label: "Resellers", path: "/admin/resellers", icon: Handshake },
  { label: "Cancellation requests", path: "/admin/cancellation-requests", icon: XCircle },
  { label: "Product pricing", path: "/admin/pricing", icon: Settings2 },
  { label: "Sales oversight", path: "/sales-oversight", icon: BarChart3 },
  { label: "Mail", path: "/admin/mail", icon: Mail },
];

export function AdminShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(Boolean(location.state?.openAccount));

  useEffect(() => {
    if (location.state?.openAccount) {
      setAccountOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state?.openAccount, navigate]);

  async function handleLogout() {
    await logout();
  }

  return (
    <>
      <ShellLayout
        ariaLabel="Admin navigation"
        footer={
          <SidebarFooter
            onLogout={handleLogout}
            onOpenAccount={() => setAccountOpen(true)}
          />
        }
        navItems={adminNavItems}
        sectionLabel="Admin"
        shellClassName="app-shell--admin"
        sidebarClassName="sidebar--admin"
      >
        {shellPageContent(children)}
      </ShellLayout>

      {accountOpen ? (
        <AccountSettingsOverlay onClose={() => setAccountOpen(false)} title="My account" />
      ) : null}
    </>
  );
}
