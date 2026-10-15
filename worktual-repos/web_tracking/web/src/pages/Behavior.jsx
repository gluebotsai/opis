import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../layout/AppShell';
import HeatmapCanvas from '../components/HeatmapCanvas';
import { getHeatmap, getHeatmapPages, getHeatmapScopes } from '../api';
import { formatPagePath } from '../utils/formatDisplayLabels';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'overall', label: 'Overall' },
];

const SCOPES = [
  { value: 'all', label: 'All visitors' },
  { value: 'visitor', label: 'Single visitor' },
  { value: 'session', label: 'Single session' },
];

const EVENT_TYPES = [
  { value: 'click', label: 'Clicks', totalKey: 'click_count', pageKey: 'click_count' },
  { value: 'rage_click', label: 'Rage clicks', totalKey: 'rage_click_count', pageKey: 'rage_click_count' },
  { value: 'dead_click', label: 'Dead clicks', totalKey: 'dead_click_count', pageKey: 'dead_click_count' },
  { value: 'all', label: 'All', totalKey: 'interaction_count', pageKey: 'interaction_count' },
];

function bestPageForEvent(pages, pageKey) {
  return [...pages]
    .filter((p) => (p[pageKey] ?? 0) > 0)
    .sort((a, b) => (b[pageKey] ?? 0) - (a[pageKey] ?? 0))[0];
}

function ScopeSelect({
  mode,
  items,
  value,
  onChange,
  idKey,
  countKey = 'event_count',
  fallbackCountKey = 'click_count',
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
  }, [mode, items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => String(item[idKey]).toLowerCase().includes(q));
  }, [items, idKey, query]);

  const exactQuery = query.trim();
  const exactInList = exactQuery && items.some((item) => item[idKey] === exactQuery);
  const showCustomId = exactQuery && !exactInList && filtered.length === 0;

  const label = mode === 'visitor' ? 'Visitor' : 'Session';
  const searchPlaceholder = mode === 'visitor'
    ? 'Search or paste visitor ID…'
    : 'Search or paste session ID…';

  return (
    <div className="heatmap-scope-select">
      <label className="heatmap-field">
        <span>Search</span>
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="heatmap-control"
        />
      </label>
      <label className="heatmap-field">
        <span>Select</span>
        <select className="heatmap-control" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          {filtered.length === 0 && !showCustomId && (
            <option value="">No {label.toLowerCase()}s match</option>
          )}
          {showCustomId && (
            <option value={exactQuery}>Use ID: {exactQuery}</option>
          )}
          {filtered.map((item) => {
            const id = item[idKey];
            const count = item[countKey] ?? item[fallbackCountKey] ?? 0;
            const sessionHint = mode === 'session' && item.visitor_id
              ? ` · ${item.visitor_id}`
              : '';
            return (
              <option key={id} value={id}>
                {id}{sessionHint} ({count} events)
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}

function PageSelect({ pages, value, onChange }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.page_path.toLowerCase().includes(q));
  }, [pages, query]);

  return (
    <div className="heatmap-page-select">
      <label className="heatmap-field">
        <span>Search</span>
        <input
          type="search"
          placeholder="Filter pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="heatmap-control"
        />
      </label>
      <label className="heatmap-field">
        <span>Select</span>
        <select className="heatmap-control" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          {filtered.length === 0 && <option value="">No pages match</option>}
          {filtered.map((p) => (
            <option key={p.page_path} value={p.page_path}>
              {formatPagePath(p.page_path)} ({p.interaction_count ?? p.click_count} events · {p.visitor_count} visitors)
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function Behavior() {
  const [period, setPeriod] = useState('overall');
  const [pages, setPages] = useState([]);
  const [totals, setTotals] = useState({});
  const [pagePath, setPagePath] = useState('');
  const [eventType, setEventType] = useState('click');
  const [scopeMode, setScopeMode] = useState('all');
  const [visitorId, setVisitorId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [scopes, setScopes] = useState({ visitors: [], sessions: [] });
  const [heatmap, setHeatmap] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getHeatmapPages(period)
      .then((res) => {
        const list = res.data?.pages || [];
        setPages(list);
        setTotals(res.data?.totals || {});
        if (list.length > 0) {
          setPagePath((prev) => {
            if (prev && list.some((p) => p.page_path === prev)) return prev;
            return list[0].page_path;
          });
        }
      })
      .catch(console.error);
  }, [period]);

  const handleEventTypeChange = useCallback((type) => {
    setEventType(type);
    const meta = EVENT_TYPES.find((t) => t.value === type);
    if (!meta || type === 'all') return;
    const best = bestPageForEvent(pages, meta.pageKey);
    if (best) setPagePath(best.page_path);
  }, [pages]);

  useEffect(() => {
    if (!pagePath) return;
    getHeatmapScopes(pagePath, period, eventType)
      .then((res) => setScopes(res.data))
      .catch(console.error);
  }, [pagePath, period, eventType]);

  useEffect(() => {
    if (!pagePath) return;
    setLoading(true);
    const params = { pagePath, period, eventType };
    if (scopeMode === 'visitor' && visitorId) params.visitorId = visitorId;
    if (scopeMode === 'session' && sessionId) params.sessionId = sessionId;

    getHeatmap(params)
      .then((res) => setHeatmap(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [pagePath, period, eventType, scopeMode, visitorId, sessionId]);

  useEffect(() => {
    setVisitorId('');
    setSessionId('');
  }, [eventType, pagePath]);

  useEffect(() => {
    if (scopeMode === 'visitor' && scopes.visitors?.length && !visitorId) {
      setVisitorId(scopes.visitors[0].visitor_id);
    }
    if (scopeMode === 'session' && scopes.sessions?.length && !sessionId) {
      setSessionId(scopes.sessions[0].session_id);
    }
  }, [scopeMode, scopes, visitorId, sessionId]);

  const scopeLabel =
    scopeMode === 'visitor' ? visitorId : scopeMode === 'session' ? sessionId : 'All visitors';

  const activeType = EVENT_TYPES.find((t) => t.value === eventType) || EVENT_TYPES[0];
  const domainTotal = totals[activeType.totalKey] ?? 0;
  const pageTotal = pages.find((p) => p.page_path === pagePath)?.[activeType.pageKey] ?? 0;
  const activeCount = heatmap?.summary?.total_events ?? pageTotal;

  return (
    <AppShell
      title="Behavior"
      subtitle="Clicks, rage clicks, and dead clicks — same period filter as the dashboard."
    >
      <div className="container container-in-shell">

        <div className="card heatmap-controls-card">
          <div className="heatmap-controls-row">
            <PageSelect pages={pages} value={pagePath} onChange={setPagePath} />
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
            {EVENT_TYPES.map((t) => {
              const tabCount = totals[t.totalKey] ?? 0;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={eventType === t.value}
                  className={`heatmap-event-tab heatmap-event-tab-${t.value}${eventType === t.value ? ' active' : ''}`}
                  onClick={() => handleEventTypeChange(t.value)}
                >
                  {t.label}
                  <span className="heatmap-tab-count">{tabCount}</span>
                </button>
              );
            })}
          </div>

          <div className="heatmap-controls-row">
            <label className="heatmap-field heatmap-field-view">
              <span>View</span>
              <select
                className="heatmap-control"
                value={scopeMode}
                onChange={(e) => {
                  setScopeMode(e.target.value);
                  setVisitorId('');
                  setSessionId('');
                }}
              >
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>

            {scopeMode === 'visitor' && (
              <ScopeSelect
                mode="visitor"
                items={scopes.visitors || []}
                value={visitorId}
                onChange={setVisitorId}
                idKey="visitor_id"
              />
            )}

            {scopeMode === 'session' && (
              <ScopeSelect
                mode="session"
                items={scopes.sessions || []}
                value={sessionId}
                onChange={setSessionId}
                idKey="session_id"
              />
            )}
          </div>
        </div>

        <div className="card heatmap-result-card">
          <div className="heatmap-card-header">
            <h3>{activeType.label} — {pagePath ? formatPagePath(pagePath) : '—'}</h3>
            <span className="heatmap-scope-badge">{scopeLabel}</span>
          </div>

          {!pagePath ? (
            <p className="heatmap-muted">No page views recorded for this period.</p>
          ) : loading ? (
            <p className="heatmap-muted">Loading heatmap…</p>
          ) : domainTotal === 0 ? (
            <p className="heatmap-muted">
              No {activeType.label.toLowerCase()} recorded in this period.
            </p>
          ) : pageTotal === 0 ? (
            <p className="heatmap-muted">
              {domainTotal} {activeType.label.toLowerCase()} site-wide, but none on this page.
              Select another page or click the {activeType.label} tab to jump to the top page.
            </p>
          ) : (
            <>
              <div className="heatmap-stats">
                <span className="heatmap-stat-primary">
                  {activeCount} on this page · {domainTotal} site-wide
                </span>
                <span>{heatmap?.summary?.unique_visitors ?? 0} visitors</span>
                <span>{heatmap?.summary?.unique_sessions ?? 0} sessions</span>
                <span>{heatmap?.points?.length ?? 0} map points</span>
              </div>

              {(heatmap?.points?.length ?? 0) === 0 ? (
                <p className="heatmap-muted">
                  {activeCount} events recorded but no coordinates to plot. They may lack x/y position data.
                </p>
              ) : (
                <HeatmapCanvas
                  points={heatmap?.points || []}
                  summary={heatmap?.summary}
                  eventType={eventType}
                  scrollDistribution={heatmap?.scroll_distribution || []}
                  visualization={heatmap?.visualization}
                />
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
