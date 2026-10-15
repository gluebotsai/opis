// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { ProductWorkflowPage } from "../ProductWorkflowPage.tsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";

export function CustomerProductRequestPage({ requestIntent = "new" }) {
  const { productKey } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { lead, loading, error, entitlements } = useCustomerDashboard();

  const isEditingExistingRequest = Boolean(
    location.state?.customerEditRequest || location.state?.seedFromProductRequest,
  );

  const intent = useMemo(() => {
    if (productKey) {
      return "upgrade";
    }
    return requestIntent;
  }, [productKey, requestIntent]);

  // New-product CTA is confirm + sales inquiry on Products. Keep this route for upgrades / edits only.
  useEffect(() => {
    if (loading || error) {
      return;
    }
    if (!productKey && intent === "new" && !isEditingExistingRequest) {
      navigate("/customer/products", { replace: true });
    }
  }, [error, intent, isEditingExistingRequest, loading, navigate, productKey]);

  if (loading) {
    return <p className="customer-support-loading" role="status">Loading product request...</p>;
  }

  if (error) {
    return <AdminPageToast error={error} />;
  }

  if (!lead) {
    return null;
  }

  if (!productKey && intent === "new" && !isEditingExistingRequest) {
    return null;
  }

  return (
    <ProductWorkflowPage
      cancelPath="/customer/products"
      customerBranchId={entitlements?.user?.branchId || null}
      embeddedLead={lead}
      preselectedProductKey={productKey || ""}
      requestIntent={intent}
      workflowMode="customer"
    />
  );
}
