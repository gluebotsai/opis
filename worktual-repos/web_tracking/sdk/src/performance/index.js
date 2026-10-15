import { config, state } from '../core/state.js';
import { createTracker } from '../tracking/tracker.js';

const { bindTrack, track: perfTrackFn } = createTracker();
export { bindTrack };

export function setupPerformance() {
  if (!config?.trackPerformance || state.modules.performance) return;
  state.modules.performance = true;

  const vitals = { lcp: null, cls: 0, inp: null, fcp: null, ttfb: null };
  let vitalsSent = false;

  const sendVitalsOnce = () => {
    if (vitalsSent) return;
    vitalsSent = true;
    perfTrackFn('performance_vitals', {
      lcp: vitals.lcp,
      cls: vitals.cls,
      inp: vitals.inp,
      fcp: vitals.fcp,
      ttfb: vitals.ttfb,
      lcpRating: vitals.lcp != null ? rateLcp(vitals.lcp) : undefined,
      clsRating: rateCls(vitals.cls),
      inpRating: vitals.inp != null ? rateInp(vitals.inp) : undefined,
    });
  };

  if ('PerformanceObserver' in window) {
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) vitals.lcp = last.startTime;
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* unsupported */ }

    try {
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(/** @type {LayoutShift} */ (entry)).hadRecentInput) {
            vitals.cls += /** @type {LayoutShift} */ (entry).value;
          }
        }
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
    } catch { /* unsupported */ }

    try {
      let maxInp = 0;
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = entry.duration || entry.processingStart - entry.startTime;
          if (duration > maxInp) maxInp = duration;
        }
        vitals.inp = maxInp;
      });
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch { /* unsupported */ }
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) vitals.ttfb = nav.responseStart - nav.requestStart;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      if (fcp) vitals.fcp = fcp.startTime;
    }, 0);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendVitalsOnce();
  });
  window.addEventListener('pagehide', sendVitalsOnce);
}

function rateLcp(value) {
  if (value <= 2500) return 'good';
  if (value <= 4000) return 'needs_improvement';
  return 'poor';
}

function rateCls(value) {
  if (value <= 0.1) return 'good';
  if (value <= 0.25) return 'needs_improvement';
  return 'poor';
}

function rateInp(value) {
  if (value <= 200) return 'good';
  if (value <= 500) return 'needs_improvement';
  return 'poor';
}
