import { Navigate } from "react-router-dom";

import { getCustomerSession, getCustomerToken } from "../lib/customerAuth.js";
import { getAuthToken, getSession, ROLES } from "../lib/auth.js";

export function ProtectedRoute({ allowedRole, children, loginPath }) {
  const session = getSession();
  const token = getAuthToken();

  if (!session || session.role !== allowedRole || !token) {
    return <Navigate replace to={loginPath} />;
  }

  return children;
}

export function SalesRoute({ children }) {
  return (
    <ProtectedRoute allowedRole={ROLES.SALES} loginPath="/">
      {children}
    </ProtectedRoute>
  );
}

export function SalesWorkspaceRoute({ children }) {
  const session = getSession();
  const token = getAuthToken();
  const allowed =
    session &&
    token &&
    (session.role === ROLES.SALES || session.role === ROLES.SALES_ADMIN);

  if (!allowed) {
    return <Navigate replace to="/" />;
  }

  return children;
}

export function FinanceRoute({ children }) {
  return (
    <ProtectedRoute allowedRole={ROLES.FINANCE} loginPath="/">
      {children}
    </ProtectedRoute>
  );
}

export function AdminRoute({ children }) {
  return (
    <ProtectedRoute allowedRole={ROLES.ADMIN} loginPath="/">
      {children}
    </ProtectedRoute>
  );
}

export function SalesAdminRoute({ children }) {
  return (
    <ProtectedRoute allowedRole={ROLES.SALES_ADMIN} loginPath="/">
      {children}
    </ProtectedRoute>
  );
}

export function SalesOversightRoute({ children }) {
  const session = getSession();
  const token = getAuthToken();
  const allowed =
    session &&
    token &&
    (session.role === ROLES.SALES_ADMIN || session.role === ROLES.ADMIN);

  if (!allowed) {
    return <Navigate replace to="/" />;
  }

  return children;
}

export function CustomerRoute({ children }) {
  const session = getCustomerSession();
  const token = getCustomerToken();

  if (!session?.email || !token) {
    return <Navigate replace to="/" />;
  }

  return children;
}
