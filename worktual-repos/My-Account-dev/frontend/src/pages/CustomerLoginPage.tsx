// @ts-nocheck
import { Navigate } from "react-router-dom";

/** @deprecated Use the unified login at `/` */
export function CustomerLoginPage() {
  return <Navigate replace to="/" />;
}
