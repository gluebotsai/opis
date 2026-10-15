// @ts-nocheck
import { Navigate, useLocation } from "react-router-dom";

import {
  customerMustChangePassword,
  getCustomerSession,
  getCustomerToken,
} from "../lib/customerAuth.js";
import { getPartnerSession, getPartnerToken } from "../lib/partnerAuth.js";
import { getResellerSession, getResellerToken } from "../lib/resellerAuth.js";
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

export function NumberManagementRoute({ children }) {
  return (
    <ProtectedRoute allowedRole={ROLES.NUMBER_MANAGEMENT} loginPath="/">
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
  const location = useLocation();
  const session = getCustomerSession();
  const token = getCustomerToken();

  if (!session?.email || !token) {
    return <Navigate replace to="/" />;
  }

  if (
    customerMustChangePassword(session) &&
    location.pathname !== "/customer/account"
  ) {
    return <Navigate replace to="/customer/account" />;
  }

  return children;
}

export function ResellerRoute({ children }) {
  const session = getResellerSession();
  const token = getResellerToken();

  if (!session?.email || !token) {
    return <Navigate replace to="/" />;
  }

  return children;
}

export function PartnerRoute({ children }) {
  const session = getPartnerSession();
  const token = getPartnerToken();

  if (!session?.email || !token) {
    return <Navigate replace to="/" />;
  }

  return children;
}
