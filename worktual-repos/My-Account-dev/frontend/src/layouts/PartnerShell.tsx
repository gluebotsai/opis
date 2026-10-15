// @ts-nocheck
import { useCallback, useMemo, useState } from "react";
import { IndianRupee, Landmark, LayoutDashboard, Users } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { LeadEditProvider } from "../components/leads/LeadEditProvider.tsx";
import { PortalLeadCreateProvider } from "../components/leads/PortalLeadCreateProvider.tsx";
import { PortalLiveEventsBridge } from "../components/portal/PortalLiveEventsBridge.tsx";
import { shellPageContent } from "../components/ShellPageOutlet.tsx";
import { SidebarFooter } from "../components/SidebarFooter.tsx";
import { logoutPartner } from "../lib/partnerAuth.js";
import { SESSION_EXPIRED_LOGIN_URL, useSessionIdleLogout } from "../lib/sessionIdle.js";
import { ShellLayout } from "./ShellLayout.tsx";

function PartnerShellInner({ children }) {
  const handleLogout = useCallback(() => {
    void logoutPartner();
  }, []);

  const handleIdleLogout = useCallback(() => {
    void logoutPartner({ redirectTo: SESSION_EXPIRED_LOGIN_URL });
  }, []);

  useSessionIdleLogout(handleIdleLogout);

  const navItems = useMemo(
    () => [
      { label: "Dashboard", path: "/partner/dashboard", icon: LayoutDashboard },
      { label: "My referrals", path: "/partner/leads", icon: Users },
      { label: "Commissions", path: "/partner/commissions", icon: IndianRupee },
      { label: "Bank details", path: "/partner/bank-details", icon: Landmark },
    ],
    [],
  );

  return (
    <ShellLayout
      ariaLabel="Partner portal navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={navItems}
      sectionLabel="Partner portal"
      shellClassName="app-shell--partner"
      sidebarClassName="sidebar--partner"
    >
      {shellPageContent(children)}
    </ShellLayout>
  );
}

export function PartnerShell({ children }) {
  const [toastMessage, setToastMessage] = useState("");

  return (
    <PortalLeadCreateProvider
      fallbackPath="/partner/dashboard"
      mode="partner"
      onCreated={(message) => setToastMessage(message || "Lead submitted.")}
    >
      <LeadEditProvider
        mode="partner"
        onUpdated={(message) => setToastMessage(message || "Lead updated.")}
      >
        <PartnerShellInner>{children}</PartnerShellInner>
        <PortalLiveEventsBridge mode="partner" />
        <AdminPageToast
          onDismiss={() => setToastMessage("")}
          success={toastMessage}
        />
      </LeadEditProvider>
    </PortalLeadCreateProvider>
  );
}
