import { randomUUID } from "node:crypto";

import type { DbClient } from "../lib/rls.js";
import {
  SQL_CONVERSATION_TO_CDP_CONTACT,
} from "../lib/sql-uuid.js";

/** Identity key types stored in `cdp.identity_keys`. */
export const IDENTITY_KEY_TYPES = {
  EMAIL: "email",
  PHONE: "phone",
  EMAIL_SECONDARY: "email_secondary",
  PHONE_SECONDARY: "phone_secondary",
  WEBCHAT_VISITOR: "webchat_visitor",
  WHATSAPP_PHONE: "whatsapp_phone",
  INSTAGRAM_USER: "instagram_user",
  FACEBOOK_USER: "facebook_user",
} as const;

export type IdentityKeyType = (typeof IDENTITY_KEY_TYPES)[keyof typeof IDENTITY_KEY_TYPES];

const EMAIL_IDENTITY_KEY_TYPES = new Set<IdentityKeyType>([
  IDENTITY_KEY_TYPES.EMAIL,
  IDENTITY_KEY_TYPES.EMAIL_SECONDARY,
]);

export const PHONE_MATCH_IDENTITY_KEYS = [
  IDENTITY_KEY_TYPES.PHONE,
  IDENTITY_KEY_TYPES.PHONE_SECONDARY,
  IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
] as const;

const PHONE_IDENTITY_KEY_TYPES = new Set<IdentityKeyType>(PHONE_MATCH_IDENTITY_KEYS);

export class IdentityKeyConflictError extends Error {
  readonly keyType: IdentityKeyType;
  readonly keyValue: string;
  readonly existingContactId: string;

  constructor(
    keyType: IdentityKeyType,
    keyValue: string,
    existingContactId: string,
  ) {
    super(
      `${keyType} "${keyValue}" is already linked to contact ${existingContactId}`,
    );
    this.name = "IdentityKeyConflictError";
    this.keyType = keyType;
    this.keyValue = keyValue;
    this.existingContactId = existingContactId;
  }
}

export function normalizeIdentityKeyValue(
  keyType: IdentityKeyType,
  keyValue: string,
): string {
  const trimmed = keyValue.trim();
  if (!trimmed) return trimmed;
  if (EMAIL_IDENTITY_KEY_TYPES.has(keyType)) {
    return trimmed.toLowerCase();
  }
  if (PHONE_IDENTITY_KEY_TYPES.has(keyType)) {
    return trimmed.replace(/\D/g, "");
  }
  return trimmed;
}

export function isIdentityKeyConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & {
    code?: string;
    meta?: { code?: string; message?: string };
  };
  return (
    details.meta?.code === "23505" ||
    /idx_identity_keys_unique|unique constraint.*key_value/i.test(
      `${details.message} ${details.meta?.message ?? ""}`,
    )
  );
}

export function readCustomFieldBool(
  customFields: Record<string, unknown> | null | undefined,
  key: string,
  fallback = true,
): boolean {
  const value = customFields?.[key];
  if (typeof value === "boolean") return value;
  if (value === "false") return false;
  if (value === "true") return true;
  return fallback;
}

export function readCustomFieldString(
  customFields: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = customFields?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function findCdpIdByIdentityKey(
  db: DbClient,
  organizationId: string,
  keyType: IdentityKeyType,
  keyValue: string,
): Promise<string | null> {
  const normalized = normalizeIdentityKeyValue(keyType, keyValue);
  if (!normalized) return null;

  if (EMAIL_IDENTITY_KEY_TYPES.has(keyType)) {
    const rows = await db.$queryRaw<{ cdp_id: string }[]>`
      SELECT cdp_id
      FROM cdp.identity_keys
      WHERE organization_id = ${organizationId}::bigint
        AND key_type = ${keyType}
        AND lower(key_value) = lower(${normalized})
      LIMIT 1
    `;
    return rows[0]?.cdp_id ?? null;
  }

  if (PHONE_IDENTITY_KEY_TYPES.has(keyType)) {
    const rows = await db.$queryRaw<{ cdp_id: string }[]>`
      SELECT ik.cdp_id
      FROM cdp.identity_keys ik
      LEFT JOIN cdp.customer_profile cp
        ON cp.cdp_id = ik.cdp_id
       AND cp.organization_id = ik.organization_id
      WHERE ik.organization_id = ${organizationId}::bigint
        AND ik.key_type = ${keyType}
        AND regexp_replace(ik.key_value, '\\D', '', 'g') = ${normalized}
      ORDER BY
        CASE
          WHEN NULLIF(btrim(COALESCE(cp.first_name, '')), '') IS NOT NULL THEN 0
          ELSE 1
        END
      LIMIT 1
    `;
    return rows[0]?.cdp_id ?? null;
  }

  const rows = await db.$queryRaw<{ cdp_id: string }[]>`
    SELECT cdp_id
    FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND key_type = ${keyType}
      AND key_value = ${normalized}
    LIMIT 1
  `;
  return rows[0]?.cdp_id ?? null;
}

const PHONE_MATCH_MIN_DIGITS = 10;
const COUNTRY_CODE_MAX_DIGITS = 3;

/** Digits only, with a leading international 00 removed. + is not a digit. */
export function comparablePhoneDigits(value: string | null | undefined): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

/** Same subscriber number with or without a 1–3 digit country code, + , or 00. */
export function phonesMatchWithCountryCode(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const first = comparablePhoneDigits(left);
  const second = comparablePhoneDigits(right);
  if (!first || !second) return false;
  if (first === second) return true;
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length < PHONE_MATCH_MIN_DIGITS || !longer.endsWith(shorter)) return false;
  const prefixLength = longer.length - shorter.length;
  return prefixLength >= 1 && prefixLength <= COUNTRY_CODE_MAX_DIGITS;
}

/** Match a stored number to the same subscriber number with or without + and a country code. */
export async function findCdpIdByMatchingPhone(
  db: DbClient,
  organizationId: string,
  phone: string,
  excludingCdpId?: string,
): Promise<string | null> {
  const digits = comparablePhoneDigits(phone);
  if (digits.length < 7) return null;

  const rows = await db.$queryRawUnsafe<Array<{ cdp_id: string }>>(
    `
    SELECT matched.cdp_id
    FROM (
      SELECT
        ik.cdp_id,
        regexp_replace(regexp_replace(ik.key_value, '\\D', '', 'g'), '^00', '') AS digits,
        cp.first_name,
        cp.created_at
      FROM cdp.identity_keys ik
      LEFT JOIN cdp.customer_profile cp
        ON cp.cdp_id = ik.cdp_id
       AND cp.organization_id = ik.organization_id
      WHERE ik.organization_id = $1::bigint
        AND ik.key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
        AND ($3::text IS NULL OR ik.cdp_id <> $3::text)
    ) matched
    WHERE matched.digits <> ''
      AND (
        matched.digits = $2
        OR (
          length(matched.digits) >= $4::int
          AND length($2) >= $4::int
          AND (
            (
              length(matched.digits) - length($2) BETWEEN 1 AND $5::int
              AND matched.digits LIKE ('%' || $2)
            )
            OR (
              length($2) - length(matched.digits) BETWEEN 1 AND $5::int
              AND $2 LIKE ('%' || matched.digits)
            )
          )
        )
      )
    ORDER BY
      CASE
        WHEN NULLIF(btrim(COALESCE(matched.first_name, '')), '') IS NOT NULL THEN 0
        ELSE 1
      END,
      length(matched.digits) DESC,
      matched.created_at ASC NULLS LAST
    LIMIT 1
    `,
    organizationId,
    digits,
    excludingCdpId ?? null,
    PHONE_MATCH_MIN_DIGITS,
    COUNTRY_CODE_MAX_DIGITS,
  );
  return rows[0]?.cdp_id ?? null;
}

export async function emailIdentityExists(
  db: DbClient,
  organizationId: string,
  email: string,
  excludingCdpId?: string,
): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM cdp.identity_keys
      WHERE organization_id = $1::bigint
        AND key_type IN ('email', 'email_secondary')
        AND lower(key_value) = lower($2)
        AND ($3::text IS NULL OR cdp_id <> $3::text)
    ) AS exists
    `,
    organizationId,
    email,
    excludingCdpId ?? null,
  );
  return rows[0]?.exists ?? false;
}

export type UpsertIdentityKeyResult = "registered" | "unchanged";

/** Drop leftover keys of the same type so GET (LIMIT 1) cannot return a stale phone/email. */
export async function replaceSiblingIdentityKeys(
  db: DbClient,
  organizationId: string,
  cdpId: string,
  keyType: IdentityKeyType,
  keepValue: string,
): Promise<void> {
  const normalized = normalizeIdentityKeyValue(keyType, keepValue);
  if (!normalized) return;

  if (EMAIL_IDENTITY_KEY_TYPES.has(keyType)) {
    await db.$executeRaw`
      DELETE FROM cdp.identity_keys
      WHERE organization_id = ${organizationId}::bigint
        AND cdp_id = ${cdpId}::text
        AND key_type = ${keyType}
        AND lower(key_value) <> lower(${normalized})
    `;
    return;
  }

  await db.$executeRaw`
    DELETE FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${cdpId}::text
      AND key_type = ${keyType}
      AND key_value <> ${normalized}
  `;
}

export async function upsertIdentityKey(
  db: DbClient,
  organizationId: string,
  cdpId: string,
  keyType: IdentityKeyType,
  keyValue: string,
  sourceSystem?: string | null,
  options: { allowReassign?: boolean } = {},
): Promise<UpsertIdentityKeyResult> {
  const normalized = normalizeIdentityKeyValue(keyType, keyValue);
  if (!normalized) {
    throw new Error(`Cannot register empty identity key for ${keyType}`);
  }

  const existingOwner = await findCdpIdByIdentityKey(
    db,
    organizationId,
    keyType,
    normalized,
  );
  if (existingOwner === cdpId) {
    return "unchanged";
  }
  if (existingOwner && !options.allowReassign) {
    throw new IdentityKeyConflictError(keyType, normalized, existingOwner);
  }

  if (existingOwner && options.allowReassign) {
    if (EMAIL_IDENTITY_KEY_TYPES.has(keyType)) {
      await db.$executeRaw`
        UPDATE cdp.identity_keys
        SET cdp_id = ${cdpId}::text,
            key_value = ${normalized},
            source_system = COALESCE(${sourceSystem ?? null}, source_system)
        WHERE organization_id = ${organizationId}::bigint
          AND key_type = ${keyType}
          AND lower(key_value) = lower(${normalized})
      `;
    } else {
      await db.$executeRaw`
        UPDATE cdp.identity_keys
        SET cdp_id = ${cdpId}::text,
            source_system = COALESCE(${sourceSystem ?? null}, source_system)
        WHERE organization_id = ${organizationId}::bigint
          AND key_type = ${keyType}
          AND key_value = ${normalized}
      `;
    }
    return "registered";
  }

  try {
    await db.$executeRaw`
      INSERT INTO cdp.identity_keys (
        identity_id, cdp_id, organization_id, key_type, key_value, source_system, verified, created_at
      ) VALUES (
        ${randomUUID()},
        ${cdpId}::text,
        ${organizationId}::bigint,
        ${keyType},
        ${normalized},
        ${sourceSystem ?? null},
        FALSE,
        NOW()
      )
    `;
    return "registered";
  } catch (error) {
    if (!isIdentityKeyConflict(error)) {
      throw error;
    }
    const owner = await findCdpIdByIdentityKey(db, organizationId, keyType, normalized);
    if (owner === cdpId) {
      return "unchanged";
    }
    if (owner) {
      throw new IdentityKeyConflictError(keyType, normalized, owner);
    }
    throw error;
  }
}

const CUSTOMER_PROFILE_IDENTITY_JOINS = `
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys
    WHERE cdp_id = cp.cdp_id
      AND organization_id = cp.organization_id
      AND key_type = 'email'
    ORDER BY created_at DESC
    LIMIT 1
  ) email_ik ON TRUE
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys
    WHERE cdp_id = cp.cdp_id
      AND organization_id = cp.organization_id
      AND key_type = 'phone'
    ORDER BY created_at DESC
    LIMIT 1
  ) phone_ik ON TRUE
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys
    WHERE cdp_id = cp.cdp_id
      AND organization_id = cp.organization_id
      AND key_type = 'email_secondary'
    ORDER BY created_at DESC
    LIMIT 1
  ) email2_ik ON TRUE
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys
    WHERE cdp_id = cp.cdp_id
      AND organization_id = cp.organization_id
      AND key_type = 'phone_secondary'
    ORDER BY created_at DESC
    LIMIT 1
  ) phone2_ik ON TRUE
`;

/** List view — identity keys only; skips conversation/message scans per row. */
export const CUSTOMER_PROFILE_LIST_SELECT = `
  SELECT
    cp.cdp_id AS id,
    cp.organization_id,
    cp.first_name,
    cp.last_name,
    cp.gender,
    cp.date_of_birth,
    cp.company,
    cp.city,
    cp.region,
    cp.country,
    cp.language,
    cp.timezone,
    cp.acquisition_channel AS source_system,
    cp.custom_fields,
    COALESCE(cp.blocked, FALSE) AS blocked,
    cp.created_at,
    cp.updated_at,
    cp.last_seen_at,
    email_ik.key_value AS primary_email,
    phone_ik.key_value AS primary_phone,
    email2_ik.key_value AS secondary_email,
    phone2_ik.key_value AS secondary_phone,
    NULL::text AS whatsapp_display_name
  FROM cdp.customer_profile cp
  ${CUSTOMER_PROFILE_IDENTITY_JOINS}
`;

export const CUSTOMER_PROFILE_SELECT = `
  SELECT
    cp.cdp_id AS id,
    cp.organization_id,
    cp.first_name,
    cp.last_name,
    cp.gender,
    cp.date_of_birth,
    cp.company,
    cp.city,
    cp.region,
    cp.country,
    cp.language,
    cp.timezone,
    cp.acquisition_channel AS source_system,
    cp.custom_fields,
    COALESCE(cp.blocked, FALSE) AS blocked,
    cp.created_at,
    cp.updated_at,
    cp.last_seen_at,
    email_ik.key_value AS primary_email,
    phone_ik.key_value AS primary_phone,
    email2_ik.key_value AS secondary_email,
    phone2_ik.key_value AS secondary_phone,
    COALESCE(wa_subject.display_name, wa_message.display_name) AS whatsapp_display_name
  FROM cdp.customer_profile cp
  ${CUSTOMER_PROFILE_IDENTITY_JOINS}
  LEFT JOIN LATERAL (
    SELECT NULLIF(trim(c.subject), '') AS display_name
    FROM ccass.conversations c
    WHERE c.organization_id = cp.organization_id
      AND ${SQL_CONVERSATION_TO_CDP_CONTACT}
      AND c.channel = 'whatsapp'
      AND NULLIF(trim(c.subject), '') IS NOT NULL
      AND lower(trim(c.subject)) NOT IN ('whatsapp', 'e2e customer')
    ORDER BY c.updated_at DESC
    LIMIT 1
  ) wa_subject ON TRUE
  LEFT JOIN LATERAL (
    SELECT NULLIF(trim(cm.model_metadata->>'customerName'), '') AS display_name
    FROM ccass.conversations c
    INNER JOIN ccass.conversation_messages cm
      ON cm.conversation_id = c.id
     AND cm.organization_id = c.organization_id
    WHERE c.organization_id = cp.organization_id
      AND ${SQL_CONVERSATION_TO_CDP_CONTACT}
      AND c.channel = 'whatsapp'
      AND NULLIF(trim(cm.model_metadata->>'customerName'), '') IS NOT NULL
    ORDER BY cm.created_at DESC
    LIMIT 1
  ) wa_message ON TRUE
`;
