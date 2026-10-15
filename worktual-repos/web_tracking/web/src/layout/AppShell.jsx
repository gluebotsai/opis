import { useRef } from 'react';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import CoWorkerMinimizedFab from '../components/CoWorkerMinimizedFab';
import CoWorkerPanel from '../components/CoWorkerPanel';
import CoWorkerSplitHandle from '../components/CoWorkerSplitHandle';
import { useCoWorker } from '../context/CoWorkerContext';

export default function AppShell({
  title,
  subtitle,
  headerActions,
  children,
  fullBleed = false,
}) {
  const { isSplit, isFullscreen, splitWidthPct } = useCoWorker();
  const mainRef = useRef(null);
  const coworkerOpen = isSplit || isFullscreen;

  return (
    <div className="app-shell">
      <Sidebar />
      <CoWorkerMinimizedFab />
      <div
        ref={mainRef}
        className={`app-shell-main${isSplit ? ' app-shell-main--split' : ''}${isFullscreen ? ' app-shell-main--fullscreen' : ''}`}
        style={{
          ...(isSplit ? {
            '--coworker-split-width': `${splitWidthPct}%`,
            '--coworker-split-width-pct': splitWidthPct,
          } : {}),
          ...(isFullscreen ? { '--coworker-split-width-pct': 100 } : {}),
        }}
      >
        {coworkerOpen && (
          <>
            <CoWorkerPanel />
            {isSplit && <CoWorkerSplitHandle containerRef={mainRef} />}
          </>
        )}
        {!isFullscreen && (
          <div className="app-shell-page">
            {(title || headerActions) && (
              <TopHeader title={title} subtitle={subtitle} actions={headerActions} />
            )}
            <main className={`app-shell-content${fullBleed ? ' app-shell-content-full-bleed' : ''}`}>
              {children}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
