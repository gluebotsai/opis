import { generateId } from '../utils/id.js';
import {
  parseAttribution,
  hasAttribution,
  mergeAttribution,
  hasCampaignTokenInUrl,
} from '../utils/attribution.js';
import { getWtQueryParam, isValidWtToken } from '../utils/web-tracking-link.js';
import { readJson, writeJson } from './store.js';
import { config } from '../core/state.js';
import { warn } from '../core/logger.js';

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

export function getCampaignProfile() {
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
export function primeCampaignProfile() {
  getCampaignProfile();
}

/** Campaign profile is attached on every ingest batch when attribution exists. */
