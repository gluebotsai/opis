// @ts-nocheck
import { useParams } from "react-router-dom";

import { ProductSubscriptionOverview } from "../components/salesOversight/ProductSubscriptionOverview.tsx";
import { readProductKeyParam } from "../lib/productOverviewRoutes.js";
import { SALES_OVERSIGHT_BASE } from "../lib/salesOversightPaths.js";

export function SalesAdminLeadProductPage() {
  const params = useParams();
  const { leadId } = params;
  const productKey = readProductKeyParam(params);

  return (
    <ProductSubscriptionOverview
      basePath={SALES_OVERSIGHT_BASE}
      leadId={leadId}
      productKey={productKey}
    />
  );
}
