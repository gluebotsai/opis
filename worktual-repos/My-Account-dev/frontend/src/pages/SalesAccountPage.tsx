// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy `/account` → open My Profile overlay on the sales shell.
 */
export function SalesAccountPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/dashboard", { replace: true, state: { openAccount: true } });
  }, [navigate]);

  return null;
}
