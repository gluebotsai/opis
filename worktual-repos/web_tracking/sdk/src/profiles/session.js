import { generateId } from '../utils/id.js';
import { isProfileSent, markProfileSent } from './store.js';
import { state } from '../core/state.js';
import * as identity from '../identity/index.js';

function referrerDomain(referrer) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname;
  } catch {
    return null;
  }
}

export function getSessionProfile() {
  const ids = identity.getIds();
  const ref = typeof document !== 'undefined' ? document.referrer || '' : '';
  return {
    id: ids.sessionId,
    startedAt: state.sessionStartedAt || Date.now(),
    landingPath: state.landingPath || window.location.pathname,
    landingUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    referrer: ref || 'direct',
    referrerDomain: referrerDomain(ref),
    title: typeof document !== 'undefined' ? document.title : undefined,
  };
}

export function sessionProfilePending(sessionId) {
  return !isProfileSent(`session_${sessionId}`);
}

export function markSessionProfileSent(sessionId) {
  markProfileSent(`session_${sessionId}`);
}

export function initSessionMeta() {
  if (!state.sessionStartedAt) {
    state.sessionStartedAt = Date.now();
    state.landingPath = window.location.pathname + window.location.search;
  }
}

export function rotateSessionMeta() {
  state.sessionStartedAt = Date.now();
  state.landingPath = window.location.pathname + window.location.search;
  state.pageViewId = generateId('pv');
}
