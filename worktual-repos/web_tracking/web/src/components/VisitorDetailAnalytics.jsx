import { useMemo } from 'react';
import {
  AnalyticsDonutChart,
  HorizontalBarChart,
  VisitorActivityChart,
} from './Charts';
import { formatPagePath } from '../utils/formatDisplayLabels';

function formatActivityDay(day) {
  const raw = String(day ?? '').slice(0, 10);
  if (!raw) return '—';
  const [y, m, d] = raw.split('-');
  if (!y || !m || !d) return raw;
  return `${d}/${m}/${y.slice(2)}`;
}

export default function VisitorDetailAnalytics({
  dailyActivity = [],
  topPages = [],
  sessionChannelMix = [],
}) {
  const activityChartData = useMemo(
    () =>
      (dailyActivity || []).map((row) => ({
        label: formatActivityDay(row.day),
        pageviews: Number(row.pageviews ?? 0),
        interactions: Number(row.interactions ?? 0),
      })),
    [dailyActivity],
  );

  const topPagesChartData = useMemo(
    () =>
      (topPages || []).slice(0, 8).map((p) => ({
        page: formatPagePath(p.page_path),
        views: Number(p.views ?? 0),
      })),
    [topPages],
  );

  const channelDonutData = useMemo(
    () =>
      (sessionChannelMix || []).map((row) => ({
        source: row.channel_label || row.channel,
        sessions: Number(row.sessions ?? 0),
      })),
    [sessionChannelMix],
  );

  return (
    <section className="visitor-section">
      <h2 className="visitor-section-title">Analytics snapshot</h2>
      <p className="visitor-muted visitor-note visitor-analytics-intro">
        Activity over time, where they spent time, and which channel started each session.
      </p>
      <div className="visitor-analytics-grid">
        <div className="card visitor-analytics-card visitor-analytics-card--wide">
          <h3>Activity over time</h3>
          <VisitorActivityChart chartData={activityChartData} />
        </div>
        <div className="card visitor-analytics-card">
          <h3>Sessions by channel</h3>
          <p className="visitor-muted visitor-analytics-card-hint">
            One slice per session start (UTM / referrer).
          </p>
          <AnalyticsDonutChart
            chartData={channelDonutData}
            labelKey="source"
            valueKey="sessions"
            emptyLabel="No session attribution yet."
          />
        </div>
        <div className="card visitor-analytics-card">
          <h3>Top pages</h3>
          <HorizontalBarChart
            chartData={topPagesChartData}
            labelKey="page"
            valueKey="views"
            datasetLabel="Views"
            emptyLabel="No page views recorded."
          />
        </div>
      </div>
    </section>
  );
}
