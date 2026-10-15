// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy full-page route — open shell-level create overlay instead (sales/partner parity).
 */
export function ResellerCreateLeadPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/reseller/dashboard", { replace: true, state: { openCreate: true } });
  }, [navigate]);

  return null;
}
