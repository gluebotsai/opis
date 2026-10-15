import { useMemo } from 'react';
import { formatPagePath } from '../utils/formatDisplayLabels';

const MILESTONES = [25, 50, 75, 100];

function buildScrollMetrics(distribution, summary) {
  const bands = [...(distribution || [])].sort((a, b) => a.depth_pct - b.depth_pct);
  const bucketSessions = bands.reduce((sum, band) => sum + Number(band.sessions || 0), 0);
  const totalSessions = Math.max(1, Number(summary?.unique_sessions) || bucketSessions || 1);
  const totalVisitors = Number(summary?.unique_visitors) || 0;
  const totalEvents = Number(summary?.total_scrolls ?? summary?.total_events) || 0;

  const avgMaxDepth = bucketSessions
    ? Math.round(
        bands.reduce((sum, band) => sum + Number(band.depth_pct) * Number(band.sessions || 0), 0)
          / bucketSessions,
      )
    : 0;

  const milestones = MILESTONES.map((milestone) => {
    const reached = bands
      .filter((band) => Number(band.depth_pct) >= milestone)
      .reduce((sum, band) => sum + Number(band.sessions || 0), 0);
    const pct = Math.min(100, Math.round((reached / totalSessions) * 100));
    return { milestone, reached, pct, total: totalSessions };
  });

  const histogram = bands.map((band) => {
    const sessions = Number(band.sessions || 0);
    const visitors = Number(band.visitors || 0);
    const pct = Math.round((sessions / totalSessions) * 100);
    return {
      depthPct: Number(band.depth_pct),
      sessions,
      visitors,
      pct,
    };
  });

  let maxDrop = 0;
  let dropLabel = null;
  for (let i = 1; i < milestones.length; i += 1) {
    const drop = milestones[i - 1].pct - milestones[i].pct;
    if (drop > maxDrop) {
      maxDrop = drop;
      dropLabel = `${milestones[i - 1].milestone}% → ${milestones[i].milestone}%`;
    }
  }

  const completionRate = milestones[milestones.length - 1]?.pct ?? 0;

  return {
    bands,
    milestones,
    histogram,
    avgMaxDepth,
    totalSessions,
    totalVisitors,
    totalEvents,
    maxDrop,
    dropLabel,
    completionRate,
  };
}

function MilestoneFunnel({ milestones }) {
  return (
    <div className="scroll-behavior-funnel">
      <div className="scroll-behavior-funnel-header">
        <span>Scroll retention</span>
        <span className="scroll-behavior-funnel-hint">% of sessions reaching each depth</span>
      </div>
      <div className="scroll-behavior-funnel-rows">
        {[...milestones].reverse().map((row) => (
          <div key={row.milestone} className="scroll-behavior-funnel-row">
            <span className="scroll-behavior-funnel-label">{row.milestone}%</span>
            <div className="scroll-behavior-funnel-track">
              <div
                className="scroll-behavior-funnel-fill"
                style={{ width: `${row.pct}%` }}
              />
            </div>
            <span className="scroll-behavior-funnel-value">
              {row.pct}%
              <span className="scroll-behavior-funnel-count">{row.reached} sess</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageStrip({ milestones }) {
  const zones = useMemo(() => {
    const ordered = [...milestones];
    return ordered.map((row, index) => {
      const top = index === 0 ? 0 : MILESTONES[index - 1];
      const bottom = row.milestone;
      return {
        key: row.milestone,
        top,
        bottom,
        pct: row.pct,
        height: bottom - top,
      };
    });
  }, [milestones]);

  return (
    <div className="scroll-behavior-strip-wrap">
      <div className="scroll-behavior-strip-header">Page read-through</div>
      <div className="scroll-behavior-strip" aria-hidden="true">
        {zones.map((zone) => (
          <div
            key={zone.key}
            className="scroll-behavior-strip-zone"
            style={{
              flex: `${zone.height} 1 0`,
              '--zone-intensity': `${Math.max(0.12, zone.pct / 100)}`,
            }}
          >
            <span className="scroll-behavior-strip-marker">{zone.bottom}%</span>
          </div>
        ))}
        <div className="scroll-behavior-strip-top-label">Top</div>
      </div>
      <p className="scroll-behavior-strip-caption">
        Darker green = more sessions still reading at that section
      </p>
    </div>
  );
}

function Histogram({ histogram, totalSessions }) {
  if (!histogram.length) return null;

  return (
    <div className="scroll-behavior-histogram">
      <div className="scroll-behavior-funnel-header">
        <span>Where scrolling stops</span>
        <span className="scroll-behavior-funnel-hint">Max depth per session ({totalSessions} total)</span>
      </div>
      <div className="scroll-behavior-histogram-grid">
        {histogram.map((row) => (
          <div key={row.depthPct} className="scroll-behavior-histogram-col">
            <div className="scroll-behavior-histogram-bar-wrap">
              <div
                className="scroll-behavior-histogram-bar"
                style={{ height: `${Math.max(8, row.pct)}%` }}
                title={`${row.sessions} sessions (${row.pct}%)`}
              />
            </div>
            <span className="scroll-behavior-histogram-depth">{row.depthPct}%</span>
            <span className="scroll-behavior-histogram-meta">{row.sessions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ScrollBehaviorPanel({
  scrollDistribution = [],
  summary = {},
  pagePath = '/',
  scopeLabel = 'All visitors',
}) {
  const metrics = useMemo(
    () => buildScrollMetrics(scrollDistribution, summary),
    [scrollDistribution, summary],
  );

  if (!scrollDistribution?.length) {
    return (
      <div className="scroll-behavior-panel scroll-behavior-panel-empty">
        <p className="heatmap-muted">
          Scroll events were recorded, but depth milestones are not available yet for this page.
        </p>
      </div>
    );
  }

  const insightParts = [];
  if (metrics.completionRate > 0) {
    insightParts.push(`${metrics.completionRate}% of sessions reach the bottom of the page`);
  }
  if (metrics.avgMaxDepth > 0) {
    insightParts.push(`average max scroll is ${metrics.avgMaxDepth}%`);
  }
  if (metrics.maxDrop > 0 && metrics.dropLabel) {
    insightParts.push(`largest drop (${metrics.maxDrop}%) happens between ${metrics.dropLabel}`);
  }

  return (
    <div className="scroll-behavior-panel">
      <div className="scroll-behavior-kpis">
        <div className="scroll-behavior-kpi">
          <span className="scroll-behavior-kpi-value">{metrics.totalEvents}</span>
          <span className="scroll-behavior-kpi-label">Scroll events</span>
        </div>
        <div className="scroll-behavior-kpi">
          <span className="scroll-behavior-kpi-value">{metrics.totalVisitors}</span>
          <span className="scroll-behavior-kpi-label">Visitors</span>
        </div>
        <div className="scroll-behavior-kpi">
          <span className="scroll-behavior-kpi-value">{metrics.totalSessions}</span>
          <span className="scroll-behavior-kpi-label">Sessions</span>
        </div>
        <div className="scroll-behavior-kpi scroll-behavior-kpi-accent">
          <span className="scroll-behavior-kpi-value">{metrics.avgMaxDepth}%</span>
          <span className="scroll-behavior-kpi-label">Avg max depth</span>
        </div>
      </div>

      {insightParts.length > 0 && (
        <p className="scroll-behavior-insight">{insightParts.join(' · ')}</p>
      )}

      <div className="scroll-behavior-grid">
        <PageStrip milestones={metrics.milestones} />
        <MilestoneFunnel milestones={metrics.milestones} />
      </div>

      <Histogram histogram={metrics.histogram} totalSessions={metrics.totalSessions} />

      <p className="scroll-behavior-footnote">
        Scroll on <strong>{formatPagePath(pagePath)}</strong> for <strong>{scopeLabel}</strong>.
        Depth is measured from page views and scroll events (no click coordinates needed).
      </p>
    </div>
  );
}
