import { useParams } from "react-router-dom";

import { SalesOversightAgentDetail } from "../components/salesOversight/SalesOversightAgentDetail.jsx";

export function AdminSalesAgentDetailPage() {
  const { userId } = useParams();
  return <SalesOversightAgentDetail basePath="/admin/sales" readOnly userId={userId} />;
}
