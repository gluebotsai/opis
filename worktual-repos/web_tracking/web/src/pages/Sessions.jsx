import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import CopyId from '../components/CopyId';
import Pagination from '../components/Pagination';
import { getReplaySessions } from '../api';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { capToViewerNow, formatLocalDateTime, parseApiDateTime } from '../utils/formatDateTime';
import {
  visitorContactTypeLabel,
  visitorIsKnown,
  visitorListProfileLabel,
} from '../utils/visitorProfileDisplay';
import { replayUrlWithReturn } from '../utils/backNavigation';

function profileInitials(label) {
  const text = String(label || '').trim();
  if (!text || /^anonymous$/i.test(text)) return 'AN';
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function relativeLastSeen(value) {
  const date = capToViewerNow(parseApiDateTime(value));
  if (!date) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`;
  return formatLocalDateTime(value);
}

const PAGE_SIZE_OPTIONS = [5, 10, 15];
const SESSIONS_REFRESH_MS =
  Number(import.meta.env.VITE_SESSIONS_REFRESH_MS)
  || Number(import.meta.env.VITE_VISITORS_REFRESH_MS)
  || 15000;

export default function Sessions() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('week');
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(10);
  const [sessionSearch, setSessionSearch] = useState('');
  const [visitorSearch, setVisitorSearch] = useState('');
  const debouncedSessionSearch = useDebouncedValue(sessionSearch);
  const debouncedVisitorSearch = useDebouncedValue(visitorSearch);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSessionSearch, debouncedVisitorSearch]);

  const loadSessions = useCallback(async ({ silent = false } = {}) => {
    const showInitialLoader = !silent && !hasLoadedRef.current;

    if (showInitialLoader) setLoading(true);
    else setRefreshing(true);
    if (!silent) setError(null);

    try {
      const res = await getReplaySessions(period, offset, limit, {
        sessionId: debouncedSessionSearch,
        visitorId: debouncedVisitorSearch,
      });
      setData(res.data);
      hasLoadedRef.current = true;
    } catch (err) {
      console.error(err);
      if (!silent) {
        setError(err.response?.data?.message || err.message || 'Failed to load sessions');
        if (showInitialLoader) setData(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, offset, limit, debouncedSessionSearch, debouncedVisitorSearch]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadSessions({ silent: true });
      }
    }, SESSIONS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadSessions]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadSessions({ silent: true });
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadSessions]);

  const sessions = data?.sessions ?? [];
  const total = Number(data?.total ?? 0);
  const hasFilters = Boolean(debouncedSessionSearch || debouncedVisitorSearch);
  const latestRecordingMs = data?.latest_recording_at
    ? new Date(data.latest_recording_at).getTime()
    : 0;
  const staleData =
    !loading
    && !hasFilters
    && latestRecordingMs > 0
    && Date.now() - latestRecordingMs > 24 * 60 * 60 * 1000;

  const openReplay = (session) => {
    navigate(replayUrlWithReturn(session.session_id, '/sessions'), {
      state: {
        visitorId: session.visitor_id,
        returnTo: '/sessions',
        returnLabel: 'Session replay',
      },
    });
  };

  const handleLimitChange = (nextLimit) => {
    setLimit(nextLimit);
    setOffset(0);
  };

  const clearFilters = () => {
    setSessionSearch('');
    setVisitorSearch('');
  };

  return (
    <AppShell
      title="Session replay"
      subtitle="One row per recorded session. Profile reflects who that session was (Guest or logged-in user), not the whole visitor history."
      headerActions={(
        <>
          <button
            type="button"
            className="btn btn-black"
            onClick={() => loadSessions({ silent: false })}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? 'Loading…' : 'Refresh'}
          </button>
          <select
            className="wt-select"
            value={period}
            onChange={(e) => { setPeriod(e.target.value); setOffset(0); }}
            aria-label="Period"
            disabled={loading && !sessions.length}
          >
            <option value="today">Today</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="overall">Overall</option>
          </select>
        </>
      )}
    >
      <div className="container container-in-shell">
        {error && (
          <div className="status-banner status-banner-error" role="alert">
            <div>
              <strong>API error:</strong> {error}
              <p className="replay-empty-hint">
                Restart API after code changes: <code>python run_backend.py --restart api</code>
              </p>
            </div>
          </div>
        )}
        {staleData && (
          <div className="status-banner status-banner-warning" role="status">
            <div>
              <strong>No recent replay data.</strong> Latest recording is more than 24 hours old.
              Browse the tracked site with replay enabled, then check DevTools → Network for{' '}
              <code>replay_chunk_v1</code> POSTs to your nfs-ingestions URL.
            </div>
          </div>
        )}

        <div className="card visitors-contacts-card">
          <div className="visitors-contacts-toolbar">
            <div>
              <h2 className="visitors-contacts-title">Session replays</h2>
              <p className="visitors-contacts-meta">
                {total.toLocaleString()} sessions
                {refreshing ? ' · Updating…' : ''}
              </p>
            </div>
            <div className="sessions-contacts-filters">
              <label className="visitors-contacts-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  placeholder="Search session ID"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  aria-label="Search session ID"
                />
              </label>
              <label className="visitors-contacts-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  placeholder="Search visitor ID"
                  value={visitorSearch}
                  onChange={(e) => setVisitorSearch(e.target.value)}
                  aria-label="Search visitor ID"
                />
              </label>
              {(sessionSearch || visitorSearch) ? (
                <button type="button" className="visitors-contacts-search-clear" onClick={clearFilters}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className={`visitors-contacts-scroll${refreshing ? ' table-wrap-loading' : ''}`}>
            <div className="visitors-contacts-head sessions-contacts-head" role="row">
              <span title="Last account on this browser (same as Visitors list)">Session</span>
              <span>Visitor</span>
              <span>Last activity</span>
              <span>Status</span>
            </div>

            {loading && !sessions.length ? (
              <p className="visitors-contacts-empty">Loading sessions…</p>
            ) : null}

            {!loading && sessions.map((s) => {
              const profileLabel = s.last_active_profile_label
                || visitorListProfileLabel(s.cdp_profile);
              const known = visitorIsKnown(s.cdp_profile) && profileLabel !== 'Anonymous';
              const contactType = visitorContactTypeLabel(s.cdp_profile);
              const showType = Boolean(contactType) && contactType !== profileLabel;
              const activityAt = s.last_chunk_at || s.started_at;
              const accountLabels = s.browser_account_labels ?? [];
              const accountHint = accountLabels.length > 1
                ? `Accounts on this browser: ${accountLabels.join(', ')}`
                : '';
              const isVideo = s.recording_kind === 'video';
              return (
                <div
                  key={s.session_id}
                  className="visitors-contacts-row sessions-contacts-row"
                  role="link"
                  tabIndex={0}
                  title={accountHint || undefined}
                  onClick={() => openReplay(s)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openReplay(s);
                    }
                  }}
                >
                  <div className="visitors-contacts-identity">
                    <span className="visitors-contacts-avatar" aria-hidden="true">
                      {profileInitials(profileLabel)}
                    </span>
                    <div className="visitors-contacts-identity-text">
                      <div className={`visitors-contacts-name${known ? '' : ' is-muted'}`}>{profileLabel}</div>
                      <div className="visitors-contacts-sub">
                        {showType ? <span>{contactType}</span> : null}
                        {showType ? <span aria-hidden="true">·</span> : null}
                        <code title={s.session_id}>{s.session_id}</code>
                        <CopyId value={s.session_id} label="session ID" />
                      </div>
                    </div>
                  </div>
                  <div className="sessions-contacts-id">
                    <code title={s.visitor_id}>{s.visitor_id}</code>
                    <CopyId value={s.visitor_id} label="visitor ID" />
                  </div>
                  <div className="visitors-contacts-time" title={formatLocalDateTime(activityAt)}>
                    <div className="visitors-contacts-time-primary">{relativeLastSeen(activityAt)}</div>
                    <div className="visitors-contacts-time-secondary">{formatLocalDateTime(activityAt)}</div>
                  </div>
                  <span
                    className={`sessions-contacts-status${isVideo ? ' is-video' : ' is-short'}`}
                    title={isVideo ? 'Video replay' : 'Less mouse/scroll activity — open to preview'}
                  >
                    {isVideo ? 'Video' : 'Short'}
                  </span>
                </div>
              );
            })}

            {!loading && !refreshing && !error && !sessions.length ? (
              <p className="visitors-contacts-empty">
                {hasFilters
                  ? 'No sessions match your search.'
                  : 'No video replay sessions in this period. Browse a tracked site with mouse/scroll activity, wait ~10s, then refresh.'}
              </p>
            ) : null}
          </div>
          {(total > 0 || hasFilters) && (
            <Pagination
              offset={offset}
              limit={limit}
              total={total}
              loading={loading || refreshing}
              onOffsetChange={setOffset}
              onLimitChange={handleLimitChange}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              itemLabel="sessions"
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
