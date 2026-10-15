import ReportsMainPanel from './ReportsMainPanel';
import { formatPagePath } from '../utils/formatDisplayLabels';

export default function EngagementOverview({ data, loading }) {
  const pages = data?.pages || [];
  const totalRage = data?.total_rage_clicks ?? 0;
  const totalDead = data?.total_dead_clicks ?? 0;

  return (
    <ReportsMainPanel
      title="Engagement Friction"
      subtitle="Rage clicks and dead clicks signal UX problems"
    >
      <div className="card-grid metric-grid engagement-metrics">
        <div className="card metric-card-simple">
          <div className="metric-label">Rage Clicks</div>
          <div className="metric-value">{Number(totalRage).toLocaleString()}</div>
        </div>
        <div className="card metric-card-simple">
          <div className="metric-label">Dead Clicks</div>
          <div className="metric-value">{Number(totalDead).toLocaleString()}</div>
        </div>
      </div>

      <div className="reports-inset-table">
        <h3 className="reports-inset-table-title">Top Pages by Friction</h3>
        <div className="table-wrap">
          <table className="reports-data-table">
            <thead>
              <tr>
                <th>Page Path</th>
                <th>Rage Clicks</th>
                <th>Dead Clicks</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {!loading && pages.map((row) => (
                <tr key={row.page_path}>
                  <td title={row.page_path}>{formatPagePath(row.page_path)}</td>
                  <td>{Number(row.rage_clicks).toLocaleString()}</td>
                  <td>{Number(row.dead_clicks).toLocaleString()}</td>
                  <td>{Number(row.total_friction_events).toLocaleString()}</td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={4} className="state-cell">Loading engagement data...</td>
                </tr>
              )}
              {!loading && !pages.length && (
                <tr>
                  <td colSpan={4} className="state-cell">No friction data for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ReportsMainPanel>
  );
}
