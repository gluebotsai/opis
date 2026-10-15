import { Link } from 'react-router-dom';
import { VisitorsChart, BounceRateChart } from './Charts';
import LiveUsers from './LiveUsers';
import TrafficSourceOverview from './TrafficSourceOverview';
import ReportsKpiSnapshot from './ReportsKpiSnapshot';
import BrowserOverview from './BrowserOverview';
import GeographicOverview from './GeographicOverview';
import ScrollDepthOverview from './ScrollDepthOverview';
import EngagementOverview from './EngagementOverview';
import VisitorSegmentationOverview from './VisitorSegmentationOverview';
import FunnelDropoffOverview from './FunnelDropoffOverview';
import ReportsMainPanel from './ReportsMainPanel';
import { useAuth } from '../AuthContext';
import { formatPagePath } from '../utils/formatDisplayLabels';

const PERIOD_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7D' },
  { id: 'month', label: '30D' },
  { id: 'overall', label: 'Overall' },
];

function formatDateRange(period) {
  const end = new Date();
  const start = new Date();
  if (period === 'today') {
    return end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  if (period === 'week') start.setDate(end.getDate() - 6);
  else if (period === 'month') start.setDate(end.getDate() - 29);
  else return 'All time';

  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function ReportsPanel({
  period,
  onPeriodChange,
  onRefresh,
  loading,
  refreshing,
  lastUpdated,
  error,
  data,
  liveData,
  topPages,
  scrollDepthData,
  engagementData,
  trafficData,
  browserData,
  geoData,
  pageDropoffData,
  showConversions,
}) {
  const { user } = useAuth();
  const productAnalyticsEnabled = user?.features?.product_analytics === true;

  const toolbar = (
    <div className="reports-panel-toolbar">
      {productAnalyticsEnabled && (
        <Link to="/product-analytics" className="btn btn-outline reports-view-analytics">
          Product analytics
        </Link>
      )}
      <Link to="/analytics" className="btn btn-outline reports-view-analytics">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" width="18" height="18" aria-hidden="true">
          <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        View Analytics
      </Link>
      <select
        className="wt-select reports-period-select"
        value={period}
        onChange={(event) => onPeriodChange(event.target.value)}
        aria-label="Report period"
        disabled={loading}
      >
        {PERIOD_OPTIONS.map(({ id, label }) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>
      <button
        className="reports-refresh-btn"
        type="button"
        onClick={onRefresh}
        disabled={loading}
        aria-label={loading ? 'Refreshing' : 'Refresh'}
        title={loading ? 'Refreshing…' : 'Refresh'}
      >
        <svg
          className={loading ? 'is-spinning' : undefined}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
          <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );

  const subtitleMeta = (
    <>
      <span>{formatDateRange(period)}</span>
      {lastUpdated ? (
        <span className="reports-main-panel-meta">
          Updated {lastUpdated.toLocaleTimeString()}
          {refreshing ? ' (refreshing…)' : ''}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="reports-panel-shell">
      <div className="reports-panel-shell-header reports-main-panel-header reports-toolbar-panel">
        <div className="reports-main-panel-heading">
          <h2 className="reports-main-panel-title">Reports</h2>
          <div className="reports-main-panel-desc">{subtitleMeta}</div>
        </div>
        <div className="reports-main-panel-aside">{toolbar}</div>
      </div>

      <div className="reports-panel-stack reports-panel-stack--nested">
      <LiveUsers data={liveData} />

      {loading && !data ? (
        <p className="reports-loading">Loading analytics…</p>
      ) : null}

      {error ? (
        <div className="status-banner status-banner-error" role="alert">
          <p className="error-msg">{error}</p>
        </div>
      ) : null}

      {data ? (
        <>
          <ReportsKpiSnapshot
            data={data}
            liveData={liveData}
            showConversions={showConversions}
            period={period}
          />

          <ReportsMainPanel
            title="Daily trends"
            subtitle="Visitors, page views, and bounce rate for the selected period"
            bodyClassName="reports-main-panel-body--charts"
          >
            <div className="dashboard-charts-grid">
              <div className="dashboard-chart-card">
                <div className="dashboard-chart-header">
                  <div>
                    <h3 className="dashboard-chart-title">Visitors &amp; page views</h3>
                    <p className="dashboard-chart-subtitle">Daily completed workload</p>
                  </div>
                  <div className="dashboard-chart-metric">{data.total_pageviews.toLocaleString()}</div>
                </div>
                <VisitorsChart chartData={data.chart} period={period} />
              </div>
              <div className="dashboard-chart-card">
                <div className="dashboard-chart-header">
                  <div>
                    <h3 className="dashboard-chart-title">Bounce rate</h3>
                    <p className="dashboard-chart-subtitle">Share of single-page sessions</p>
                  </div>
                  <div className="dashboard-chart-metric">{data.bounce_rate}%</div>
                </div>
                <BounceRateChart bounceRate={data.bounce_rate} chartData={data.chart} period={period} />
              </div>
            </div>
          </ReportsMainPanel>

          <div className="reports-overview-pair-wrap">
            <div className="reports-overview-pair">
              <TrafficSourceOverview data={trafficData} loading={loading} />
              <BrowserOverview data={browserData} loading={loading} />
            </div>
          </div>

          <GeographicOverview data={geoData} loading={loading} />
          <VisitorSegmentationOverview period={period} loading={loading} />
          <EngagementOverview data={engagementData} loading={loading} period={period} />
          <FunnelDropoffOverview data={pageDropoffData} loading={loading} />
          <ScrollDepthOverview data={scrollDepthData} loading={loading} period={period} />

          <ReportsMainPanel className="reports-table-card" title="Top pages" subtitle="Most viewed paths in this period">
            <div className="table-wrap">
              <table className="reports-data-table">
                <thead>
                  <tr>
                    <th>Page Path</th>
                    <th>Views</th>
                    <th>Unique Visitors</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((p) => (
                    <tr key={p.page_path}>
                      <td title={p.page_path}>{formatPagePath(p.page_path)}</td>
                      <td>{p.views}</td>
                      <td>{p.unique_visitors}</td>
                    </tr>
                  ))}
                  {!topPages.length ? (
                    <tr>
                      <td colSpan={3} className="table-empty">No page data for this period.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </ReportsMainPanel>
        </>
      ) : null}
      </div>
    </div>
  );
}
