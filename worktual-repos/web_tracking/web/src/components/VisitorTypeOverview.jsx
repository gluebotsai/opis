import { AnalyticsDonutChart } from './Charts';

export default function VisitorTypeOverview({ data, loading }) {
  const newVisitors = data?.new_visitors ?? 0;
  const returningVisitors = data?.returning_visitors ?? 0;
  const chartData = [
    {
      source: 'New visitors',
      visitors: Number(newVisitors),
      percentage: Number(data?.new_visitor_percentage ?? 0),
    },
    {
      source: 'Returning visitors',
      visitors: Number(returningVisitors),
      percentage: Number(data?.returning_visitor_percentage ?? 0),
    },
  ];

  return (
    <section className="analytics-section visitor-type-section">
      <div className="section-header">
        <h2>Visitor Type Overview</h2>
        <p className="section-subtitle">
          New visitors had one session in this period. Returning visitors had two or more.
        </p>
      </div>

      <div className="card analytics-chart-card">
        <AnalyticsDonutChart
          chartData={chartData}
          loading={loading}
          labelKey="source"
          valueKey="visitors"
          percentKey="percentage"
          loadingLabel="Loading visitor type breakdown..."
          emptyLabel="No visitor data for this period."
        />
      </div>
    </section>
  );
}
