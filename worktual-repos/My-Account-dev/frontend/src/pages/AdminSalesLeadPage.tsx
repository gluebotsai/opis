// @ts-nocheck
import { useParams } from "react-router-dom";

import { SalesOversightLeadDetail } from "../components/salesOversight/SalesOversightLeadDetail.tsx";
import { SALES_OVERSIGHT_BASE } from "../lib/salesOversightPaths.js";

export function AdminSalesLeadPage() {
  const { leadId } = useParams();
  return <SalesOversightLeadDetail basePath={SALES_OVERSIGHT_BASE} leadId={leadId} />;
}
