import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const TOOLTIP_PAD = 12;

const PALETTES = {
  click: { bg: ['#0c1222', '#111827'], heat: [[59, 130, 246], [236, 72, 153], [239, 68, 68]] },
  move: { bg: ['#071318', '#0c1929'], heat: [[8, 145, 178], [34, 211, 238], [165, 243, 252]] },
  scroll: { bg: ['#071510', '#0f1f17'], heat: [[22, 163, 74], [74, 222, 128], [187, 247, 208]] },
  rage_click: { bg: ['#140818', '#1a0f24'], heat: [[147, 51, 234], [192, 132, 252], [233, 213, 255]] },
  dead_click: { bg: ['#171208', '#1f1608'], heat: [[217, 119, 6], [251, 191, 36], [254, 243, 199]] },
  all: { bg: ['#0c1222', '#111827'], heat: [[59, 130, 246], [250, 204, 21], [239, 68, 68]] },
};

function heatColor(intensity, palette) {
  const t = Math.max(0, Math.min(1, intensity));
  const [low, mid, high] = palette;
  const pick = t <= 0.5
    ? low.map((c, i) => Math.round(c + (mid[i] - c) * (t / 0.5)))
    : mid.map((c, i) => Math.round(c + (high[i] - c) * ((t - 0.5) / 0.5)));
  const alpha = 0.35 + t * 0.55;
  return `rgba(${pick[0]}, ${pick[1]}, ${pick[2]}, ${alpha})`;
}

const GENERIC_ELEMENT_TAGS = new Set([
  'div', 'span', 'section', 'article', 'main', 'body', 'html', 'li', 'ul', 'ol', 'nav',
  'header', 'footer', 'img', 'svg', 'path', 'input', 'label', 'form', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

function inferHeatmapViewport(points, fallbackW, fallbackH) {
  let w = Math.max(1, fallbackW || 1280);
  let h = Math.max(1, fallbackH || 800);
  for (const p of points) {
    const pw = Number(p.viewport_w);
    const ph = Number(p.viewport_h);
    if (pw > 0) w = Math.max(w, pw);
    if (ph > 0) h = Math.max(h, ph);
    const x = Number(p.x);
    const y = Number(p.y);
    if (Number.isFinite(x) && x > 0) w = Math.max(w, Math.ceil(x) + 8);
    if (Number.isFinite(y) && y > 0) h = Math.max(h, Math.ceil(y) + 8);
  }
  return { w, h };
}

function normalizePoint(p, displayW, displayH, fallbackW, fallbackH) {
  const rawW = Number(p.viewport_w);
  const rawH = Number(p.viewport_h);
  const pw = rawW > 0 ? rawW : fallbackW;
  const ph = rawH > 0 ? rawH : fallbackH;
  const y = p.y ?? (p.scroll_depth != null && ph ? (p.scroll_depth / 100) * ph : null);
  const x = p.x ?? (pw ? pw / 2 : null);
  if (x == null || y == null || pw <= 0 || ph <= 0) return null;
  const nx = (Number(x) / pw) * displayW;
  const ny = (Number(y) / ph) * displayH;
  return {
    ...p,
    nx: Math.max(0, Math.min(displayW, nx)),
    ny: Math.max(0, Math.min(displayH, ny)),
    count: p.event_count ?? p.click_count ?? p.count ?? 1,
    visitors: p.visitor_count ?? 0,
    eventType: p.event_type,
  };
}

export function heatmapPointHoverLabel(point) {
  const text = String(point.element_text ?? '').trim();
  if (text) return text.length > 100 ? `${text.slice(0, 97)}…` : text;
  const tag = String(point.element || point.element_type || '').trim().toLowerCase();
  if (!tag || GENERIC_ELEMENT_TAGS.has(tag)) return null;
  if (tag === 'a') return 'Link';
  if (tag === 'button') return 'Button';
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function drawGrid(ctx, vw, vh, scale) {
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1 / scale;
  const step = 80;
  for (let x = 0; x <= vw; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, vh);
    ctx.stroke();
  }
  for (let y = 0; y <= vh; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(vw, y);
    ctx.stroke();
  }
}

function drawScrollBands(ctx, vw, vh, distribution, scale) {
  if (!distribution?.length) return;
  const maxVisitors = Math.max(1, ...distribution.map((d) => d.visitors || d.sessions || 0));
  const sorted = [...distribution].sort((a, b) => a.depth_pct - b.depth_pct);
  let prev = 0;
  sorted.forEach((band) => {
    const depth = band.depth_pct;
    const y0 = (prev / 100) * vh;
    const y1 = (depth / 100) * vh;
    const intensity = (band.visitors || band.sessions || 0) / maxVisitors;
    ctx.fillStyle = `rgba(34, 197, 94, ${0.08 + intensity * 0.45})`;
    ctx.fillRect(0, y0, vw, y1 - y0);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.font = `${11 / scale}px system-ui, sans-serif`;
    ctx.fillText(`${depth}%`, vw - 36 / scale, y1 - 4 / scale);
    prev = depth;
  });
}

export default function HeatmapCanvas({
  points = [],
  viewportW,
  viewportH,
  summary,
  eventType = 'click',
  scrollDistribution = [],
  visualization = 'coordinates',
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const layoutRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const [layout, setLayout] = useState({ scale: 1, tx: 0, ty: 0 });
  const [tooltip, setTooltip] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState({ left: 0, top: 0 });
  const tooltipRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });

  const palette = PALETTES[eventType] || PALETTES.click;
  const summaryW = viewportW || summary?.viewport_w || 0;
  const summaryH = viewportH || summary?.viewport_h || 0;
  const inferred = useMemo(
    () => inferHeatmapViewport(points, summaryW || 1280, summaryH || 800),
    [points, summaryW, summaryH],
  );
  const vw = inferred.w;
  const vh = inferred.h;

  const normalized = useMemo(
    () => points.map((p) => normalizePoint(p, vw, vh, vw, vh)).filter(Boolean),
    [points, vw, vh],
  );

  const maxCount = useMemo(
    () => Math.max(1, ...normalized.map((p) => p.count)),
    [normalized],
  );

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth || 800;
    const ch = Math.min(680, Math.max(320, Math.round(cw * (vh / vw))));
    const scale = Math.min(cw / vw, ch / vh);
    const next = { scale, tx: (cw - vw * scale) / 2, ty: (ch - vh * scale) / 2 };
    layoutRef.current = next;
    setLayout(next);
    setCanvasSize({ width: cw, height: ch });
  }, [vw, vh]);

  useEffect(() => {
    fitView();
    window.addEventListener('resize', fitView);
    return () => window.removeEventListener('resize', fitView);
  }, [fitView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvasSize;
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, palette.bg[0]);
    bg.addColorStop(1, palette.bg[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const { scale, tx, ty } = layout;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    drawGrid(ctx, vw, vh, scale);

    if (visualization === 'scroll_depth' || eventType === 'scroll') {
      drawScrollBands(ctx, vw, vh, scrollDistribution, scale);
    }

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeRect(0, 0, vw, vh);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = `600 ${13 / scale}px system-ui, sans-serif`;
    ctx.fillText(`${Math.round(vw)} × ${Math.round(vh)}`, 14 / scale, 22 / scale);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vw, vh);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';

    normalized.forEach((p) => {
      const intensity = p.count / maxCount;
      const baseRadius = eventType === 'move' ? 22 : 16;
      const radius = Math.min(56, baseRadius + Math.log(p.count + 1) * (eventType === 'move' ? 5 : 9));
      const gradient = ctx.createRadialGradient(p.nx, p.ny, 0, p.nx, p.ny, radius);
      const core = heatColor(intensity, palette.heat);
      gradient.addColorStop(0, core);
      gradient.addColorStop(0.55, core.replace(/[\d.]+\)$/, '0.25)'));
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.nx, p.ny, radius, 0, Math.PI * 2);
      ctx.fill();

      if (eventType === 'rage_click' || eventType === 'dead_click') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = eventType === 'rage_click' ? 'rgba(192, 132, 252, 0.9)' : 'rgba(251, 191, 36, 0.9)';
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.arc(p.nx, p.ny, 6 / scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
      }
    });

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    ctx.restore();
  }, [normalized, layout, canvasSize, vw, vh, maxCount, palette, eventType, scrollDistribution, visualization]);

  const screenToWorld = useCallback((clientX, clientY) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const { scale, tx, ty } = layoutRef.current;
    return { x: (sx - tx) / scale, y: (sy - ty) / scale };
  }, []);

  const findPoint = useCallback(
    (wx, wy) => {
      let best = null;
      let bestDist = Infinity;
      normalized.forEach((p) => {
        const dist = Math.hypot(p.nx - wx, p.ny - wy);
        const hit = Math.min(56, 16 + Math.log(p.count + 1) * 9);
        if (dist <= hit && dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      });
      return best;
    },
    [normalized],
  );

  const onMouseMove = (e) => {
    const world = screenToWorld(e.clientX, e.clientY);
    if (!world) return;
    const hit = findPoint(world.x, world.y);
    if (hit) {
      const rect = canvasRef.current.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      setTooltip({ anchorX, anchorY, point: hit });
      setTooltipStyle({
        left: anchorX + TOOLTIP_PAD,
        top: anchorY + TOOLTIP_PAD,
      });
    } else {
      setTooltip(null);
    }
  };

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current || !containerRef.current) return;

    const tipEl = tooltipRef.current;
    const container = containerRef.current;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    const { anchorX, anchorY } = tooltip;

    let left = anchorX + TOOLTIP_PAD;
    let top = anchorY + TOOLTIP_PAD;

    if (left + tw > cw - TOOLTIP_PAD) {
      left = anchorX - tw - TOOLTIP_PAD;
    }
    if (top + th > ch - TOOLTIP_PAD) {
      top = anchorY - th - TOOLTIP_PAD;
    }

    left = Math.max(TOOLTIP_PAD, Math.min(left, cw - tw - TOOLTIP_PAD));
    top = Math.max(TOOLTIP_PAD, Math.min(top, ch - th - TOOLTIP_PAD));

    setTooltipStyle((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [tooltip]);

  const eventLabel = {
    click: 'clicks',
    move: 'move samples',
    scroll: 'scroll events',
    rage_click: 'rage clicks',
    dead_click: 'dead clicks',
    all: 'interactions',
  }[eventType] || 'events';

  const tooltipHoverLabel = tooltip ? heatmapPointHoverLabel(tooltip.point) : null;

  return (
    <div className="heatmap-widget">
      <div ref={containerRef} className="heatmap-viewport heatmap-viewport-dark">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setTooltip(null)}
          className="heatmap-canvas heatmap-canvas-static"
        />
        {tooltip && (
          <div ref={tooltipRef} className="heatmap-tooltip" style={{ left: tooltipStyle.left, top: tooltipStyle.top }}>
            {tooltip.point.eventType && eventType === 'all' && (
              <div className="heatmap-tooltip-type">{tooltip.point.eventType.replace(/_/g, ' ')}</div>
            )}
            {tooltipHoverLabel && (
              <div className="heatmap-tooltip-text"><strong>{tooltipHoverLabel}</strong></div>
            )}
            {tooltip.point.scroll_depth != null && (
              <div>Scroll depth: {Math.round(tooltip.point.scroll_depth)}%</div>
            )}
            {tooltip.point.reason && eventType === 'dead_click' && (
              <div>Non-interactive target</div>
            )}
            <div>{tooltip.point.count} {eventLabel}</div>
            {tooltip.point.visitors > 0 && (
              <div>{tooltip.point.visitors} visitor{tooltip.point.visitors !== 1 ? 's' : ''}</div>
            )}
          </div>
        )}
      </div>
      <div className="heatmap-footer">
        <div className={`heatmap-legend heatmap-legend-${eventType}`} aria-hidden="true">
          <span>Cold</span>
          <div className="heatmap-legend-bar" />
          <span>Hot</span>
          <span className="heatmap-legend-max">peak {maxCount}</span>
        </div>
        <p className="heatmap-hint">Hover points for details</p>
      </div>
    </div>
  );
}
