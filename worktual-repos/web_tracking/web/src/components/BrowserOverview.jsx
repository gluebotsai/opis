import { AnalyticsDonutChart } from './Charts';
import ReportsMainPanel from './ReportsMainPanel';

const BROWSER_FIELDS = [
  { key: 'visitors', label: 'visitors' },
  { key: 'sessions', label: 'sessions' },
];

export default function BrowserOverview({ data, loading }) {
  const browsers = data?.browsers || [];

  return (
    <ReportsMainPanel
      className="reports-chart-panel"
      title="Browser Overview"
      subtitle="Share of visitors by browser, with sessions for context"
      bodyClassName="reports-main-panel-body--chart"
    >
      <AnalyticsDonutChart
        chartData={browsers}
        loading={loading}
        labelKey="browser"
        valueKey="visitors"
        percentKey="percentage"
        extraFields={BROWSER_FIELDS}
        loadingLabel="Loading browser analytics..."
        emptyLabel="No browser data for this period."
      />
    </ReportsMainPanel>
  );
}
