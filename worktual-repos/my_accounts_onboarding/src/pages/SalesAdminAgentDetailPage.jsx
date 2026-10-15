import { useParams } from "react-router-dom";

import { SalesOversightAgentDetail } from "../components/salesOversight/SalesOversightAgentDetail.jsx";

export function SalesAdminAgentDetailPage() {
  const { userId } = useParams();
  return <SalesOversightAgentDetail basePath="/sales-admin" userId={userId} />;
}
