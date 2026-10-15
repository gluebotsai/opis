import { useParams } from "react-router-dom";

import {
  createSalesWorkspaceProductLoader,
  ProductSubscriptionOverview,
} from "../components/salesOversight/ProductSubscriptionOverview.jsx";
import { readProductKeyParam } from "../lib/productOverviewRoutes.js";

const loadLead = createSalesWorkspaceProductLoader();

export function LeadProductOverviewPage() {
  const params = useParams();
  const { leadId } = params;
  const productKey = readProductKeyParam(params);

  return (
    <ProductSubscriptionOverview
      basePath="/products"
      leadId={leadId}
      loadLead={loadLead}
      productKey={productKey}
    />
  );
}
