// @ts-nocheck
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Legacy route `/admin/partners/:partnerId/edit` → Partners list with edit overlay open.
 */
export function PartnerEditPage() {
  const navigate = useNavigate();
  const { partnerId } = useParams();

  useEffect(() => {
    navigate("/admin/partners", {
      replace: true,
      state: { openEditPartnerId: partnerId },
    });
  }, [navigate, partnerId]);

  return null;
}
