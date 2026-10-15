import { useParams } from "react-router-dom";

import { SalesOversightLeadDetail } from "../components/salesOversight/SalesOversightLeadDetail.jsx";

export function AdminSalesLeadPage() {
  const { leadId } = useParams();
  return <SalesOversightLeadDetail basePath="/admin/sales" leadId={leadId} />;
}
