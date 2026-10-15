import { useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

import { ProductSubscriptionOverview } from "../../components/salesOversight/ProductSubscriptionOverview.jsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";

export function CustomerProductOverviewPage() {
  const { productKey } = useParams();
  const navigate = useNavigate();
  const { lead, usageBySubscriptionId, loading, error } = useCustomerDashboard();

  if (loading) {
    return <p className="customer-support-loading" role="status">Loading product...</p>;
  }

  if (error) {
    return <div className="form-error-banner">{error}</div>;
  }

  return (
    <section className="lead-dashboard-page">
      <div className="customer-product-overview-actions">
        <button
          className="secondary-button"
          onClick={() =>
            navigate(`/customer/products/${encodeURIComponent(productKey || "")}/request`)
          }
          type="button"
        >
          <ArrowUpRight size={16} />
          Request upgrade
        </button>
      </div>
      <ProductSubscriptionOverview
        basePath="/customer/products"
        leadId={lead?.id}
        loadLead={async () => ({ lead })}
        productKey={productKey}
        usageBySubscriptionId={usageBySubscriptionId}
      />
    </section>
  );
}
