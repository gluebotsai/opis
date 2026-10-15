// @ts-nocheck
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Rocket,
} from "lucide-react";

import { BrandLogo } from "../components/BrandLogo.tsx";
import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import {
  customerMustChangePassword,
  getCustomerSession,
  logoutCustomer,
} from "../lib/customerAuth.js";
import { SESSION_EXPIRED_LOGIN_URL, useSessionIdleLogout } from "../lib/sessionIdle.js";
import { ShellLayout } from "./ShellLayout.tsx";

const customerNavItems = [
  { label: "Dashboard", path: "/customer/dashboard", icon: LayoutDashboard },
  { label: "Products", path: "/customer/products", icon: Package },
  { label: "Onboarding", path: "/customer/onboarding", icon: Rocket },
  { label: "Operational hub", path: "/customer/operational-hub", icon: LifeBuoy },
  { label: "Support", path: "/customer/support", icon: Headphones },
  { label: "Invoices", path: "/customer/invoices", icon: FileText },
];

export function CustomerPortalShell({ children }) {
  const navigate = useNavigate();
  const session = getCustomerSession();
  const forcePasswordChange = customerMustChangePassword(session);

  function handleLogout() {
    logoutCustomer();
  }

  const handleIdleLogout = useCallback(() => {
    logoutCustomer({ redirectTo: SESSION_EXPIRED_LOGIN_URL });
  }, []);

  const handleOpenAccount = useCallback(() => {
    navigate("/customer/account");
  }, [navigate]);

  useSessionIdleLogout(handleIdleLogout);

  if (forcePasswordChange) {
    return (
      <div className="customer-force-password-shell">
        <header className="customer-force-password-shell__header">
          <BrandLogo />
          <button className="text-button" onClick={handleLogout} type="button">
            Sign out
          </button>
        </header>
        <main className="customer-force-password-shell__main">{shellPageContent(children)}</main>
      </div>
    );
  }

  return (
    <ShellLayout
      ariaLabel="Customer portal navigation"
      footer={
        <SidebarFooter
          accountActionLabel="Account"
          onLogout={handleLogout}
          onOpenAccount={handleOpenAccount}
        />
      }
      navItems={customerNavItems}
      sectionLabel="Customer portal"
      shellClassName="app-shell--customer"
      sidebarClassName="sidebar--customer"
    >
      <div className="customer-portal-context">
        <span className="customer-portal-role-badge is-branch">
          Branch access · {session?.branchLabel || "Your branch"}
        </span>
      </div>
      {shellPageContent(children)}
    </ShellLayout>
  );
}
