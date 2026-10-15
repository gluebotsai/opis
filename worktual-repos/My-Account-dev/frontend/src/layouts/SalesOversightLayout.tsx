// @ts-nocheck
import { Navigate } from "react-router-dom";

import { getSession, ROLES } from "../lib/auth.js";
import { AdminShell } from "./AdminShell.tsx";
import { SalesAdminShell } from "./SalesAdminShell.tsx";

export function SalesOversightLayout({ children }) {
  const session = getSession();
  const role = session?.role;

  if (role === ROLES.ADMIN) {
    return <AdminShell>{children}</AdminShell>;
  }

  if (role === ROLES.SALES_ADMIN) {
    return <SalesAdminShell>{children}</SalesAdminShell>;
  }

  return <Navigate replace to="/" />;
}
