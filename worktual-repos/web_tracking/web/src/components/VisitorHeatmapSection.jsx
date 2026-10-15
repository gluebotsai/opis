import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import HeatmapCanvas from './HeatmapCanvas';
import { getHeatmap } from '../api';
import { formatPagePath, formatPagePathTitle } from '../utils/formatDisplayLabels';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'overall', label: 'Overall' },
];

/** Visitor detail heatmap — scroll metrics live on Behavior page and Scroll depth section. */
/** Visitor heatmap: movement disabled (too dense / low signal per visitor). */
const EVENT_TYPES = [
  { value: 'click', label: 'Clicks' },
  { value: 'rage_click', label: 'Rage clicks' },
  { value: 'dead_click', label: 'Dead clicks' },
  { value: 'all', label: 'All' },
];

export default function VisitorHeatmapSection({
  visitorId,
  pages = [],
  sessions = [],
  selectedPage = null,
  cdpId = '',
}) {
  const [period, setPeriod] = useState('overall');
  const [pagePath, setPagePath] = useState('');
  const [eventType, setEventType] = useState('click');
  const [sessionScope, setSessionScope] = useState('all');
  const [sessionId, setSessionId] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [heatmap, setHeatmap] = useState(null);
  const [loading, setLoading] = useState(false);

  const pageOptions = useMemo(
    () => pages.map((p) => p.page_path).filter(Boolean),
    [pages],
  );

  useEffect(() => {
    if (selectedPage && pageOptions.includes(selectedPage)) {
      setPagePath(selectedPage);
      document.getElementById('visitor-heatmap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedPage, pageOptions]);

  useEffect(() => {
    if (pageOptions.length === 0) {
      setPagePath('');
      return;
    }
    setPagePath((prev) => (prev && pageOptions.includes(prev) ? prev : pageOptions[0]));
  }, [pageOptions]);

  useEffect(() => {
    if (eventType === 'move') setEventType('click');
  }, [eventType]);

  useEffect(() => {
    if (!pagePath || !visitorId) return;
    setLoading(true);
    const params = {
      pagePath,
      period,
      eventType,
      visitorId,
      cdpId: cdpId || undefined,
    };
    if (sessionScope === 'session' && sessionId) {
      params.sessionId = sessionId;
    }

    getHeatmap(params)
      .then((res) => setHeatmap(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [pagePath, period, eventType, visitorId, cdpId, sessionScope, sessionId]);

  useEffect(() => {
    if (sessionScope === 'session' && sessions.length && !sessionId) {
      setSessionId(sessions[0].session_id);
    }
    if (sessionScope === 'all') {
      setSessionId('');
    }
  }, [sessionScope, sessions, sessionId]);

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.session_id.toLowerCase().includes(q));
  }, [sessions, sessionQuery]);

  const activeType = EVENT_TYPES.find((t) => t.value === eventType) || EVENT_TYPES[0];

  const heatmapDisplay = useMemo(() => {
    if (!heatmap) return null;
    if (eventType !== 'all') return heatmap;
    const points = (heatmap.points || []).filter((p) => {
      const t = p.event_type ?? p.eventType;
      return t !== 'move';
    });
    const totalFromPoints = points.reduce((sum, p) => sum + Number(p.count ?? 0), 0);
    return {
      ...heatmap,
      points,
      summary: {
        ...heatmap.summary,
        total_events: totalFromPoints,
      },
    };
  }, [heatmap, eventType]);

  const eventCount = heatmapDisplay?.summary?.total_events ?? 0;

  if (!pageOptions.length) {
    return (
      <div className="card heatmap-result-card" id="visitor-heatmap">
        <h3>Behavior heatmap</h3>
        <p className="heatmap-muted">No page views recorded for this visitor.</p>
      </div>
    );
  }

  return (
    <div className="card heatmap-controls-card" id="visitor-heatmap">
      <div className="heatmap-card-header">
        <div>
          <h3>Behavior heatmap</h3>
          <p className="chart-card-subtitle" style={{ marginTop: '0.25rem' }}>
            This visitor&apos;s clicks and interactions per page (scroll metrics on{' '}
            <Link to="/behavior">Behavior</Link>).
          </p>
        </div>
      </div>

      <div className="heatmap-controls-row">
        <label className="heatmap-field heatmap-field-grow">
          <span>Page</span>
          <select className="heatmap-control" value={pagePath} onChange={(e) => setPagePath(e.target.value)}>
            {pageOptions.map((path) => {
              const meta = pages.find((p) => p.page_path === path);
              return (
                <option key={path} value={path}>
                  {formatPagePath(path)}{meta?.views != null ? ` (${meta.views} views)` : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label className="heatmap-field heatmap-field-period">
          <span>Period</span>
          <select className="heatmap-control" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="heatmap-event-tabs" role="tablist">
        {EVENT_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={eventType === t.value}
            className={`heatmap-event-tab heatmap-event-tab-${t.value}${eventType === t.value ? ' active' : ''}`}
            onClick={() => setEventType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="heatmap-controls-row">
        <label className="heatmap-field heatmap-field-view">
          <span>Session</span>
          <select
            className="heatmap-control"
            value={sessionScope}
            onChange={(e) => {
              setSessionScope(e.target.value);
              setSessionId('');
            }}
          >
            <option value="all">All sessions</option>
            <option value="session">Single session</option>
          </select>
        </label>

        {sessionScope === 'session' && (
          <div className="heatmap-scope-select">
            <label className="heatmap-field">
              <span>Search</span>
              <input
                type="search"
                className="heatmap-control"
                placeholder="Search session ID…"
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
              />
            </label>
            <label className="heatmap-field">
              <span>Select</span>
              <select
                className="heatmap-control"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                {filteredSessions.length === 0 && (
                  <option value="">No sessions match</option>
                )}
                {filteredSessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.session_id} ({s.pageview_count ?? 0} pages)
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="heatmap-result-card" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--gray-100)' }}>
        <div className="heatmap-card-header heatmap-card-header--path">
          <h3
            className="heatmap-path-title"
            style={{ fontSize: '0.9375rem' }}
            title={formatPagePathTitle(pagePath)}
          >
            {activeType.label} — {formatPagePath(pagePath)}
          </h3>
          <span className="heatmap-scope-badge">
            {sessionScope === 'session' && sessionId ? sessionId : visitorId}
          </span>
        </div>

        {loading ? (
          <p className="heatmap-muted">Loading heatmap…</p>
        ) : eventCount === 0 ? (
          <p className="heatmap-muted">
            No {activeType.label.toLowerCase()} for this visitor on this page in the selected period.
          </p>
        ) : (
          <>
            <div className="heatmap-stats">
              <span className="heatmap-stat-primary">{eventCount} events</span>
              <span>{heatmapDisplay?.summary?.unique_sessions ?? 0} sessions</span>
              <span>{heatmapDisplay?.points?.length ?? 0} map points</span>
            </div>
            {(heatmapDisplay?.points?.length ?? 0) === 0 ? (
              <p className="heatmap-muted">
                {eventCount} events recorded but no coordinates to plot.
              </p>
            ) : (
              <HeatmapCanvas
                points={heatmapDisplay?.points || []}
                summary={heatmapDisplay?.summary}
                eventType={eventType}
                scrollDistribution={heatmapDisplay?.scroll_distribution || []}
                visualization={heatmapDisplay?.visualization}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
