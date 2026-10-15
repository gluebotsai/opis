import { useEffect, useState } from 'react';
import AppShell from '../layout/AppShell';
import { getErrors } from '../api';

export default function Errors() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('week');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getErrors(period)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setData(null);
          setError(err.response?.data?.detail || 'Failed to load errors.');
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
      title="Errors"
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
              <h2 className="section-heading">Error events</h2>
              <p className="section-subtitle">Grouped by type for the selected period</p>
            </div>
          </div>
          {loading && <p className="module-empty">Loading errors…</p>}
          {!loading && !error && !(data?.errors || []).length && (
            <p className="module-empty">No errors for this period.</p>
          )}
          {!loading && (data?.errors || []).length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Message</th>
                    <th>Count</th>
                    <th>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.errors || []).map((e, i) => (
                    <tr key={i}>
                      <td>{e.error_type}</td>
                      <td className="cell-ellipsis">{e.message}</td>
                      <td>{e.count}</td>
                      <td>{new Date(e.last_seen).toLocaleString()}</td>
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
