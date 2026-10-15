import { uuidV4 } from '../utils/id.js';
import { getStorage, setStorage } from '../utils/storage.js';

/** Shared with Worktual Webchat on the same origin. */
export const SHARED_VISITOR_STORAGE_KEY = 'wt_visitor_id';

/** @returns {string} visitor_<uuid> */
export function createVisitorId() {
  return `visitor_${uuidV4()}`;
}

/**
 * Reuse wt_visitor_id from localStorage when present (e.g. Webchat already set it).
 * Otherwise create visitor_<uuid> and persist under the same key.
 * @returns {string}
 */
export function getOrCreateVisitorId() {
  const existing = String(getStorage(SHARED_VISITOR_STORAGE_KEY) || '').trim();
  const visitorId = existing || createVisitorId();
  setStorage(SHARED_VISITOR_STORAGE_KEY, visitorId);
  return visitorId;
}
