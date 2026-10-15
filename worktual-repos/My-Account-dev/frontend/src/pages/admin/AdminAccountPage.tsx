// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy `/admin/account` → open My account overlay on the admin shell.
 * Navigates to User credentials with `openAccount: true`.
 */
export function AdminAccountPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/admin/users", { replace: true, state: { openAccount: true } });
  }, [navigate]);

  return null;
}
