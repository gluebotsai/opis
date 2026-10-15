import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { ProductWorkflowPage } from "../ProductWorkflowPage.jsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";

export function CustomerProductRequestPage({ requestIntent = "new" }) {
  const { productKey } = useParams();
  const { lead, loading, error, entitlements } = useCustomerDashboard();

  const intent = useMemo(() => {
    if (productKey) {
      return "upgrade";
    }
    return requestIntent;
  }, [productKey, requestIntent]);

  if (loading) {
    return <p className="customer-support-loading" role="status">Loading product request...</p>;
  }

  if (error) {
    return <div className="form-error-banner">{error}</div>;
  }

  if (!lead) {
    return null;
  }

  return (
    <ProductWorkflowPage
      cancelPath="/customer/products"
      customerBranchId={entitlements?.user?.locationId || null}
      embeddedLead={lead}
      preselectedProductKey={productKey || ""}
      requestIntent={intent}
      workflowMode="customer"
    />
  );
}
