import { useCallback, useEffect, useRef } from 'react';
import { useCoWorker } from '../context/CoWorkerContext';

const MIN_PCT = 25;
const MAX_PCT = 75;

export default function CoWorkerSplitHandle({ containerRef }) {
  const { splitWidthPct, setSplitWidthPct } = useCoWorker();
  const dragRef = useRef({ active: false, startX: 0, startPct: 50 });

  const onPointerMove = useCallback(
    (e) => {
      if (!dragRef.current.active) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const width = rect.width || 1;
      const deltaPct = ((e.clientX - dragRef.current.startX) / width) * 100;
      const next = Math.min(MAX_PCT, Math.max(MIN_PCT, dragRef.current.startPct + deltaPct));
      setSplitWidthPct(next);
    },
    [containerRef, setSplitWidthPct],
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    document.body.classList.remove('coworker-split-dragging');
  }, []);

  const onPointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      dragRef.current = { active: true, startX: e.clientX, startPct: splitWidthPct };
      document.body.classList.add('coworker-split-dragging');
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [splitWidthPct],
  );

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.body.classList.remove('coworker-split-dragging');
    };
  }, [onPointerMove, endDrag]);

  return (
    <div
      className="coworker-split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(splitWidthPct)}
      aria-valuemin={MIN_PCT}
      aria-valuemax={MAX_PCT}
      aria-label="Resize co-worker panel"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
