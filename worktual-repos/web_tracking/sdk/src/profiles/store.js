/** Local profile cache + sync flags (sent-once semantics). */

import { getStorage, setStorage } from '../utils/storage.js';

const PREFIX = 'wa_prof_';

/** @deprecated use isProfileSent */
export function getFlag(key) {
  return isProfileSent(key);
}

/** @deprecated use markProfileSent */
export function setFlag(key, value = true) {
  if (value) markProfileSent(key);
  else clearProfileSent(key);
}

/** Sent-once flag — separate from JSON cache keys (e.g. browser data vs browser sent). */
export function isProfileSent(key) {
  return getStorage(PREFIX + 'sent_' + key, 'local') === '1';
}

export function markProfileSent(key) {
  setStorage(PREFIX + 'sent_' + key, '1', 'local');
}

export function clearProfileSent(key) {
  setStorage(PREFIX + 'sent_' + key, '0', 'local');
}

export function clearSessionFlags(sessionId) {
  clearProfileSent(`session_${sessionId}`);
  clearProfileSent(`campaign_${sessionId}`);
}

export function readJson(key, storage = 'local') {
  try {
    const raw = getStorage(PREFIX + key, storage);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Legacy sent flags stored "1" in wa_prof_browser — ignore corrupt cache.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeJson(key, value, storage = 'local') {
  setStorage(PREFIX + key, JSON.stringify(value), storage);
}
