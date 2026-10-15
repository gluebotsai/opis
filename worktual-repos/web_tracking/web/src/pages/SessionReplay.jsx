import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getBackLabel, parseReturnToLocation } from '../utils/backNavigation';
import AppShell from '../layout/AppShell';
import SessionReplayPlayer from '../components/SessionReplayPlayer';
import { getReplayEvents } from '../api';
import { canOpenReplayPlayer, getReplayStats, replayKindLabel } from '../utils/replayStats';

/** Poll only while replay is still uploading / not yet playable — never during video playback. */
const SESSION_REPLAY_WAIT_REFRESH_MS = Number(import.meta.env.VITE_SESSION_REPLAY_REFRESH_MS) || 10000;

export default function SessionReplay() {
  const { sessionId } = useParams();
  const location = useLocation();
  const replayBackTo = parseReturnToLocation(location.search, location.state) ?? { pathname: '/sessions', search: '' };
  const replayBackLabel = getBackLabel(location.pathname, location.state, location.search);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period] = useState('overall');
  const events = data?.events || [];
  const rrwebStats = events.length ? getReplayStats(events) : null;
  const canPlayReplay = canOpenReplayPlayer(rrwebStats);
  /** Once playable, auto-refresh would remount the player and interrupt playback. */
  const waitForMoreChunks = !loading && !error && !canPlayReplay;
  const waitRefreshRef = useRef(waitForMoreChunks);
  waitRefreshRef.current = waitForMoreChunks;

  const loadReplay = useCallback(async ({ silent = false } = {}) => {
    if (!sessionId) {
      setLoading(false);
      setError('Missing session id in URL.');
      return;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const res = await getReplayEvents(sessionId, null, period);
      setData(res.data);
    } catch (err) {
      console.error('Failed to load session replay', err);
      if (!silent) {
        const timedOut = err.code === 'ECONNABORTED';
        const detail = err.response?.data?.detail;
        setError(
          timedOut
            ? 'Replay API timed out (90s). Restart API and ClickHouse ingest, or try a shorter session.'
            : detail || err.message || 'Failed to load replay',
        );
        setData(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId, period]);

  useEffect(() => {
    loadReplay();
  }, [loadReplay]);

  useEffect(() => {
    if (!sessionId || !waitForMoreChunks) return undefined;

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && waitRefreshRef.current) {
        loadReplay({ silent: true });
      }
    }, SESSION_REPLAY_WAIT_REFRESH_MS);

    return () => clearInterval(interval);
  }, [sessionId, waitForMoreChunks, loadReplay]);

  useEffect(() => {
    if (!waitForMoreChunks) return undefined;

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && waitRefreshRef.current) {
        loadReplay({ silent: true });
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [waitForMoreChunks, loadReplay]);

  const subtitle = data
    ? `Session ${sessionId} · ${data.chunk_count ?? 0} chunk(s) · ${data.event_count ?? events.length} event(s)${refreshing ? ' · Checking for new chunks…' : ''}`
    : `Session ${sessionId}${refreshing ? ' · Checking for new chunks…' : ''}`;

  return (
    <AppShell
      title="Session replay"
      subtitle={subtitle}
      headerActions={(
        <button
          type="button"
          className="btn btn-black"
          onClick={() => loadReplay({ silent: canPlayReplay })}
          disabled={loading || refreshing}
        >
          {loading || refreshing ? 'Loading…' : 'Refresh'}
        </button>
      )}
    >
      <div className="container container-in-shell">
        {error && <div className="card replay-error">{error}</div>}

        <div className="card replay-card">
          {loading && !error && <p>Loading replay…</p>}
          {!loading && data && events.length === 0 && !error && (
            <div className="replay-empty">
              <p>No replay records decoded for this session.</p>
              <p className="replay-empty-hint">
                {data.min_chunk_index > 0
                  ? `Only chunks from index ${data.min_chunk_index} onward were stored (earlier chunks lost). Record a new session via the demo page.`
                  : 'Waiting for replay chunks — this page checks every few seconds until video is ready. Use Reload if needed.'}
              </p>
              {data.replay_note && <p className="replay-empty-hint">{data.replay_note}</p>}
            </div>
          )}
          {!loading && data && events.length > 0 && !error && !canPlayReplay && (
            <div className="replay-empty">
              <p>This session cannot be played back.</p>
              <p className="replay-empty-hint">
                {rrwebStats
                  ? `${replayKindLabel(rrwebStats.recordingKind)} — ${rrwebStats.snapshots} snapshot(s), ${rrwebStats.incrementals} incremental event(s). A full DOM snapshot and at least one incremental update are required.`
                  : 'Missing rrweb snapshot or incremental events.'}
              </p>
              {data.replay_note && <p className="replay-empty-hint">{data.replay_note}</p>}
              <Link to={replayBackTo} className="btn btn-outline" style={{ marginTop: '1rem' }}>
                {`← Back to ${replayBackLabel.toLowerCase()}`}
              </Link>
            </div>
          )}
          {!loading && events.length > 0 && !error && canPlayReplay && (
            <SessionReplayPlayer events={events} note={data?.replay_note || null} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
