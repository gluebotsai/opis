import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'coworkerPanelState';
const SPLIT_WIDTH_KEY = 'coworkerSplitWidthPct';
const DEFAULT_SPLIT_WIDTH = 50;
const MIN_SPLIT_WIDTH = 25;
const MAX_SPLIT_WIDTH = 75;

function normalizeState(raw) {
  if (raw === 'split') return 'split';
  if (raw === 'fullscreen' || raw === 'overlay') return 'fullscreen';
  if (raw === 'minimized') return 'minimized';
  return 'closed';
}

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === 'minimized') return 'minimized';
  } catch {
    /* ignore */
  }
  return 'closed';
}

function loadSplitWidth() {
  try {
    const raw = sessionStorage.getItem(SPLIT_WIDTH_KEY);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(MAX_SPLIT_WIDTH, Math.max(MIN_SPLIT_WIDTH, n));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SPLIT_WIDTH;
}

const CoWorkerContext = createContext(null);

export function CoWorkerProvider({ children }) {
  const [panelState, setPanelStateRaw] = useState(loadState);
  const [splitWidthPct, setSplitWidthPctRaw] = useState(loadSplitWidth);
  const setPanelState = useCallback((next) => {
    setPanelStateRaw(normalizeState(next));
  }, []);

  const setSplitWidthPct = useCallback((pct) => {
    const clamped = Math.min(MAX_SPLIT_WIDTH, Math.max(MIN_SPLIT_WIDTH, pct));
    setSplitWidthPctRaw(clamped);
  }, []);

  useEffect(() => {
    try {
      if (panelState === 'minimized') {
        sessionStorage.setItem(STORAGE_KEY, 'minimized');
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [panelState]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SPLIT_WIDTH_KEY, String(splitWidthPct));
    } catch {
      /* ignore */
    }
  }, [splitWidthPct]);

  const openChat = useCallback(() => setPanelStateRaw('split'), []);
  const minimizeChat = useCallback(() => setPanelStateRaw('minimized'), []);
  const closeChat = useCallback(() => setPanelStateRaw('closed'), []);

  const value = useMemo(
    () => ({
      panelState,
      setPanelState,
      splitWidthPct,
      setSplitWidthPct,
      openChat,
      minimizeChat,
      closeChat,
      isMinimized: panelState === 'minimized',
      isSplit: panelState === 'split',
      isFullscreen: panelState === 'fullscreen',
      isClosed: panelState === 'closed',
    }),
    [
      panelState,
      setPanelState,
      splitWidthPct,
      setSplitWidthPct,
      openChat,
      minimizeChat,
      closeChat,
    ],
  );

  return (
    <CoWorkerContext.Provider value={value}>
      {children}
    </CoWorkerContext.Provider>
  );
}

export function useCoWorker() {
  const ctx = useContext(CoWorkerContext);
  if (!ctx) {
    throw new Error('useCoWorker must be used within CoWorkerProvider');
  }
  return ctx;
}
