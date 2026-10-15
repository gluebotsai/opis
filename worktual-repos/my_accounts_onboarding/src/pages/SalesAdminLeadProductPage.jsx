import { useParams } from "react-router-dom";

import { ProductSubscriptionOverview } from "../components/salesOversight/ProductSubscriptionOverview.jsx";
import { readProductKeyParam } from "../lib/productOverviewRoutes.js";

export function SalesAdminLeadProductPage() {
  const params = useParams();
  const { leadId } = params;
  const productKey = readProductKeyParam(params);

  return (
    <ProductSubscriptionOverview
      basePath="/sales-admin"
      leadId={leadId}
      productKey={productKey}
    />
  );
}
