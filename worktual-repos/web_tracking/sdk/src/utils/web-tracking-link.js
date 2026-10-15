/**
 * Decode Worktual Campaign email click tokens (?wt= query param).
 * Format: 30 chars = org(6) + campaign(6) + contact(12) + sig(6)
 * Spec: docs/WEB_TRACKING_LINK_DECODE.md
 */

import { hmacSha256 } from './sha256-hmac.js';

export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const WT_TOKEN_LEN = 30;

const WT_TOKEN_RE = /^[0-9A-Za-z]{30}$/;

/** @param {string} seg @returns {bigint} */
export function base62Decode(seg) {
  let n = 0n;
  for (const ch of seg) {
    const idx = BASE62.indexOf(ch);
    if (idx < 0) throw new Error('invalid base62');
    n = n * 62n + BigInt(idx);
  }
  return n;
}

/** @param {bigint|number} value @param {number} width @returns {string} */
export function base62EncodePad(value, width) {
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
export function base62EncodePad6(value) {
  return base62EncodePad(value, 6);
}

/** @param {bigint|number} value @returns {string} */
export function base62EncodePad12(value) {
  return base62EncodePad(value, 12);
}

/** @param {Uint8Array} digest @returns {string} */
export function digestFirst4ToSigSegment(digest) {
  const n = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  return base62EncodePad6(BigInt(n));
}

/** @param {string} secret @param {string} message @returns {string} */
export function hmacSigToBase62(secret, message) {
  return digestFirst4ToSigSegment(hmacSha256(secret, message));
}

/** @param {string} token */
export function isValidWtToken(token) {
  return Boolean(token && WT_TOKEN_RE.test(token));
}

/**
 * @param {string} token
 * @returns {{ O: string, C: string, U: string, sig: string } | null}
 */
export function splitWtToken(token) {
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
export function decodeWebTrackingTokenSegments(token) {
  return decodeSegmentsFromToken(token);
}

/** HMAC-verified decode — production when webTrackingHmacSecret is set. */
export function parseWebTrackingToken(token, secret) {
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

/** Build 30-char token (exact CDP contact id in 12-char segment). */
export function buildWebTrackingToken(orgId, campaignId, contactId, secret) {
  const O = base62EncodePad6(BigInt(orgId));
  const C = base62EncodePad6(BigInt(campaignId));
  const U = base62EncodePad12(BigInt(contactId));
  const sig = hmacSigToBase62(secret, `${O}|${C}|${U}`);
  return `${O}${C}${U}${sig}`;
}

/** Raw ?wt= value (any length) — for URL cleanup. */
export function getWtQueryParam(search = '') {
  const params = new URLSearchParams(
    search || (typeof window !== 'undefined' ? window.location.search : ''),
  );
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase() === 'wt' && value) return value.trim();
  }
  return null;
}

/** Read token from ?wt= (30 base62 chars only). */
export function extractWtToken(search = '') {
  const fromQuery = getWtQueryParam(search);
  if (fromQuery && isValidWtToken(fromQuery)) return fromQuery;
  return null;
}

/** @param {bigint} n @returns {number|string} */
export function bigintToId(n) {
  const num = Number(n);
  return Number.isSafeInteger(num) ? num : n.toString();
}

/** Contact id from token; omit when decoded value is 0. */
export function contactIdFromSegment(contactId) {
  const id = bigintToId(contactId);
  if (id === 0 || id === '0') return undefined;
  return id;
}
