import { useEffect, useState } from 'react';
import AppShell from '../layout/AppShell';
import { getPerformance } from '../api';

export default function Performance() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('week');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPerformance(period)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setData(null);
          setError(err.response?.data?.detail || 'Failed to load performance.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <AppShell
      title="Performance"
      headerActions={(
        <select className="wt-select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          <option value="today">Today</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="overall">Overall</option>
        </select>
      )}
    >
      <div className="container container-in-shell">
        {error && (
          <div className="status-banner status-banner-error" role="alert">{error}</div>
        )}
        <div className="card">
          <div className="module-card-header">
            <div>
              <h2 className="section-heading">Web vitals</h2>
              <p className="section-subtitle">Percentiles for the selected period</p>
            </div>
          </div>
          {loading && <p className="module-empty">Loading performance…</p>}
          {!loading && !error && !(data?.metrics || []).length && (
            <p className="module-empty">No performance samples for this period.</p>
          )}
          {!loading && (data?.metrics || []).length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>P50</th>
                    <th>P75</th>
                    <th>P95</th>
                    <th>Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.metrics || []).map((m) => (
                    <tr key={m.metric_name}>
                      <td>{m.metric_name}</td>
                      <td>{m.p50}</td>
                      <td>{m.p75}</td>
                      <td>{m.p95}</td>
                      <td>{m.samples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
