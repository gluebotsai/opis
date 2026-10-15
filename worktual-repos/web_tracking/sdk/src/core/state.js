/** @typedef {import('../core/config.js').SdkConfig} SdkConfig */

export const SDK_VERSION = '3.0.1';

/** @type {import('./config.js').SdkConfig | null} */
export let config = null;

export function setConfig(c) {
  config = c;
}

export const state = {
  initialized: false,
  paused: false,
  pageViewId: null,
  pageId: null,
  sessionId: null,
  trackedPagePath: null,
  lastNavigationPath: null,
  sessionStartedAt: null,
  landingPath: null,
  engagementStart: Date.now(),
  idleStart: null,
  isActive: true,
  listeners: [],
  modules: {},
  userTraits: {},
  groupTraits: {},
};

export function resetState() {
  state.pageViewId = null;
  state.pageId = null;
  state.sessionStartedAt = null;
  state.landingPath = null;
  state.trackedPagePath = null;
  state.lastNavigationPath = null;
  state.engagementStart = Date.now();
  state.idleStart = null;
  state.isActive = true;
  state.userTraits = {};
  state.groupTraits = {};
}
