/**
 * Split contact payloads: known CDP columns vs extras → custom_fields JSONB.
 * Campaign must not ALTER CDP; extras always go into custom_fields.
 */

/** API / column aliases that are NOT custom_fields. */
const CORE_KEY_ALIASES = new Set(
  [
    "id",
    "cdp_id",
    "cdpid",
    "firstname",
    "first_name",
    "lastname",
    "last_name",
    "fullname",
    "email",
    "phone",
    "mobile",
    "company",
    "companyname",
    "company_name",
    "city",
    "town",
    "apppushtoken",
    "app_push_token",
    "apppushplatform",
    "app_push_platform",
    "webpushendpoint",
    "web_push_endpoint",
    "webpushp256dh",
    "web_push_p256dh",
    "webpushauth",
    "web_push_auth",
    "customfields",
    "custom_fields",
    "extrafields",
    "extra_fields",
    "organization_id",
    "organizationid",
    "created_at",
    "updated_at",
    "first_seen_at",
    "last_seen_at",
    "acquisition_channel",
  ].map((k) => k.toLowerCase()),
);

/** System keys users must not overwrite via create/update. */
const RESERVED_CUSTOM_KEYS = new Set(
  [
    "campaign_deleted",
    "campaign_consent_source",
    "campaign_contactable",
    "campaign_import_source",
  ].map((k) => k.toLowerCase()),
);

function normalizeKey(key: string): string {
  return String(key || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Coerce JSON-ish values; drop empty strings / null / undefined. */
function sanitizeCustomValue(value: unknown): unknown | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return undefined;
    // Numeric strings → number when safe (score, loyalty points).
    if (/^-?\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
    if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
    return t;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return value;
  return String(value);
}

/**
 * Build custom_fields from explicit `customFields` / `custom_fields` plus any
 * unknown top-level keys on the request body / import row.
 */
export function extractCustomFields(
  body: unknown,
  explicit?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const mergeIn = (src: Record<string, unknown> | null | undefined) => {
    if (!src) return;
    for (const [rawKey, rawVal] of Object.entries(src)) {
      const key = normalizeKey(rawKey);
      if (!key || CORE_KEY_ALIASES.has(key) || RESERVED_CUSTOM_KEYS.has(key)) {
        continue;
      }
      const val = sanitizeCustomValue(rawVal);
      if (val === undefined) continue;
      out[key] = val;
    }
  };

  if (isPlainObject(explicit)) mergeIn(explicit);
  if (isPlainObject(body)) {
    const nested =
      (isPlainObject(body.customFields) && body.customFields) ||
      (isPlainObject(body.custom_fields) && body.custom_fields) ||
      null;
    if (nested) mergeIn(nested);
    // Top-level extras (score, segment, job_title, …)
    mergeIn(body);
  }

  return out;
}

export function hasCustomFields(cf: Record<string, unknown> | null | undefined) {
  return Boolean(cf && Object.keys(cf).length > 0);
}
