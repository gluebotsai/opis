import { AnalyticsVisual } from "@/components/analytics/AnalyticsVisual";
import type { StructuredAnalytics } from "@/services/agent-stream";

/** Copilot analytics renderer — delegates to shared KPI/chart/table components. */
export function AnalyticsChartCard({
  analytics,
}: {
  analytics: StructuredAnalytics;
}) {
  return <AnalyticsVisual analytics={analytics} />;
}
