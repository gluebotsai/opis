/** First-touch and latest-touch campaign / click-id attribution. */

import {
  bigintToId,
  contactIdFromSegment,
  decodeWebTrackingTokenSegments,
  extractWtToken,
  getWtQueryParam,
  parseWebTrackingToken,
} from './web-tracking-link.js';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const CLICK_IDS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 'twclid', 'gbraid', 'wbraid', 'li_fat_id'];
const WT_KEYS = ['wt_organization_id', 'wt_campaign_id', 'wt_contact_id'];

/**
 * @param {string} [search]
 * @param {string} [referrer]
 * @param {{ hmacSecret?: string|null }} [options]
 */
export function parseAttribution(
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

export function hasAttribution(touch) {
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

export function mergeAttribution(existing, incoming) {
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
export function hasCampaignTokenInUrl(
  search = typeof window !== 'undefined' ? window.location.search : '',
) {
  return !!getWtQueryParam(search);
}
