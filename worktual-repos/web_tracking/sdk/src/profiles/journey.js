import { state } from '../core/state.js';
import { registerCurrentPage } from './page.js';

let previousPageId = null;
let pageEnteredAt = Date.now();

export function onPageTransition(trackFn) {
  const toPageId = registerCurrentPage();
  const now = Date.now();
  const duration = previousPageId ? now - pageEnteredAt : 0;

  if (previousPageId && previousPageId !== toPageId) {
    trackFn('page_transition', {
      fromPageId: previousPageId,
      toPageId,
      duration,
    });
  }

  previousPageId = toPageId;
  pageEnteredAt = now;
  return toPageId;
}
