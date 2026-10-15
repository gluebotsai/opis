import { SDK_VERSION } from './state.js';

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
export function mergeConfig(userConfig = {}) {
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
