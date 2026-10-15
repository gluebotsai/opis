import { config, state } from '../core/state.js';
import {
  RAGE_CLICK_THRESHOLD,
  RAGE_CLICK_WINDOW_MS,
  RAGE_CLICK_RADIUS_PX,
  DEAD_CLICK_DELAY_MS,
} from '../core/constants.js';
import { createTracker } from './tracker.js';
import { getElementInfo, getClickTarget } from './element-info.js';

const { bindTrack, track: heatmapTrackFn } = createTracker();
export { bindTrack };

const rageWindow = [];

function sample() {
  const rate = config?.heatmapSampleRate ?? 1;
  return rate >= 1 || Math.random() < rate;
}

function onHeatmapClick(e) {
  if (!sample()) return;
  const target = getClickTarget(e.target);
  heatmapTrackFn('click', {
    x: e.clientX,
    y: e.clientY,
    pageX: e.pageX,
    pageY: e.pageY,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    ...getElementInfo(target),
  });
  if (config?.trackRageClick !== false) detectRageClick(e);
  if (config?.trackDeadClick !== false) detectDeadClick(e, /** @type {HTMLElement} */ (e.target));
}

export function setupHeatmap() {
  if (!config?.trackHeatmap || state.modules.heatmap) return;

  const trackClicks = config?.trackHeatmapClicks !== false;
  const trackMove = config?.trackMove === true;
  const trackHover = config?.trackHover === true;

  if (!trackClicks && !trackMove && !trackHover) return;

  state.modules.heatmap = true;

  if (trackClicks) {
    document.addEventListener('click', onHeatmapClick, true);
  }

  if (trackMove) {
    let lastMove = { x: 0, y: 0, t: 0 };
    const minInterval = config?.moveSampleIntervalMs ?? 1000;
    const minPixels = config?.moveSampleMinPixels ?? 25;

    document.addEventListener('mousemove', (e) => {
      if (!sample()) return;
      const now = Date.now();
      const dx = Math.abs(e.clientX - lastMove.x);
      const dy = Math.abs(e.clientY - lastMove.y);
      if (now - lastMove.t < minInterval && dx < minPixels && dy < minPixels) return;
      lastMove = { x: e.clientX, y: e.clientY, t: now };
      heatmapTrackFn('move', {
        x: e.clientX,
        y: e.clientY,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      });
    }, { passive: true });
  }

  if (trackHover) {
    document.addEventListener('mouseover', (e) => {
      if (!sample()) return;
      heatmapTrackFn('hover', {
        x: e.clientX,
        y: e.clientY,
        ...getElementInfo(e.target),
      });
    }, { passive: true });
  }
}

function detectRageClick(e) {
  const now = Date.now();
  rageWindow.push({ x: e.clientX, y: e.clientY, t: now });
  while (rageWindow.length && now - rageWindow[0].t > RAGE_CLICK_WINDOW_MS) rageWindow.shift();

  if (rageWindow.length < RAGE_CLICK_THRESHOLD) return;

  const xs = rageWindow.map((point) => point.x);
  const ys = rageWindow.map((point) => point.y);
  const dx = Math.max(...xs) - Math.min(...xs);
  const dy = Math.max(...ys) - Math.min(...ys);

  if (dx < RAGE_CLICK_RADIUS_PX && dy < RAGE_CLICK_RADIUS_PX) {
    heatmapTrackFn('rage_click', { x: e.clientX, y: e.clientY, clickCount: rageWindow.length });
    rageWindow.length = 0;
  }
}

function detectDeadClick(e, element) {
  const interactive = element.closest?.('a,button,input,select,textarea,[onclick],[role=button]');
  if (interactive) return;

  setTimeout(() => {
    heatmapTrackFn('dead_click', { x: e.clientX, y: e.clientY, reason: 'non_interactive' });
  }, DEAD_CLICK_DELAY_MS);
}
