import { useParams } from "react-router-dom";

import { SalesOversightLeadDetail } from "../components/salesOversight/SalesOversightLeadDetail.jsx";

export function SalesAdminLeadPage() {
  const { leadId } = useParams();
  return <SalesOversightLeadDetail basePath="/sales-admin" leadId={leadId} />;
}
