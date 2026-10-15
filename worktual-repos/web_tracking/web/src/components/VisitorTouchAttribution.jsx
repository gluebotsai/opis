import { formatLocalDateTime } from '../utils/formatDateTime';
import { formatDuration } from '../utils/formatDuration';
import { formatPagePath, formatPagePathTitle } from '../utils/formatDisplayLabels';

function TouchDetailRows({ touch }) {
  if (!touch) return null;
  return (
    <>
      <div className="detail-item">
        <span className="key">Channel</span>
        <span>{touch.channel_label || '—'}</span>
      </div>
      <div className="detail-item">
        <span className="key">Source</span>
        <span>{touch.source_label || '—'}</span>
      </div>
      {touch.utm_source && (
        <div className="detail-item">
          <span className="key">UTM Source</span>
          <span>{touch.utm_source}</span>
        </div>
      )}
      {touch.utm_medium && (
        <div className="detail-item">
          <span className="key">UTM Medium</span>
          <span>{touch.utm_medium}</span>
        </div>
      )}
      {touch.utm_campaign && (
        <div className="detail-item">
          <span className="key">UTM Campaign</span>
          <span>{touch.utm_campaign}</span>
        </div>
      )}
      {touch.referrer && (
        <div className="detail-item">
          <span className="key">Referrer</span>
          <span className="visitor-detail-mono">{touch.referrer}</span>
        </div>
      )}
      {touch.click_id && (
        <div className="detail-item">
          <span className="key">{String(touch.click_id_type || 'click_id').toUpperCase()}</span>
          <span className="visitor-detail-mono">{touch.click_id}</span>
        </div>
      )}
      {touch.captured_at && (
        <div className="detail-item">
          <span className="key">Captured</span>
          <span>{formatLocalDateTime(touch.captured_at)}</span>
        </div>
      )}
    </>
  );
}

function SessionAttributionRow({ session, index }) {
  const touch = session.touch ?? {};
  const channel = touch.channel_label || 'Unknown';
  const source = touch.source_label || '—';

  return (
    <li className="visitor-session-attrib-item">
      <div className="visitor-session-attrib-head">
        <span className="visitor-session-attrib-num">Session {index + 1}</span>
        <span className="visitor-session-attrib-time">{formatLocalDateTime(session.started_at)}</span>
      </div>
      <div className="visitor-session-attrib-channels">
        <span className="visitor-channel-pill">{channel}</span>
        <span className="visitor-session-attrib-source">{source}</span>
      </div>
      <div className="visitor-session-attrib-meta">
        <span>{Number(session.pageview_count ?? 0)} pages</span>
        <span>·</span>
        <span>{formatDuration(Number(session.duration_seconds ?? 0))}</span>
        {session.entry_page && (
          <>
            <span>·</span>
            <span title={session.entry_page}>Entry {formatPagePath(session.entry_page)}</span>
          </>
        )}
        {Number(session.is_bounce) ? (
          <>
            <span>·</span>
            <span
              className="visitor-session-attrib-bounce"
              title={formatPagePathTitle(session.bounce_page || session.entry_page)}
            >
              Bounced {formatPagePath(session.bounce_page || session.entry_page)}
            </span>
          </>
        ) : null}
      </div>
      {(touch.utm_campaign || touch.utm_medium) && (
        <div className="visitor-session-attrib-utm visitor-muted">
          {[touch.utm_source, touch.utm_medium, touch.utm_campaign].filter(Boolean).join(' · ')}
        </div>
      )}
    </li>
  );
}

function sourceJourneyFromSessions(sessions) {
  const ordered = [...sessions].sort(
    (a, b) => new Date(String(a.started_at ?? 0)).getTime() - new Date(String(b.started_at ?? 0)).getTime(),
  );
  const steps = [];
  for (const session of ordered) {
    const touch = session.touch ?? {};
    const sourceLabel = touch.source_label || touch.channel_label || 'Unknown';
    const channelLabel = touch.channel_label || 'Unknown';
    const last = steps[steps.length - 1];
    if (last && last.source_label === sourceLabel) {
      last.session_count += 1;
      continue;
    }
    steps.push({ source_label: sourceLabel, channel_label: channelLabel, session_count: 1 });
  }
  return {
    steps,
    path_label: steps.length ? steps.map((s) => s.source_label).join(' → ') : '—',
  };
}

export default function VisitorTouchAttribution({ attribution, sessions = [] }) {
  if (!attribution) return null;

  const { first_touch: firstTouch, last_touch: lastTouch, source_journey: sourceJourney } = attribution;
  const orderedSessions = [...sessions].sort(
    (a, b) => new Date(String(a.started_at ?? 0)).getTime() - new Date(String(b.started_at ?? 0)).getTime(),
  );
  const journey =
    sourceJourney?.steps?.length || sourceJourney?.path_label
      ? sourceJourney
      : sourceJourneyFromSessions(orderedSessions);

  return (
    <section className="visitor-section">
      <h2 className="visitor-section-title">Touch attribution</h2>

      <div className="detail-grid visitor-touch-grid">
        <div className="card visitor-touch-card">
          <h3>First touch (visitor)</h3>
          <TouchDetailRows touch={firstTouch} />
        </div>

        <div className="card visitor-touch-card">
          <h3>Last touch (visitor)</h3>
          <TouchDetailRows touch={lastTouch} />
        </div>

        <div className="card visitor-touch-card visitor-touch-journey">
          <h3>Source journey</h3>
          <p className="visitor-muted visitor-analytics-card-hint">
            Ordered by session start; consecutive sessions with the same source are shown once.
          </p>
          {journey.steps?.length ? (
            <ol className="visitor-source-journey-list">
              {journey.steps.map((step, index) => (
                <li key={`${step.source_label}-${index}`} className="visitor-source-journey-step">
                  <span className="visitor-source-journey-index">{index + 1}</span>
                  <span className="visitor-channel-pill">{step.channel_label}</span>
                  <span className="visitor-source-journey-label">{step.source_label}</span>
                  {step.session_count > 1 ? (
                    <span className="visitor-muted visitor-source-journey-count">
                      ×{step.session_count} sessions
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="visitor-muted">—</p>
          )}
          {journey.path_label && journey.path_label !== '—' && (
            <div className="detail-item visitor-source-journey-path">
              <span className="key">Summary</span>
              <span className="visitor-touch-path">{journey.path_label}</span>
            </div>
          )}
        </div>
      </div>

      {orderedSessions.length > 0 && (
        <div className="card visitor-session-attrib-card">
          <h3>Attribution by session</h3>
          <p className="visitor-muted visitor-analytics-card-hint">
            Each row is how that session started (referrer / UTM on session entry).
          </p>
          <ul className="visitor-session-attrib-list">
            {orderedSessions.map((session, index) => (
              <SessionAttributionRow
                key={session.session_id ?? `${session.started_at}-${index}`}
                session={session}
                index={index}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
