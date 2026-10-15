// @ts-nocheck
import { useParams } from "react-router-dom";

import { SalesOversightAgentDetail } from "../components/salesOversight/SalesOversightAgentDetail.tsx";
import { SalesOversightAgents } from "../components/salesOversight/SalesOversightAgents.tsx";
import { SalesOversightDashboard } from "../components/salesOversight/SalesOversightDashboard.tsx";
import { SalesOversightLeadDetail } from "../components/salesOversight/SalesOversightLeadDetail.tsx";
import { ProductSubscriptionOverview } from "../components/salesOversight/ProductSubscriptionOverview.tsx";
import { isAdminSession } from "../lib/auth.js";
import { readProductKeyParam } from "../lib/productOverviewRoutes.js";
import { SALES_OVERSIGHT_BASE } from "../lib/salesOversightPaths.js";

export function SalesOversightHomePage() {
  return (
    <SalesOversightDashboard
      allowAssign
      basePath={SALES_OVERSIGHT_BASE}
      readOnly={isAdminSession()}
    />
  );
}

export function SalesOversightAgentsPage() {
  return <SalesOversightAgents basePath={SALES_OVERSIGHT_BASE} />;
}

export function SalesOversightAgentDetailPage() {
  const { userId } = useParams();
  return (
    <SalesOversightAgentDetail
      allowReassign
      basePath={SALES_OVERSIGHT_BASE}
      readOnly={isAdminSession()}
      userId={userId}
    />
  );
}

export function SalesOversightLeadPage() {
  const { leadId } = useParams();
  return <SalesOversightLeadDetail basePath={SALES_OVERSIGHT_BASE} leadId={leadId} />;
}

export function SalesOversightLeadProductPage() {
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
