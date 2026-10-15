import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DashboardWorkspace } from "@/components/dashboard/DashboardWorkspace";

/** Home dashboard — Copilot split + campaign Overview (CC-style chrome). */
export function DashboardPage() {
  return (
    <ErrorBoundary label="Dashboard">
      <DashboardWorkspace />
    </ErrorBoundary>
  );
}
