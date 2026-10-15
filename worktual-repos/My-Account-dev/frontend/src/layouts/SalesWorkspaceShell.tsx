// @ts-nocheck
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { AccountSettingsOverlay } from "../components/AccountSettingsOverlay.tsx";
import { LeadEditProvider } from "../components/leads/LeadEditProvider.tsx";
import { getSession, ROLES } from "../lib/auth.js";
import { AppShell } from "./AppShell.tsx";
import { SalesAdminShell } from "./SalesAdminShell.tsx";

export function SalesWorkspaceShell({ children }) {
  const session = getSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(Boolean(location.state?.openAccount));
  const [editMessage, setEditMessage] = useState("");

  useEffect(() => {
    if (location.state?.openAccount) {
      setAccountOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state?.openAccount, navigate]);

  const Shell = session?.role === ROLES.SALES_ADMIN ? SalesAdminShell : AppShell;

  return (
    <LeadEditProvider onUpdated={(message) => setEditMessage(message || "Lead updated.")}>
      <Shell onOpenAccount={() => setAccountOpen(true)}>{children}</Shell>
      <AdminPageToast
        onDismiss={() => setEditMessage("")}
        success={editMessage}
      />
      {accountOpen ? (
        <AccountSettingsOverlay
          onClose={() => setAccountOpen(false)}
          subtitle="Update your profile and password."
          title="My Profile"
        />
      ) : null}
    </LeadEditProvider>
  );
}
