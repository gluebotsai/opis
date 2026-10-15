// @ts-nocheck
import { SalesOversightAgents } from "../components/salesOversight/SalesOversightAgents.tsx";
import { SALES_OVERSIGHT_BASE } from "../lib/salesOversightPaths.js";

export function AdminSalesAgentsPage() {
  return <SalesOversightAgents basePath={SALES_OVERSIGHT_BASE} />;
}
