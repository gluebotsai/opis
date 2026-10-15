import ReportsMainPanel from './ReportsMainPanel';
import { formatPagePath } from '../utils/formatDisplayLabels';

export default function FunnelDropoffOverview({ data, loading }) {
  const pages = data?.pages ?? [];
  const totalExits = Number(data?.total_exit_sessions ?? 0);

  return (
    <ReportsMainPanel
      title="Funnel drop-off"
      subtitle="Top pages where sessions end — each % is its share of all exits in this period"
    >
      {loading && !pages.length ? (
        <p className="visitor-muted">Loading drop-off pages…</p>
      ) : null}

      {!loading && !pages.length ? (
        <p className="visitor-muted">No session exit data for this period.</p>
      ) : null}

      {pages.length > 0 ? (
        <div className="dashboard-dropoff">
          <p className="dashboard-dropoff-meta">
            {totalExits.toLocaleString()} session exit{totalExits === 1 ? '' : 's'} in period
          </p>
          <div className="scroll-behavior-funnel-rows">
            {pages.map((row) => {
              const pct = Number(row.dropoff_pct ?? 0);
              const exits = Number(row.exit_sessions ?? 0);
              const path = String(row.page_path ?? '/');
              return (
                <div key={path} className="scroll-behavior-funnel-row dashboard-dropoff-row">
                  <span className="dashboard-dropoff-path" title={path}>
                    {formatPagePath(path)}
                  </span>
                  <div className="scroll-behavior-funnel-track">
                    <div
                      className="scroll-behavior-funnel-fill dashboard-dropoff-fill"
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                  <span className="scroll-behavior-funnel-value">
                    {pct.toFixed(1)}%
                    <span className="scroll-behavior-funnel-count">
                      {exits.toLocaleString()} exit{exits === 1 ? '' : 's'}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </ReportsMainPanel>
  );
}
