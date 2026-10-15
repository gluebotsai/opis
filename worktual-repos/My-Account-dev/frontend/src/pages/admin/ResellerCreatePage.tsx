// @ts-nocheck
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy route `/admin/resellers/new` → Resellers list with create overlay open.
 */
export function ResellerCreatePage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/admin/resellers", { replace: true, state: { openCreate: true } });
  }, [navigate]);

  return null;
}
