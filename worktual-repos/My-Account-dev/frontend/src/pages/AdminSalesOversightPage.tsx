// @ts-nocheck
import { SalesOversightDashboard } from "../components/salesOversight/SalesOversightDashboard.tsx";
import { SALES_OVERSIGHT_BASE } from "../lib/salesOversightPaths.js";

export function AdminSalesOversightPage() {
  return <SalesOversightDashboard basePath={SALES_OVERSIGHT_BASE} readOnly />;
}
