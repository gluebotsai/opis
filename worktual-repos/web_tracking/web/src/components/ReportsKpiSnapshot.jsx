import KpiIcon from './KpiIcon';
import { chartSeriesFromDaily, KpiSparkline } from './Charts';
import { formatDuration } from '../utils/formatDuration';

const COMPARE_LABEL = {
  today: 'versus yesterday',
  week: 'versus the prior 7 days',
  month: 'versus the prior 30 days',
};

function growthDelta(current, previous, { invert = false } = {}) {
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0 && cur === 0) {
    return { direction: 'flat', tone: 'flat', label: '0%', change: 'unchanged' };
  }
  if (prev === 0) {
    const direction = cur > 0 ? 'up' : 'flat';
    const tone = direction === 'flat' ? 'flat' : (invert ? 'down' : 'up');
    return { direction, tone, label: 'New', change: 'up from zero' };
  }
  const raw = ((cur - prev) / Math.abs(prev)) * 100;
  const direction = Math.abs(raw) < 0.05 ? 'flat' : (raw > 0 ? 'up' : 'down');
  const tone = direction === 'flat' ? 'flat' : (invert ? (direction === 'up' ? 'down' : 'up') : direction);
  const abs = Math.abs(raw);
  const digits = abs >= 100 ? 0 : 1;
  const label = `${raw > 0 ? '+' : ''}${raw.toFixed(digits)}%`;
  const change = direction === 'flat' ? 'unchanged' : `${direction === 'up' ? 'up' : 'down'} ${abs.toFixed(digits)}%`;
  return { direction, tone, label, change };
}

function KpiGrowth({ delta, versus }) {
  if (!delta) return null;
  const arrow = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  return (
    <span className={`kpi-card-ref-growth is-${delta.tone}`} title={`${delta.change} ${versus}`}>
      <span aria-hidden="true">{arrow}</span>
      <span>{delta.label}</span>
    </span>
  );
}

function KpiCard({
  icon,
  label,
  value,
  subtitle,
  badge,
  sparklineValues,
  sparklineColor = '#3b82f6',
  growth,
  versus,
}) {
  const hasSparkline = sparklineValues?.length >= 2;

  return (
    <div className={`kpi-card-ref${hasSparkline ? ' kpi-card-ref--sparkline' : ''}`}>
      <div className="kpi-card-ref-head">
        <KpiIcon name={icon} />
        <div className="kpi-card-ref-head-text">
          <span className="kpi-card-ref-label">{label}</span>
          {badge ? <span className="kpi-card-ref-badge">{badge}</span> : null}
        </div>
      </div>
      <div className="kpi-card-ref-value">{value}</div>
      <KpiGrowth delta={growth} versus={versus} />
      <p className="kpi-card-ref-subtitle">{subtitle}</p>
      {hasSparkline ? (
        <KpiSparkline values={sparklineValues} color={sparklineColor} />
      ) : null}
    </div>
  );
}

function PanelHeader({ tintClass, title, description, children }) {
  return (
    <div className="reports-kpi-panel-header">
      <div className="reports-kpi-panel-heading">
        <span className={`reports-kpi-panel-icon ${tintClass}`} aria-hidden="true">
          {children}
        </span>
        <div>
          <h3 className="reports-kpi-panel-title">{title}</h3>
          {description ? <p className="reports-kpi-panel-desc">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

function panelIconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function panelIconActivity() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function panelIconBehavior() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

export default function ReportsKpiSnapshot({ data, liveData, showConversions, period }) {
  const dailyChart = data?.chart ?? [];
  const trend = (key) => (
    dailyChart.length && dailyChart[0][key] != null
      ? chartSeriesFromDaily(dailyChart, key)
      : []
  );
  const pageviewTrend = trend('pageviews');
  const visitorTrend = trend('visitors');
  const newVisitorTrend = trend('new_visitors');
  const returningTrend = trend('returning_visitors');
  const sessionTrend = trend('sessions');
  const pagesTrend = trend('avg_pages');
  const durationTrend = trend('avg_duration');
  const bounceTrend = trend('bounce_rate');
  const clickTrend = trend('clicks');
  const conversionTrend = trend('conversions');
  const previous = data?.previous ?? null;
  const versus = COMPARE_LABEL[period] || 'versus the previous period';

  const compare = (current, previousValue, options) => (
    previous ? growthDelta(current, previousValue, options) : null
  );

  const clicks = Number(data?.total_clicks ?? 0);
  const conversions = Number(data?.total_conversions ?? 0);
  const clickToGoalPct = clicks > 0 ? ((conversions / clicks) * 100).toFixed(1) : null;

  return (
    <div className="reports-kpi-snapshot">
      <div className="reports-main-panel reports-kpi-panel">
        <PanelHeader
          tintClass="reports-kpi-panel-icon-visitors"
          title="Visitor overview"
          description="Live presence and unique visitors in this period"
        >
          {panelIconUsers()}
        </PanelHeader>
        <div className="reports-kpi-panel-body">
          <div className="reports-kpi-row">
            <KpiCard
              icon="online"
              label="Online now"
              value={liveData?.active_users ?? 0}
              subtitle="Active right now"
            />
            <KpiCard
              icon="visitors"
              label="Total visitors"
              value={data.total_visitors.toLocaleString()}
              subtitle="Unique visitors in period"
              sparklineValues={visitorTrend}
              sparklineColor="#2563eb"
              growth={compare(data.total_visitors, previous?.total_visitors)}
              versus={versus}
            />
            <KpiCard
              icon="new"
              label="New visitors"
              value={data.new_visitors?.toLocaleString() ?? 0}
              subtitle="One session in period"
              badge="New"
              sparklineValues={newVisitorTrend}
              sparklineColor="#059669"
              growth={compare(data.new_visitors, previous?.new_visitors)}
              versus={versus}
            />
            <KpiCard
              icon="returning"
              label="Returning visitors"
              value={data.returning_visitors?.toLocaleString() ?? 0}
              subtitle="Multiple sessions in period"
              sparklineValues={returningTrend}
              sparklineColor="#4f46e5"
              growth={compare(data.returning_visitors, previous?.returning_visitors)}
              versus={versus}
            />
          </div>
        </div>
      </div>

      <div className="reports-main-panel reports-kpi-panel">
        <PanelHeader
          tintClass="reports-kpi-panel-icon-engagement"
          title="Engagement & interaction"
          description="Volume and depth for the selected period"
        >
          {panelIconActivity()}
        </PanelHeader>
        <div className="reports-kpi-panel-body">
          <div className="reports-kpi-row">
            <KpiCard
              icon="pageviews"
              label="Page views"
              value={data.total_pageviews.toLocaleString()}
              subtitle="Total page loads"
              sparklineValues={pageviewTrend}
              sparklineColor="#2563eb"
              growth={compare(data.total_pageviews, previous?.total_pageviews)}
              versus={versus}
            />
            <KpiCard
              icon="sessions"
              label="Sessions"
              value={data.total_sessions.toLocaleString()}
              subtitle="Total browsing sessions"
              sparklineValues={sessionTrend}
              sparklineColor="#7c3aed"
              growth={compare(data.total_sessions, previous?.total_sessions)}
              versus={versus}
            />
            <KpiCard
              icon="pages"
              label="Pages / session"
              value={data.avg_pages_per_session}
              subtitle="Average depth per session"
              sparklineValues={pagesTrend}
              sparklineColor="#0891b2"
              growth={compare(data.avg_pages_per_session, previous?.avg_pages_per_session)}
              versus={versus}
            />
            <KpiCard
              icon="duration"
              label="Avg session duration"
              value={formatDuration(data.avg_session_duration_seconds)}
              subtitle="Average time on site"
              sparklineValues={durationTrend}
              sparklineColor="#0891b2"
              growth={compare(data.avg_session_duration_seconds, previous?.avg_session_duration_seconds)}
              versus={versus}
            />
          </div>
        </div>
      </div>

      <div className="reports-main-panel reports-kpi-panel">
        <PanelHeader
          tintClass="reports-kpi-panel-icon-behavior"
          title="Behavior & conversion"
          description="Friction signals and goal completion"
        >
          {panelIconBehavior()}
        </PanelHeader>
        <div className="reports-kpi-panel-body reports-kpi-panel-body--behavior">
          <div className="reports-kpi-row reports-kpi-row--behavior">
            <KpiCard
              icon="bounce"
              label="Bounce rate"
              value={`${data.bounce_rate}%`}
              subtitle="Single-page sessions"
              sparklineValues={bounceTrend}
              sparklineColor="#d97706"
              growth={compare(data.bounce_rate, previous?.bounce_rate, { invert: true })}
              versus={versus}
            />
            <KpiCard
              icon="clicks"
              label="Clicks"
              value={clicks.toLocaleString()}
              subtitle="Total click events"
              sparklineValues={clickTrend}
              sparklineColor="#2563eb"
              growth={compare(clicks, previous?.total_clicks)}
              versus={versus}
            />
            {showConversions ? (
              <KpiCard
                icon="conversions"
                label="Conversions"
                value={conversions.toLocaleString()}
                subtitle="Goal completions"
                sparklineValues={conversionTrend}
                sparklineColor="#059669"
                growth={compare(conversions, previous?.total_conversions)}
                versus={versus}
              />
            ) : null}
          </div>
          {showConversions && clicks > 0 ? (
            <div className="reports-kpi-conversion-strip" aria-label="Click to goal rate">
              <div className="reports-kpi-conversion-end">
                <span className="reports-kpi-conversion-end-label">Clicks</span>
                <span className="reports-kpi-conversion-end-value">{clicks.toLocaleString()}</span>
              </div>
              <div className="reports-kpi-conversion-mid">
                <span className="reports-kpi-conversion-rate">{clickToGoalPct}%</span>
                <span className="reports-kpi-conversion-rate-label">Click to goal rate</span>
              </div>
              <div className="reports-kpi-conversion-end reports-kpi-conversion-end--goal">
                <span className="reports-kpi-conversion-end-label">Conversions</span>
                <span className="reports-kpi-conversion-end-value">{conversions.toLocaleString()}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
