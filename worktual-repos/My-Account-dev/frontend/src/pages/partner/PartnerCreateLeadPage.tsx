// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy full-page route — open shell-level create overlay instead (sales parity).
 */
export function PartnerCreateLeadPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/partner/dashboard", { replace: true, state: { openCreate: true } });
  }, [navigate]);

  return null;
}
