import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCoWorker } from '../context/CoWorkerContext';

/** Close split view when navigating — split opens from the floating co-worker icon. */
export default function CoWorkerRouteSync() {
  const { pathname } = useLocation();
  const { panelState, closeChat } = useCoWorker();
  const prevPathname = useRef(pathname);
  const panelStateRef = useRef(panelState);

  panelStateRef.current = panelState;

  useEffect(() => {
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;
    if (panelStateRef.current === 'split' || panelStateRef.current === 'fullscreen') {
      closeChat();
    }
  }, [pathname, closeChat]);

  return null;
}
