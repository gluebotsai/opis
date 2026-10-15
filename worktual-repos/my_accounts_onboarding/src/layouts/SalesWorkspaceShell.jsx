import { getSession, ROLES } from "../lib/auth.js";
import { AppShell } from "./AppShell.jsx";
import { SalesAdminShell } from "./SalesAdminShell.jsx";

export function SalesWorkspaceShell({ children }) {
  const session = getSession();

  if (session?.role === ROLES.SALES_ADMIN) {
    return <SalesAdminShell>{children}</SalesAdminShell>;
  }

  return <AppShell>{children}</AppShell>;
}
