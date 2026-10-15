// @ts-nocheck
import { useCallback, useMemo, useState } from "react";
import { FileText, LayoutDashboard, RefreshCw, Users } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { LeadEditProvider } from "../components/leads/LeadEditProvider.tsx";
import { PortalLeadCreateProvider } from "../components/leads/PortalLeadCreateProvider.tsx";
import { PortalLiveEventsBridge } from "../components/portal/PortalLiveEventsBridge.tsx";
import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import { getResellerSession, logoutReseller } from "../lib/resellerAuth.js";
import { SESSION_EXPIRED_LOGIN_URL, useSessionIdleLogout } from "../lib/sessionIdle.js";
import { ShellLayout } from "./ShellLayout.tsx";

function ResellerShellInner({ children }) {
  const session = getResellerSession();

  const handleLogout = useCallback(() => {
    void logoutReseller();
  }, []);

  const handleIdleLogout = useCallback(() => {
    void logoutReseller({ redirectTo: SESSION_EXPIRED_LOGIN_URL });
  }, []);

  useSessionIdleLogout(handleIdleLogout);

  const navItems = useMemo(
    () => [
      { label: "Dashboard", path: "/reseller/dashboard", icon: LayoutDashboard },
      { label: "Your leads", path: "/reseller/leads", icon: Users },
      { label: "Renewals", path: "/reseller/renewals", icon: RefreshCw },
      { label: "Invoices", path: "/reseller/invoices", icon: FileText },
    ],
    [],
  );

  return (
    <ShellLayout
      ariaLabel="Reseller portal navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={navItems}
      sectionLabel="Reseller portal"
      shellClassName="app-shell--reseller"
      sidebarClassName="sidebar--reseller"
    >
      <div className="customer-portal-context">
        <span className="customer-portal-role-badge is-reseller">
          {session?.companyName || "Reseller"} · reseller access
        </span>
      </div>
      {shellPageContent(children)}
    </ShellLayout>
  );
}

export function ResellerShell({ children }) {
  const [toastMessage, setToastMessage] = useState("");

  return (
    <PortalLeadCreateProvider
      fallbackPath="/reseller/dashboard"
      mode="reseller"
      onCreated={(message) => setToastMessage(message || "Lead submitted.")}
    >
      <LeadEditProvider
        mode="reseller"
        onUpdated={(message) => setToastMessage(message || "Lead updated.")}
      >
        <ResellerShellInner>{children}</ResellerShellInner>
        <PortalLiveEventsBridge mode="reseller" />
        <AdminPageToast onDismiss={() => setToastMessage("")} success={toastMessage} />
      </LeadEditProvider>
    </PortalLeadCreateProvider>
  );
}
