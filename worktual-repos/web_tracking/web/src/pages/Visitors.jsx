import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import CopyId from '../components/CopyId';
import Pagination from '../components/Pagination';
import { getVisitors } from '../api';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { capToViewerNow, formatLocalDateTime, parseApiDateTime } from '../utils/formatDateTime';
import {
  visitorContactTypeLabel,
  visitorIsKnown,
  visitorListProfileLabel,
} from '../utils/visitorProfileDisplay';
import useLiveTrackingStream from '../hooks/useLiveTrackingStream';

const VISITORS_REFRESH_MS = Number(import.meta.env.VITE_VISITORS_REFRESH_MS) || 15000;

function visitorIdFromRow(row) {
  return row?.visitor_id ?? row?.['v.visitor_id'] ?? '';
}

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

export default function Visitors() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(10);
  const [visitorSearch, setVisitorSearch] = useState('');
  const debouncedSearch = useDebouncedValue(visitorSearch);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch]);

  const loadVisitors = useCallback(async ({ silent = false } = {}) => {
    const showInitialLoader = !silent && !hasLoadedRef.current;

    if (showInitialLoader) setLoading(true);
    else setRefreshing(true);

    if (!silent) setError(null);

    try {
      const res = await getVisitors(offset, limit, debouncedSearch);
      setData(res.data);
      hasLoadedRef.current = true;
    } catch (err) {
      console.error('Failed to load visitors', err);
      if (!silent) {
        setError(err.response?.data?.detail || err.response?.data?.message || 'Failed to load visitors.');
        if (showInitialLoader) setData(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offset, limit, debouncedSearch]);

  useEffect(() => {
    loadVisitors();
  }, [loadVisitors]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadVisitors({ silent: true });
      }
    }, VISITORS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadVisitors]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadVisitors({ silent: true });
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadVisitors]);

  useLiveTrackingStream({
    enabled: true,
    onTracking: (event) => {
      const vid = String(event?.visitor_id ?? '').trim();
      if (!vid) return;
      const seen = new Date(event.ts || Date.now()).toISOString();
      setData((prev) => {
        if (!prev?.visitors) return prev;
        const visitors = prev.visitors.map((row) => {
          if (visitorIdFromRow(row) !== vid) return row;
          return { ...row, last_seen_at: seen };
        });
        return { ...prev, visitors };
      });
    },
  });

  const total = Number(data?.total || 0);
  const visitors = data?.visitors ?? [];

  const handleRefresh = () => loadVisitors({ silent: false });

  const handleLimitChange = (nextLimit) => {
    setLimit(nextLimit);
    setOffset(0);
  };

  const openVisitor = (visitorId) => {
    if (!visitorId) return;
    navigate(`/visitors/${encodeURIComponent(visitorId)}`);
  };

  const clearSearch = () => setVisitorSearch('');

  return (
    <AppShell
      title="Visitors"
      subtitle="Live visitor tracking data"
      headerActions={(
        <button
          className="btn btn-black"
          onClick={handleRefresh}
          disabled={loading || refreshing}
        >
          {loading || refreshing ? 'Loading…' : 'Refresh'}
        </button>
      )}
    >
      <div className="container container-in-shell">
        {error && (
          <div className="status-banner status-banner-error" role="alert">
            {error}
          </div>
        )}

        <div className="card visitors-contacts-card">
          <div className="visitors-contacts-toolbar">
            <div>
              <h2 className="visitors-contacts-title">Visitors list</h2>
              <p className="visitors-contacts-meta">
                {total.toLocaleString()} visitors
                {refreshing ? ' · Updating…' : ''}
              </p>
            </div>
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
              {visitorSearch ? (
                <button type="button" className="visitors-contacts-search-clear" onClick={clearSearch}>
                  Clear
                </button>
              ) : null}
            </label>
          </div>

          <div className={`visitors-contacts-scroll${refreshing ? ' table-wrap-loading' : ''}`}>
            <div className="visitors-contacts-head" role="row">
              <span>Visitor</span>
              <span>Country</span>
              <span>Sessions</span>
              <span>Page views</span>
              <span>Last seen</span>
            </div>

            {loading && !visitors.length ? (
              <p className="visitors-contacts-empty">Loading visitors…</p>
            ) : null}

            {!loading && visitors.map((v) => {
              const visitorId = visitorIdFromRow(v);
              const cdp = v.cdp_profile;
              const accountLabels = v.browser_account_labels ?? [];
              const profileLabel = visitorListProfileLabel(cdp, v.last_active_profile_label);
              const known = visitorIsKnown(cdp) && profileLabel !== 'Anonymous';
              const contactType = visitorContactTypeLabel(cdp);
              const showType = Boolean(contactType) && contactType !== profileLabel;
              const accountHint = accountLabels.length > 1
                ? `Accounts on this browser: ${accountLabels.join(', ')}`
                : '';
              return (
                <div
                  key={visitorId || profileLabel}
                  className="visitors-contacts-row"
                  role="link"
                  tabIndex={visitorId ? 0 : undefined}
                  title={accountHint || undefined}
                  onClick={() => openVisitor(visitorId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openVisitor(visitorId);
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
                        {showType && visitorId ? <span aria-hidden="true">·</span> : null}
                        {visitorId ? (
                          <>
                            <code title={visitorId}>{visitorId}</code>
                            <CopyId value={visitorId} label="visitor ID" />
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="visitors-contacts-country">{v.country || '—'}</span>
                  <span className="visitors-contacts-metric">{Number(v.total_sessions ?? 0)}</span>
                  <span className="visitors-contacts-metric">{Number(v.total_pageviews ?? 0)}</span>
                  <div className="visitors-contacts-time" title={`First seen ${formatLocalDateTime(v.first_seen_at)}`}>
                    <div className="visitors-contacts-time-primary">{relativeLastSeen(v.last_seen_at)}</div>
                    <div className="visitors-contacts-time-secondary">
                      First {formatLocalDateTime(v.first_seen_at)}
                    </div>
                  </div>
                </div>
              );
            })}

            {!loading && !error && !visitors.length ? (
              <p className="visitors-contacts-empty">
                {debouncedSearch ? 'No visitors match that ID.' : 'No visitors found.'}
              </p>
            ) : null}
          </div>

          {(total > 0 || debouncedSearch) && (
            <Pagination
              offset={offset}
              limit={limit}
              total={total}
              loading={loading || refreshing}
              onOffsetChange={setOffset}
              onLimitChange={handleLimitChange}
              pageSizeOptions={[5, 10, 15]}
              itemLabel="visitors"
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
