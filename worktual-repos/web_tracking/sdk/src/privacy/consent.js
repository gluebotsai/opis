import { config } from '../core/state.js';

let consent = { analytics: null, marketing: null };

const SENSITIVE_KEYS = /password|passwd|pwd|otp|token|access_token|refresh_token|cvv|cvc|card_number|cardnumber|secret|ssn|pin/i;
const SENSITIVE_TYPES = new Set(['password', 'hidden']);

export function setConsent(options = {}) {
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

export function getConsent() {
  return { ...consent };
}

export function isTrackingAllowed() {
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
export function sanitizeProperties(obj) {
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
export function shouldMaskField(el) {
  if (!el) return true;
  if (SENSITIVE_TYPES.has(el.type)) return true;
  if (el.autocomplete && SENSITIVE_KEYS.test(el.autocomplete)) return true;
  if (el.name && SENSITIVE_KEYS.test(el.name)) return true;
  if (el.id && SENSITIVE_KEYS.test(el.id)) return true;
  return false;
}

/** @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el */
export function maskFieldValue(el) {
  if (shouldMaskField(el)) return '[MASKED]';
  const val = el.value;
  if (val && val.length > 100) return val.slice(0, 100) + '…';
  return val;
}

/** @param {Record<string, unknown>} props */
export function stripCredentials(props) {
  return sanitizeProperties(props);
}
