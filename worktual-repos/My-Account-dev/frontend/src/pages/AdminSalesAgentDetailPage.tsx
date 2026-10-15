// @ts-nocheck
import { useParams } from "react-router-dom";

import { SalesOversightAgentDetail } from "../components/salesOversight/SalesOversightAgentDetail.tsx";
import { SALES_OVERSIGHT_BASE } from "../lib/salesOversightPaths.js";

export function AdminSalesAgentDetailPage() {
  const { userId } = useParams();
  return (
    <SalesOversightAgentDetail
      basePath={SALES_OVERSIGHT_BASE}
      readOnly
      userId={userId}
    />
  );
}
