import { config } from './state.js';

/** @param {...unknown} args */
export function log(...args) {
  if (config?.debug) {
    console.log('[WorktualAnalytics]', ...args);
  }
}

/** @param {...unknown} args */
export function warn(...args) {
  if (config?.debug) {
    console.warn('[WorktualAnalytics]', ...args);
  }
}

/** @param {...unknown} args */
export function error(...args) {
  console.error('[WorktualAnalytics]', ...args);
}
