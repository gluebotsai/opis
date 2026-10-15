import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLiveUsers } from '../api';
import Pagination from './Pagination';
import {
  visitorContactTypeLabel,
  visitorIsKnown,
  visitorMultiAccountOptionTitle,
} from '../utils/visitorProfileDisplay';
import { formatLocalDateTime } from '../utils/formatDateTime';
import {
  LIVE_POLL_MS_FALLBACK,
  livePollMsForPresenceSource,
} from '../utils/livePollMs';

function liveUserDisplayName(session) {
  const label = String(session?.last_active_profile_label ?? '').trim();
  if (label) return label;
  const cdpProfile = session?.cdp_profile;
  if (!visitorIsKnown(cdpProfile)) return 'Anonymous';
  return visitorMultiAccountOptionTitle(cdpProfile);
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * @param {{ data?: object | null }} props
 * When `data` is passed from Dashboard, polling is owned by the parent (single /live poller).
 */
export default function LiveUsers({ data: controlledData } = {}) {
  const isControlled = controlledData !== undefined;
  const [data, setData] = useState(null);
  const [livePollMs, setLivePollMs] = useState(LIVE_POLL_MS_FALLBACK);
  const [loading, setLoading] = useState(!isControlled);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  const load = useCallback(async () => {
    try {
      const res = await getLiveUsers();
      setData(res.data);
      setLivePollMs(livePollMsForPresenceSource(res.data?.presence_source));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isControlled) return undefined;
    load();
    const interval = setInterval(load, livePollMs);
    return () => clearInterval(interval);
  }, [load, isControlled, livePollMs]);

  const displayData = isControlled ? controlledData : data;
  const sessions = displayData?.sessions ?? [];
  const total = sessions.length;

  useEffect(() => {
    if (offset >= total && total > 0) {
      setOffset(0);
    }
  }, [offset, total]);

  const pagedSessions = useMemo(
    () => sessions.slice(offset, offset + limit),
    [sessions, offset, limit],
  );

  const handleLimitChange = (nextLimit) => {
    setLimit(nextLimit);
    setOffset(0);
  };

  return (
    <section className="reports-main-panel live-users-panel reports-table-card">
      <div className="reports-main-panel-header">
        <div className="reports-main-panel-heading">
          <h2 className="reports-main-panel-title">Live Users</h2>
          <p className="reports-main-panel-desc">Real-time sessions in the last 5 minutes</p>
        </div>
        <span className="live-indicator">Last 5 minutes</span>
      </div>

      <div className="reports-main-panel-body">
      {(loading && !displayData) || (isControlled && controlledData === null) ? (
        <p className="loading-text">Loading live activity...</p>
      ) : (
        <>
          <div className="live-users-summary">
            <div className="live-metric">
              <div className="value">{displayData?.active_users ?? 0}</div>
              <div className="label">Online devices</div>
              <div className="replay-empty-hint" style={{ marginTop: '0.25rem' }}>Unique browsers (visitor id)</div>
            </div>
            <div className="live-metric">
              <div className="value">{displayData?.active_sessions ?? 0}</div>
              <div className="label">Active sessions</div>
              <div className="replay-empty-hint" style={{ marginTop: '0.25rem' }}>One row per visitor below</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="live-users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Type</th>
                  <th>Current Page</th>
                  <th>Country</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {pagedSessions.map((session) => (
                  <tr key={session.visitor_id || session.session_id}>
                    <td>{liveUserDisplayName(session)}</td>
                    <td>{visitorContactTypeLabel(session.cdp_profile)}</td>
                    <td>{session.current_page || '—'}</td>
                    <td>{session.country || '—'}</td>
                    <td>{formatLocalDateTime(session.last_activity)}</td>
                  </tr>
                ))}
                {!sessions.length && (
                  <tr>
                    <td colSpan={5} className="state-cell">
                      No active users in the last 5 minutes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <Pagination
              offset={offset}
              limit={limit}
              total={total}
              loading={loading}
              onOffsetChange={setOffset}
              onLimitChange={handleLimitChange}
              pageSizeOptions={[5, 10, 25]}
              itemLabel="sessions"
            />
          )}
        </>
      )}
      </div>
    </section>
  );
}
