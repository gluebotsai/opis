// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Banknote, Mail, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { AccountSettingsOverlay } from "../components/AccountSettingsOverlay.tsx";
import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import { logout } from "../lib/auth.js";
import { SESSION_EXPIRED_LOGIN_URL, useSessionIdleLogout } from "../lib/sessionIdle.js";
import { ShellLayout } from "./ShellLayout.tsx";

const financeNavItems = [
  { label: "Quotation queue", path: "/finance/queue", icon: ShieldCheck },
  { label: "Partner commissions", path: "/finance/commissions", icon: Banknote },
  { label: "Mail", path: "/finance/mail", icon: Mail },
];

export function FinanceShell({ children }) {
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

  const handleIdleLogout = useCallback(async () => {
    await logout({ redirectTo: SESSION_EXPIRED_LOGIN_URL });
  }, []);

  useSessionIdleLogout(handleIdleLogout);

  return (
    <>
      <ShellLayout
        ariaLabel="Finance navigation"
        footer={
          <SidebarFooter
            onLogout={handleLogout}
            onOpenAccount={() => setAccountOpen(true)}
          />
        }
        navItems={financeNavItems}
        sectionLabel="Finance"
        shellClassName="app-shell--finance"
        sidebarClassName="sidebar--finance"
      >
        {shellPageContent(children)}
      </ShellLayout>
      {accountOpen ? (
        <AccountSettingsOverlay
          onClose={() => setAccountOpen(false)}
          subtitle="Update your profile and password."
          title="My Profile"
        />
      ) : null}
    </>
  );
}
