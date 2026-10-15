import { Link } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import DiagnosticSection from '../components/analytics/DiagnosticSection';
import PredictiveSection from '../components/analytics/PredictiveSection';
import PrescriptiveSection from '../components/analytics/PrescriptiveSection';
import { useAnalyticsInsights } from '../hooks/useAnalyticsInsights';

const PERIOD_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7D' },
  { id: 'month', label: '30D' },
  { id: 'overall', label: 'Overall' },
];

function severityLabel(severity) {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Needs attention';
  return 'Stable';
}

function severityClass(severity) {
  if (severity === 'critical') return 'insight-badge-critical';
  if (severity === 'warning') return 'insight-badge-warning';
  return 'insight-badge-normal';
}

export default function Analytics() {
  const { period, setPeriod, data, loading, error, reload } = useAnalyticsInsights('month');

  return (
    <AppShell
      title="Analytics"
      subtitle="Diagnostic, predictive, and prescriptive insights"
      headerActions={(
        <Link to="/" className="btn btn-outline analytics-back-reports">
          ← Reports
        </Link>
      )}
    >
      <div className="analytics-page">
        <div className="analytics-toolbar">
          <div className="period-pills" role="tablist" aria-label="Insights period">
            {PERIOD_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={period === id}
                className={`period-pill${period === id ? ' active' : ''}`}
                onClick={() => setPeriod(id)}
                disabled={loading}
              >
                {label}
              </button>
            ))}
          </div>
          {data?.generated_at && (
            <span className="analytics-generated-at">
              Updated {new Date(data.generated_at).toLocaleString()}
            </span>
          )}
        </div>

        {error && (
          <div className="status-banner status-banner-error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={reload}>
              Retry
            </button>
          </div>
        )}

        {loading && !data && (
          <div className="analytics-loading">Loading insights…</div>
        )}

        {data && (
          <>
            <DiagnosticSection
              diagnostic={data.diagnostic}
              severityLabel={severityLabel(data.diagnostic?.severity)}
              severityClass={severityClass(data.diagnostic?.severity)}
            />
            <PredictiveSection
              forecasts={data.forecasts}
              predictive={data.predictive}
            />
            <PrescriptiveSection prescriptive={data.prescriptive} />
          </>
        )}
      </div>
    </AppShell>
  );
}
