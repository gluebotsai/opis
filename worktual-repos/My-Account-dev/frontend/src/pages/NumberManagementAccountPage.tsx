// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy `/number-management/account` → open My Profile overlay on the number management shell.
 */
export function NumberManagementAccountPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/number-management/dashboard", { replace: true, state: { openAccount: true } });
  }, [navigate]);

  return null;
}
