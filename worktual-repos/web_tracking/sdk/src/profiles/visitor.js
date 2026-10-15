import { isProfileSent, markProfileSent } from './store.js';
import { getBrowserProfile } from './browser.js';
import * as identity from '../identity/index.js';
import { state } from '../core/state.js';

export function getVisitorProfile() {
  const ids = identity.getIds();
  const browser = getBrowserProfile();
  return {
    id: ids.visitorId,
    anonymousId: ids.anonymousId,
    userId: ids.userId || undefined,
    fingerprint: browser.fingerprint,
    traits: Object.keys(state.userTraits || {}).length ? { ...state.userTraits } : undefined,
  };
}

export function visitorProfilePending() {
  return !isProfileSent('visitor');
}

export function markVisitorProfileSent() {
  markProfileSent('visitor');
}
