/*! WorktualAnalytics v3.0.0 | (c) Worktual */
/** @typedef {import('../core/config.js').SdkConfig} SdkConfig */

const SDK_VERSION = '3.0.1';

/** @type {import('./config.js').SdkConfig | null} */
let config = null;

function setConfig(c) {
  config = c;
}

const state = {
  initialized: false,
  paused: false,
  pageViewId: null,
  pageId: null,
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

function resetState() {
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

const DEFAULTS = {
  websiteId: null,
  websiteUrl: typeof window !== 'undefined' ? window.location.hostname : '',
  organizationId: null,
  endpoint: 'https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions',
  /** When null, replay uses the same URL as endpoint (single ingest path). */
  replayEndpoint: null,
  compressPayloads: false,
  autoTrack: true,
  trackForms: true,
  /** Per-event form tracking — submit/success/failure on by default for AJAX login/register. */
  trackFormSubmit: true,
  trackFormView: false,
  trackFormStart: false,
  trackFormFocus: false,
  trackFormBlur: false,
  trackFormChange: false,
  trackFormValidation: false,
  trackFormSuccess: true,
  trackFormFailure: true,
  trackFormAbandon: false,
  trackPerformance: false,
  trackHeatmap: true,
  trackHeatmapClicks: true,
  trackMove: false,
  trackHover: false,
  trackScroll: true,
  trackRageClick: true,
  trackDeadClick: true,
  trackErrors: false,
  trackEcommerce: true,
  trackJourney: true,
  trackHeartbeat: true,
  batching: true,
  batchInterval: 10_000,
  batchSize: 50,
  /** Send first page_view (and queued events) immediately instead of waiting batchInterval. */
  flushOnFirstPageView: true,
  /** Flush ecommerce events immediately instead of waiting batchInterval. */
  flushOnEcommerce: true,
  sessionTimeoutMinutes: 30,
  heatmapSampleRate: 1,
  moveSampleIntervalMs: 1000,
  moveSampleMinPixels: 25,
  scrollMilestones: [25, 50, 75, 90, 100],
  heartbeatIntervalMs: 30_000,
  debug: false,
  respectDNT: false,
  respectGPC: false,
  offlineQueue: true,
  flushOnUnload: true,
  resendProfiles: true,
  geolocation: true,
  geolocationPrompt: true,
  geolocationRefresh: true,
  geolocationHighAccuracy: true,
  geolocationTimeout: 15000,
  geolocationMaxAge: 60000,
  fetchClientIp: true,
  clientIpUrl: 'https://getip.worktual.co.uk/',
  leadFormAutoScan: true,
  leadFormHeuristicScan: true,
  leadForms: [],
  trackReplay: true,
  sessionReplay: true,
  replaySampleRate: 1,
  replayChunkIntervalMs: 2000,
  replayMaxEventsPerChunk: 25,
  replayCheckoutEveryNms: 30_000,
  replayBlockClass: 'wt-no-replay',
  replayMaskTextClass: 'wt-mask',
  replayMaskAllInputs: false,
  replayInlineStylesheet: true,
  replayRecordCanvas: false,
  /** Throttle ms for cursor path — false disables. 100–150 is enough for video replay. */
  replaySampleMousemove: 100,
  replaySampleMouseInteraction: true,
  replaySampleScroll: 150,
  /** rrweb UMD on production CDN; localhost still uses /vendor/rrweb via recorder.js when unset at runtime. */
  replayScriptUrl:
    'https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/vendor/rrweb/rrweb.min.js',
  /** Shared with Campaign backend `WEB_TRACKING_HMAC_SECRET` — decodes ?wt= email click tokens. Override in init() for prod. */
  webTrackingHmacSecret: 'change-me-web-tracking-hmac-secret-min-32-chars',
  /** Remove `?wt=` from the address bar after capture. */
  stripCampaignTokenFromUrl: true,
  /** On by default — attach script + init() starts tracking. Set analytics:false or setConsent({ analytics: false }) to opt out. */
  consent: { analytics: true, marketing: true },
};

/** @typedef {typeof DEFAULTS & { consent?: { analytics?: boolean; marketing?: boolean } }} SdkConfig */

/** @param {Partial<SdkConfig>} userConfig @returns {SdkConfig} */
function mergeConfig(userConfig = {}) {
  const merged = { ...DEFAULTS, ...userConfig, sdkVersion: SDK_VERSION };

  // Accept legacy init keys (domainId/domainName) — maps to websiteId/websiteUrl only.
  if (!merged.websiteId) {
    merged.websiteId =
      merged.domainId ?? merged.domain_id ?? merged.website_id ?? null;
  }
  if (userConfig.website_url != null && userConfig.website_url !== '') {
    merged.websiteUrl = userConfig.website_url;
  } else if (userConfig.domainName != null && userConfig.domainName !== '') {
    merged.websiteUrl = userConfig.domainName;
  } else if (userConfig.domain_name != null && userConfig.domain_name !== '') {
    merged.websiteUrl = userConfig.domain_name;
  } else if (merged.websiteUrl == null || merged.websiteUrl === '') {
    merged.websiteUrl = merged.website_url ?? null;
  }
  if (merged.organization_id != null && merged.organizationId == null) {
    merged.organizationId = merged.organization_id;
  }
  if (userConfig.web_tracking_hmac_secret != null && userConfig.webTrackingHmacSecret == null) {
    merged.webTrackingHmacSecret = userConfig.web_tracking_hmac_secret;
  }

  delete merged.website_id;
  delete merged.website_url;
  delete merged.domain_id;
  delete merged.domain_name;
  delete merged.organization_id;
  delete merged.web_tracking_hmac_secret;

  if (!merged.websiteId) {
    throw new Error('WorktualAnalytics.init: websiteId is required');
  }
  return merged;
}

/** @returns {string} */
function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36)}`;
}

/** @returns {string} */
function uuidV4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getPageContext() {
  const loc = window.location;
  return {
    url: loc.href,
    path: loc.pathname + loc.search,
    title: document.title || '',
    referrer: document.referrer || '',
    hash: loc.hash || '',
  };
}

function isOutboundLink(href) {
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  try {
    const url = new URL(href, window.location.origin);
    return url.hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

function isDownloadLink(href) {
  if (!href) return false;
  return /\.(pdf|zip|doc|docx|xls|xlsx|csv|ppt|pptx|mp3|mp4|avi|mov|dmg|exe|pkg)(\?|$)/i.test(href);
}

/** @type {Map<string, object>} */
const registry = new Map();

function registerCurrentPage() {
  const page = getPageContext();
  const path = page.path;
  if (state.pageId && registry.get(state.pageId)?.path === path) {
    return state.pageId;
  }
  const id = generateId('pg');
  registry.set(id, { path: page.path, title: page.title, url: page.url });
  state.pageId = id;
  return id;
}

function collectNewPageProfiles(batchPageIds, resend = false) {
  const pages = {};
  for (const pid of batchPageIds) {
    const page = registry.get(pid);
    if (page && (resend || !page.sent)) {
      pages[pid] = { path: page.path, title: page.title };
    }
  }
  return Object.keys(pages).length ? pages : undefined;
}

function markPageProfilesSent(pages) {
  if (!pages) return;
  for (const pid of Object.keys(pages)) {
    const page = registry.get(pid);
    if (page) page.sent = true;
  }
}

/** Minimal synchronous SHA-256 + HMAC-SHA256 (browser-safe, no dependencies). */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function toUtf8Bytes(input) {
  return new TextEncoder().encode(String(input));
}

/** @param {Uint8Array} data @returns {Uint8Array} */
function sha256(data) {
  const msg = data instanceof Uint8Array ? data : toUtf8Bytes(data);
  const bitLen = msg.length * 8;
  const padLen = ((56 - ((msg.length + 1) % 64)) + 64) % 64;
  const padded = new Uint8Array(msg.length + 1 + padLen + 8);
  padded.set(msg);
  padded[msg.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLen, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    const view = new DataView(padded.buffer, padded.byteOffset + offset, 64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
    let e = h[4]; let f = h[5]; let g = h[6]; let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return out;
}

/** @param {string|Uint8Array} key @param {string|Uint8Array} message @returns {Uint8Array} */
function hmacSha256(key, message) {
  const keyBytes = typeof key === 'string' ? toUtf8Bytes(key) : key;
  const msgBytes = typeof message === 'string' ? toUtf8Bytes(message) : message;

  let normalizedKey = keyBytes;
  if (normalizedKey.length > 64) normalizedKey = sha256(normalizedKey);

  const block = new Uint8Array(64);
  block.set(normalizedKey);

  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = block[i] ^ 0x36;
    opad[i] = block[i] ^ 0x5c;
  }

  const inner = new Uint8Array(ipad.length + msgBytes.length);
  inner.set(ipad);
  inner.set(msgBytes, ipad.length);
  const innerHash = sha256(inner);

  const outer = new Uint8Array(opad.length + innerHash.length);
  outer.set(opad);
  outer.set(innerHash, opad.length);
  return sha256(outer);
}

/**
 * Decode Worktual Campaign email click tokens (?wt= query param).
 * Format: 30 chars = org(6) + campaign(6) + contact(12) + sig(6)
 * Spec: docs/WEB_TRACKING_LINK_DECODE.md
 */


const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const WT_TOKEN_RE = /^[0-9A-Za-z]{30}$/;

/** @param {string} seg @returns {bigint} */
function base62Decode(seg) {
  let n = 0n;
  for (const ch of seg) {
    const idx = BASE62.indexOf(ch);
    if (idx < 0) throw new Error('invalid base62');
    n = n * 62n + BigInt(idx);
  }
  return n;
}

/** @param {bigint|number} value @param {number} width @returns {string} */
function base62EncodePad(value, width) {
  let n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) n = -n;
  if (n === 0n) return '0'.repeat(width);
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(width, '0');
}

/** @param {bigint|number} value @returns {string} */
function base62EncodePad6(value) {
  return base62EncodePad(value, 6);
}

/** @param {Uint8Array} digest @returns {string} */
function digestFirst4ToSigSegment(digest) {
  const n = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  return base62EncodePad6(BigInt(n));
}

/** @param {string} secret @param {string} message @returns {string} */
function hmacSigToBase62(secret, message) {
  return digestFirst4ToSigSegment(hmacSha256(secret, message));
}

/** @param {string} token */
function isValidWtToken(token) {
  return Boolean(token && WT_TOKEN_RE.test(token));
}

/**
 * @param {string} token
 * @returns {{ O: string, C: string, U: string, sig: string } | null}
 */
function splitWtToken(token) {
  if (!isValidWtToken(token)) return null;
  return {
    O: token.slice(0, 6),
    C: token.slice(6, 12),
    U: token.slice(12, 24),
    sig: token.slice(24, 30),
  };
}

/**
 * @param {string} token
 * @returns {{ valid: boolean, organizationId?: bigint, campaignId?: bigint, contactId?: bigint }}
 */
function decodeSegmentsFromToken(token) {
  const parts = splitWtToken(token);
  if (!parts) return { valid: false };
  try {
    return {
      valid: true,
      organizationId: base62Decode(parts.O),
      campaignId: base62Decode(parts.C),
      contactId: base62Decode(parts.U),
    };
  } catch {
    return { valid: false };
  }
}

/** Base62 decode only — QA when HMAC secret is not configured. */
function decodeWebTrackingTokenSegments(token) {
  return decodeSegmentsFromToken(token);
}

/** HMAC-verified decode — production when webTrackingHmacSecret is set. */
function parseWebTrackingToken(token, secret) {
  if (!secret) return { valid: false };
  const parts = splitWtToken(token);
  if (!parts) return { valid: false };

  const message = `${parts.O}|${parts.C}|${parts.U}`;
  try {
    if (hmacSigToBase62(secret, message) !== parts.sig) return { valid: false };
    return {
      valid: true,
      organizationId: base62Decode(parts.O),
      campaignId: base62Decode(parts.C),
      contactId: base62Decode(parts.U),
    };
  } catch {
    return { valid: false };
  }
}

/** Raw ?wt= value (any length) — for URL cleanup. */
function getWtQueryParam(search = '') {
  const params = new URLSearchParams(
    search || (typeof window !== 'undefined' ? window.location.search : ''),
  );
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase() === 'wt' && value) return value.trim();
  }
  return null;
}

/** Read token from ?wt= (30 base62 chars only). */
function extractWtToken(search = '') {
  const fromQuery = getWtQueryParam(search);
  if (fromQuery && isValidWtToken(fromQuery)) return fromQuery;
  return null;
}

/** @param {bigint} n @returns {number|string} */
function bigintToId(n) {
  const num = Number(n);
  return Number.isSafeInteger(num) ? num : n.toString();
}

/** Contact id from token; omit when decoded value is 0. */
function contactIdFromSegment(contactId) {
  const id = bigintToId(contactId);
  if (id === 0 || id === '0') return undefined;
  return id;
}

/** First-touch and latest-touch campaign / click-id attribution. */


const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const CLICK_IDS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 'twclid', 'gbraid', 'wbraid', 'li_fat_id'];
const WT_KEYS = ['wt_organization_id', 'wt_campaign_id', 'wt_contact_id'];

/**
 * @param {string} [search]
 * @param {string} [referrer]
 * @param {{ hmacSecret?: string|null }} [options]
 */
function parseAttribution(
  search = typeof window !== 'undefined' ? window.location.search : '',
  referrer = typeof document !== 'undefined' ? document.referrer || '' : '',
  options = {},
) {
  const params = new URLSearchParams(search);
  const touch = { referrer: referrer || undefined, capturedAt: Date.now() };

  for (const key of UTM_KEYS) {
    const val = params.get(key);
    if (val) touch[key] = val;
  }
  for (const key of CLICK_IDS) {
    const val = params.get(key);
    if (val) touch[key] = val;
  }

  const wt = extractWtToken(search);
  if (wt) {
    const decoded = options.hmacSecret
      ? parseWebTrackingToken(wt, options.hmacSecret)
      : decodeWebTrackingTokenSegments(wt);
    if (decoded.valid) {
      touch.wt_organization_id = bigintToId(decoded.organizationId);
      touch.wt_campaign_id = bigintToId(decoded.campaignId);
      const contactId = contactIdFromSegment(decoded.contactId);
      if (contactId != null) touch.wt_contact_id = contactId;
    } else if (options.hmacSecret) {
      touch._wt_decode_failed = true;
    }
  }

  return touch;
}

function hasAttribution(touch) {
  if (!touch) return false;
  return (
    UTM_KEYS.some((k) => touch[k])
    || CLICK_IDS.some((k) => touch[k])
    || WT_KEYS.some((k) => touch[k] != null && touch[k] !== '')
    || !!touch.referrer
  );
}

function carryForwardWtIds(incoming, existing) {
  if (!incoming || !existing) return incoming;
  const source = existing.lastTouch || existing.firstTouch;
  if (!source) return incoming;

  const touch = { ...incoming };
  for (const key of WT_KEYS) {
    if ((touch[key] == null || touch[key] === '') && source[key] != null && source[key] !== '') {
      touch[key] = source[key];
    }
  }
  return touch;
}

function mergeAttribution(existing, incoming) {
  if (!hasAttribution(incoming)) return existing;
  const enriched = carryForwardWtIds(incoming, existing);
  const first = existing?.firstTouch || enriched;
  return {
    id: existing?.id,
    firstTouch: first,
    lastTouch: enriched,
  };
}

/** True when URL still has a ?wt= query param (strip even if token format is invalid). */
function hasCampaignTokenInUrl(
  search = typeof window !== 'undefined' ? window.location.search : '',
) {
  return !!getWtQueryParam(search);
}

function getStorage(key, storage = 'local') {
  try {
    const store = storage === 'session' ? sessionStorage : localStorage;
    return store.getItem(key);
  } catch {
    return null;
  }
}

function setStorage(key, value, storage = 'local') {
  try {
    const store = storage === 'session' ? sessionStorage : localStorage;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key, storage = 'local') {
  try {
    const store = storage === 'session' ? sessionStorage : localStorage;
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Local profile cache + sync flags (sent-once semantics). */


const PREFIX = 'wa_prof_';

/** Sent-once flag — separate from JSON cache keys (e.g. browser data vs browser sent). */
function isProfileSent(key) {
  return getStorage(PREFIX + 'sent_' + key, 'local') === '1';
}

function markProfileSent(key) {
  setStorage(PREFIX + 'sent_' + key, '1', 'local');
}

function clearProfileSent(key) {
  setStorage(PREFIX + 'sent_' + key, '0', 'local');
}

function clearSessionFlags(sessionId) {
  clearProfileSent(`session_${sessionId}`);
  clearProfileSent(`campaign_${sessionId}`);
}

function readJson(key, storage = 'local') {
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

function writeJson(key, value, storage = 'local') {
  setStorage(PREFIX + key, JSON.stringify(value), storage);
}

/** @param {...unknown} args */
function log(...args) {
  if (config?.debug) {
    console.log('[WorktualAnalytics]', ...args);
  }
}

/** @param {...unknown} args */
function warn(...args) {
  if (config?.debug) {
    console.warn('[WorktualAnalytics]', ...args);
  }
}

const CAMPAIGN_PROFILE_KEY = 'campaign';
const STRIP_FLAG_KEY = 'wt_url_stripped';

function stripCampaignParamsFromUrl() {
  if (typeof window === 'undefined' || config?.stripCampaignTokenFromUrl === false) return;
  if (sessionStorage.getItem(STRIP_FLAG_KEY)) return;
  if (!hasCampaignTokenInUrl()) return;

  const url = new URL(window.location.href);
  url.searchParams.delete('wt');

  const next = url.pathname + url.search + url.hash;
  history.replaceState(history.state, document.title, next);
  sessionStorage.setItem(STRIP_FLAG_KEY, '1');
}

function getCampaignProfile() {
  const stored = readJson(CAMPAIGN_PROFILE_KEY) || {};
  const incoming = parseAttribution(undefined, undefined, {
    hmacSecret: config?.webTrackingHmacSecret,
  });
  const rawWt = getWtQueryParam();
  if (rawWt && !isValidWtToken(rawWt)) {
    warn(
      `WorktualAnalytics: ?wt= ignored — expected 30 base62 chars, got ${rawWt.length}. ` +
        'Campaign must use v2 tokens. Check CDN SDK is latest build.',
    );
  } else if (incoming._wt_decode_failed) {
    warn(
      'WorktualAnalytics: ?wt= present but HMAC verify failed — wt_campaign_id / wt_contact_id not set. ' +
        'Ensure Campaign WEB_TRACKING_HMAC_SECRET matches SDK webTrackingHmacSecret.',
    );
    delete incoming._wt_decode_failed;
  }
  if (!hasAttribution(incoming) && !stored.firstTouch) {
    if (hasCampaignTokenInUrl()) stripCampaignParamsFromUrl();
    return null;
  }

  const merged = mergeAttribution(stored, incoming);
  if (!merged.id) merged.id = stored.id || generateId('cp');
  writeJson(CAMPAIGN_PROFILE_KEY, merged);

  if (hasCampaignTokenInUrl()) {
    stripCampaignParamsFromUrl();
  }

  return merged;
}

/** Capture campaign attribution on init (before SPA routers may strip query params). */
function primeCampaignProfile() {
  getCampaignProfile();
}

/** Campaign profile is attached on every ingest batch when attribution exists. */

/** Shared SDK constants — transport, storage, and tracking thresholds. */

const PAYLOAD_TYPE_V3 = 'events_v3';

const BEACON_MAX_BYTES = 60_000;
const HTTP_STATUS_DUPLICATE = 409;

const OFFLINE_DRAIN_BATCH = 20;
const OFFLINE_QUEUE_MAX = 500;
const OFFLINE_STORE_MAX = 50;

const RAGE_CLICK_THRESHOLD = 3;
const RAGE_CLICK_WINDOW_MS = 1000;
const RAGE_CLICK_RADIUS_PX = 30;
const DEAD_CLICK_DELAY_MS = 300;

const USER_IDLE_MS = 30_000;

const SEARCH_QUERY_MAX_LEN = 200;
const ELEMENT_TEXT_MAX_LEN = 100;

const ERROR_STACK_MAX_LEN = 2000;

function referrerDomain(referrer) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname;
  } catch {
    return null;
  }
}

function getSessionProfile() {
  const ids = getIds();
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

function sessionProfilePending(sessionId) {
  return !isProfileSent(`session_${sessionId}`);
}

function markSessionProfileSent(sessionId) {
  markProfileSent(`session_${sessionId}`);
}

function initSessionMeta() {
  if (!state.sessionStartedAt) {
    state.sessionStartedAt = Date.now();
    state.landingPath = window.location.pathname + window.location.search;
  }
}

function rotateSessionMeta() {
  state.sessionStartedAt = Date.now();
  state.landingPath = window.location.pathname + window.location.search;
  state.pageViewId = generateId('pv');
}

/** Shared with Worktual Webchat on the same origin. */
const SHARED_VISITOR_STORAGE_KEY = 'wt_visitor_id';

/** @returns {string} visitor_<uuid> */
function createVisitorId() {
  return `visitor_${uuidV4()}`;
}

/**
 * Reuse wt_visitor_id from localStorage when present (e.g. Webchat already set it).
 * Otherwise create visitor_<uuid> and persist under the same key.
 * @returns {string}
 */
function getOrCreateVisitorId() {
  const existing = String(getStorage(SHARED_VISITOR_STORAGE_KEY) || '').trim();
  const visitorId = existing || createVisitorId();
  setStorage(SHARED_VISITOR_STORAGE_KEY, visitorId);
  return visitorId;
}

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

function initIdentity() {
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

function touchSession() {
  setStorage(SESSION_ACTIVITY_KEY, String(Date.now()), 'session');
}

function getIds() {
  return { visitorId, sessionId, userId, anonymousId, groupId };
}

/** @param {string} id @param {Record<string, unknown>} [traits] */
function identify$1(id, traits = {}) {
  if (!id) return;
  const previousAnon = anonymousId;
  userId = String(id);
  setStorage(USER_KEY, userId);
  if (traits && typeof traits === 'object') {
    state.userTraits = { ...state.userTraits, ...traits };
  }
  return { previousAnon, userId };
}

/** @param {string} id @param {Record<string, unknown>} [props] */
function group$1(id, props = {}) {
  groupId = String(id);
  setStorage(GROUP_KEY, groupId);
  state.groupTraits = { ...state.groupTraits, ...props };
  return groupId;
}

/** Clear known user only — keeps visitorId, sessionId, and anonymousId (used by logout()). */
function resetIdentity() {
  userId = null;
  groupId = null;
  removeStorage(USER_KEY);
  removeStorage(GROUP_KEY);
  state.userTraits = {};
  state.groupTraits = {};
  touchSession();
}

function newSession() {
  sessionId = generateId('session');
  setStorage(SESSION_KEY, sessionId, 'session');
  clearSessionFlags(sessionId);
  rotateSessionMeta();
  touchSession();
  return sessionId;
}

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';

function parseBrowser(ua) {
  if (/Edg\//.test(ua)) return { name: 'Edge', version: ua.match(/Edg\/([\d.]+)/)?.[1] || '' };
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return { name: 'Chrome', version: ua.match(/Chrome\/([\d.]+)/)?.[1] || '' };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', version: ua.match(/Firefox\/([\d.]+)/)?.[1] || '' };
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return { name: 'Safari', version: ua.match(/Version\/([\d.]+)/)?.[1] || '' };
  return { name: 'Other', version: '' };
}

function parseOS(ua) {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

function parseDevice(ua) {
  if (/Mobile|Android|iPhone/.test(ua)) return 'mobile';
  if (/iPad|Tablet/.test(ua)) return 'tablet';
  return 'desktop';
}

function getDeviceContext() {
  const browser = parseBrowser(UA);
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    browser: browser.name,
    browserVersion: browser.version,
    engine: /WebKit/.test(UA) ? 'WebKit' : 'Other',
    os: parseOS(UA),
    device: parseDevice(UA),
    language: navigator.language || '',
    languages: navigator.languages ? [...navigator.languages] : [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    dpr: window.devicePixelRatio || 1,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    cpu: navigator.hardwareConcurrency || null,
    memory: navigator.deviceMemory || null,
    connection: conn
      ? { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt }
      : null,
    userAgent: UA,
  };
}

/** Static browser/device profile — generated once per visitor. */


const BROWSER_PROFILE_KEY = 'browser';

function fingerprint(device) {
  const parts = [
    device.browser,
    device.browserVersion,
    device.os,
    device.device,
    device.language,
    device.timezone,
    device.screen?.width,
    device.screen?.height,
    device.dpr,
    device.cpu,
    device.touch ? 1 : 0,
  ].join('|');
  let h = 0;
  for (let i = 0; i < parts.length; i++) h = ((h << 5) - h + parts.charCodeAt(i)) | 0;
  return `fp_${Math.abs(h).toString(36)}`;
}

function isValidBrowserProfile(cached) {
  return cached && typeof cached === 'object' && typeof cached.browser === 'string';
}

function getBrowserProfile(force = false) {
  const cached = readJson(BROWSER_PROFILE_KEY);
  if (isValidBrowserProfile(cached) && !force) return cached;

  const device = getDeviceContext();
  const profile = {
    id: isValidBrowserProfile(cached) ? cached.id : generateId('br'),
    fingerprint: fingerprint(device),
    userAgent: device.userAgent,
    browser: device.browser,
    browserVersion: device.browserVersion,
    engine: device.engine,
    os: device.os,
    device: device.device,
    language: device.language,
    languages: device.languages,
    timezone: device.timezone,
    screen: device.screen,
    viewport: device.viewport,
    dpr: device.dpr,
    touch: device.touch,
    cpu: device.cpu,
    memory: device.memory,
    connection: device.connection,
  };
  writeJson(BROWSER_PROFILE_KEY, profile);
  return profile;
}

function browserProfilePending() {
  return !isProfileSent(BROWSER_PROFILE_KEY);
}

function markBrowserProfileSent() {
  markProfileSent(BROWSER_PROFILE_KEY);
}

function getVisitorProfile() {
  const ids = getIds();
  const browser = getBrowserProfile();
  return {
    id: ids.visitorId,
    anonymousId: ids.anonymousId,
    userId: ids.userId || undefined,
    fingerprint: browser.fingerprint,
    traits: Object.keys(state.userTraits || {}).length ? { ...state.userTraits } : undefined,
  };
}

function visitorProfilePending() {
  return !isProfileSent('visitor');
}

function markVisitorProfileSent() {
  markProfileSent('visitor');
}

let consent = { analytics: null, marketing: null };

const SENSITIVE_KEYS = /password|passwd|pwd|otp|token|access_token|refresh_token|cvv|cvc|card_number|cardnumber|secret|ssn|pin/i;
const SENSITIVE_TYPES = new Set(['password', 'hidden']);

function setConsent(options = {}) {
  const next = {
    analytics: consent.analytics,
    marketing: consent.marketing,
  };
  if ('analytics' in options) {
    next.analytics = options.analytics === true ? true : options.analytics === false ? false : null;
  }
  if ('marketing' in options) {
    next.marketing = options.marketing === true ? true : options.marketing === false ? false : null;
  } else if ('analytics' in options && options.analytics === true) {
    next.marketing = true;
  } else if ('analytics' in options && options.analytics === false) {
    next.marketing = false;
  }
  consent = next;
  config.consent = consent;
  return consent;
}

function isTrackingAllowed() {
  const analyticsConsent = consent.analytics ?? config?.consent?.analytics;
  if (analyticsConsent !== true) {
    return false;
  }
  if (config?.respectDNT && (navigator.doNotTrack === '1' || window.doNotTrack === '1')) {
    return false;
  }
  if (config?.respectGPC && navigator.globalPrivacyControl === true) {
    return false;
  }
  return true;
}

/** @param {Record<string, unknown>} obj */
function sanitizeProperties(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeProperties(/** @type {Record<string, unknown>} */ (value));
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
function shouldMaskField(el) {
  if (!el) return true;
  if (SENSITIVE_TYPES.has(el.type)) return true;
  if (el.autocomplete && SENSITIVE_KEYS.test(el.autocomplete)) return true;
  if (el.name && SENSITIVE_KEYS.test(el.name)) return true;
  if (el.id && SENSITIVE_KEYS.test(el.id)) return true;
  return false;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
function maskFieldValue(el) {
  if (shouldMaskField(el)) return '[MASKED]';
  const val = el.value;
  if (val && val.length > 100) return val.slice(0, 100) + '…';
  return val;
}

/** @param {Record<string, unknown>} props */
function stripCredentials(props) {
  return sanitizeProperties(props);
}

const LOCATION_KEY = 'location';
/** @type {Promise<Record<string, unknown>>|null} */
let pendingRequest = null;

function hasGeolocationApi() {
  return typeof navigator !== 'undefined' && typeof navigator.geolocation?.getCurrentPosition === 'function';
}

function getLocationProfile() {
  return readJson(LOCATION_KEY);
}

function locationProfilePending() {
  const profile = getLocationProfile();
  if (!profile || profile.permission !== 'granted') return false;
  return !isProfileSent('location');
}

function markLocationProfileSent() {
  markProfileSent('location');
}

/** @param {GeolocationPosition} position */
function buildProfile(position) {
  return {
    source: 'gps',
    permission: 'granted',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude ?? null,
    altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
    heading: position.coords.heading ?? null,
    speed: position.coords.speed ?? null,
    capturedAt: Date.now(),
  };
}

/**
 * Ask the browser for GPS coordinates. Resolves when the user allows or denies.
 * @param {{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }} [options]
 */
function requestLocation(options = {}) {
  if (!hasGeolocationApi()) {
    return Promise.resolve({ source: 'gps', permission: 'unsupported', capturedAt: Date.now() });
  }
  if (!isTrackingAllowed()) {
    return Promise.resolve({ source: 'gps', permission: 'denied', reason: 'consent', capturedAt: Date.now() });
  }

  const opts = {
    enableHighAccuracy: options.enableHighAccuracy ?? config?.geolocationHighAccuracy ?? true,
    timeout: options.timeout ?? config?.geolocationTimeout ?? 15000,
    maximumAge: options.maximumAge ?? config?.geolocationMaxAge ?? 60000,
  };

  if (pendingRequest) return pendingRequest;

  pendingRequest = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const profile = buildProfile(position);
        writeJson(LOCATION_KEY, profile);
        pendingRequest = null;
        if (config?.debug) log('geolocation granted', profile.latitude, profile.longitude);
        resolve(profile);
      },
      (error) => {
        const permission = error.code === 1 ? 'denied' : 'unavailable';
        const profile = {
          source: 'gps',
          permission,
          capturedAt: Date.now(),
          error: error.message,
        };
        writeJson(LOCATION_KEY, profile);
        pendingRequest = null;
        if (config?.debug) log('geolocation', permission, error.message);
        resolve(profile);
      },
      opts,
    );
  });

  return pendingRequest;
}

/** Start GPS capture when geolocation is enabled in SDK config. */
function initLocation() {
  if (!config?.geolocation) return;
  if (!hasGeolocationApi()) return;

  const existing = getLocationProfile();
  if (existing?.permission === 'granted') {
    if (config?.geolocationRefresh !== false) {
      requestLocation().catch(() => {});
    }
    return;
  }

  if (config?.geolocationPrompt !== false) {
    requestLocation().catch(() => {});
  }
}

function getLocationPermissionState() {
  const profile = getLocationProfile();
  return profile?.permission ?? 'unknown';
}

function initProfiles() {
  initSessionMeta();
  getBrowserProfile();
  registerCurrentPage();
  initLocation();
  primeCampaignProfile();
}

function collectProfilesForBatch(pageIds = []) {
  const ids = getIds();
  const batchProfiles = {};
  const resend = config?.resendProfiles === true;

  if (resend || browserProfilePending()) {
    batchProfiles.browser = getBrowserProfile();
  }
  if (resend || visitorProfilePending()) {
    batchProfiles.visitor = getVisitorProfile();
  }
  if (resend || sessionProfilePending(ids.sessionId)) {
    batchProfiles.session = getSessionProfile();
  }
  const campaignProfile = getCampaignProfile();
  if (campaignProfile) {
    batchProfiles.campaign = campaignProfile;
  }

  if (config?.geolocation) {
    const locationProfile = getLocationProfile();
    if (locationProfile?.permission === 'granted') {
      batchProfiles.location = locationProfile;
    } else if (resend || locationProfilePending()) {
      const cached = getLocationProfile();
      if (cached?.permission === 'granted') {
        batchProfiles.location = cached;
      }
    }
  }

  const pages = collectNewPageProfiles(pageIds, resend);
  if (pages) batchProfiles.pages = pages;

  return Object.keys(batchProfiles).length ? batchProfiles : undefined;
}

/** Mark profile sync flags only after a successful send. */
function markProfilesSent(profiles) {
  if (!profiles || config?.resendProfiles) return;
  const sessionId = getIds().sessionId;
  if (profiles.browser) markBrowserProfileSent();
  if (profiles.visitor) markVisitorProfileSent();
  if (profiles.session && sessionId) markSessionProfileSent(sessionId);
  if (profiles.location) markLocationProfileSent();
  if (profiles.pages) markPageProfilesSent(profiles.pages);
}

const STORAGE_KEY = 'wa_client_ip';
const FETCH_TIMEOUT_MS = 8000;

/** @type {string | null | undefined} */
let memoryCache;

function normalizeIp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let ip = raw.trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  return ip || null;
}

function readStorage() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(ip) {
  try {
    sessionStorage.setItem(STORAGE_KEY, ip);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Cached client IP from getip (memory or sessionStorage). */
function getCachedClientIp() {
  if (memoryCache) return memoryCache;
  const stored = readStorage();
  if (stored) {
    memoryCache = stored;
    return stored;
  }
  return null;
}

async function fetchClientIpFromService() {
  const url = config?.clientIpUrl || 'https://getip.worktual.co.uk/';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      signal: controller?.signal,
    });
    if (!res.ok) {
      if (config?.debug) warn('clientIp fetch failed', res.status);
      return null;
    }
    const data = await res.json();
    const ip = normalizeIp(data?.clientIPv6 || data?.clientIPv4 || data?.clientIp);
    if (config?.debug && ip) log('clientIp resolved', ip);
    return ip;
  } catch (err) {
    if (config?.debug) warn('clientIp fetch error', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Start non-blocking client IP lookup (once per browser session). */
function initClientIp() {
  if (config?.fetchClientIp === false) return;
  if (getCachedClientIp()) return;

  void fetchClientIpFromService().then((ip) => {
    if (!ip) return;
    memoryCache = ip;
    writeStorage(ip);
  });
}

/** Build compact events_v3 wire payloads with profile references. */


/** @param {Array<Record<string, unknown>>} events */
function buildPayloadV3(events) {
  const ids = getIds();
  const pageIds = [...new Set(events.map((event) => event.pid).filter(Boolean))];
  const profiles = collectProfilesForBatch(pageIds);

  const payload = {
    type: PAYLOAD_TYPE_V3,
    websiteId: config?.websiteId,
    websiteUrl: config?.websiteUrl || window.location.hostname,
    visitorId: ids.visitorId,
    sessionId: ids.sessionId,
    sdkVersion: config?.sdkVersion,
    sentAt: Date.now(),
    events: events.map(normalizeEvent),
  };

  if (config?.organizationId != null) {
    payload.organizationId = config.organizationId;
  }

  if (ids.userId) payload.userId = ids.userId;
  if (ids.anonymousId) payload.anonymousId = ids.anonymousId;
  if (profiles) payload.profiles = profiles;

  const clientIp = getCachedClientIp();
  if (clientIp) payload.clientIp = clientIp;

  return payload;
}

function normalizeEvent(event) {
  const normalized = {
    eventId: event.eventId,
    name: event.name,
    ts: event.ts || event.timestamp || Date.now(),
  };

  const props = event.props || event.properties;
  if (props && Object.keys(props).length) normalized.props = props;
  if (event.pid) normalized.pid = event.pid;
  if (event.cid) normalized.cid = event.cid;

  return normalized;
}

/** Built-in event names — keep in sync with etl/ingest/validation.py KNOWN_EVENT_NAMES. */

const BUILT_IN_EVENT_NAMES = new Set([
  'page_view',
  'click',
  'move',
  'scroll',
  'scroll_depth',
  'rage_click',
  'dead_click',
  'hover',
  'form_view',
  'form_start',
  'form_focus',
  'form_blur',
  'form_change',
  'form_validation',
  'form_submit',
  'form_success',
  'form_failure',
  'form_abandon',
  'performance_lcp',
  'performance_cls',
  'performance_inp',
  'performance_fcp',
  'performance_navigation',
  'performance_resource',
  'performance_long_task',
  'performance_memory',
  'error',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'remove_from_wishlist',
  'begin_checkout',
  'payment_failure',
  'purchase',
  'refund',
  'identify',
  'alias',
  'group',
  'login',
  'logout',
  'register',
  'signup',
  'user_properties',
  'user_active',
  'user_idle',
  'page_visible',
  'page_hidden',
  'scroll_milestone',
  'page_transition',
  'heartbeat',
  'performance_vitals',
  'outbound_link',
  'file_download',
  'site_search',
  'product_rating',
]);

/** @param {string} name */
function isCustomEventName(name) {
  return !BUILT_IN_EVENT_NAMES.has(name);
}

/** @param {string} name @param {Record<string, unknown>} [properties] */
function buildEvent(name, properties = {}) {
  const pageId = registerCurrentPage();
  const campaign = getCampaignProfile();
  const path = typeof window !== 'undefined'
    ? window.location.pathname + window.location.search
    : '';

  const event = {
    eventId: generateId('evt'),
    name,
    ts: Date.now(),
    pid: pageId,
  };

  if (isCustomEventName(name)) {
    event.event_mode = 'custom';
  }

  const props = {
    ...(path ? { path } : {}),
    ...properties,
  };
  if (Object.keys(props).length) event.props = props;
  if (campaign?.id) event.cid = campaign.id;

  return event;
}

/** @param {Array<Record<string, unknown>>} events */
function buildPayload(events) {
  return buildPayloadV3(events);
}

/** @typedef {{ name: string; properties?: Record<string, unknown>; eventId?: string; timestamp?: number }} TrackEvent */

const hooks = {
  beforeTrack: [],
  afterTrack: [],
  beforeSend: [],
  afterSend: [],
};

/** @param {'beforeTrack'|'afterTrack'|'beforeSend'|'afterSend'} hook @param {Function} fn */
function on(hook, fn) {
  if (hooks[hook]) hooks[hook].push(fn);
}

/** @param {'beforeTrack'|'afterTrack'|'beforeSend'|'afterSend'} hook @param {unknown} payload */
async function emit$1(hook, payload) {
  let result = payload;
  for (const fn of hooks[hook] || []) {
    const next = await fn(result);
    if (next === false) return false;
    if (next !== undefined) result = next;
  }
  return result;
}

function clearHooks() {
  for (const key of Object.keys(hooks)) {
    hooks[key] = [];
  }
}

/** Optional payload compression via CompressionStream (gzip). */

async function compressJson(jsonString) {
  if (typeof CompressionStream === 'undefined' || typeof TextEncoder === 'undefined') {
    return { body: jsonString, encoding: null };
  }
  try {
    const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    return { body: buffer, encoding: 'gzip' };
  } catch {
    return { body: jsonString, encoding: null };
  }
}

function payloadByteLength(body, encoding) {
  if (encoding === 'gzip' && body instanceof ArrayBuffer) return body.byteLength;
  return typeof body === 'string' ? body.length : 0;
}

const DB_NAME = 'worktual_analytics';
const STORE = 'events';
const LS_KEY = 'wa_offline_queue';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function lsLoad() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function lsSave(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items.slice(-OFFLINE_QUEUE_MAX)));
  } catch {
    /* quota */
  }
}

/** @param {{ id: string; payload: unknown; retries: number }} item */
async function enqueue(item) {
  const record = { id: item.id || uuidV4(), payload: item.payload, retries: item.retries || 0, createdAt: Date.now() };
  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
    });
    return record.id;
  }
  const items = lsLoad();
  items.push(record);
  lsSave(items);
  return record.id;
}

async function drain(max = OFFLINE_STORE_MAX) {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const batch = all.slice(0, max);
        for (const item of batch) store.delete(item.id);
        resolve(batch);
      };
      req.onerror = () => resolve([]);
    });
  }
  const items = lsLoad();
  const batch = items.slice(0, max);
  lsSave(items.slice(max));
  return batch;
}

/** @param {string} id @param {number} retries */
async function requeue(id, payload, retries) {
  log('requeue', id, retries);
  await enqueue({ id, payload, retries });
}

/** @type {Array<Record<string, unknown>>} */
let pendingEvents = [];
let flushTimer = null;
let batchIntervalTimer = null;
/** @type {((success: boolean) => void)[] | null} */
let flushWaiters = null;

function getEndpoint$1() {
  return config?.endpoint || '/v1/tracking/nfs-ingestions';
}

function batchLimit() {
  return config?.batchSize || 20;
}

function isCrossOriginEndpoint(url) {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

async function encodeBody(payload) {
  const json = JSON.stringify(payload);
  if (!config?.compressPayloads) return { body: json, encoding: null, json };
  const compressed = await compressJson(json);
  if (compressed.encoding === 'gzip' && compressed.body instanceof ArrayBuffer) {
    return compressed;
  }
  return { body: json, encoding: null, json };
}

/** @param {Record<string, unknown>[]} events @param {{ preferBeacon?: boolean, forceCompress?: boolean }} [options] */
async function sendPayload(events, options = {}) {
  const body = {
    ...buildPayload(events),
    payloadId: uuidV4(),
    type: PAYLOAD_TYPE_V3,
  };
  const payload = await emit$1('beforeSend', body);
  if (payload === false) return true;

  let encoded = await encodeBody(payload);
  const jsonLen = typeof encoded.json === 'string' ? encoded.json.length : 0;
  if (
    (options.forceCompress || jsonLen > 50_000)
    && !encoded.encoding
    && typeof encoded.json === 'string'
  ) {
    encoded = await compressJson(encoded.json);
    if (encoded.encoding === 'gzip') {
      encoded.json = payload;
    }
  }

  const url = getEndpoint$1();
  const crossOrigin = isCrossOriginEndpoint(url);
  const headers = { 'Content-Type': 'application/json' };
  if (encoded.encoding === 'gzip') {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Type'] = 'application/json';
  }

  const bodySize = payloadByteLength(encoded.body, encoded.encoding);
  const canBeacon =
    !encoded.encoding
    && typeof encoded.body === 'string'
    && bodySize < BEACON_MAX_BYTES
    && (!crossOrigin || options.preferBeacon)
    && navigator.sendBeacon;

  if (canBeacon) {
    const blob = new Blob([encoded.body], { type: 'application/json' });
    if (navigator.sendBeacon(url, blob)) {
      markProfilesSent(payload.profiles);
      await emit$1('afterSend', { success: true, payload });
      return true;
    }
  }

  if (typeof fetch !== 'undefined') {
    try {
      if (config?.debug) {
        const keys = payload.profiles ? Object.keys(payload.profiles).join(', ') : 'none';
        log('sending', events.length, 'event(s)', '| profiles:', keys);
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: encoded.body,
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
      });
      if (res.ok || res.status === HTTP_STATUS_DUPLICATE) {
        markProfilesSent(payload.profiles);
        if (config?.debug) log('sent ok', res.status);
        await emit$1('afterSend', { success: true, payload, bytes: payloadByteLength(encoded.body, encoded.encoding) });
        return true;
      }
      if (config?.debug) warn('send failed', res.status, res.statusText);
    } catch (e) {
      warn('fetch failed', e);
    }
  }

  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = false;
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.onload = async () => {
        const ok = xhr.status >= 200 && xhr.status < 300 || xhr.status === HTTP_STATUS_DUPLICATE;
        if (ok) {
          markProfilesSent(payload.profiles);
          await emit$1('afterSend', { success: true, payload });
        }
        resolve(ok);
      };
      xhr.onerror = () => resolve(false);
      xhr.send(encoded.body);
    } catch {
      resolve(false);
    }
  });
}

async function flushOffline() {
  const batch = await drain(OFFLINE_DRAIN_BATCH);
  for (const item of batch) {
    const events = item.payload?.events || [];
    if (!events.length) continue;
    const ok = await sendPayload(events);
    if (!ok) {
      await requeue(item.id, item.payload, (item.retries || 0) + 1);
    }
  }
}

const IMMEDIATE_FLUSH_EVENTS = new Set([
  'page_view',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'remove_from_wishlist',
  'begin_checkout',
  'purchase',
  'refund',
  'payment_failure',
  'product_rating',
]);

function shouldFlushImmediately(eventName) {
  if (!IMMEDIATE_FLUSH_EVENTS.has(eventName)) return false;
  if (eventName === 'page_view') return config?.flushOnFirstPageView !== false;
  if (eventName === 'product_rating') return true;
  return config?.flushOnEcommerce !== false;
}

/** @param {Record<string, unknown>} event */
function queueEvent(event) {
  pendingEvents.push(event);
  if (shouldFlushImmediately(event?.name)) {
    void flushQueue();
    return;
  }
  if (config?.batching && pendingEvents.length < batchLimit()) {
    scheduleFlush();
    return;
  }
  flushQueue();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, config?.batchInterval || 10_000);
}

async function flushQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushOffline();

  if (!pendingEvents.length) {
    flushWaiters?.forEach((waiter) => waiter(true));
    flushWaiters = null;
    return true;
  }

  const events = pendingEvents.splice(0, batchLimit());
  const ok = await sendPayload(events);
  if (!ok && config?.offlineQueue) {
    await enqueue({
      id: uuidV4(),
      payload: { events },
      retries: 0,
    });
  }
  flushWaiters?.forEach((waiter) => waiter(ok));
  flushWaiters = null;
  return ok;
}

function startBatchTimer() {
  if (config?.batching && !batchIntervalTimer) {
    batchIntervalTimer = setInterval(() => {
      void flushQueue();
    }, config?.batchInterval || 10_000);
  }
  if (config?.flushOnUnload) {
    const onHide = () => flushQueue();
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
  }
}

function destroyTransport() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (batchIntervalTimer) clearInterval(batchIntervalTimer);
  batchIntervalTimer = null;
  pendingEvents = [];
}

let previousPageId = null;
let pageEnteredAt = Date.now();

function onPageTransition(trackFn) {
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

/** Shared track-fn binding used by feature modules. */

/** @typedef {(name: string, properties?: Record<string, unknown>) => void} TrackFn */

/** @returns {{ bindTrack: (fn: TrackFn) => void, track: TrackFn }} */
function createTracker() {
  /** @type {TrackFn} */
  let trackFn = () => {};

  return {
    bindTrack(fn) {
      trackFn = fn;
    },
    track(name, properties = {}) {
      trackFn(name, properties);
    },
  };
}

const { bindTrack: bindTrack$8, track: autoTrackFn } = createTracker();

function currentPath() {
  return window.location.pathname + window.location.search;
}

function currentPathname() {
  return window.location.pathname || '/';
}

function trackPageView(name, props = {}) {
  const path = currentPath();
  if (state.trackedPagePath === path) return;
  state.trackedPagePath = path;
  state.pageViewId = generateId('pv');
  registerCurrentPage();
  if (config?.trackJourney !== false) onPageTransition(autoTrackFn);
  touchSession();
  const event = buildEvent('page_view', sanitizeProperties({
    pageName: name || document.title,
    path,
    title: document.title,
    ...props,
  }));
  queueEvent(event);
}

function dispatchNavigationIfPathChanged() {
  const pathname = currentPathname();
  if (pathname === state.lastNavigationPath) return;
  state.lastNavigationPath = pathname;
  window.dispatchEvent(new Event('wa:navigation'));
}

function setupSpaNavigation() {
  if (state.modules.spa) return;
  state.modules.spa = true;
  state.lastNavigationPath = currentPathname();

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args) {
    origPush.apply(this, args);
    dispatchNavigationIfPathChanged();
  };
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    dispatchNavigationIfPathChanged();
  };

  window.addEventListener('popstate', dispatchNavigationIfPathChanged);
  window.addEventListener('wa:navigation', () => trackPageView());
}

function setupAutoTracking() {
  if (!config?.autoTrack) return;

  trackPageView();
  setupSpaNavigation();
  setupEngagement();
  const heatmapHandlesClicks = config?.trackHeatmap !== false && config?.trackHeatmapClicks !== false;
  if (!heatmapHandlesClicks) setupClicks();
  if (config?.trackScroll !== false) setupScrollMilestones();
  setupVisibility();
  setupOutbound();
  setupDownloads();
  setupSearch();
}

function addListener(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  state.listeners.push(() => target.removeEventListener(event, handler, options));
}

function setupEngagement() {
  let idle = false;
  let idleTimer = null;

  const onActivity = () => {
    state.isActive = true;
    touchSession();
    if (idle) {
      idle = false;
      autoTrackFn('user_active', {});
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      state.isActive = false;
      autoTrackFn('user_idle', { idleMs: USER_IDLE_MS });
    }, USER_IDLE_MS);
  };

  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => {
    addListener(document, ev, onActivity, { passive: true });
  });
}

function setupClicks() {
  addListener(document, 'click', function onAutoClick(e) {
    const el = /** @type {HTMLElement} */ (e.target)?.closest?.('a,button,[role=button]');
    if (!el) return;
    autoTrackFn('click', {
      element: el.tagName?.toLowerCase(),
      text: (el.textContent || '').slice(0, ELEMENT_TEXT_MAX_LEN),
      href: el.getAttribute('href') || undefined,
      x: e.clientX,
      y: e.clientY,
    });
  }, true);
}

function setupScrollMilestones() {
  const milestones = config?.scrollMilestones || [25, 50, 75, 90, 100];
  const reached = new Set();
  let ticking = false;

  addListener(window, 'scroll', function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const depth = Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100);
      for (const milestone of milestones) {
        if (depth >= milestone && !reached.has(milestone)) {
          reached.add(milestone);
          autoTrackFn('scroll_milestone', { milestone, maxDepth: depth });
        }
      }
      ticking = false;
    });
  }, { passive: true });
}

function setupVisibility() {
  addListener(document, 'visibilitychange', function onVisibility() {
    autoTrackFn(document.visibilityState === 'visible' ? 'page_visible' : 'page_hidden', {});
  });
}

function setupOutbound() {
  addListener(document, 'click', function onOutbound(e) {
    const anchor = /** @type {HTMLElement} */ (e.target)?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !isOutboundLink(href)) return;
    autoTrackFn('outbound_link', {
      href,
      text: (anchor.textContent || '').slice(0, ELEMENT_TEXT_MAX_LEN),
    });
  }, true);
}

function setupDownloads() {
  addListener(document, 'click', function onDownload(e) {
    const anchor = /** @type {HTMLElement} */ (e.target)?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!isDownloadLink(href)) return;
    autoTrackFn('file_download', { href, fileName: href.split('/').pop() });
  }, true);
}

function setupSearch() {
  addListener(document, 'submit', function onSearch(e) {
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (!form || form.hasAttribute('data-wa-skip')) return;
    const input = form.querySelector('input[type=search], input[name=q], input[name=query], input[name=search]');
    if (input) {
      autoTrackFn('site_search', { query: maskSearch(input.value), formId: form.id || form.name });
    }
  }, true);
}

function maskSearch(value) {
  if (!value) return '';
  return value.length > SEARCH_QUERY_MAX_LEN
    ? value.slice(0, SEARCH_QUERY_MAX_LEN) + '…'
    : value;
}

function teardownAutoTracking() {
  state.listeners.forEach((removeListener) => removeListener());
  state.listeners = [];
  state.modules = {};
}

/** @param {EventTarget | null | undefined} target */
function getElementInfo(target) {
  const element = /** @type {HTMLElement | null} */ (target);
  if (!element?.tagName) return {};

  return {
    element: element.tagName.toLowerCase(),
    elementType: element.getAttribute('type') || undefined,
    elementText: (element.textContent || '').trim().slice(0, ELEMENT_TEXT_MAX_LEN) || undefined,
    href: element.getAttribute('href') || undefined,
  };
}

/** @param {EventTarget | null | undefined} target */
function getClickTarget(target) {
  const element = /** @type {HTMLElement | null} */ (target);
  return element?.closest?.('a,button,[role=button],div,span') || element;
}

const { bindTrack: bindTrack$7, track: heatmapTrackFn } = createTracker();

const rageWindow = [];

function sample() {
  const rate = config?.heatmapSampleRate ?? 1;
  return rate >= 1 || Math.random() < rate;
}

function onHeatmapClick(e) {
  if (!sample()) return;
  const target = getClickTarget(e.target);
  heatmapTrackFn('click', {
    x: e.clientX,
    y: e.clientY,
    pageX: e.pageX,
    pageY: e.pageY,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    ...getElementInfo(target),
  });
  if (config?.trackRageClick !== false) detectRageClick(e);
  if (config?.trackDeadClick !== false) detectDeadClick(e, /** @type {HTMLElement} */ (e.target));
}

function setupHeatmap() {
  if (!config?.trackHeatmap || state.modules.heatmap) return;

  const trackClicks = config?.trackHeatmapClicks !== false;
  const trackMove = config?.trackMove === true;
  const trackHover = config?.trackHover === true;

  if (!trackClicks && !trackMove && !trackHover) return;

  state.modules.heatmap = true;

  if (trackClicks) {
    document.addEventListener('click', onHeatmapClick, true);
  }

  if (trackMove) {
    let lastMove = { x: 0, y: 0, t: 0 };
    const minInterval = config?.moveSampleIntervalMs ?? 1000;
    const minPixels = config?.moveSampleMinPixels ?? 25;

    document.addEventListener('mousemove', (e) => {
      if (!sample()) return;
      const now = Date.now();
      const dx = Math.abs(e.clientX - lastMove.x);
      const dy = Math.abs(e.clientY - lastMove.y);
      if (now - lastMove.t < minInterval && dx < minPixels && dy < minPixels) return;
      lastMove = { x: e.clientX, y: e.clientY, t: now };
      heatmapTrackFn('move', {
        x: e.clientX,
        y: e.clientY,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      });
    }, { passive: true });
  }

  if (trackHover) {
    document.addEventListener('mouseover', (e) => {
      if (!sample()) return;
      heatmapTrackFn('hover', {
        x: e.clientX,
        y: e.clientY,
        ...getElementInfo(e.target),
      });
    }, { passive: true });
  }
}

function detectRageClick(e) {
  const now = Date.now();
  rageWindow.push({ x: e.clientX, y: e.clientY, t: now });
  while (rageWindow.length && now - rageWindow[0].t > RAGE_CLICK_WINDOW_MS) rageWindow.shift();

  if (rageWindow.length < RAGE_CLICK_THRESHOLD) return;

  const xs = rageWindow.map((point) => point.x);
  const ys = rageWindow.map((point) => point.y);
  const dx = Math.max(...xs) - Math.min(...xs);
  const dy = Math.max(...ys) - Math.min(...ys);

  if (dx < RAGE_CLICK_RADIUS_PX && dy < RAGE_CLICK_RADIUS_PX) {
    heatmapTrackFn('rage_click', { x: e.clientX, y: e.clientY, clickCount: rageWindow.length });
    rageWindow.length = 0;
  }
}

function detectDeadClick(e, element) {
  const interactive = element.closest?.('a,button,input,select,textarea,[onclick],[role=button]');
  if (interactive) return;

  setTimeout(() => {
    heatmapTrackFn('dead_click', { x: e.clientX, y: e.clientY, reason: 'non_interactive' });
  }, DEAD_CLICK_DELAY_MS);
}

const FIELD_SELECTOR = 'input, textarea, select';
const FIELD_INPUT_SELECTOR = 'input:not([type=hidden]), textarea, select';

/** @param {EventTarget|null} target */
function findInputFromFieldBlockClick(target) {
  if (!(target instanceof Element)) return null;
  if (target.matches(FIELD_INPUT_SELECTOR)) {
    return /** @type {HTMLInputElement} */ (target);
  }

  const block = target.closest(
    'label, [class*="formblockinner"], [class*="form-group"], [class*="formlabel"]',
  );
  const searchRoot = block?.parentElement || target.parentElement;
  if (!searchRoot) return null;

  const input = searchRoot.querySelector(FIELD_INPUT_SELECTOR);
  if (!input || shouldMaskField(/** @type {HTMLInputElement} */ (input))) return null;
  return /** @type {HTMLInputElement} */ (input);
}

/** @param {string} text */
function slugifyFieldKey(text) {
  if (!text) return undefined;
  const slug = text.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return slug || undefined;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
function labelForField(el) {
  const id = el.id;
  if (id && typeof document !== 'undefined') {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) return slugifyFieldKey(label.textContent);
    } catch {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label?.textContent) return slugifyFieldKey(label.textContent);
    }
  }
  const parentLabel = el.closest('label');
  if (parentLabel?.textContent) return slugifyFieldKey(parentLabel.textContent);
  return undefined;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
function resolveFieldKey(el) {
  return (
    el.name
    || el.getAttribute('data-wt-field')
    || labelForField(el)
    || slugifyFieldKey(el.id)
    || el.id
    || slugifyFieldKey(el.getAttribute('placeholder'))
    || undefined
  );
}

/** @param {Element} root */
function collectFieldsFromContainer(root) {
  /** @type {Record<string, string>} */
  const fields = {};
  if (!root?.querySelectorAll) return fields;

  root.querySelectorAll(FIELD_SELECTOR).forEach((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    if (shouldMaskField(input)) return;
    const key = resolveFieldKey(input);
    if (!key) return;
    if (input.type === 'checkbox') {
      fields[key] = input.checked ? (input.value || 'true') : 'false';
      return;
    }
    if (input.type === 'radio') {
      if (input.checked) fields[key] = input.value;
      return;
    }
    fields[key] = input.value;
  });

  return fields;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
function fieldMeta(el) {
  return {
    fieldName: resolveFieldKey(el),
    fieldType: el.getAttribute('type') || el.tagName.toLowerCase(),
    fieldValue: maskFieldValue(el),
  };
}

/** @param {Element} root @param {string} [submitSelector] */
function findSubmitControl(root, submitSelector) {
  if (submitSelector) {
    const found = root.querySelector(submitSelector);
    if (found) return found;
  }
  const explicit = (
    root.querySelector('[data-wt-submit]')
    || root.querySelector('button[type="submit"]')
    || root.querySelector('input[type="submit"]')
    || root.querySelector('button:not([type="button"])')
    || root.querySelector('[role="button"]')
  );
  if (explicit) return explicit;

  // React/Vue often use type="button" + onClick — treat lone button as submit.
  const buttons = root.querySelectorAll('button');
  if (buttons.length === 1) return buttons[0];

  return root.querySelector('button[type="button"]');
}

/** Maps form_* event names to config flags (see core/config.js). */
const EVENT_FLAGS = {
  form_view: 'trackFormView',
  form_start: 'trackFormStart',
  form_focus: 'trackFormFocus',
  form_blur: 'trackFormBlur',
  form_change: 'trackFormChange',
  form_validation: 'trackFormValidation',
  form_submit: 'trackFormSubmit',
  form_success: 'trackFormSuccess',
  form_failure: 'trackFormFailure',
  form_abandon: 'trackFormAbandon',
};

/** @param {string} eventName */
function shouldTrackFormEvent(eventName) {
  if (!config?.trackForms) return false;
  const flag = EVENT_FLAGS[eventName];
  if (!flag) return false;
  return config[flag] === true;
}

const { bindTrack: bindTrack$6, track: formsTrackFn } = createTracker();

const formState = new WeakMap();

function formMeta(form) {
  return {
    formId: form.id || form.name || undefined,
    formName: form.getAttribute('name') || undefined,
    formAction: form.action || undefined,
  };
}

function trackFormEvent(name, props) {
  if (!shouldTrackFormEvent(name)) return;
  formsTrackFn(name, props);
}

function setupFormTracking() {
  if (!config?.trackForms || state.modules.forms) return;
  state.modules.forms = true;

  if (typeof IntersectionObserver === 'undefined') return;

  const observer = new IntersectionObserver((entries) => {
    if (!shouldTrackFormEvent('form_view')) return;
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const form = /** @type {HTMLFormElement} */ (entry.target);
        if (!formState.get(form)?.viewed) {
          formState.set(form, { viewed: true, started: false });
          trackFormEvent('form_view', formMeta(form));
        }
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('form').forEach((form) => observer.observe(form));

  document.addEventListener('focusin', (e) => {
    if (!shouldTrackFormEvent('form_focus') && !shouldTrackFormEvent('form_start')) return;
    const el = /** @type {HTMLElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form || shouldMaskField(/** @type {HTMLInputElement} */ (el))) return;
    const st = formState.get(form) || {};
    if (!st.started) {
      st.started = true;
      formState.set(form, st);
      trackFormEvent('form_start', formMeta(form));
    }
    trackFormEvent('form_focus', { ...formMeta(form), fieldName: el.name || el.id, fieldType: el.getAttribute('type') });
  }, true);

  document.addEventListener('focusout', (e) => {
    if (!shouldTrackFormEvent('form_blur')) return;
    const el = /** @type {HTMLElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form) return;
    trackFormEvent('form_blur', { ...formMeta(form), ...fieldMeta(/** @type {HTMLInputElement} */ (el)) });
  }, true);

  document.addEventListener('change', (e) => {
    if (!shouldTrackFormEvent('form_change')) return;
    const el = /** @type {HTMLInputElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form) return;
    trackFormEvent('form_change', {
      ...formMeta(form),
      ...fieldMeta(el),
    });
  }, true);

  document.addEventListener('invalid', (e) => {
    if (!shouldTrackFormEvent('form_validation')) return;
    const el = /** @type {HTMLInputElement} */ (e.target);
    const form = el.closest?.('form');
    if (!form) return;
    trackFormEvent('form_validation', { ...formMeta(form), fieldName: el.name || el.id, valid: false });
  }, true);

  document.addEventListener('submit', (e) => {
    if (!shouldTrackFormEvent('form_submit')) return;
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (!form?.tagName || form.tagName !== 'FORM') return;
    trackFormEvent('form_submit', { ...formMeta(form), fields: collectFieldsFromContainer(form) });
  }, true);

  window.addEventListener('beforeunload', () => {
    if (!shouldTrackFormEvent('form_abandon')) return;
    document.querySelectorAll('form').forEach((form) => {
      const st = formState.get(form);
      if (st?.started && !st?.completed) {
        trackFormEvent('form_abandon', formMeta(form));
      }
    });
  });
}

const DISC_WT_FORM_ATTR = 'data-wt-form';
const DISC_WT_NO_FORM_ATTR = 'data-wt-no-form';
const DISC_FIELD_SELECTOR = 'input:not([type=hidden]), textarea, select';
const SEARCH_KEY_RE = /^(search|query|q|s)$/i;

/** @param {Element} root */
function getTrackableFields(root) {
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(DISC_FIELD_SELECTOR)).filter((el) => !el.closest('form'));
}

/** @param {Element} root */
function hasSubmitControl(root) {
  return Boolean(findSubmitControl(root));
}

/** @param {Element} root @param {Element[]} fields */
function isSearchOnlyWidget(root, fields) {
  if (fields.length !== 1) return false;
  const el = /** @type {HTMLInputElement} */ (fields[0]);
  const type = el.getAttribute('type') || '';
  const name = el.name || el.id || '';
  if (type === 'search') return true;
  if (el.closest('[role="search"]')) return true;
  if (SEARCH_KEY_RE.test(name)) return true;
  if (root.matches('[role="search"], form[role="search"]')) return true;
  return false;
}

/** @param {Element} root */
function isExcludedRoot(root) {
  if (root.hasAttribute(DISC_WT_NO_FORM_ATTR)) return true;
  if (root.closest(`[${DISC_WT_NO_FORM_ATTR}]`)) return true;
  return false;
}

/** @param {Element} root */
function matchesExplicitMarker(root) {
  return root.hasAttribute(DISC_WT_FORM_ATTR) || root.getAttribute('role') === 'form';
}

/** @param {Element} root */
function isValidHeuristicRoot(root) {
  if (isExcludedRoot(root)) return false;
  const fields = getTrackableFields(root);
  if (isSearchOnlyWidget(root, fields)) return false;
  if (fields.length >= 2) return true;
  if (fields.length === 1 && hasSubmitControl(root)) return true;
  return false;
}

/** @param {Element} fieldEl */
function findFormRoot(fieldEl) {
  if (!fieldEl?.matches?.('input, textarea, select')) return null;
  if (fieldEl.closest('form')) return null;
  if (fieldEl.closest(`[${DISC_WT_NO_FORM_ATTR}]`)) return null;

  let node = fieldEl.parentElement;
  while (node && node !== document.documentElement) {
    if (matchesExplicitMarker(node)) return node;
    if (isValidHeuristicRoot(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** @param {Element} el */
function findFormRootFromElement(el) {
  if (!el?.closest) return null;
  if (el.closest('form')) return null;
  if (el.closest(`[${DISC_WT_NO_FORM_ATTR}]`)) return null;
  if (el.matches?.('input, textarea, select')) return findFormRoot(el);

  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    if (matchesExplicitMarker(node)) return node;
    if (isValidHeuristicRoot(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** @param {Element} root @param {number} [index] */
function deriveFormId(root, index = 0) {
  const wtForm = root.getAttribute(DISC_WT_FORM_ATTR);
  if (wtForm) return wtForm;
  if (root.id) return root.id;

  const className = root.className;
  if (typeof className === 'string' && className.trim()) {
    const first = className.trim().split(/\s+/)[0];
    const base = first.replace(/__[a-zA-Z0-9_-]+$/, '');
    if (base) return base;
  }

  const path = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\//g, '_').replace(/^_|_$/g, '') || 'root'
    : 'root';
  return `auto_${path}_${index}`;
}

/** @param {(root: Element) => boolean} [isRegistered] */
function discoverFormRoots(isRegistered) {
  /** @type {Element[]} */
  const roots = [];
  const seen = new Set();

  document.querySelectorAll(DISC_FIELD_SELECTOR).forEach((field) => {
    if (field.closest('form')) return;
    const root = findFormRoot(field);
    if (!root || seen.has(root)) return;
    if (isRegistered?.(root)) return;
    seen.add(root);
    roots.push(root);
  });

  return roots;
}

const { bindTrack: bindTrack$5, track: leadTrackFn } = createTracker();

const WT_FORM_ATTR = 'data-wt-form';
const registeredRoots = new WeakSet();
/** @type {Map<string, Element>} */
const formIdToRoot = new Map();
/** @type {WeakMap<Element, { formId: string, started: boolean, completed: boolean, wired: boolean }>} */
const leadState = new WeakMap();
/** @type {WeakMap<Element, ReturnType<typeof setTimeout>>} */
const inputDebounceTimers = new WeakMap();

/** @type {MutationObserver | null} */
let domObserver = null;

function resolveRoot(root) {
  if (!root) return null;
  if (typeof root === 'string') return document.querySelector(root);
  if (root instanceof Element) return root;
  return null;
}

function isLeadFormRegistered(root) {
  return registeredRoots.has(root);
}

function leadMeta(formId, root) {
  return {
    formId,
    formName: root.getAttribute('name') || root.getAttribute(WT_FORM_ATTR) || formId,
  };
}

/** @param {string} formId @param {Element} root @param {Record<string, unknown>} [extra] */
function emit(formId, root, name, extra = {}) {
  if (!shouldTrackFormEvent(name)) return;
  const fields = collectFieldsFromContainer(root);
  const props = {
    ...leadMeta(formId, root),
    ...extra,
  };
  if (name === 'form_submit' || name === 'form_success' || name === 'form_failure') {
    props.fields = fields;
  }
  leadTrackFn(name, props);
}

function wireSubmit(formId, root, submitEl, autoSuccess) {
  submitEl.addEventListener('click', () => {
    const st = leadState.get(root);
    if (!st) return;
    emit(formId, root, 'form_submit');
    if (autoSuccess) {
      st.completed = true;
      emit(formId, root, 'form_success');
    }
  });
}

function bindLeadFormRoot(formId, root, options = {}) {
  if (!formId || !root || registeredRoots.has(root)) return false;

  const submitEl = findSubmitControl(root, options.submit);
  registeredRoots.add(root);
  formIdToRoot.set(formId, root);
  leadState.set(root, { formId, started: false, completed: false, wired: true });

  root.addEventListener('focusin', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    const st = leadState.get(root);
    if (!st) return;
    if (!st.started) {
      st.started = true;
      emit(formId, root, 'form_start');
    }
    emit(formId, root, 'form_focus', fieldMeta(/** @type {HTMLInputElement} */ (el)));
  }, true);

  root.addEventListener('focusout', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    emit(formId, root, 'form_blur', fieldMeta(/** @type {HTMLInputElement} */ (el)));
  }, true);

  root.addEventListener('change', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    emit(formId, root, 'form_change', fieldMeta(el));
  }, true);

  root.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!root.contains(el) || !el.matches('input, textarea, select')) return;
    const prev = inputDebounceTimers.get(el);
    if (prev) clearTimeout(prev);
    inputDebounceTimers.set(el, setTimeout(() => {
      inputDebounceTimers.delete(el);
      emit(formId, root, 'form_change', fieldMeta(el));
    }, 300));
  }, true);

  root.addEventListener('click', (e) => {
    const input = findInputFromFieldBlockClick(e.target);
    if (!input || !root.contains(input) || input === e.target) return;
    if (document.activeElement !== input) input.focus();
  }, true);

  if (submitEl) {
    wireSubmit(formId, root, submitEl, options.autoSuccess === true);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          emit(formId, root, 'form_view');
          observer.disconnect();
        }
      });
    }, { threshold: 0.5 });
    observer.observe(root);
  }

  return true;
}

/** @param {Element} fieldEl */
function ensureLeadFormBound(fieldEl) {
  if (!fieldEl?.matches?.('input, textarea, select')) return null;
  if (fieldEl.closest('form')) return null;

  const root = findFormRoot(fieldEl);
  if (!root) return null;
  if (registeredRoots.has(root)) return root;

  const formId = deriveFormId(root, formIdToRoot.size);
  bindLeadFormRoot(formId, root, {});

  const st = leadState.get(root);
  if (st && !st.started) {
    st.started = true;
    emit(formId, root, 'form_start');
  }
  emit(formId, root, 'form_focus', fieldMeta(/** @type {HTMLInputElement} */ (fieldEl)));
  return root;
}

function scanHeuristicForms() {
  if (config.leadFormHeuristicScan === false) return;
  discoverFormRoots(isLeadFormRegistered).forEach((root, index) => {
    const formId = deriveFormId(root, formIdToRoot.size + index);
    bindLeadFormRoot(formId, root, {});
  });
}

function setupLazyFormDiscovery() {
  if (config.leadFormHeuristicScan === false) return;

  document.addEventListener('focusin', (e) => {
    scanAllLeadForms();
    const el = /** @type {HTMLElement} */ (e.target);
    if (!el?.matches?.('input, textarea, select')) return;
    if (el.closest('form')) return;
    const root = findFormRoot(el);
    if (root && !registeredRoots.has(root)) {
      ensureLeadFormBound(el);
    }
  }, true);

  document.addEventListener('click', (e) => {
    scanAllLeadForms();
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target?.closest?.('button, [role="button"], input[type="submit"]');
    const inputFromLabel = findInputFromFieldBlockClick(target);

    if (inputFromLabel && !inputFromLabel.closest('form')) {
      const root = findFormRoot(inputFromLabel);
      if (root && !registeredRoots.has(root)) {
        ensureLeadFormBound(inputFromLabel);
      }
    }

    if (!btn || btn.closest('form')) return;

    const root = findFormRootFromElement(btn);
    if (!root || registeredRoots.has(root)) return;

    const formId = deriveFormId(root, formIdToRoot.size);
    bindLeadFormRoot(formId, root, {});
  }, true);
}

/** @param {{ formId: string, root?: string | Element, submit?: string, autoSuccess?: boolean }} opts */
function registerLeadForm$1(opts) {
  const formId = opts?.formId;
  const root = resolveRoot(opts?.root);
  if (!formId || !root) return false;
  return bindLeadFormRoot(formId, root, opts);
}

function scanAutoForms() {
  document.querySelectorAll(`[${WT_FORM_ATTR}]`).forEach((root) => {
    const formId = root.getAttribute(WT_FORM_ATTR);
    if (!formId) return;
    bindLeadFormRoot(formId, root, {
      submit: root.getAttribute('data-wt-submit') || undefined,
      autoSuccess: root.getAttribute('data-wt-auto-success') === 'true',
    });
  });
}

function scanConfiguredForms() {
  const list = config?.leadForms;
  if (!Array.isArray(list)) return;
  list.forEach((item) => {
    if (!item?.formId) return;
    const root = resolveRoot(item.root);
    if (!root) return;
    bindLeadFormRoot(item.formId, root, item);
  });
}

function scanAllLeadForms() {
  scanAutoForms();
  scanConfiguredForms();
  scanHeuristicForms();
  scanKnownFormContainers();
}

function scanKnownFormContainers() {
  if (config.leadFormHeuristicScan === false) return;
  document.querySelectorAll('[class*="formblock"]:not([class*="inner"]), [class*="form_block"]:not([class*="inner"]), [role="form"]').forEach((root) => {
    if (registeredRoots.has(root)) return;
    if (root.closest('form')) return;
    const fieldCount = root.querySelectorAll('input:not([type=hidden]), textarea, select').length;
    if (fieldCount < 2 && !findSubmitControl(root)) return;
    bindLeadFormRoot(deriveFormId(root, formIdToRoot.size), root, {});
  });
}

function scheduleLeadFormRescan() {
  scanAllLeadForms();
  setTimeout(scanAllLeadForms, 100);
  setTimeout(scanAllLeadForms, 500);
}

function hookSpaFormRescan() {
  window.addEventListener('wa:navigation', scheduleLeadFormRescan);
  window.addEventListener('pageshow', scheduleLeadFormRescan);
}

function startDomObserver() {
  if (domObserver || typeof MutationObserver === 'undefined') return;
  domObserver = new MutationObserver(() => {
    scanAllLeadForms();
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function setupLeadFormTracking() {
  if (!config?.trackForms || state.modules.leadForms) return;
  state.modules.leadForms = true;

  scanAllLeadForms();
  setupLazyFormDiscovery();
  hookSpaFormRescan();

  if (config.leadFormAutoScan !== false) {
    startDomObserver();
  }

  window.addEventListener('beforeunload', () => {
    formIdToRoot.forEach((root, formId) => {
      const st = leadState.get(root);
      if (st?.started && !st?.completed) {
        emit(formId, root, 'form_abandon');
      }
    });
  });
}

/** @param {string} formId @param {Record<string, unknown>} [props] */
function trackLeadFormSuccess(formId, props = {}) {
  if (!shouldTrackFormEvent('form_success')) return;
  const root = formIdToRoot.get(formId);
  if (!root) {
    leadTrackFn('form_success', { formId, ...props });
    return;
  }
  const st = leadState.get(root);
  if (st) st.completed = true;
  emit(formId, root, 'form_success', props);
}

/** @param {string} formId @param {Record<string, unknown>} [props] */
function trackLeadFormFailure(formId, props = {}) {
  if (!shouldTrackFormEvent('form_failure')) return;
  const root = formIdToRoot.get(formId);
  if (!root) {
    leadTrackFn('form_failure', { formId, ...props });
    return;
  }
  emit(formId, root, 'form_failure', props);
}

const { bindTrack: bindTrack$4, track: perfTrackFn } = createTracker();

function setupPerformance() {
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

const { bindTrack: bindTrack$3, track: errorsTrackFn } = createTracker();

function setupErrorTracking() {
  if (!config?.trackErrors || state.modules.errors) return;
  state.modules.errors = true;

  window.addEventListener('error', (e) => {
    errorsTrackFn('error', {
      type: 'javascript',
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack?.slice(0, ERROR_STACK_MAX_LEN),
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    errorsTrackFn('error', {
      type: 'unhandledrejection',
      message: reason?.message || String(reason),
      stack: reason?.stack?.slice(0, ERROR_STACK_MAX_LEN),
    });
  });

  patchFetch();
  patchXhr();
  monitorResourceErrors();
}

function patchFetch() {
  if (!window.fetch) return;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      const res = await orig(...args);
      if (!res.ok) {
        errorsTrackFn('error', {
          type: 'fetch',
          url: String(args[0]),
          status: res.status,
          statusText: res.statusText,
        });
      }
      return res;
    } catch (err) {
      errorsTrackFn('error', {
        type: 'fetch',
        url: String(args[0]),
        message: err?.message || 'Network error',
      });
      throw err;
    }
  };
}

function patchXhr() {
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._waUrl = url;
    this._waMethod = method;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('error', () => {
      errorsTrackFn('error', { type: 'xhr', url: this._waUrl, method: this._waMethod, message: 'Network error' });
    });
    this.addEventListener('load', () => {
      if (this.status >= 400) {
        errorsTrackFn('error', { type: 'xhr', url: this._waUrl, method: this._waMethod, status: this.status });
      }
    });
    return origSend.apply(this, args);
  };
}

function monitorResourceErrors() {
  window.addEventListener('error', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      errorsTrackFn('error', {
        type: 'resource',
        tagName: target.tagName,
        src: target.src || target.href,
      });
    }
  }, true);
}

const { bindTrack: bindTrack$2, track: ecomTrackFn } = createTracker();

function requireProductId(product, methodName) {
  const id = product?.productId || product?.id || product?.sku;
  if (!id) {
    throw new Error(`WorktualAnalytics.${methodName}: productId (or id/sku) is required`);
  }
  return id;
}

function productView(product) {
  requireProductId(product, 'productView');
  ecomTrackFn('product_view', stripCredentials(normalizeProduct(product)));
}

function addToCart(product) {
  requireProductId(product, 'addToCart');
  ecomTrackFn('add_to_cart', stripCredentials(normalizeProduct(product)));
}

function removeFromCart(product) {
  requireProductId(product, 'removeFromCart');
  ecomTrackFn('remove_from_cart', stripCredentials(normalizeProduct(product)));
}

function addToWishlist(product) {
  requireProductId(product, 'addToWishlist');
  ecomTrackFn('add_to_wishlist', stripCredentials(normalizeProduct(product)));
}

function removeFromWishlist(product) {
  requireProductId(product, 'removeFromWishlist');
  ecomTrackFn('remove_from_wishlist', stripCredentials(normalizeProduct(product)));
}

function beginCheckout(props = {}) {
  const rawLines = props.products || props.items;
  const { items: _items, ...rest } = props;
  const payload = stripCredentials({
    ...rest,
    currency: props.currency || 'USD',
    cartValue: props.cartValue ?? props.revenue ?? props.value,
    itemCount: props.itemCount,
    coupon: props.coupon,
    ...(Array.isArray(rawLines)
      ? { products: rawLines.map((line) => normalizeProduct(line)) }
      : {}),
  });
  ecomTrackFn('begin_checkout', payload);
}

/** Payment declined / checkout error (after gateway or API failure). */
function paymentFailure(props = {}) {
  const rawLines = props.products || props.items;
  const { items: _items, ...rest } = props;
  const payload = stripCredentials({
    ...rest,
    currency: props.currency || 'USD',
    cartValue: props.cartValue ?? props.revenue ?? props.value,
    orderId: props.orderId || props.transactionId,
    errorCode: props.errorCode || props.code,
    errorMessage: props.errorMessage || props.message,
    paymentMethod: props.paymentMethod || props.method,
    ...(Array.isArray(rawLines)
      ? { products: rawLines.map((line) => normalizeProduct(line)) }
      : {}),
  });
  ecomTrackFn('payment_failure', payload);
}

function purchase(order) {
  ecomTrackFn('purchase', stripCredentials(normalizeOrder(order)));
}

function refund(order) {
  ecomTrackFn('refund', stripCredentials(normalizeOrder(order)));
}

function normalizeProduct(product) {
  return {
    productId: product.productId || product.id || product.sku,
    productName: product.productName || product.name,
    productCategory: product.productCategory || product.category,
    productPrice: product.productPrice ?? product.price,
    currency: product.currency || 'USD',
    quantity: product.quantity || 1,
    sku: product.sku,
    brand: product.brand,
  };
}

function normalizeOrder(order) {
  return {
    orderId: order.orderId || order.transactionId,
    revenue: order.revenue ?? order.total,
    currency: order.currency || 'USD',
    products: order.products || order.items || [],
    tax: order.tax,
    shipping: order.shipping,
  };
}

const PRODUCT_RATING_EVENT = 'product_rating';

const { bindTrack: bindTrack$1, track: ratingTrackFn } = createTracker();

function parseScore(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Normalize cross-site product rating props (stored in fact_custom_events).
 * @param {Record<string, unknown>} input
 */
function normalizeProductRating(input = {}) {
  const score = parseScore(input.score ?? input.rating ?? input.nps);
  if (score == null) {
    throw new Error('WorktualAnalytics.productRating: score (number) is required');
  }

  const orderId = String(
    input.orderId ?? input.orderNumber ?? input.order_id ?? '',
  ).trim();
  const orderItemId = String(
    input.orderItemId ?? input.order_item_id ?? '',
  ).trim();
  const productId = String(
    input.productId ?? input.product_id ?? input.sku ?? '',
  ).trim();

  if (!orderId && !orderItemId && !productId) {
    throw new Error(
      'WorktualAnalytics.productRating: orderId, orderItemId, or productId is required',
    );
  }

  const payload = {
    score,
    scale: String(input.scale ?? '0-10').trim() || '0-10',
    orderId: orderId || undefined,
    orderItemId: orderItemId || undefined,
    productId: productId || undefined,
    productName: input.productName ?? input.product_name ?? input.name,
    source: input.source ?? input.context,
    comment: input.comment ?? input.feedback,
    deliveredAt: input.deliveredAt ?? input.delivered_at,
    currency: input.currency,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === '') delete payload[key];
  });

  return payload;
}

/**
 * Generic product / order-item rating (NPS, post-delivery score, etc.) — same event on all websites.
 * Stored as `product_rating` in fact_custom_events for CDP queries.
 *
 * @param {Record<string, unknown>} props
 */
function productRating(props = {}) {
  ratingTrackFn(PRODUCT_RATING_EVENT, stripCredentials(normalizeProductRating(props)));
}

/**
 * Submit multiple line-item ratings in one call (one ingest event each).
 * @param {{ orderId?: string, scale?: string, source?: string, items?: Record<string, unknown>[] }} batch
 */
function productRatings(batch = {}) {
  const items = batch.items || batch.responses || batch.products;
  if (!Array.isArray(items) || !items.length) {
    throw new Error('WorktualAnalytics.productRatings: items array is required');
  }
  const shared = {
    orderId: batch.orderId ?? batch.orderNumber,
    scale: batch.scale,
    source: batch.source,
    deliveredAt: batch.deliveredAt,
  };
  for (const line of items) {
    productRating({ ...shared, ...line });
  }
}

const { bindTrack, track: heartbeatTrackFn } = createTracker();

function setupHeartbeat() {
  if (config?.trackHeartbeat === false || state.modules.heartbeat) return;
  state.modules.heartbeat = true;

  const intervalMs = config?.heartbeatIntervalMs ?? 30_000;
  setInterval(() => {
    if (!state.isActive || document.visibilityState === 'hidden') return;
    heartbeatTrackFn('heartbeat', {
      intervalMs,
      path: window.location.pathname + window.location.search,
    });
  }, intervalMs);
}

/** gzip + base64 for replay_chunk_v1.eventsData */

async function gzipB64Encode(text) {
  if (typeof CompressionStream === 'undefined') {
    return btoa(unescape(encodeURIComponent(text)));
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

let chunkIndex = 0;
let snapshotAccepted = false;
/** @type {unknown[] | null} */
let pendingSnapshotBatch = null;
/** @type {Promise<boolean>} */
let sendChain = Promise.resolve(true);

function getEndpoint() {
  if (config?.replayEndpoint) return config.replayEndpoint;
  const base = config?.endpoint || '/v1/tracking/nfs-ingestions';
  if (base.includes('/nfs-ingestions')) return base;
  if (base.includes('/collect')) return base.replace(/\/collect\/?$/, '/nfs-ingestions');
  if (base.includes('/events')) return base.replace(/\/events\/?$/, '/nfs-ingestions');
  return base.replace(/\/?$/, '/nfs-ingestions');
}

function batchHasSnapshot(events) {
  return events.some((event) => event?.type === 2);
}

async function postOneBatch(rrwebEvents, index) {
  const eventsJson = JSON.stringify(rrwebEvents);
  let eventsData;
  try {
    eventsData = await gzipB64Encode(eventsJson);
  } catch (e) {
    warn('replay encode failed', e);
    return false;
  }

  const ids = getIds();
  const body = {
    type: 'replay_chunk_v1',
    websiteId: config.websiteId,
    websiteUrl: config.websiteUrl || window.location.hostname,
    visitorId: ids.visitorId,
    sessionId: ids.sessionId,
    pageViewId: registerCurrentPage(),
    chunkIndex: index,
    chunkId: uuidV4(),
    encoding: 'gzip_b64',
    eventsData,
    eventCount: rrwebEvents.length,
    source: 'rrweb',
    payloadId: uuidV4(),
  };

  if (config.organizationId != null) body.organizationId = config.organizationId;

  const clientIp = getCachedClientIp();
  if (clientIp) body.clientIp = clientIp;

  const url = getEndpoint();
  const bodyStr = JSON.stringify(body);
  // keepalive requests are capped ~64KB in browsers — full DOM snapshots exceed that
  const useKeepalive = bodyStr.length <= 60_000;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: useKeepalive,
      credentials: 'omit',
      mode: 'cors',
    });
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => '');
      warn('replay ingest HTTP', res.status, url, text.slice(0, 120));
      return false;
    }
    chunkIndex = index + 1;
    if (batchHasSnapshot(rrwebEvents)) {
      snapshotAccepted = true;
      pendingSnapshotBatch = null;
    }
    if (config?.debug) log('replay chunk accepted', index, rrwebEvents.length, 'events');
    return true;
  } catch (e) {
    warn('replay send failed', url, e);
    if (batchHasSnapshot(rrwebEvents)) pendingSnapshotBatch = rrwebEvents;
    return false;
  }
}

function runSend(fn) {
  const run = sendChain.then(fn);
  sendChain = run.catch(() => false);
  return run;
}

/** @param {unknown[]} rrwebEvents */
async function sendReplayChunk(rrwebEvents) {
  if (!rrwebEvents?.length || !config?.websiteId) return false;

  return runSend(async () => {
    if (batchHasSnapshot(rrwebEvents)) {
      pendingSnapshotBatch = rrwebEvents;
    } else if (!snapshotAccepted && pendingSnapshotBatch) {
      const snapshotOk = await postOneBatch(pendingSnapshotBatch, chunkIndex);
      if (!snapshotAccepted) return snapshotOk;
    }
    return postOneBatch(rrwebEvents, chunkIndex);
  });
}

function flushReplayChunks() {
  return sendChain;
}

function resetReplayChunkIndex() {
  chunkIndex = 0;
  snapshotAccepted = false;
  pendingSnapshotBatch = null;
  sendChain = Promise.resolve(true);
}

/**
 * Session replay — rrweb DOM recording.
 * Loads rrweb UMD → window.rrweb.record → gzip chunks via replay_chunk_v1.
 */


const CDN_RRWEB_URL =
  'https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/vendor/rrweb/rrweb.min.js';
const LOCAL_RRWEB_URL = '/vendor/rrweb/rrweb.min.js';

const EventType = { FullSnapshot: 2, Meta: 4 };

/** @type {(() => void) | null} */
let stopRecord = null;
/** @type {unknown[]} */
let buffer = [];
let replayFlushTimer = null;
let flushRetryTimer = null;
let flushing = false;
let flushBackoffUntil = 0;
let paused = false;
let snapshotFlushed = false;
/** @type {Promise<{ record: Function }> | null} */
let rrwebLoadPromise = null;
const FLUSH_RETRY_MS = 5000;

function rrwebScriptUrl() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return LOCAL_RRWEB_URL;
  }
  if (config?.replayScriptUrl) return config.replayScriptUrl;
  return CDN_RRWEB_URL;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-wt-rrweb="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.wtRrweb = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load rrweb: ${src}`));
    document.head.appendChild(script);
  });
}

function loadRrweb() {
  if (!rrwebLoadPromise) {
    rrwebLoadPromise = (async () => {
      const win = /** @type {Window & { rrweb?: { record: Function } }} */ (window);
      if (win.rrweb?.record) return win.rrweb;
      await loadScript(rrwebScriptUrl());
      if (!win.rrweb?.record) throw new Error('rrweb.record not available after script load');
      return win.rrweb;
    })();
  }
  return rrwebLoadPromise;
}

function shouldSample() {
  const rate = config?.replaySampleRate ?? 1;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  if (state.replaySampled == null) state.replaySampled = Math.random() < rate;
  return state.replaySampled;
}

function maxEventsPerChunk() {
  return config?.replayMaxEventsPerChunk ?? 25;
}

function chunkIntervalMs() {
  return config?.replayChunkIntervalMs ?? 2000;
}

function mousemoveSampling() {
  const value = config?.replaySampleMousemove;
  if (value === false) return false;
  if (value === true) return 100;
  return value ?? 100;
}

function isSnapshotEvent(event) {
  return event?.type === EventType.FullSnapshot || event?.type === EventType.Meta;
}

function trimBuffer() {
  const max = config?.replayMaxBufferEvents ?? 80;
  if (buffer.length <= max) return;
  buffer = buffer.filter((event) => !snapshotFlushed || !isSnapshotEvent(event)).slice(-max);
}

function takeNextBatch() {
  const limit = maxEventsPerChunk();
  const batch = buffer.splice(0, limit);
  if (snapshotFlushed) return batch.filter((event) => !isSnapshotEvent(event));
  return batch;
}

function scheduleFlushRetry() {
  if (flushRetryTimer) return;
  flushBackoffUntil = Date.now() + FLUSH_RETRY_MS;
  flushRetryTimer = setTimeout(() => {
    flushRetryTimer = null;
    flushBackoffUntil = 0;
    void flushRrwebBuffer();
  }, FLUSH_RETRY_MS);
}

async function flushRrwebBuffer() {
  if (flushing) return flushReplayChunks();
  if (Date.now() < flushBackoffUntil) return flushReplayChunks();

  const batch = takeNextBatch();
  if (!batch.length) return flushReplayChunks();

  flushing = true;
  try {
    const ok = await sendReplayChunk(batch);
    if (!ok) {
      buffer.unshift(...batch);
      trimBuffer();
      scheduleFlushRetry();
      if (config?.debug) warn('rrweb flush failed — retry in', FLUSH_RETRY_MS, 'ms');
    } else {
      if (batch.some(isSnapshotEvent)) snapshotFlushed = true;
      if (buffer.length > 0) scheduleRrwebFlush();
    }
  } finally {
    flushing = false;
  }
  return flushReplayChunks();
}

function scheduleRrwebFlush() {
  if (replayFlushTimer) return;
  replayFlushTimer = setTimeout(() => {
    replayFlushTimer = null;
    void flushRrwebBuffer();
  }, chunkIntervalMs());
}

function onRrwebEmit(event) {
  if (paused) return;
  if (snapshotFlushed && isSnapshotEvent(event)) return;

  buffer.push(event);
  trimBuffer();

  if (!snapshotFlushed && event?.type === EventType.FullSnapshot) {
    void flushRrwebBuffer();
    return;
  }

  if (buffer.length >= maxEventsPerChunk()) {
    void flushRrwebBuffer();
    return;
  }
  scheduleRrwebFlush();
}

function onRrwebPageExit() {
  paused = false;
  void flushRrwebBuffer().then(() => flushReplayChunks());
}

function setupSessionReplay() {
  if (state.modules.replay || config?.trackReplay === false) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!shouldSample()) return;

  state.modules.replay = true;
  snapshotFlushed = false;
  buffer = [];
  resetReplayChunkIndex();

  loadRrweb()
    .then((rrweb) => {
      if (!state.modules.replay) return;
      stopRecord = rrweb.record({
        emit: onRrwebEmit,
        checkoutEveryNms: config?.replayCheckoutEveryNms ?? 30_000,
        blockClass: config?.replayBlockClass ?? 'wt-no-replay',
        maskTextClass: config?.replayMaskTextClass ?? 'wt-mask',
        maskAllInputs: config?.replayMaskAllInputs ?? false,
        maskInputOptions: { password: true, ...(config?.replayMaskInputOptions || {}) },
        slimDOMOptions: config?.replaySlimDOM ?? 'all',
        inlineStylesheet: config?.replayInlineStylesheet !== false,
        recordCanvas: config?.replayRecordCanvas === true,
        sampling: {
          mousemove: mousemoveSampling(),
          mouseInteraction: config?.replaySampleMouseInteraction !== false,
          scroll: config?.replaySampleScroll ?? 150,
          media: config?.replaySampleMedia ?? 800,
          input: config?.replaySampleInput ?? 'last',
        },
      });
      if (config?.debug) log('rrweb session replay started', rrwebScriptUrl());
    })
    .catch((e) => {
      warn('rrweb session replay unavailable', e);
      state.modules.replay = false;
    });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onRrwebPageExit();
    else paused = document.visibilityState !== 'visible';
  });
  window.addEventListener('pagehide', onRrwebPageExit);
  window.addEventListener('beforeunload', onRrwebPageExit);
}

function teardownSessionReplay() {
  if (replayFlushTimer) {
    clearTimeout(replayFlushTimer);
    replayFlushTimer = null;
  }
  if (flushRetryTimer) {
    clearTimeout(flushRetryTimer);
    flushRetryTimer = null;
  }
  flushBackoffUntil = 0;
  if (stopRecord) {
    stopRecord();
    stopRecord = null;
  }
  onRrwebPageExit();
  buffer = [];
  flushing = false;
  snapshotFlushed = false;
  resetReplayChunkIndex();
  state.modules.replay = false;
}

/** @param {string} name @param {object} plugin */
function registerPlugin(name, plugin) {
  if (!name || !plugin) return;
  if (plugin.beforeTrack) on('beforeTrack', plugin.beforeTrack);
  if (plugin.afterTrack) on('afterTrack', plugin.afterTrack);
  if (plugin.beforeSend) on('beforeSend', plugin.beforeSend);
  if (plugin.afterSend) on('afterSend', plugin.afterSend);
}

function bindModules() {
  const trackRef = track;
  bindTrack$8(trackRef);
  bindTrack$7(trackRef);
  bindTrack$6(trackRef);
  bindTrack$5(trackRef);
  bindTrack$4(trackRef);
  bindTrack$3(trackRef);
  bindTrack$2(trackRef);
  bindTrack$1(trackRef);
  bindTrack(trackRef);
}

function bootstrapTracking() {
  if (!state.initialized || !isTrackingAllowed()) return;

  if (!state.modules.bootstrapped) {
    state.modules.bootstrapped = true;
    initIdentity();
    initProfiles();
    initClientIp();
  }
  startTracking();
}

function startTracking() {
  if (!state.initialized || !isTrackingAllowed() || state.modules.tracking) return;
  state.modules.tracking = true;

  if (config.autoTrack !== false) setupAutoTracking();
  if (config.trackHeatmap !== false) setupHeatmap();
  if (config.trackForms !== false) {
    setupFormTracking();
    setupLeadFormTracking();
  }
  if (config.trackPerformance !== false) setupPerformance();
  if (config.trackErrors !== false) setupErrorTracking();
  if (config.trackHeartbeat !== false) setupHeartbeat();
  if (config.trackReplay !== false) setupSessionReplay();
  startBatchTimer();
}

function stopTracking() {
  if (!state.modules.tracking) return;
  teardownSessionReplay();
  teardownAutoTracking();
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
  emit$1('beforeTrack', event).then((result) => {
    if (result === false) return;
    if (result && typeof result === 'object') event = /** @type {typeof event} */ (result);
    queueEvent(event);
    emit$1('afterTrack', event);
  });
  touchSession();
}

/** @param {string} [name] @param {Record<string, unknown>} [props] */
function page(name, props = {}) {
  trackPageView(name, props);
}

/** @param {string} userId @param {Record<string, unknown>} [traits] */
function identify(userId, traits = {}) {
  const result = identify$1(userId, traits);
  track('identify', { userId, traits: stripCredentials(traits), previousAnonymousId: result?.previousAnon });
}

/** @param {string} oldId @param {string} newId */
function alias(oldId, newId) {
  track('alias', { oldId, newId });
}

/** @param {string} groupId @param {Record<string, unknown>} [props] */
function group(groupId, props = {}) {
  group$1(groupId, props);
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
  resetIdentity();
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
  newSession();
  rotateSessionMeta();
  state.trackedPagePath = null;
  trackPageView();
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
  return getIds().visitorId;
}

function getSessionId() {
  return getIds().sessionId;
}

function getUserId() {
  return getIds().userId;
}

function formSuccess(formId, props = {}) {
  trackLeadFormSuccess(formId, props);
}

function formFailure(formId, props = {}) {
  trackLeadFormFailure(formId, props);
}

function registerLeadForm(opts) {
  return registerLeadForm$1(opts);
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
  productView: productView,
  addToCart: addToCart,
  removeFromCart: removeFromCart,
  addToWishlist: addToWishlist,
  removeFromWishlist: removeFromWishlist,
  beginCheckout: beginCheckout,
  paymentFailure: paymentFailure,
  purchase: purchase,
  refund: refund,
  productRating: productRating,
  productRatings: productRatings,
  version: SDK_VERSION,
};

if (typeof window !== 'undefined') {
  window.WorktualAnalytics = api;
}

export { api as default };
