import { AnalyticsDonutChart } from './Charts';
import ReportsMainPanel from './ReportsMainPanel';

const TRAFFIC_FIELDS = [
  { key: 'visitors', label: 'visitors' },
  { key: 'sessions', label: 'sessions' },
];

export default function TrafficSourceOverview({ data, loading }) {
  const channels = data?.channels || [];

  return (
    <ReportsMainPanel
      className="traffic-source-section reports-chart-panel"
      title="Traffic Source Overview"
      subtitle="Where your visitors are coming from"
      bodyClassName="reports-main-panel-body--chart"
    >
      <AnalyticsDonutChart
        chartData={channels}
        loading={loading}
        labelKey="source"
        valueKey="sessions"
        percentKey="percentage"
        totalValue={data?.total_sessions}
        extraFields={TRAFFIC_FIELDS}
        loadingLabel="Loading traffic distribution..."
        emptyLabel="No traffic source data for this period."
      />
    </ReportsMainPanel>
  );
}
