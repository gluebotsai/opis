import { AnalyticsDonutChart } from './Charts';
import ReportsMainPanel from './ReportsMainPanel';
import { formatGeoLabel } from '../utils/formatDisplayLabels';

const GEO_FIELDS = [
  { key: 'visitors', label: 'visitors' },
  { key: 'sessions', label: 'sessions' },
];

export default function GeographicOverview({ data, loading }) {
  const countries = (data?.countries || []).map((row) => ({
    ...row,
    country: formatGeoLabel(row.country),
  }));
  const cities = (data?.cities || []).map((row) => ({
    ...row,
    label: `${formatGeoLabel(row.city)} · ${formatGeoLabel(row.country)}`,
  }));

  return (
    <ReportsMainPanel
      className="reports-geo-panel"
      title="Visitors by Location"
      subtitle="Geographic distribution by visitor share, with sessions for context"
    >
      <div className="analytics-grid analytics-grid-2 reports-geo-panel-grid">
        <div className="reports-geo-donut-block">
          <h3 className="reports-geo-donut-title">Country distribution</h3>
          <AnalyticsDonutChart
            chartData={countries}
            loading={loading}
            labelKey="country"
            valueKey="visitors"
            percentKey="percentage"
            extraFields={GEO_FIELDS}
            loadingLabel="Loading country distribution..."
            emptyLabel="No country data for this period."
          />
        </div>

        <div className="reports-geo-donut-block">
          <h3 className="reports-geo-donut-title">City distribution</h3>
          <AnalyticsDonutChart
            chartData={cities}
            loading={loading}
            labelKey="label"
            valueKey="visitors"
            percentKey="percentage"
            extraFields={GEO_FIELDS}
            loadingLabel="Loading city distribution..."
            emptyLabel="No city data for this period."
          />
        </div>
      </div>
    </ReportsMainPanel>
  );
}
