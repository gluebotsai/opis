import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical CDP id: CDP-{source}-org{organizationId}-{externalId} (external may be an email). */
export const CDP_ID_RE =
  /^CDP-[a-z0-9_]+-org[0-9]+-[A-Za-z0-9._@+:-]{1,120}$/i;

/**
 * Map client UUID / opaque keys → stable decimal string for bigint columns.
 * Pure numeric strings pass through.
 */
export function toStableDbId(id: string): string {
  const s = String(id || "").trim();
  if (!s) return s;
  if (/^\d+$/.test(s)) return s;
  const hex = createHash("sha256")
    .update(`campaign-id:${s}`)
    .digest("hex")
    .slice(0, 15);
  return String(BigInt(`0x${hex}`));
}

function sanitizeCdpSourceName(sourceName: string): string {
  const s = String(sourceName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return s || "unknown";
}

function sanitizeCdpOrgId(organizationId: string | number): string {
  const digits = String(organizationId ?? "").replace(/\D+/g, "");
  return digits || "0";
}

function sanitizeCdpExternalId(externalId: string): string {
  const s = String(externalId || "")
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return s.slice(0, 120) || randomBytes(8).toString("hex");
}

/**
 * Build canonical cdp_id:
 * CDP-{source_name}-org{organization_id}-{external_id}
 */
export function buildCdpId(args: {
  sourceName: string;
  organizationId: string | number;
  externalId: string;
}): string {
  const source = sanitizeCdpSourceName(args.sourceName);
  const org = sanitizeCdpOrgId(args.organizationId);
  const external = sanitizeCdpExternalId(args.externalId);
  return `CDP-${source}-org${org}-${external}`;
}

/** Stable numeric tail used inside Campaign-created CDP ids (and bigint mapping). */
export function newContactExternalId(): string {
  const ts = BigInt(Date.now()) << 10n;
  const rand = BigInt(Math.floor(Math.random() * 1024));
  return String(ts | rand);
}

/**
 * New profile cdp_id for inserts.
 * Default source: campaign → CDP-campaign-org{org}-{externalId}
 */
export function newContactId(
  organizationId: string | number,
  opts?: { sourceName?: string; externalId?: string },
): string {
  return buildCdpId({
    sourceName: opts?.sourceName || "campaign",
    organizationId,
    externalId: opts?.externalId || newContactExternalId(),
  });
}

/**
 * Campaign / accounts entity ids.
 * Accepts decimal strings or legacy UUIDs (hashed to bigint).
 */
export const zDbId = z
  .string()
  .trim()
  .min(1, { message: "id is required" })
  .transform(toStableDbId);

export const zDbIdOptional = zDbId.optional();
export const zDbIdNullable = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v == null || v === "" ? null : toStableDbId(v)));

/**
 * Contact / CDP refs: numeric, UUID, or opaque CDP ids
 * (CDP-{source}-org{org}-{external}, legacy CDP-cdc-*, …).
 * When writing into campaign bigint contact_id, use campaignContactIdFromCdp().
 */
export function isRecognizedContactId(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (/^\d+$/.test(s)) return true;
  if (UUID_RE.test(s)) return true;
  if (CDP_ID_RE.test(s)) return true;
  // Legacy / alternate CDP shapes (e.g. CDP-cdc-*), including email external ids.
  if (/^CDP-[A-Za-z0-9._@+:-]{4,200}$/i.test(s)) return true;
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(s)) return true;
  return false;
}

export const zContactId = z
  .string()
  .trim()
  .min(1, { message: "contact id is required" })
  .refine(isRecognizedContactId, {
    message: "contact id must be numeric, UUID, or a CDP id",
  });

/** Expand stored campaign contact ids so CDP lookups match original cdp_id. */
export function expandContactLookupIds(contactIds: string[]): string[] {
  const keys = new Set<string>();
  for (const raw of contactIds) {
    const s = String(raw || "").trim();
    if (!s) continue;
    keys.add(s);
    const mapped = campaignContactIdFromCdp(s);
    if (mapped) keys.add(mapped);
  }
  return [...keys];
}

/**
 * SQL fragment: match cdp_id exactly or by trailing 10+ digits
 * (CDP-*-org*-{digits} / legacy CDP-cdc-* stored as bigint tails).
 * Opaque ids without a digit tail are hashed — callers should also
 * resolve those in JS via campaignContactIdFromCdp(), or pass full
 * cdp_id on launch_plan.audience_cdp_ids for batch scheduling.
 */
export function cdpIdLookupSql(paramIndex: number): string {
  return `(p.cdp_id::text = ANY($${paramIndex}::text[])
    OR (
      p.cdp_id::text ~ '[0-9]{10,}$'
      AND (regexp_match(p.cdp_id::text, '([0-9]{10,})$'))[1] = ANY($${paramIndex}::text[])
    ))`;
}

export function dbIdParam(message = "id is required") {
  return z.object({
    id: z
      .string()
      .trim()
      .min(1, { message })
      .transform(toStableDbId),
  });
}

/** Campaign contact_id bind: numeric as-is, UUID → stable bigint string. */
export function contactIdForCampaign(contactId: string): string {
  return campaignContactIdFromCdp(contactId);
}

/**
 * Map CDP cdp_id → campaign.contact_id bigint string.
 * Numeric ids pass through; CDP-… with digit external_id uses trailing digits.
 */
export function campaignContactIdFromCdp(contactId: string): string {
  const s = String(contactId || "").trim();
  if (!s) return s;
  if (/^\d+$/.test(s)) return s;
  const tail = s.match(/(\d{10,})$/);
  if (tail) return tail[1];
  return toStableDbId(s);
}
