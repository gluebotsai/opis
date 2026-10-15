import { useRef } from 'react';
import { LOGO_URL } from '../brand';
import { useCoWorker } from '../context/CoWorkerContext';
import ChatInterface from './ChatInterface';

export default function CoWorkerPanel() {
  const { setPanelState, isSplit, isFullscreen } = useCoWorker();
  const chatRef = useRef(null);

  if (!isSplit && !isFullscreen) return null;

  const closePanel = () => setPanelState('minimized');

  return (
    <div
      className={`coworker-panel${isSplit ? ' coworker-panel--split' : ''}${isFullscreen ? ' coworker-panel--fullscreen' : ''}`}
      role="region"
      aria-label="Worktual co-worker"
    >
      <div className="coworker-panel-header">
        <div className="coworker-panel-title">
          <span className="coworker-panel-logo">
            <img src={LOGO_URL} alt="" />
          </span>
          <span>Worktual co-worker</span>
        </div>
        <div className="coworker-panel-actions">
          <button
            type="button"
            className="coworker-action-btn"
            aria-label="New conversation"
            title="New conversation"
            onClick={() => chatRef.current?.resetSession()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button
            type="button"
            className={`coworker-action-btn${isFullscreen ? ' is-active' : ''}`}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen co-worker'}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={() => setPanelState(isFullscreen ? 'split' : 'fullscreen')}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m14 10 7-7" />
                <path d="M20 10h-6V4" />
                <path d="m3 21 7-7" />
                <path d="M4 14h6v6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="coworker-action-btn"
            aria-label="Co-worker options"
            title="Options"
            onClick={() => chatRef.current?.focusInput()}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.75" />
              <circle cx="12" cy="12" r="1.75" />
              <circle cx="19" cy="12" r="1.75" />
            </svg>
          </button>
          <button
            type="button"
            className="coworker-action-btn"
            aria-label="Close co-worker panel"
            title="Close"
            onClick={closePanel}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="coworker-panel-body">
        <ChatInterface
          ref={chatRef}
          mode="embedded"
          showSuggestions={false}
          suppressWelcome
          embeddedPlaceholder="Ask about any customer, segment, journey or channel…"
        />
      </div>
    </div>
  );
}
