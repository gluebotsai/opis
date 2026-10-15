/**
 * Compact HMAC links for web tracking (email clicks).
 *
 * Token layout v2 (30 chars):
 *   org(6) + campaign(6) + contact(12) + sig(6)
 *
 * Contact uses 12 base62 chars so full CDP/snowflake ids round-trip
 * (no SHA-256 fold). Org/campaign stay 6 (autoincrement range).
 *
 * Live sends stamp UTM + wt= onto the template destination URL:
 *   {destination}?utm_source=worktual_campaign&utm_medium=email
 *     &utm_campaign={name}&wt={token}
 *
 * Optional lab landing (WEB_TRACKING_LANDING_URL) still supports:
 *   {WEB_TRACKING_LANDING_URL}/?utm…&wt={token}
 *   {WEB_TRACKING_LANDING_URL}/t/{token}
 *
 * Share WEB_TRACKING_HMAC_SECRET + this module spec with the web tracking team.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Org / campaign segment width (autoincrement ids). */
export const ORG_CAMP_SEG_LEN = 6;
/** Contact segment width — holds full snowflake CDP ids (< 62^12). */
export const CONTACT_SEG_LEN = 12;
const SIG_LEN = 6;
/** Current tokens: 6+6+12+6 */
export const TOKEN_LEN = ORG_CAMP_SEG_LEN * 2 + CONTACT_SEG_LEN + SIG_LEN;
/** Legacy tokens: 6+6+6+6 (folded contact fingerprint). */
export const LEGACY_TOKEN_LEN = ORG_CAMP_SEG_LEN * 3 + SIG_LEN;
const MAX_ORG_CAMP = 62n ** BigInt(ORG_CAMP_SEG_LEN) - 1n;
const MAX_CONTACT = 62n ** BigInt(CONTACT_SEG_LEN) - 1n;

export type WebTrackingIds = {
  organizationId: bigint | number | string;
  campaignId: bigint | number | string;
  contactId?: bigint | number | string | null;
};

function toBigInt(id: bigint | number | string | null | undefined): bigint {
  if (id == null || id === "") return 0n;
  if (typeof id === "bigint") return id >= 0n ? id : 0n;
  if (typeof id === "number") {
    if (!Number.isFinite(id) || id < 0) return 0n;
    // Unsafe floats lose precision — callers must pass decimal string/bigint.
    if (!Number.isSafeInteger(id)) {
      throw new Error(
        `Id ${id} exceeds Number.MAX_SAFE_INTEGER; pass as decimal string`,
      );
    }
    return BigInt(Math.trunc(id));
  }
  const s = String(id).trim();
  if (!s) return 0n;
  if (!/^\d+$/.test(s)) {
    throw new Error(`Non-decimal id cannot be encoded exactly: ${s.slice(0, 48)}`);
  }
  try {
    const n = BigInt(s);
    return n < 0n ? 0n : n;
  } catch {
    throw new Error(`Invalid numeric id: ${s.slice(0, 48)}`);
  }
}

function fitFromDigest(raw: string, max: bigint): bigint {
  const digest = createHash("sha256").update(raw).digest();
  let h = 0n;
  for (let i = 0; i < 8; i += 1) {
    h = (h << 8n) + BigInt(digest[i]!);
  }
  return h % (max + 1n);
}

/**
 * Fit org/campaign into a 6-char base62 segment.
 * Large values fold (rare for autoincrement). Prefer decimal strings.
 * @deprecated Prefer encodeSegmentWithLen for new code.
 */
export function fitSegmentId(id: bigint | number | string): bigint {
  const n = toBigInt(id);
  if (n <= MAX_ORG_CAMP) return n;
  return fitFromDigest(n.toString(), MAX_ORG_CAMP);
}

export function encodeSegmentWithLen(
  id: bigint | number | string,
  len: number,
  opts?: { foldIfTooLarge?: boolean },
): string {
  let n = toBigInt(id);
  const max = 62n ** BigInt(len) - 1n;
  if (n > max) {
    if (opts?.foldIfTooLarge) {
      n = fitFromDigest(n.toString(), max);
    } else {
      throw new Error(
        `Id ${n.toString()} does not fit in ${len}-char base62 segment (max ${max.toString()})`,
      );
    }
  }
  let out = "";
  for (let i = 0; i < len; i += 1) {
    const rem = Number(n % 62n);
    out = BASE62[rem] + out;
    n = n / 62n;
  }
  return out;
}

/** Encode org/campaign (6 chars). Folds only if somehow over 62^6. */
export function encodeSegment(id: bigint | number | string): string {
  return encodeSegmentWithLen(id, ORG_CAMP_SEG_LEN, { foldIfTooLarge: true });
}

/** Encode full contact/CDP id (12 chars) — exact, no fold. */
export function encodeContactSegment(id: bigint | number | string): string {
  return encodeSegmentWithLen(id, CONTACT_SEG_LEN, { foldIfTooLarge: false });
}

export function decodeSegment(segment: string): bigint {
  const s = String(segment || "").trim();
  if (!s.length) throw new Error("Empty segment");
  let n = 0n;
  for (const ch of s) {
    const idx = BASE62.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base62 character: ${ch}`);
    n = n * 62n + BigInt(idx);
  }
  return n;
}

function signSegments(
  orgSeg: string,
  campSeg: string,
  custSeg: string,
  secret: string,
): string {
  const msg = `${orgSeg}|${campSeg}|${custSeg}`;
  const digest = createHmac("sha256", secret).update(msg).digest();
  let n = 0n;
  for (let i = 0; i < 4; i += 1) {
    n = (n << 8n) + BigInt(digest[i]!);
  }
  n = n % 62n ** BigInt(SIG_LEN);
  let out = "";
  for (let i = 0; i < SIG_LEN; i += 1) {
    const rem = Number(n % 62n);
    out = BASE62[rem] + out;
    n = n / 62n;
  }
  return out;
}

export function buildWebTrackingToken(
  ids: WebTrackingIds,
  secret: string,
): string {
  const orgSeg = encodeSegment(ids.organizationId);
  const campSeg = encodeSegment(ids.campaignId);
  const custSeg = encodeContactSegment(ids.contactId ?? 0);
  const sig = signSegments(orgSeg, campSeg, custSeg, secret);
  return `${orgSeg}${campSeg}${custSeg}${sig}`;
}

export function parseWebTrackingToken(
  token: string,
  secret: string,
): {
  organizationId: bigint;
  campaignId: bigint;
  contactId: bigint;
  tokenVersion: 1 | 2;
} {
  const raw = String(token || "").trim();
  let orgSeg: string;
  let campSeg: string;
  let custSeg: string;
  let sig: string;
  let tokenVersion: 1 | 2;

  if (raw.length === TOKEN_LEN) {
    // v2: 6+6+12+6 — exact contact id
    orgSeg = raw.slice(0, ORG_CAMP_SEG_LEN);
    campSeg = raw.slice(ORG_CAMP_SEG_LEN, ORG_CAMP_SEG_LEN * 2);
    custSeg = raw.slice(
      ORG_CAMP_SEG_LEN * 2,
      ORG_CAMP_SEG_LEN * 2 + CONTACT_SEG_LEN,
    );
    sig = raw.slice(ORG_CAMP_SEG_LEN * 2 + CONTACT_SEG_LEN, TOKEN_LEN);
    tokenVersion = 2;
  } else if (raw.length === LEGACY_TOKEN_LEN) {
    // v1: 6+6+6+6 — contact may be a folded fingerprint
    orgSeg = raw.slice(0, ORG_CAMP_SEG_LEN);
    campSeg = raw.slice(ORG_CAMP_SEG_LEN, ORG_CAMP_SEG_LEN * 2);
    custSeg = raw.slice(ORG_CAMP_SEG_LEN * 2, ORG_CAMP_SEG_LEN * 3);
    sig = raw.slice(ORG_CAMP_SEG_LEN * 3, LEGACY_TOKEN_LEN);
    tokenVersion = 1;
  } else {
    throw new Error(
      `Expected ${TOKEN_LEN}-char (v2) or ${LEGACY_TOKEN_LEN}-char (v1) token, got ${raw.length}`,
    );
  }

  const expected = signSegments(orgSeg, campSeg, custSeg, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid web tracking token signature");
  }
  return {
    organizationId: decodeSegment(orgSeg),
    campaignId: decodeSegment(campSeg),
    contactId: decodeSegment(custSeg),
    tokenVersion,
  };
}

/** Legacy path URL (`/t/{token}`) — kept for decode/docs compatibility. */
export function buildWebTrackingClickUrl(
  ids: WebTrackingIds,
  landingBase: string,
  secret: string,
): string | null {
  const base = String(landingBase || "").trim().replace(/\/$/, "");
  const key = String(secret || "").trim();
  if (!base || !/^https?:\/\//i.test(base) || !key) return null;
  try {
    const token = buildWebTrackingToken(ids, key);
    return `${base}/t/${token}`;
  } catch {
    return null;
  }
}

/**
 * Stamp UTM + wt= onto a real destination URL from the template (KB/user/form).
 * Returns null when dest/secret missing; throws if contact id cannot encode.
 */
export function applyWebTrackingParamsToUrl(
  dest: string,
  ids: WebTrackingIds,
  secret: string,
  opts?: {
    campaignName?: string | null;
    utmMedium?: string | null;
  },
): string | null {
  const raw = String(dest || "").trim();
  const key = String(secret || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw) || !key) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const token = buildWebTrackingToken(ids, key);
  const nameRaw = String(opts?.campaignName || "").trim();
  const utmCampaign =
    nameRaw || `campaign-${String(ids.campaignId ?? "0").toString().trim() || "0"}`;
  const utmMedium = String(opts?.utmMedium || "email").trim() || "email";
  url.searchParams.set("utm_source", "worktual_campaign");
  url.searchParams.set("utm_medium", utmMedium);
  url.searchParams.set("utm_campaign", utmCampaign);
  url.searchParams.set("wt", token);
  return url.toString();
}

/**
 * Homepage UTM + wt=token landing (agreed with Web Tracking).
 * Campaign click wrapper should redirect here after logging the click.
 * Returns null only when base/secret missing; throws if contact id cannot encode.
 */
export function buildWebTrackingUtmLandingUrl(
  ids: WebTrackingIds,
  landingBase: string,
  secret: string,
  opts?: {
    campaignName?: string | null;
    utmMedium?: string | null;
  },
): string | null {
  const base = String(landingBase || "").trim().replace(/\/$/, "");
  const key = String(secret || "").trim();
  if (!base || !/^https?:\/\//i.test(base) || !key) return null;
  const token = buildWebTrackingToken(ids, key);
  const nameRaw = String(opts?.campaignName || "").trim();
  const utmCampaign =
    nameRaw || `campaign-${String(ids.campaignId ?? "0").toString().trim() || "0"}`;
  const utmMedium = String(opts?.utmMedium || "email").trim() || "email";
  const q = new URLSearchParams({
    utm_source: "worktual_campaign",
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    wt: token,
  });
  // Contact id lives only inside `wt` (encoded segment). Do not append raw CDP id.
  return `${base}/?${q.toString()}`;
}

/** Split token for path-style routing: /O/C/U with ?s=sig */
export function buildWebTrackingClickUrlSplit(
  ids: WebTrackingIds,
  landingBase: string,
  secret: string,
): string | null {
  const base = String(landingBase || "").trim().replace(/\/$/, "");
  const key = String(secret || "").trim();
  if (!base || !/^https?:\/\//i.test(base) || !key) return null;
  try {
    const orgSeg = encodeSegment(ids.organizationId);
    const campSeg = encodeSegment(ids.campaignId);
    const custSeg = encodeContactSegment(ids.contactId ?? 0);
    const sig = signSegments(orgSeg, campSeg, custSeg, key);
    return `${base}/${orgSeg}/${campSeg}/${custSeg}?s=${sig}`;
  } catch {
    return null;
  }
}

/** Max contact id that fits in v2 token (for docs/tests). */
export function maxContactSegmentId(): bigint {
  return MAX_CONTACT;
}
