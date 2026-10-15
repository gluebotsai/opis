import { generateId } from '../utils/id.js';
import { getStorage, setStorage, removeStorage } from '../utils/storage.js';
import { config, state } from '../core/state.js';
import { rotateSessionMeta } from '../profiles/session.js';
import { clearSessionFlags } from '../profiles/store.js';
import { getOrCreateVisitorId } from './shared-visitor-id.js';

const ANON_KEY = 'wa_anonymous_id';
const USER_KEY = 'wa_user_id';
const SESSION_KEY = 'wa_session_id';
const SESSION_ACTIVITY_KEY = 'wa_session_activity';
const GROUP_KEY = 'wa_group_id';

let visitorId = null;
let sessionId = null;
let userId = null;
let anonymousId = null;
let groupId = null;

function sessionTimeoutMs() {
  return (config?.sessionTimeoutMinutes || 30) * 60 * 1000;
}

export function initIdentity() {
  visitorId = getOrCreateVisitorId();

  anonymousId = getStorage(ANON_KEY) || generateId('anon');
  setStorage(ANON_KEY, anonymousId);

  userId = getStorage(USER_KEY) || null;
  groupId = getStorage(GROUP_KEY) || null;

  rotateSessionIfNeeded();
}

function rotateSessionIfNeeded() {
  const lastActivity = parseInt(getStorage(SESSION_ACTIVITY_KEY, 'session') || '0', 10);
  const now = Date.now();
  const existing = getStorage(SESSION_KEY, 'session');

  if (!existing || !lastActivity || now - lastActivity > sessionTimeoutMs()) {
    sessionId = generateId('session');
    setStorage(SESSION_KEY, sessionId, 'session');
    clearSessionFlags(existing || sessionId);
    rotateSessionMeta();
  } else {
    sessionId = existing;
  }
  touchSession();
}

export function touchSession() {
  setStorage(SESSION_ACTIVITY_KEY, String(Date.now()), 'session');
}

export function getIds() {
  return { visitorId, sessionId, userId, anonymousId, groupId };
}

/** @param {string} id @param {Record<string, unknown>} [traits] */
export function identify(id, traits = {}) {
  if (!id) return;
  const previousAnon = anonymousId;
  userId = String(id);
  setStorage(USER_KEY, userId);
  if (traits && typeof traits === 'object') {
    state.userTraits = { ...state.userTraits, ...traits };
  }
  return { previousAnon, userId };
}

/** @param {string} oldId @param {string} newId */
export function alias(oldId, newId) {
  return { oldId, newId, merged: true };
}

/** @param {string} id @param {Record<string, unknown>} [props] */
export function group(id, props = {}) {
  groupId = String(id);
  setStorage(GROUP_KEY, groupId);
  state.groupTraits = { ...state.groupTraits, ...props };
  return groupId;
}

/** Clear known user only — keeps visitorId, sessionId, and anonymousId (used by logout()). */
export function resetIdentity() {
  userId = null;
  groupId = null;
  removeStorage(USER_KEY);
  removeStorage(GROUP_KEY);
  state.userTraits = {};
  state.groupTraits = {};
  touchSession();
}

export function newSession() {
  sessionId = generateId('session');
  setStorage(SESSION_KEY, sessionId, 'session');
  clearSessionFlags(sessionId);
  rotateSessionMeta();
  touchSession();
  return sessionId;
}

