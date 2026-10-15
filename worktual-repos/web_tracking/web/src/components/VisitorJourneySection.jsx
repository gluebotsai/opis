import { useEffect, useMemo, useState } from 'react';
import { formatLocalDateTime } from '../utils/formatDateTime';
import { formatPagePath } from '../utils/formatDisplayLabels';

/** Inline list scrolls after this many steps so the page stays usable. */
const JOURNEY_INLINE_SCROLL_AFTER = 10;

function stepDurationLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s on page`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem > 0 ? `${min}m ${rem}s on page` : `${min}m on page`;
  const hr = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${hr}h ${m}m on page` : `${hr}h on page`;
}

function journeyStepTime(step) {
  if (!step?.created_at) return 0;
  const ms = new Date(step.created_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function JourneyStepRow({ step, index, showIndex, showDuration, durationMs, compact }) {
  const pathLabel = formatPagePath(step.page_path);
  const title = (step.page_title ?? '').trim();

  return (
    <div className={`journey-step${compact ? ' journey-step--compact' : ''}`}>
      <div className="journey-step-body">
        {showIndex && (
          <span className="journey-step-index" aria-hidden="true">
            {index + 1}
          </span>
        )}
        <div className="journey-step-content">
          <strong className={compact ? 'journey-step-path--compact' : undefined}>{pathLabel}</strong>
          {title && (
            <span className="visitor-muted journey-step-title">
              {compact && title.length > 72 ? `${title.slice(0, 72)}…` : ` — ${title}`}
            </span>
          )}
          <div className="visitor-journey-time">{formatLocalDateTime(step.created_at)}</div>
          {showDuration && durationMs != null && (
            <div className="journey-step-duration">{stepDurationLabel(durationMs)}</div>
          )}
          {!compact && step.page_path && step.page_path !== pathLabel && (
            <code className="journey-step-raw-path">{step.page_path}</code>
          )}
        </div>
      </div>
    </div>
  );
}

function JourneyList({ steps, compact, showIndex, showDurations }) {
  return (
    <div className={`journey${compact ? ' journey--compact' : ''}`}>
      {steps.map((step, i) => {
        const next = steps[i + 1];
        const durationMs =
          showDurations && next
            ? journeyStepTime(next) - journeyStepTime(step)
            : null;
        return (
          <JourneyStepRow
            key={`${step.page_path}-${step.created_at}-${i}`}
            step={step}
            index={i}
            compact={compact}
            showIndex={showIndex}
            showDuration={showDurations && i < steps.length - 1}
            durationMs={durationMs}
          />
        );
      })}
    </div>
  );
}

function VisitorJourneyModal({ open, onClose, steps }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const firstAt = steps[0]?.created_at;
  const lastAt = steps[steps.length - 1]?.created_at;

  return (
    <div className="visitor-journey-modal-root" role="presentation">
      <button
        type="button"
        className="visitor-journey-modal-backdrop"
        aria-label="Close journey details"
        onClick={onClose}
      />
      <div
        className="visitor-journey-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visitor-journey-modal-title"
      >
        <header className="visitor-journey-modal-header">
          <div>
            <h2 id="visitor-journey-modal-title">Full user journey</h2>
            <p className="visitor-journey-modal-meta">
              {steps.length} step{steps.length === 1 ? '' : 's'}
              {firstAt && lastAt && firstAt !== lastAt && (
                <>
                  {' · '}
                  {formatLocalDateTime(firstAt)} → {formatLocalDateTime(lastAt)}
                </>
              )}
            </p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="visitor-journey-modal-body">
          <JourneyList steps={steps} compact={false} showIndex showDurations />
        </div>
      </div>
    </div>
  );
}

export default function VisitorJourneySection({ steps }) {
  const [modalOpen, setModalOpen] = useState(false);
  const journeySteps = useMemo(() => (Array.isArray(steps) ? steps : []), [steps]);
  const useScroll = journeySteps.length > JOURNEY_INLINE_SCROLL_AFTER;

  return (
    <section className="visitor-section">
      <h2 className="visitor-section-title">User Journey</h2>
      <div className="card visitor-journey-card">
        {!journeySteps.length && <p className="visitor-muted">No journey data.</p>}
        {journeySteps.length > 0 && (
          <>
            <div
              className={useScroll ? 'visitor-journey-inline-scroll' : undefined}
              aria-label={`${journeySteps.length} pages in visit order`}
            >
              <JourneyList steps={journeySteps} compact={false} showIndex={false} showDurations={false} />
            </div>
            <div className="journey-preview-footer">
              <p className="visitor-muted journey-preview-hint">
                {journeySteps.length} page{journeySteps.length === 1 ? '' : 's'} in order
                {useScroll ? ' · scroll the list above for earlier steps' : ''}.
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setModalOpen(true)}
              >
                View details (times on page)
              </button>
            </div>
          </>
        )}
      </div>
      <VisitorJourneyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        steps={journeySteps}
      />
    </section>
  );
}
