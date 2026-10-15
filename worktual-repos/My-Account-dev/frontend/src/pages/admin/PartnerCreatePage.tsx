// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy route `/admin/partners/new` → Partners list with create overlay open.
 */
export function PartnerCreatePage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/admin/partners", { replace: true, state: { openCreate: true } });
  }, [navigate]);

  return null;
}
