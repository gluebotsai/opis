import { useCallback, useEffect, useRef, useState } from 'react';
import { LOGO_URL } from '../brand';
import { useCoWorker } from '../context/CoWorkerContext';

const POS_KEY = 'coworkerFloatPos';
/** Matches Worktual `--control-height` (38px). */
const FLOAT_SIZE = 38;
const FLOAT_MARGIN = 20;
const CORNER_SNAP_PX = 28;

function defaultPos() {
  if (typeof window === 'undefined') return { x: FLOAT_MARGIN, y: FLOAT_MARGIN };
  return {
    x: window.innerWidth - FLOAT_SIZE - FLOAT_MARGIN,
    y: window.innerHeight - FLOAT_SIZE - FLOAT_MARGIN,
  };
}

function clampPos(pos) {
  if (typeof window === 'undefined') return pos;
  return {
    x: Math.min(Math.max(FLOAT_MARGIN, pos.x), window.innerWidth - FLOAT_SIZE - FLOAT_MARGIN),
    y: Math.min(Math.max(FLOAT_MARGIN, pos.y), window.innerHeight - FLOAT_SIZE - FLOAT_MARGIN),
  };
}

function isNearBottomRight(pos) {
  if (typeof window === 'undefined') return true;
  const target = defaultPos();
  return Math.abs(pos.x - target.x) <= CORNER_SNAP_PX && Math.abs(pos.y - target.y) <= CORNER_SNAP_PX;
}

function loadSavedPos() {
  try {
    const raw = sessionStorage.getItem(POS_KEY) || sessionStorage.getItem('coworkerMiniPos');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function CoWorkerMinimizedFab() {
  const { panelState, openChat, setPanelState } = useCoWorker();
  const [pos, setPos] = useState(() => {
    const saved = loadSavedPos();
    if (!saved) return defaultPos();
    const clamped = clampPos(saved);
    return isNearBottomRight(clamped) ? defaultPos() : clamped;
  });
  /** When true, pin to bottom-right via CSS so resize never drifts the FAB. */
  const [anchored, setAnchored] = useState(() => {
    const saved = loadSavedPos();
    if (!saved) return true;
    return isNearBottomRight(clampPos(saved));
  });
  const dragRef = useRef({ active: false, moved: false, offsetX: 0, offsetY: 0, startX: 0, startY: 0 });
  const boxRef = useRef(null);

  const showFloat = panelState === 'closed' || panelState === 'minimized';

  useEffect(() => {
    if (!showFloat) return;
    try {
      if (anchored) {
        sessionStorage.removeItem(POS_KEY);
        sessionStorage.removeItem('coworkerMiniPos');
      } else {
        sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
      }
    } catch {
      /* ignore */
    }
  }, [showFloat, pos, anchored]);

  useEffect(() => {
    if (!showFloat) return;
    const onResize = () => {
      if (anchored) {
        setPos(defaultPos());
        return;
      }
      setPos((p) => {
        const next = clampPos(p);
        if (isNearBottomRight(next)) {
          setAnchored(true);
          return defaultPos();
        }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showFloat, anchored]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      active: true,
      moved: false,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
    };
    // Switch from CSS bottom/right anchoring to explicit left/top for drag.
    setAnchored(false);
    setPos({ x: rect.left, y: rect.top });
    boxRef.current?.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    const dx = Math.abs(e.clientX - dragRef.current.startX);
    const dy = Math.abs(e.clientY - dragRef.current.startY);
    if (dx > 4 || dy > 4) dragRef.current.moved = true;

    setPos(
      clampPos({
        x: e.clientX - dragRef.current.offsetX,
        y: e.clientY - dragRef.current.offsetY,
      }),
    );
  }, []);

  const onPointerUp = useCallback(
    (e) => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      boxRef.current?.releasePointerCapture?.(e.pointerId);
      if (!dragRef.current.moved) {
        if (panelState === 'minimized') {
          setPanelState('split');
        } else {
          openChat();
        }
        return;
      }
      setPos((p) => {
        const next = clampPos(p);
        if (isNearBottomRight(next)) {
          setAnchored(true);
          return defaultPos();
        }
        setAnchored(false);
        return next;
      });
    },
    [openChat, panelState, setPanelState],
  );

  if (!showFloat) return null;

  const style = anchored
    ? { right: FLOAT_MARGIN, bottom: FLOAT_MARGIN, left: 'auto', top: 'auto', width: FLOAT_SIZE, height: FLOAT_SIZE }
    : { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto', width: FLOAT_SIZE, height: FLOAT_SIZE };

  return (
    <div
      ref={boxRef}
      className="coworker-float-launcher"
      style={style}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="coworker-float-launcher-tip" role="tooltip">
        I&apos;m your co-worker
      </span>
      <button
        type="button"
        className="coworker-float-launcher-btn"
        aria-label="Open co-worker — drag to move"
        onPointerDown={onPointerDown}
      >
        <img src={LOGO_URL} alt="" />
      </button>
    </div>
  );
}
