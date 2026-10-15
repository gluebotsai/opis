// @ts-nocheck
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Legacy route `/admin/resellers/:resellerId/edit` → Resellers list with edit overlay open.
 */
export function ResellerEditPage() {
  const navigate = useNavigate();
  const { resellerId } = useParams();

  useEffect(() => {
    navigate("/admin/resellers", {
      replace: true,
      state: { openEditResellerId: resellerId },
    });
  }, [navigate, resellerId]);

  return null;
}
