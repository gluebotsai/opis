// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy `/finance/account` → open My Profile overlay on the finance shell.
 */
export function FinanceAccountPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/finance/queue", { replace: true, state: { openAccount: true } });
  }, [navigate]);

  return null;
}
