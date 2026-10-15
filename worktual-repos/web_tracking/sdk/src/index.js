import { mergeConfig } from './core/config.js';
import { config, state, resetState, SDK_VERSION, setConfig } from './core/state.js';
import { buildEvent } from './core/context.js';
import { emit, clearHooks } from './core/event-bus.js';
import { log } from './core/logger.js';
import * as identity from './identity/index.js';
import { isTrackingAllowed, sanitizeProperties, setConsent, stripCredentials } from './privacy/consent.js';
import { queueEvent, flushQueue, startBatchTimer, destroyTransport } from './transport/sender.js';
import { initProfiles, requestLocation, getLocationPermissionState } from './profiles/index.js';
import { rotateSessionMeta } from './profiles/session.js';
import * as auto from './tracking/auto.js';
import * as heatmap from './tracking/heatmap.js';
import * as forms from './tracking/forms.js';
import * as leadForms from './tracking/lead-forms.js';
import * as performance from './performance/index.js';
import * as errors from './errors/index.js';
import * as ecommerce from './ecommerce/index.js';
import * as ratings from './ratings/index.js';
import * as heartbeat from './tracking/heartbeat.js';
import { setupSessionReplay, teardownSessionReplay } from './replay/recorder.js';
import { registerPlugin } from './plugins/index.js';
import { initClientIp } from './utils/client-ip.js';

function bindModules() {
  const trackRef = track;
  auto.bindTrack(trackRef);
  heatmap.bindTrack(trackRef);
  forms.bindTrack(trackRef);
  leadForms.bindTrack(trackRef);
  performance.bindTrack(trackRef);
  errors.bindTrack(trackRef);
  ecommerce.bindTrack(trackRef);
  ratings.bindTrack(trackRef);
  heartbeat.bindTrack(trackRef);
}

function bootstrapTracking() {
  if (!state.initialized || !isTrackingAllowed()) return;

  if (!state.modules.bootstrapped) {
    state.modules.bootstrapped = true;
    identity.initIdentity();
    initProfiles();
    initClientIp();
  }
  startTracking();
}

function startTracking() {
  if (!state.initialized || !isTrackingAllowed() || state.modules.tracking) return;
  state.modules.tracking = true;

  if (config.autoTrack !== false) auto.setupAutoTracking();
  if (config.trackHeatmap !== false) heatmap.setupHeatmap();
  if (config.trackForms !== false) {
    forms.setupFormTracking();
    leadForms.setupLeadFormTracking();
  }
  if (config.trackPerformance !== false) performance.setupPerformance();
  if (config.trackErrors !== false) errors.setupErrorTracking();
  if (config.trackHeartbeat !== false) heartbeat.setupHeartbeat();
  if (config.trackReplay !== false) setupSessionReplay();
  startBatchTimer();
}

function stopTracking() {
  if (!state.modules.tracking) return;
  teardownSessionReplay();
  auto.teardownAutoTracking();
  state.modules.tracking = false;
}

function updateConsent(options = {}) {
  const wasAllowed = isTrackingAllowed();
  const result = setConsent(options);
  const nowAllowed = isTrackingAllowed();
  if (nowAllowed && !wasAllowed) bootstrapTracking();
  else if (!nowAllowed && wasAllowed) stopTracking();
  return result;
}

/** @param {Partial<import('./core/config.js').SdkConfig>} userConfig */
function init(userConfig = {}) {
  if (state.initialized) {
    log('already initialized');
    return api;
  }
  const merged = mergeConfig(userConfig);
  setConfig(merged);
  if (merged.consent && typeof merged.consent === 'object') {
    setConsent(merged.consent);
  }

  bindModules();
  state.initialized = true;

  if (isTrackingAllowed()) {
    bootstrapTracking();
  } else if (merged.debug) {
    log('tracking blocked — consent.analytics is false');
  }

  log('initialized', SDK_VERSION);
  return api;
}

/** @param {string} name @param {Record<string, unknown>} [properties] */
function track(name, properties = {}) {
  if (state.paused || !state.initialized) return;
  if (!isTrackingAllowed()) return;

  if (name === 'page_view') {
    const path = window.location.pathname + window.location.search;
    if (state.trackedPagePath === path) return;
    state.trackedPagePath = path;
  }

  let event = buildEvent(name, sanitizeProperties(properties));
  emit('beforeTrack', event).then((result) => {
    if (result === false) return;
    if (result && typeof result === 'object') event = /** @type {typeof event} */ (result);
    queueEvent(event);
    emit('afterTrack', event);
  });
  identity.touchSession();
}

/** @param {string} [name] @param {Record<string, unknown>} [props] */
function page(name, props = {}) {
  auto.trackPageView(name, props);
}

/** @param {string} userId @param {Record<string, unknown>} [traits] */
function identify(userId, traits = {}) {
  const result = identity.identify(userId, traits);
  track('identify', { userId, traits: stripCredentials(traits), previousAnonymousId: result?.previousAnon });
}

/** @param {string} oldId @param {string} newId */
function alias(oldId, newId) {
  identity.alias(oldId, newId);
  track('alias', { oldId, newId });
}

/** @param {string} groupId @param {Record<string, unknown>} [props] */
function group(groupId, props = {}) {
  identity.group(groupId, props);
  track('group', { groupId, ...stripCredentials(props) });
}

/** @param {Record<string, unknown>} props */
function login(props = {}) {
  const { userId, ...traits } = props;
  if (userId) identify(String(userId), traits);
  track('login', stripCredentials({ userId, ...traits }));
}

function logout() {
  track('logout', {});
  identity.resetIdentity();
}

/** @param {Record<string, unknown>} props */
function registerUser(props = {}) {
  track('register', stripCredentials(props));
  if (props.userId) identify(String(props.userId), props);
}

/** @deprecated Use register() — kept for older integrations. */
function signup(props = {}) {
  registerUser(props);
}

/** @param {Record<string, unknown>} traits */
function setUserProperties(traits = {}) {
  state.userTraits = { ...state.userTraits, ...stripCredentials(traits) };
  track('user_properties', { traits: state.userTraits });
}

function flush() {
  return flushQueue();
}

function reset() {
  identity.newSession();
  rotateSessionMeta();
  state.trackedPagePath = null;
  auto.trackPageView();
}

function pause() {
  state.paused = true;
}

function resume() {
  state.paused = false;
}

function destroy() {
  stopTracking();
  destroyTransport();
  clearHooks();
  state.initialized = false;
  state.modules.bootstrapped = false;
  resetState();
}

function getVisitorId() {
  return identity.getIds().visitorId;
}

function getSessionId() {
  return identity.getIds().sessionId;
}

function getUserId() {
  return identity.getIds().userId;
}

function formSuccess(formId, props = {}) {
  leadForms.trackLeadFormSuccess(formId, props);
}

function formFailure(formId, props = {}) {
  leadForms.trackLeadFormFailure(formId, props);
}

function registerLeadForm(opts) {
  return leadForms.registerLeadForm(opts);
}

const api = {
  init,
  track,
  page,
  identify,
  alias,
  group,
  login,
  logout,
  register: registerUser,
  signup,
  setUserProperties,
  setConsent: updateConsent,
  requestLocation,
  getLocationPermissionState,
  flush,
  reset,
  pause,
  resume,
  destroy,
  registerPlugin,
  getVisitorId,
  getSessionId,
  getUserId,
  formSuccess,
  formFailure,
  registerLeadForm,
  productView: ecommerce.productView,
  addToCart: ecommerce.addToCart,
  removeFromCart: ecommerce.removeFromCart,
  addToWishlist: ecommerce.addToWishlist,
  removeFromWishlist: ecommerce.removeFromWishlist,
  beginCheckout: ecommerce.beginCheckout,
  paymentFailure: ecommerce.paymentFailure,
  purchase: ecommerce.purchase,
  refund: ecommerce.refund,
  productRating: ratings.productRating,
  productRatings: ratings.productRatings,
  version: SDK_VERSION,
};

export default api;

if (typeof window !== 'undefined') {
  window.WorktualAnalytics = api;
}
