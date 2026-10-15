// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { accountQuery } from "../plugins/account-pool.js";

/** Per-query account DB options (Hub on-demand uses longer timeout, no wide fallback scan). */
export type ContactDbQueryOpts = {
  timeoutMs?: number;
  /** When true, do not scan thousands of profiles if hashed id lookup misses. */
  skipOpaqueFallback?: boolean;
};

export const ON_DEMAND_CONTACT_LOOKUP_OPTS: ContactDbQueryOpts = {
  timeoutMs: 120_000,
  skipOpaqueFallback: true,
};
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { accountOrgParam } from "../helpers/account-ids.js";
import {
  campaignContactIdFromCdp,
  cdpIdLookupSql,
  expandContactLookupIds,
  newContactId,
} from "../helpers/id-schema.js";
import { AppError } from "../helpers/response-builders.js";
import { RESPONSE } from "../helpers/constants.js";
import { extractCustomFields } from "../helpers/contact-custom-fields.js";
import {
  emptyPreferences,
  isPreferenceChannel,
  mergePreferencesJson,
  normalizePreferencesJson,
  preferencesChannelIsOnSql,
  preferencesFromEngagement,
  type ContactPreferencesJson,
} from "../helpers/contact-preferences.js";
import {
  LOOKBACK_DAYS,
  computePreferenceWindows,
  fillMissingWindows,
} from "../helpers/contact-preference-timing.js";
import {
  getEngagementForContact,
  listEmailUnsubscribedContactIds,
} from "./campaign-contact-engagement.js";
import {
  isValidEmailFormat,
  parseAndValidatePhone,
  titleCasePersonName,
  validateContactIdentityFlexible,
} from "../helpers/contact-validation.js";

/** CDP/accounts organization_id (bigint or uuid text) from campaign session tenant UUID. */
function cdpOrg(organizationId: string): string {
  return accountOrgParam(organizationId);
}

/**
 * Contacts = CDP profiles + identity keys.
 * - Profile: cdp.customer_profile (PK cdp_id → API `id` / campaign contact_id refs)
 * - Identities: cdp.identity_keys (key_type email | phone)
 * Allowed: SELECT / INSERT / UPDATE / DELETE on existing columns only.
 * Forbidden: ALTER / add columns. Campaign engagement stays in campaign schema.
 */
export type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  created_at: string | null;
  /** Extra attrs (job_title, segment, score, …) — JSONB on customer_profile. */
  custom_fields: Record<string, unknown>;
  /**
   * CDP preferences_json — preferred/active channels as 0|1, plus optional
   * timezone / timing / channel_timing. Audience SQL still uses top-level flags.
   */
  preferences_json: ContactPreferencesJson;
};

export type ContactFilterInput = {
  city?: string | null;
  company?: string | null;
  /** Role/title — matches custom_fields job_title / title / role (no CDP ALTER). */
  job_title?: string | null;
  has_email?: boolean | null;
  has_phone?: boolean | null;
  search?: string | null;
  /** Exact email matches (OR). Prefer this over search for named addresses. */
  emails?: string[] | null;
  /** Exact phone matches (OR, digit-normalized / last-10). */
  phones?: string[] | null;
  /**
   * Optional soft CPMA filter — only when the user asks to narrow by consent.
   * Does not block contacts by default.
   */
  consent_source?: string | null;
  /** B2C — matches custom_fields segment / customer_segment. */
  segment?: string | null;
  /** B2C — matches custom_fields product_interest / interest / product. */
  product_interest?: string | null;
  /** Numeric floor on custom_fields.score when that key exists. */
  min_score?: number | null;
  /**
   * Extra JSONB equals/ILIKE on keys that exist on this tenant's contacts.
   * Rejected internals (campaign_deleted) are ignored.
   */
  custom_fields?: Record<string, string | number | boolean> | null;
  /**
   * Prefer contacts with preferences_json.<channel> = 1
   * (email | whatsapp | push | web | sms).
   */
  preferred_channel?: string | null;
};

export type FilterableField = {
  key: string;
  source: "core" | "custom_fields";
  type: "string" | "number" | "boolean" | "string[]";
  description: string;
};

const RESERVED_CUSTOM_FIELD_KEYS = new Set([
  "campaign_deleted",
]);

const CORE_FILTERABLE_FIELDS: FilterableField[] = [
  {
    key: "preferred_channel",
    source: "core",
    type: "string",
    description:
      "preferences_json channel flag = 1 (email|whatsapp|push|web|sms)",
  },
  {
    key: "emails",
    source: "core",
    type: "string[]",
    description: "Exact primary emails (OR)",
  },
  {
    key: "phones",
    source: "core",
    type: "string[]",
    description: "Exact phones, digit-normalized / last-10 (OR)",
  },
  {
    key: "city",
    source: "core",
    type: "string",
    description: "Profile city",
  },
  {
    key: "company",
    source: "core",
    type: "string",
    description: "Profile company",
  },
  {
    key: "search",
    source: "core",
    type: "string",
    description: "Free-text name / email / company / city / phone",
  },
  {
    key: "has_email",
    source: "core",
    type: "boolean",
    description: "Require a stored email",
  },
  {
    key: "has_phone",
    source: "core",
    type: "boolean",
    description: "Require a stored phone",
  },
  {
    key: "consent_source",
    source: "core",
    type: "string",
    description: "custom_fields.campaign_consent_source",
  },
];

function isSafeJsonbKey(key: string): boolean {
  return /^[a-zA-Z0-9_]{1,64}$/.test(key);
}

const JOB_TITLE_EXPR = `coalesce(
  p.custom_fields->>'job_title',
  p.custom_fields->>'title',
  p.custom_fields->>'role',
  ''
)`;

/** Combined display name for partial name search (first + last). */
const FULL_NAME_EXPR = `trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))`;

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * B2B phrase match: exact (ci) or token-boundary. Optional prefix for company
 * ("Acme" → "Acme Inc") — never leading-% substring ("acme" ↛ "PlaceMe").
 */
function pushB2bPhraseMatch(
  clauses: string[],
  params: unknown[],
  i: number,
  columnExpr: string,
  raw: string,
  opts?: { allowPrefix?: boolean },
): number {
  const value = raw.trim();
  if (!value) return i;
  const regex = escapeRegexLiteral(value);
  const parts = [
    `lower(btrim(${columnExpr})) = lower(btrim($${i}))`,
    `coalesce(${columnExpr}, '') ~* ('(^|[^[:alnum:]])' || $${i + 1} || '([^[:alnum:]]|$)')`,
  ];
  params.push(value, regex);
  i += 2;
  if (opts?.allowPrefix && value.length >= 3) {
    parts.push(
      `lower(btrim(${columnExpr})) LIKE lower($${i}) || '%' ESCAPE '\\'`,
    );
    params.push(escapeLikeLiteral(value));
    i += 1;
  }
  clauses.push(`(${parts.join(" OR ")})`);
  return i;
}

export type AudienceConsentSummary = {
  by_source: Record<string, number>;
  weak_count: number;
  missing_count: number;
  contactable_false_count: number;
  /** Non-blocking advisory messages for the agent/UI. */
  warnings: string[];
};

export type AudienceQualitySummary = {
  with_email: number;
  with_phone: number;
  missing_email: number;
  missing_phone: number;
  sample_size: number;
  /** Non-blocking channel-fit notes. */
  notes: string[];
};

export type ContactInput = {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  city?: string | null;
  /** Non-column attrs → customer_profile.custom_fields */
  customFields?: Record<string, unknown> | null;
};

const KEY_EMAIL = "email";
const KEY_PHONE = "phone";

/** Soft-delete flag stored in custom_fields (no schema ALTER). */
const NOT_DELETED = `coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false`;

/** At least one usable contacting channel (email or phone identity key). */
const HAS_CONTACT_CHANNEL = `(
  EXISTS (
    SELECT 1 FROM cdp.identity_keys ik
    WHERE ik.cdp_id = p.cdp_id
      AND ik.organization_id::text = p.organization_id::text
      AND lower(ik.key_type) IN (
        'email', 'primary_email', 'phone', 'primary_phone', 'mobile'
      )
      AND btrim(coalesce(ik.key_value,'')) <> ''
  )
)`;

/** Pre-filter org contacts that have email/phone — avoids per-row double EXISTS. */
const CHANNEL_IDS_CTE = `
  channel_ids AS (
    SELECT DISTINCT ik.cdp_id
    FROM cdp.identity_keys ik
    WHERE ik.organization_id::text = $1::text
      AND lower(ik.key_type) IN (
        'email', 'primary_email', 'phone', 'primary_phone', 'mobile'
      )
      AND btrim(coalesce(ik.key_value,'')) <> ''
  )
`;

const WEAK_CONSENT = new Set([
  "",
  "unknown",
  "verbal",
  "booth",
  "offline",
  "other",
  "none",
]);

/**
 * Map profile + identity keys → API contact shape.
 * `id` is always customer_profile.cdp_id.
 */
const CONTACT_FROM = `
  FROM cdp.customer_profile p
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id::text = p.cdp_id::text
      AND ik.organization_id::text = p.organization_id::text
      AND lower(ik.key_type) IN ('email', 'primary_email')
    ORDER BY ik.verified DESC, ik.created_at DESC
    LIMIT 1
  ) email_k ON true
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id::text = p.cdp_id::text
      AND ik.organization_id::text = p.organization_id::text
      AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
    ORDER BY ik.verified DESC, ik.created_at DESC
    LIMIT 1
  ) phone_k ON true
`;

const CONTACT_SELECT = `
  p.cdp_id AS id,
  p.first_name,
  p.last_name,
  email_k.key_value AS email,
  phone_k.key_value AS phone,
  p.company AS company_name,
  p.city,
  p.created_at,
  coalesce(p.custom_fields, '{}'::jsonb) AS custom_fields,
  coalesce(p.preferences_json, '{}'::jsonb) AS preferences_json
`;

type DbContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  created_at: Date | string | null;
  custom_fields?: Record<string, unknown> | string | null;
  preferences_json?: Record<string, unknown> | string | null;
};

function parseCustomFields(
  raw: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ...raw };
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      return {};
    }
  }
  return {};
}

function mapRow(row: DbContact): ContactRow {
  return {
    id: row.id,
    first_name: row.first_name ? titleCasePersonName(row.first_name) : row.first_name,
    last_name: row.last_name ? titleCasePersonName(row.last_name) : row.last_name,
    email: row.email,
    phone: row.phone,
    company_name: row.company_name,
    city: row.city,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at
          ? String(row.created_at)
          : null,
    custom_fields: parseCustomFields(row.custom_fields),
    preferences_json: normalizePreferencesJson(
      parseCustomFields(row.preferences_json),
    ),
  };
}

function normalizeInput(input: ContactInput) {
  const firstName = titleCasePersonName(input.firstName);
  const lastTrim = input.lastName?.trim() || "";
  const lastName = lastTrim ? titleCasePersonName(lastTrim) : null;
  const emailRaw = (input.email || "").trim().toLowerCase();
  const phoneRaw = (input.phone || "").trim();
  const companyName = input.companyName?.trim() || null;
  const city = input.city?.trim() || null;

  const errors: string[] = [];

  if (!firstName) {
    errors.push("First name is required.");
  }

  let email: string | null = null;
  if (emailRaw) {
    if (!isValidEmailFormat(emailRaw)) {
      errors.push("Enter a valid email address.");
    } else {
      email = emailRaw;
    }
  }

  let phone: string | null = null;
  if (!phoneRaw) {
    errors.push(
      "Phone number with country code is required (e.g. +91 9876543210).",
    );
  } else {
    const phoneParsed = parseAndValidatePhone(phoneRaw);
    if (!phoneParsed.ok) {
      errors.push(phoneParsed.message);
    } else {
      phone = phoneParsed.e164;
    }
  }

  if (errors.length) {
    throw new AppError(errors.join(" "), 400);
  }

  return {
    firstName,
    lastName,
    email,
    phone,
    companyName,
    city,
    customFields:
      input.customFields && typeof input.customFields === "object"
        ? { ...input.customFields }
        : {},
  };
}

/** App-push / integration create — email and/or phone (at least one). */
function normalizeIntegrationInput(input: ContactInput) {
  const firstName = titleCasePersonName(input.firstName || "App");
  const lastTrim = input.lastName?.trim() || "";
  const lastName = lastTrim ? titleCasePersonName(lastTrim) : "User";
  const identity = validateContactIdentityFlexible({
    email: input.email,
    phone: input.phone,
  });
  if (!identity.ok) {
    throw new AppError(identity.message, 400);
  }
  return {
    firstName,
    lastName,
    email: identity.email,
    phone: identity.phone,
    companyName: input.companyName?.trim() || null,
    city: input.city?.trim() || null,
    customFields:
      input.customFields && typeof input.customFields === "object"
        ? { ...input.customFields }
        : {},
  };
}

export async function createContactForIntegrationDao(
  session: CampaignSessionUser,
  input: ContactInput,
): Promise<ContactRow> {
  const data = normalizeIntegrationInput(input);

  await purgeDeletedIdentityKeys(session.organizationId, data.email, data.phone);

  if (data.email) {
    const owner = await findIdentityOwner(
      session.organizationId,
      KEY_EMAIL,
      data.email,
    );
    if (owner) throw new AppError(RESPONSE.existContact, 400);
  }
  if (data.phone) {
    const owner = await findIdentityOwner(
      session.organizationId,
      KEY_PHONE,
      data.phone,
    );
    if (owner) throw new AppError(RESPONSE.existContact, 400);
  }

  const cdpId = newContactId(session.organizationId, {
    sourceName: "campaign",
  });
  const customFields =
    data.customFields && Object.keys(data.customFields).length
      ? data.customFields
      : {};
  const { rows } = await accountQuery<{ cdp_id: string }>(
    `INSERT INTO cdp.customer_profile (
       cdp_id, organization_id, first_name, last_name, company, city,
       custom_fields, created_at, updated_at, first_seen_at, last_seen_at,
       acquisition_channel
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, now(), now(), now(), now(),
       'campaign'
     )
     RETURNING cdp_id`,
    [
      cdpId,
      cdpOrg(session.organizationId),
      data.firstName,
      data.lastName,
      data.companyName,
      data.city,
      JSON.stringify(customFields),
    ],
  );

  if (!rows[0]?.cdp_id) {
    throw new AppError(RESPONSE.failedContact, 400);
  }

  try {
    await upsertIdentityKeys(session.organizationId, cdpId, data.email, data.phone);
  } catch (err) {
    await accountQuery(
      `DELETE FROM cdp.customer_profile WHERE cdp_id::text = $1::text`,
      [cdpId],
    );
    throw err instanceof AppError
      ? err
      : new AppError(RESPONSE.existContact, 400);
  }

  const created = await getMappedById(session.organizationId, cdpId);
  if (!created) {
    throw new AppError(RESPONSE.failedContact, 400);
  }
  return created;
}

async function findIdentityOwner(
  organizationId: string,
  keyType: "email" | "phone",
  keyValue: string,
  excludeCdpId?: string,
): Promise<string | null> {
  const cdpOrgId = cdpOrg(organizationId);
  if (keyType === KEY_PHONE) {
    const params: unknown[] = [cdpOrgId, keyValue];
    let exclude = "";
    if (excludeCdpId) {
      exclude = ` AND ik.cdp_id::text <> $3::text`;
      params.push(excludeCdpId);
    }
    const { rows } = await accountQuery<{ cdp_id: string }>(
      `SELECT ik.cdp_id FROM cdp.identity_keys ik
       JOIN cdp.customer_profile p ON p.cdp_id::text = ik.cdp_id::text
       WHERE ik.organization_id::text = $1::text
         AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
         AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false
         AND (
           ik.key_value = $2
           OR regexp_replace(coalesce(ik.key_value,''), '[^0-9+]', '', 'g')
              = regexp_replace($2, '[^0-9+]', '', 'g')
         )
         ${exclude}
       LIMIT 1`,
      params,
    );
    return rows[0]?.cdp_id ?? null;
  }

  const params: unknown[] = [cdpOrgId, keyValue];
  let exclude = "";
    if (excludeCdpId) {
      exclude = ` AND ik.cdp_id::text <> $3::text`;
      params.push(excludeCdpId);
    }
    const { rows } = await accountQuery<{ cdp_id: string }>(
      `SELECT ik.cdp_id FROM cdp.identity_keys ik
       JOIN cdp.customer_profile p ON p.cdp_id::text = ik.cdp_id::text
       WHERE ik.organization_id::text = $1::text
         AND lower(ik.key_type) IN ('email', 'primary_email')
       AND lower(ik.key_value) = lower($2)
       AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false
       ${exclude}
     LIMIT 1`,
    params,
  );
  return rows[0]?.cdp_id ?? null;
}

async function purgeDeletedIdentityKeys(
  organizationId: string,
  email: string | null,
  phone: string | null,
) {
  const cdpOrgId = cdpOrg(organizationId);
  if (email) {
    await accountQuery(
      `DELETE FROM cdp.identity_keys ik
       USING cdp.customer_profile p
       WHERE ik.cdp_id::text = p.cdp_id::text
         AND ik.organization_id::text = $1::text
         AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = true
         AND lower(ik.key_type) IN ('email', 'primary_email')
         AND lower(ik.key_value) = lower($2)`,
      [cdpOrgId, email],
    );
  }
  if (phone) {
    await accountQuery(
      `DELETE FROM cdp.identity_keys ik
       USING cdp.customer_profile p
       WHERE ik.cdp_id::text = p.cdp_id::text
         AND ik.organization_id::text = $1::text
         AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = true
         AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
         AND (
           ik.key_value = $2
           OR regexp_replace(coalesce(ik.key_value,''), '[^0-9+]', '', 'g')
              = regexp_replace($2, '[^0-9+]', '', 'g')
         )`,
      [cdpOrgId, phone],
    );
  }
}

/** Hub/API: add email identity when profile exists but has no email key yet. */
export async function ensureRequestEmailsOnCdpContactsDao(
  session: CampaignSessionUser,
  pairs: Array<{ cdpId: string; email: string }>,
): Promise<number> {
  const cdpOrgId = cdpOrg(session.organizationId);
  let attached = 0;
  for (const pair of pairs) {
    const cdpId = String(pair.cdpId || "").trim();
    const email = String(pair.email || "").trim().toLowerCase();
    if (!cdpId || !email || !isValidEmailFormat(email)) continue;

    const { rowCount: profileOk } = await accountQuery(
      `SELECT 1 FROM cdp.customer_profile p
       WHERE p.cdp_id::text = $1::text
         AND p.organization_id::text = $2::text
         AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false
       LIMIT 1`,
      [cdpId, cdpOrgId],
    );
    if (!profileOk) continue;

    const { rowCount: hasEmailKey } = await accountQuery(
      `SELECT 1 FROM cdp.identity_keys ik
       WHERE ik.cdp_id::text = $1::text
         AND ik.organization_id::text = $2::text
         AND lower(ik.key_type) IN ('email', 'primary_email')
       LIMIT 1`,
      [cdpId, cdpOrgId],
    );
    if (hasEmailKey) continue;

    const { rowCount } = await accountQuery(
      `INSERT INTO cdp.identity_keys (
         identity_id, cdp_id, key_type, key_value, source_system,
         verified, created_at, organization_id, custom_fields
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 'hub',
         true, now(), $4, '{}'::jsonb
       )`,
      [cdpId, KEY_EMAIL, email, cdpOrgId],
    );
    if (rowCount) attached += 1;
  }
  return attached;
}

async function upsertIdentityKeys(
  organizationId: string,
  cdpId: string,
  email: string | null,
  phone: string | null,
) {
  const cdpOrgId = cdpOrg(organizationId);
  // Replace campaign-managed email/phone keys for this profile
  await accountQuery(
    `DELETE FROM cdp.identity_keys
     WHERE cdp_id::text = $1::text
       AND organization_id::text = $2::text
       AND lower(key_type) IN ('email', 'primary_email', 'phone', 'primary_phone', 'mobile')`,
    [cdpId, cdpOrgId],
  );

  if (email) {
    await accountQuery(
      `INSERT INTO cdp.identity_keys (
         identity_id, cdp_id, key_type, key_value, source_system,
         verified, created_at, organization_id, custom_fields
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 'campaign',
         true, now(), $4, '{}'::jsonb
       )`,
      [cdpId, KEY_EMAIL, email, cdpOrgId],
    );
  }
  if (phone) {
    await accountQuery(
      `INSERT INTO cdp.identity_keys (
         identity_id, cdp_id, key_type, key_value, source_system,
         verified, created_at, organization_id, custom_fields
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 'campaign',
         true, now(), $4, '{}'::jsonb
       )`,
      [cdpId, KEY_PHONE, phone, cdpOrgId],
    );
  }
}

async function getMappedById(
  organizationId: string,
  cdpId: string,
): Promise<ContactRow | null> {
  const cdpOrgId = cdpOrg(organizationId);
  const { rows } = await accountQuery<DbContact>(
    `SELECT ${CONTACT_SELECT}
     ${CONTACT_FROM}
     WHERE p.cdp_id::text = $1::text
       AND p.organization_id::text = $2::text
       AND ${NOT_DELETED}
     LIMIT 1`,
    [cdpId, cdpOrgId],
  );
  if (rows[0]) return mapRow(rows[0]);
  // Same cdp_id, in case organization_id type/format differs from session tenant.
  const fallback = await accountQuery<DbContact>(
    `SELECT ${CONTACT_SELECT}
     ${CONTACT_FROM}
     WHERE p.cdp_id::text = $1::text
       AND ${NOT_DELETED}
     LIMIT 1`,
    [cdpId],
  );
  return fallback.rows[0] ? mapRow(fallback.rows[0]) : null;
}

/** Audience list — profiles first, then batch identity lookup (faster than per-row LATERAL). */
function buildContactListSearchClause(
  search: string | null | undefined,
  params: unknown[],
  paramIndex: number,
): { clause: string; nextIndex: number } {
  const q = search?.trim();
  if (!q) return { clause: "TRUE", nextIndex: paramIndex };
  const like = `%${escapeLikeLiteral(q)}%`;
  params.push(like);
  return {
    clause: `(
      coalesce(p.first_name,'') ILIKE $${paramIndex} ESCAPE '\\'
      OR coalesce(p.last_name,'') ILIKE $${paramIndex} ESCAPE '\\'
      OR ${FULL_NAME_EXPR} ILIKE $${paramIndex} ESCAPE '\\'
      OR coalesce(p.company,'') ILIKE $${paramIndex} ESCAPE '\\'
      OR coalesce(p.city,'') ILIKE $${paramIndex} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM cdp.identity_keys ik
        WHERE ik.cdp_id = p.cdp_id
          AND ik.organization_id::text = p.organization_id::text
          AND btrim(coalesce(ik.key_value,'')) <> ''
          AND ik.key_value ILIKE $${paramIndex} ESCAPE '\\'
      )
    )`,
    nextIndex: paramIndex + 1,
  };
}

function buildListContactsSql(limitParam: number, offsetParam: number, searchClause: string) {
  return `
  WITH ${CHANNEL_IDS_CTE},
  profiles AS (
    SELECT
      p.cdp_id AS id,
      p.first_name,
      p.last_name,
      p.company AS company_name,
      p.city,
      p.created_at,
      coalesce(p.custom_fields, '{}'::jsonb) AS custom_fields,
      coalesce(p.preferences_json, '{}'::jsonb) AS preferences_json
    FROM cdp.customer_profile p
    INNER JOIN channel_ids ch ON ch.cdp_id = p.cdp_id
    WHERE p.organization_id::text = $1::text
      AND ${NOT_DELETED}
      AND ${searchClause}
    ORDER BY lower(coalesce(p.first_name, '')),
             lower(coalesce(p.last_name, '')),
             p.created_at ASC NULLS LAST,
             p.cdp_id
    OFFSET $${offsetParam} LIMIT $${limitParam}
  ),
  emails AS (
    SELECT DISTINCT ON (ik.cdp_id)
      ik.cdp_id,
      ik.key_value
    FROM cdp.identity_keys ik
    INNER JOIN profiles pr ON pr.id = ik.cdp_id
    WHERE ik.organization_id::text = $1::text
      AND lower(ik.key_type) IN ('email', 'primary_email')
    ORDER BY ik.cdp_id, ik.verified DESC, ik.created_at DESC
  ),
  phones AS (
    SELECT DISTINCT ON (ik.cdp_id)
      ik.cdp_id,
      ik.key_value
    FROM cdp.identity_keys ik
    INNER JOIN profiles pr ON pr.id = ik.cdp_id
    WHERE ik.organization_id::text = $1::text
      AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
    ORDER BY ik.cdp_id, ik.verified DESC, ik.created_at DESC
  )
  SELECT
    pr.id,
    pr.first_name,
    pr.last_name,
    e.key_value AS email,
    ph.key_value AS phone,
    pr.company_name,
    pr.city,
    pr.created_at,
    pr.custom_fields,
    pr.preferences_json
  FROM profiles pr
  LEFT JOIN emails e ON pr.id = e.cdp_id
  LEFT JOIN phones ph ON pr.id = ph.cdp_id
  ORDER BY lower(coalesce(pr.first_name, '')),
           lower(coalesce(pr.last_name, '')),
           pr.created_at ASC NULLS LAST,
           pr.id
`;
}

export type ListContactsResult = {
  items: ContactRow[];
  total: number;
  withChannel: number;
  page: number;
  limit: number;
};

export async function listContactsDao(
  session: CampaignSessionUser,
  opts: { page?: number; limit?: number; search?: string | null } = {},
): Promise<ListContactsResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const offset = (page - 1) * limit;
  const org = cdpOrg(session.organizationId);

  const filterParams: unknown[] = [org];
  const { clause: searchClause, nextIndex } = buildContactListSearchClause(
    opts.search,
    filterParams,
    2,
  );
  const limitParam = nextIndex;
  const offsetParam = nextIndex + 1;
  const listParams = [...filterParams, limit, offset];

  // List + total only include contacts with ≥1 contacting channel (email or phone).
  const countSql = `
    WITH ${CHANNEL_IDS_CTE}
    SELECT count(*)::int AS total
    FROM cdp.customer_profile p
    INNER JOIN channel_ids ch ON ch.cdp_id = p.cdp_id
    WHERE p.organization_id::text = $1::text
      AND ${NOT_DELETED}
      AND ${searchClause}
  `;
  const listSql = buildListContactsSql(limitParam, offsetParam, searchClause);

  const [countRes, listRes] = await Promise.all([
    accountQuery<{ total: number }>(countSql, filterParams, { timeoutMs: 20_000 }),
    accountQuery<DbContact>(listSql, listParams, { timeoutMs: 20_000 }),
  ]);

  const total = countRes.rows[0]?.total ?? 0;
  return {
    items: listRes.rows.map(mapRow),
    total,
    withChannel: total,
    page,
    limit,
  };
}

export async function getContactByIdDao(
  session: CampaignSessionUser,
  contactId: string,
): Promise<ContactRow | null> {
  const id = String(contactId || "").trim();
  if (!id) return null;
  return getMappedById(session.organizationId, id);
}

/** Lookup by email and/or phone within the tenant. */
export async function findContactsByIdentityDao(
  session: CampaignSessionUser,
  opts: { email?: string | null; phone?: string | null; fullName?: string | null },
  queryOpts?: ContactDbQueryOpts,
): Promise<ContactRow[]> {
  const clauses = [
    "p.organization_id::text = $1::text",
    NOT_DELETED,
  ];
  const params: unknown[] = [cdpOrg(session.organizationId)];
  let i = 2;
  const identityOr: string[] = [];

  const email = opts.email?.trim().toLowerCase();
  if (email) {
    identityOr.push(`EXISTS (
      SELECT 1 FROM cdp.identity_keys ik
      WHERE ik.cdp_id::text = p.cdp_id::text
        AND ik.organization_id::text = p.organization_id::text
        AND lower(ik.key_type) IN ('email', 'primary_email')
        AND lower(btrim(ik.key_value)) = $${i}
    )`);
    params.push(email);
    i += 1;
  }
  const phone = opts.phone?.trim();
  if (phone) {
    identityOr.push(
      `EXISTS (
        SELECT 1 FROM cdp.identity_keys ik
        WHERE ik.cdp_id::text = p.cdp_id::text
          AND ik.organization_id::text = p.organization_id::text
          AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
          AND (
            ik.key_value = $${i}
            OR regexp_replace(coalesce(ik.key_value,''), '[^0-9+]', '', 'g')
               = regexp_replace($${i}, '[^0-9+]', '', 'g')
          )
      )`,
    );
    params.push(phone);
    i += 1;
  }
  const fullName = opts.fullName?.trim();
  if (fullName && !email && !phone) {
    if (fullName.length < 3) {
      return [];
    }
    const like = `%${escapeLikeLiteral(fullName)}%`;
    clauses.push(
      `(${FULL_NAME_EXPR} ILIKE $${i} ESCAPE '\\'
        OR coalesce(p.first_name,'') ILIKE $${i} ESCAPE '\\'
        OR coalesce(p.last_name,'') ILIKE $${i} ESCAPE '\\')`,
    );
    params.push(like);
    i += 1;
  } else if (identityOr.length) {
    clauses.push(`(${identityOr.join(" OR ")})`);
  }

  if (params.length === 1) return [];

  const { rows } = await accountQuery<DbContact>(
    `SELECT ${CONTACT_SELECT}
     ${CONTACT_FROM}
     WHERE ${clauses.join(" AND ")}
     ORDER BY lower(coalesce(p.first_name, '')), lower(coalesce(p.last_name, ''))
     LIMIT 25`,
    params,
    queryOpts?.timeoutMs != null ? { timeoutMs: queryOpts.timeoutMs } : undefined,
  );
  return rows.map(mapRow);
}

/**
 * Core columns + custom_fields keys that actually exist on this tenant's contacts.
 * Filtering specialist may only plan against this catalog.
 */
export async function listFilterableFieldsDao(
  session: CampaignSessionUser,
): Promise<FilterableField[]> {
  const byKey = new Map<string, FilterableField>();
  for (const row of CORE_FILTERABLE_FIELDS) {
    byKey.set(row.key, row);
  }

  try {
    const { rows } = await accountQuery<{ key: string }>(
      `SELECT DISTINCT jsonb_object_keys(coalesce(p.custom_fields, '{}'::jsonb)) AS key
       FROM cdp.customer_profile p
       WHERE p.organization_id::text = $1::text
         AND ${NOT_DELETED}
       LIMIT 200`,
      [cdpOrg(session.organizationId)],
    );
    const rawKeys = rows
      .map((r) => String(r.key || "").trim())
      .filter((k) => k && !RESERVED_CUSTOM_FIELD_KEYS.has(k) && isSafeJsonbKey(k));

    const has = new Set(rawKeys);
    if (has.has("job_title") || has.has("title") || has.has("role")) {
      byKey.set("job_title", {
        key: "job_title",
        source: "custom_fields",
        type: "string",
        description: "custom_fields job_title / title / role",
      });
    }
    if (has.has("segment") || has.has("customer_segment")) {
      byKey.set("segment", {
        key: "segment",
        source: "custom_fields",
        type: "string",
        description: "custom_fields segment / customer_segment",
      });
    }
    if (
      has.has("product_interest") ||
      has.has("interest") ||
      has.has("product")
    ) {
      byKey.set("product_interest", {
        key: "product_interest",
        source: "custom_fields",
        type: "string",
        description: "custom_fields product_interest / interest / product",
      });
    }
    if (has.has("score")) {
      byKey.set("min_score", {
        key: "min_score",
        source: "custom_fields",
        type: "number",
        description: "Minimum custom_fields.score",
      });
    }

    const firstClass = new Set([
      "job_title",
      "title",
      "role",
      "segment",
      "customer_segment",
      "product_interest",
      "interest",
      "product",
      "campaign_consent_source",
      "score",
    ]);
    for (const key of rawKeys) {
      if (firstClass.has(key) || byKey.has(key)) continue;
      byKey.set(key, {
        key,
        source: "custom_fields",
        type: "string",
        description: `custom_fields.${key}`,
      });
    }
  } catch {
    // Catalog still includes core profile fields when JSONB scan fails.
  }

  return [...byKey.values()];
}

/** Audience "Found contacts" panel — full match count may exceed this sample. */
const FILTER_PANEL_SAMPLE_MAX = 100;

export async function filterContactsDao(
  session: CampaignSessionUser,
  filters: ContactFilterInput,
): Promise<{
  count: number;
  contact_ids: string[];
  sample: ContactRow[];
  emails_requested: string[];
  emails_matched: string[];
  emails_missing: string[];
  phones_requested: string[];
  phones_matched: string[];
  phones_missing: string[];
  consent: AudienceConsentSummary;
  quality: AudienceQualitySummary;
}> {
  const clauses: string[] = [
    "p.organization_id::text = $1::text",
    NOT_DELETED,
  ];
  const params: unknown[] = [cdpOrg(session.organizationId)];
  let i = 2;

  const city = filters.city?.trim();
  if (city) {
    i = pushB2bPhraseMatch(clauses, params, i, "p.city", city);
  }

  const company = filters.company?.trim();
  if (company) {
    i = pushB2bPhraseMatch(clauses, params, i, "p.company", company, {
      allowPrefix: true,
    });
  }

  const jobTitle = filters.job_title?.trim();
  if (jobTitle) {
    i = pushB2bPhraseMatch(clauses, params, i, JOB_TITLE_EXPR, jobTitle);
  }

  const emailsRequested = normalizeEmailList(filters.emails);
  const phonesRequested = normalizePhoneList(filters.phones);

  if (filters.has_email === true && !phonesRequested.length) {
    clauses.push(`email_k.key_value IS NOT NULL AND length(trim(email_k.key_value)) > 0`);
  }
  if (filters.has_phone === true) {
    clauses.push(`phone_k.key_value IS NOT NULL AND length(trim(phone_k.key_value)) > 0`);
  }

  const consentSource = filters.consent_source?.trim();
  if (consentSource) {
    clauses.push(
      `lower(coalesce(p.custom_fields->>'campaign_consent_source', '')) = lower($${i})`,
    );
    params.push(consentSource);
    i += 1;
  }

  const preferredChannel = String(filters.preferred_channel || "")
    .trim()
    .toLowerCase();
  if (preferredChannel && isPreferenceChannel(preferredChannel)) {
    clauses.push(preferencesChannelIsOnSql(i));
    params.push(preferredChannel);
    i += 1;
  }

  const segment = filters.segment?.trim();
  if (segment) {
    clauses.push(
      `(lower(coalesce(p.custom_fields->>'segment', '')) = lower($${i})
        OR lower(coalesce(p.custom_fields->>'customer_segment', '')) = lower($${i})
        OR coalesce(p.custom_fields->>'segment', '') ILIKE $${i + 1} ESCAPE '\\'
        OR coalesce(p.custom_fields->>'customer_segment', '') ILIKE $${i + 1} ESCAPE '\\')`,
    );
    params.push(segment, `%${escapeLikeLiteral(segment)}%`);
    i += 2;
  }

  const productInterest = filters.product_interest?.trim();
  if (productInterest) {
    clauses.push(
      `(lower(coalesce(p.custom_fields->>'product_interest', '')) = lower($${i})
        OR lower(coalesce(p.custom_fields->>'interest', '')) = lower($${i})
        OR lower(coalesce(p.custom_fields->>'product', '')) = lower($${i})
        OR coalesce(p.custom_fields->>'product_interest', '') ILIKE $${i + 1} ESCAPE '\\'
        OR coalesce(p.custom_fields->>'interest', '') ILIKE $${i + 1} ESCAPE '\\'
        OR coalesce(p.custom_fields->>'product', '') ILIKE $${i + 1} ESCAPE '\\')`,
    );
    params.push(productInterest, `%${escapeLikeLiteral(productInterest)}%`);
    i += 2;
  }

  const minScore = filters.min_score;
  if (typeof minScore === "number" && Number.isFinite(minScore)) {
    clauses.push(
      `(coalesce(p.custom_fields->>'score', '') ~ '^[0-9]+(\\.[0-9]+)?$'
        AND (p.custom_fields->>'score')::numeric >= $${i}::numeric)`,
    );
    params.push(minScore);
    i += 1;
  }

  const extraFields =
    filters.custom_fields && typeof filters.custom_fields === "object"
      ? filters.custom_fields
      : {};
  const skipExtra = new Set([
    "campaign_deleted",
    "campaign_consent_source",
    "job_title",
    "title",
    "role",
    "segment",
    "customer_segment",
    "product_interest",
    "interest",
    "product",
    "score",
  ]);
  for (const [rawKey, rawVal] of Object.entries(extraFields)) {
    const key = String(rawKey || "").trim();
    if (!isSafeJsonbKey(key) || skipExtra.has(key) || RESERVED_CUSTOM_FIELD_KEYS.has(key)) {
      continue;
    }
    if (rawVal == null || rawVal === "") continue;
    if (typeof rawVal === "boolean") {
      clauses.push(
        `lower(coalesce(p.custom_fields->>$${i}, '')) = $${i + 1}`,
      );
      params.push(key, rawVal ? "true" : "false");
      i += 2;
      continue;
    }
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      clauses.push(
        `(coalesce(p.custom_fields->>$${i}, '') ~ '^[0-9]+(\\.[0-9]+)?$'
          AND (p.custom_fields->>$${i})::numeric >= $${i + 1}::numeric)`,
      );
      params.push(key, rawVal);
      i += 2;
      continue;
    }
    const text = String(rawVal).trim();
    if (!text) continue;
    clauses.push(
      `(lower(coalesce(p.custom_fields->>$${i}, '')) = lower($${i + 1})
        OR coalesce(p.custom_fields->>$${i}, '') ILIKE $${i + 2} ESCAPE '\\')`,
    );
    params.push(key, text, `%${escapeLikeLiteral(text)}%`);
    i += 3;
  }

  const identityOr: string[] = [];
  if (emailsRequested.length) {
    identityOr.push(`EXISTS (
      SELECT 1 FROM cdp.identity_keys ik
      WHERE ik.cdp_id::text = p.cdp_id::text
        AND ik.organization_id::text = p.organization_id::text
        AND lower(ik.key_type) IN ('email', 'primary_email')
        AND lower(btrim(ik.key_value)) = ANY($${i}::text[])
    )`);
    params.push(emailsRequested);
    i += 1;
  }
  if (phonesRequested.length) {
    const storedPhone = `regexp_replace(coalesce(ik.key_value,''), '[^0-9]', '', 'g')`;
    const last10 = phonesRequested.map((d) => d.slice(-10));
    identityOr.push(
      `EXISTS (
        SELECT 1 FROM cdp.identity_keys ik
        WHERE ik.cdp_id::text = p.cdp_id::text
          AND ik.organization_id::text = p.organization_id::text
          AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
          AND (
            ${storedPhone} = ANY($${i}::text[])
            OR (length(${storedPhone}) >= 10 AND right(${storedPhone}, 10) = ANY($${i + 1}::text[]))
          )
      )`,
    );
    params.push(phonesRequested, last10);
    i += 2;
  }
  if (identityOr.length) {
    clauses.push(`(${identityOr.join(" OR ")})`);
  } else {
    const search = filters.search?.trim();
    if (search && search.length >= 3) {
      const like = `%${escapeLikeLiteral(search)}%`;
      clauses.push(
        `(coalesce(p.first_name,'') ILIKE $${i} ESCAPE '\\'
          OR coalesce(p.last_name,'') ILIKE $${i} ESCAPE '\\'
          OR ${FULL_NAME_EXPR} ILIKE $${i} ESCAPE '\\'
          OR coalesce(email_k.key_value,'') ILIKE $${i} ESCAPE '\\'
          OR coalesce(p.company,'') ILIKE $${i} ESCAPE '\\'
          OR coalesce(p.city,'') ILIKE $${i} ESCAPE '\\'
          OR coalesce(${JOB_TITLE_EXPR},'') ILIKE $${i} ESCAPE '\\'
          OR coalesce(phone_k.key_value,'') ILIKE $${i} ESCAPE '\\'
          OR regexp_replace(coalesce(phone_k.key_value,''), '[^0-9]', '', 'g') ILIKE $${i} ESCAPE '\\')`,
      );
      params.push(like);
      i += 1;
    }
  }

  const where = clauses.join(" AND ");
  const { rows } = await accountQuery<DbContact>(
    `SELECT ${CONTACT_SELECT}
     ${CONTACT_FROM}
     WHERE ${where}
     ORDER BY lower(coalesce(p.first_name, '')), lower(coalesce(p.last_name, ''))
     LIMIT 5000`,
    params,
  );

  let unsubscribed = new Set<string>();
  try {
    unsubscribed = await listEmailUnsubscribedContactIds(session.organizationId);
  } catch {
    unsubscribed = new Set();
  }
  const eligibleRows = rows.filter((r) => !unsubscribed.has(String(r.id)));
  const eligible = eligibleRows.map(mapRow);
  const emailsMatched = [
    ...new Set(
      eligible
        .map((r) => (r.email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (emailsRequested.length === 1 && eligible.length > 0) {
    const only = emailsRequested[0];
    if (only && !emailsMatched.includes(only)) emailsMatched.push(only);
  }
  const matchedSet = new Set(emailsMatched);
  const emailsMissing = emailsRequested.filter((e) => !matchedSet.has(e));
  const phonesMatched = [
    ...new Set(
      eligible
        .map((r) => digitsOnly(r.phone || ""))
        .filter((d) => d.length >= 10),
    ),
  ];
  const matchedPhoneTails = new Set(
    phonesMatched.map((d) => d.slice(-10)),
  );
  const phonesMissing = phonesRequested.filter(
    (p) => !matchedPhoneTails.has(p.slice(-10)),
  );

  const consent = await buildConsentSummary(session.organizationId, eligibleRows);
  const quality = buildQualitySummary(eligible);

  return {
    count: eligible.length,
    contact_ids: eligible.map((r) => r.id),
    sample: eligible.slice(0, FILTER_PANEL_SAMPLE_MAX),
    emails_requested: emailsRequested,
    emails_matched: emailsMatched,
    emails_missing: emailsMissing,
    phones_requested: phonesRequested,
    phones_matched: phonesMatched,
    phones_missing: phonesMissing,
    consent,
    quality,
  };
}

/**
 * Resolve CDP profiles from campaign or original contact ids.
 * Matches exact cdp_id, trailing 10+ digits, then hashed opaque ids
 * (CDP-shop* stored as sha256 tails on campaign.contact_id).
 */
async function loadDbContactsByLookupIds(
  session: CampaignSessionUser,
  contactIds: string[],
  extraAndSql = "",
  queryOpts?: ContactDbQueryOpts,
): Promise<DbContact[]> {
  const ids = expandContactLookupIds(contactIds);
  if (!ids.length) return [];

  const qTimeout = queryOpts?.timeoutMs;

  const { rows } = await accountQuery<DbContact>(
    `SELECT ${CONTACT_SELECT}
     ${CONTACT_FROM}
     WHERE p.organization_id::text = $1::text
       AND ${cdpIdLookupSql(2)}
       AND ${NOT_DELETED}
       ${extraAndSql}`,
    [cdpOrg(session.organizationId), ids],
    qTimeout != null ? { timeoutMs: qTimeout } : undefined,
  );

  const matched = new Set<string>();
  for (const row of rows) {
    for (const key of expandContactLookupIds([String(row.id)])) {
      matched.add(key);
    }
  }
  const missingHashed = ids.filter(
    (id) => /^\d{10,}$/.test(id) && !matched.has(id),
  );
  if (!missingHashed.length) return rows;
  if (queryOpts?.skipOpaqueFallback) return rows;

  const { rows: opaque } = await accountQuery<DbContact>(
    `SELECT ${CONTACT_SELECT}
     ${CONTACT_FROM}
     WHERE p.organization_id::text = $1::text
       AND p.cdp_id::text !~ '^[0-9]+$'
       AND ${NOT_DELETED}
       ${extraAndSql}
     LIMIT 8000`,
    [cdpOrg(session.organizationId)],
    qTimeout != null ? { timeoutMs: qTimeout } : undefined,
  );
  const want = new Set(missingHashed);
  const seen = new Set(rows.map((r) => String(r.id)));
  const extra = opaque.filter((row) => {
    const cid = String(row.id);
    if (seen.has(cid)) return false;
    return want.has(campaignContactIdFromCdp(cid));
  });
  return extra.length ? [...rows, ...extra] : rows;
}

/** Soft CPMA + ASA insights for a frozen audience (launch warnings; never blocks). */
export async function audienceInsightsDao(
  session: CampaignSessionUser,
  contactIds: string[],
): Promise<{
  count: number;
  consent: AudienceConsentSummary;
  quality: AudienceQualitySummary;
  sample: ContactRow[];
}> {
  const rows = await loadDbContactsByLookupIds(session, contactIds);
  if (!rows.length) {
    return {
      count: 0,
      consent: emptyConsentSummary(),
      quality: emptyQualitySummary(),
      sample: [],
    };
  }

  const mapped = rows.map(mapRow);
  return {
    count: mapped.length,
    consent: await buildConsentSummary(session.organizationId, rows),
    quality: buildQualitySummary(mapped),
    sample: mapped.slice(0, 10),
  };
}

export type AudienceSegmentRow = { label: string; count: number };

export type AudienceSegmentationSummary = {
  total_contacts: number;
  with_email: number;
  with_phone: number;
  by_city: AudienceSegmentRow[];
  by_segment: AudienceSegmentRow[];
  by_company: AudienceSegmentRow[];
  join_windows: AudienceSegmentRow[];
};

const PROFILE_BASE_FROM = `
  FROM cdp.customer_profile p
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id::text = p.cdp_id::text
      AND ik.organization_id::text = p.organization_id::text
      AND lower(ik.key_type) IN ('email', 'primary_email')
    ORDER BY ik.verified DESC, ik.created_at DESC
    LIMIT 1
  ) email_k ON true
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id::text = p.cdp_id::text
      AND ik.organization_id::text = p.organization_id::text
      AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
    ORDER BY ik.verified DESC, ik.created_at DESC
    LIMIT 1
  ) phone_k ON true
  WHERE p.organization_id::text = $1::text
    AND ${NOT_DELETED}
`;

/** Aggregated audience segments for create-campaign strategist prompts. */
export async function audienceSegmentationSummaryDao(
  session: CampaignSessionUser,
): Promise<AudienceSegmentationSummary> {
  const org = cdpOrg(session.organizationId);

  const { rows: totals } = await accountQuery<{
    total: string;
    with_email: string;
    with_phone: string;
  }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE email_k.key_value IS NOT NULL AND trim(email_k.key_value) <> '')::text AS with_email,
       count(*) FILTER (WHERE phone_k.key_value IS NOT NULL AND trim(phone_k.key_value) <> '')::text AS with_phone
     ${PROFILE_BASE_FROM}`,
    [org],
  );

  const { rows: cities } = await accountQuery<{ label: string; count: string }>(
    `SELECT
       coalesce(nullif(trim(p.city), ''), 'Unknown') AS label,
       count(*)::text AS count
     ${PROFILE_BASE_FROM}
     GROUP BY 1
     ORDER BY count(*) DESC
     LIMIT 12`,
    [org],
  );

  const { rows: segments } = await accountQuery<{ label: string; count: string }>(
    `SELECT
       coalesce(
         nullif(trim(coalesce(p.custom_fields->>'segment', p.custom_fields->>'customer_segment')), ''),
         'Unsegmented'
       ) AS label,
       count(*)::text AS count
     ${PROFILE_BASE_FROM}
     GROUP BY 1
     ORDER BY count(*) DESC
     LIMIT 12`,
    [org],
  );

  const { rows: companies } = await accountQuery<{ label: string; count: string }>(
    `SELECT
       coalesce(nullif(trim(p.company), ''), 'Unknown') AS label,
       count(*)::text AS count
     ${PROFILE_BASE_FROM}
     GROUP BY 1
     ORDER BY count(*) DESC
     LIMIT 10`,
    [org],
  );

  const { rows: windowRow } = await accountQuery<{
    last_7: string;
    last_30: string;
    last_90: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE p.created_at >= now() - interval '7 days')::text AS last_7,
       count(*) FILTER (WHERE p.created_at >= now() - interval '30 days')::text AS last_30,
       count(*) FILTER (WHERE p.created_at >= now() - interval '90 days')::text AS last_90
     ${PROFILE_BASE_FROM}`,
    [org],
  );
  const win = windowRow[0] || { last_7: "0", last_30: "0", last_90: "0" };
  const join_windows = [
    { label: "Last 7 days", count: Number(win.last_7 || 0) },
    { label: "Last 30 days", count: Number(win.last_30 || 0) },
    { label: "Last 90 days", count: Number(win.last_90 || 0) },
  ];

  const totalRow = totals[0] || { total: "0", with_email: "0", with_phone: "0" };
  return {
    total_contacts: Number(totalRow.total || 0),
    with_email: Number(totalRow.with_email || 0),
    with_phone: Number(totalRow.with_phone || 0),
    by_city: cities.map((r) => ({
      label: String(r.label || "Unknown"),
      count: Number(r.count || 0),
    })),
    by_segment: segments.map((r) => ({
      label: String(r.label || "Unsegmented"),
      count: Number(r.count || 0),
    })),
    by_company: companies.map((r) => ({
      label: String(r.label || "Unknown"),
      count: Number(r.count || 0),
    })),
    join_windows: join_windows,
  };
}

function emptyConsentSummary(): AudienceConsentSummary {
  return {
    by_source: {},
    weak_count: 0,
    missing_count: 0,
    contactable_false_count: 0,
    warnings: [],
  };
}

function emptyQualitySummary(): AudienceQualitySummary {
  return {
    with_email: 0,
    with_phone: 0,
    missing_email: 0,
    missing_phone: 0,
    sample_size: 0,
    notes: [],
  };
}

/**
 * Contacts who already got a live campaign delivery (status=sent).
 * Used so soft consent warnings don't fire again after successful receive.
 */
/**
 * Contacts who already got a campaign delivery (sent / opened / clicked).
 * Used so soft consent warnings don't fire again after successful receive.
 */
async function listPriorSuccessfulSendContactIds(
  organizationId: string,
  contactIds: string[],
  emailsByContactId: Map<string, string> = new Map(),
): Promise<Set<string>> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const cdpByCampaign = new Map<string, string[]>();
  for (const cdpId of ids) {
    const campaignId = campaignContactIdFromCdp(cdpId);
    const bucket = cdpByCampaign.get(campaignId) ?? [];
    bucket.push(cdpId);
    cdpByCampaign.set(campaignId, bucket);
  }
  const campaignIds = [...cdpByCampaign.keys()];
  const emails = [
    ...new Set(
      [...emailsByContactId.values()]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  try {
    const rows = await prisma.campaignSendRecipient.findMany({
      where: { organizationId,
        OR: [
          {
            contactId: { in: campaignIds },
            status: { in: ["sent", "stub_sent"] },
          },
          {
            contactId: { in: campaignIds },
            openedAt: { not: null },
          },
          {
            contactId: { in: campaignIds },
            clickedAt: { not: null },
          },
          ...(emails.length
            ? [
                {
                  email: { in: emails, mode: "insensitive" as const },
                  status: { in: ["sent", "stub_sent"] },
                },
              ]
            : []),
        ],
      },
      select: { contactId: true, email: true },
      take: 5000,
    });
    const delivered = new Set<string>();
    const deliveredEmails = new Set<string>();
    for (const r of rows) {
      if (r.contactId) {
        for (const cdpId of cdpByCampaign.get(String(r.contactId)) ?? []) {
          delivered.add(cdpId);
        }
      }
      const em = (r.email || "").trim().toLowerCase();
      if (em) deliveredEmails.add(em);
    }
    for (const [cid, email] of emailsByContactId) {
      if (deliveredEmails.has(email.trim().toLowerCase())) {
        delivered.add(cid);
      }
    }
    return delivered;
  } catch {
    return new Set();
  }
}

async function buildConsentSummary(
  organizationId: string,
  rows: Array<{
    id?: string;
    email?: string | null;
    custom_fields?: Record<string, unknown> | string | null;
  }>,
): Promise<AudienceConsentSummary> {
  const emailsByContactId = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    const email = String(row.email || "").trim();
    if (id && email) emailsByContactId.set(id, email);
  }
  const priorDelivered = await listPriorSuccessfulSendContactIds(
    organizationId,
    rows.map((r) => String(r.id || "")).filter(Boolean),
    emailsByContactId,
  );

  const bySource: Record<string, number> = {};
  let weakCount = 0;
  let missingCount = 0;
  let contactableFalse = 0;

  for (const row of rows) {
    let cf: Record<string, unknown> = {};
    const rawCf = row.custom_fields;
    if (rawCf && typeof rawCf === "object") {
      cf = rawCf as Record<string, unknown>;
    } else if (typeof rawCf === "string" && rawCf.trim()) {
      try {
        cf = JSON.parse(rawCf) as Record<string, unknown>;
      } catch {
        cf = {};
      }
    }
    let raw = String(cf.campaign_consent_source ?? "").trim();
    const contactId = String(row.id || "");
    // Prior successful campaign delivery counts as provenance for soft checks.
    if (!raw && contactId && priorDelivered.has(contactId)) {
      raw = "prior_campaign";
    }
    const key = raw || "(none)";
    bySource[key] = (bySource[key] || 0) + 1;
    if (!raw) missingCount += 1;
    else if (WEAK_CONSENT.has(raw.toLowerCase())) weakCount += 1;
    if (cf.campaign_contactable === false) contactableFalse += 1;
  }

  const warnings: string[] = [];
  if (weakCount > 0) {
    warnings.push(
      `${weakCount} contact(s) have weak consent provenance (verbal/unknown/booth). Launch is still allowed.`,
    );
  }
  if (missingCount > 0) {
    warnings.push(
      `${missingCount} contact(s) have no recorded consent source. Launch is still allowed.`,
    );
  }
  if (contactableFalse > 0) {
    warnings.push(
      `${contactableFalse} contact(s) are marked not contactable. Review before launch — not blocked automatically.`,
    );
  }

  return {
    by_source: bySource,
    weak_count: weakCount,
    missing_count: missingCount,
    contactable_false_count: contactableFalse,
    warnings,
  };
}

function buildQualitySummary(rows: ContactRow[]): AudienceQualitySummary {
  let withEmail = 0;
  let withPhone = 0;
  let missingEmail = 0;
  let missingPhone = 0;
  for (const r of rows) {
    const hasE = Boolean((r.email || "").trim());
    const hasP = Boolean((r.phone || "").trim());
    if (hasE) withEmail += 1;
    else missingEmail += 1;
    if (hasP) withPhone += 1;
    else missingPhone += 1;
  }
  const notes: string[] = [];
  if (rows.length && missingEmail > 0) {
    notes.push(
      `${missingEmail} contact(s) have no email — email channel will skip them.`,
    );
  }
  if (rows.length && missingPhone > 0) {
    notes.push(
      `${missingPhone} contact(s) have no phone — SMS/WhatsApp will skip them.`,
    );
  }
  return {
    with_email: withEmail,
    with_phone: withPhone,
    missing_email: missingEmail,
    missing_phone: missingPhone,
    sample_size: Math.min(10, rows.length),
    notes,
  };
}

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function normalizeEmailList(emails: unknown): string[] {
  const raw = Array.isArray(emails) ? emails : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const e = String(item ?? "")
      .trim()
      .toLowerCase();
    if (!e || !e.includes("@") || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function normalizePhoneList(phones: unknown): string[] {
  const raw = Array.isArray(phones) ? phones : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const d = digitsOnly(String(item ?? ""));
    if (d.length < 10 || d.length > 15 || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

export async function createContactDao(
  session: CampaignSessionUser,
  input: ContactInput,
): Promise<ContactRow> {
  const data = normalizeInput(input);

  await purgeDeletedIdentityKeys(session.organizationId, data.email, data.phone);

  if (data.email) {
    const owner = await findIdentityOwner(
      session.organizationId,
      KEY_EMAIL,
      data.email,
    );
    if (owner) throw new AppError(RESPONSE.existContact, 400);
  }
  if (data.phone) {
    const owner = await findIdentityOwner(
      session.organizationId,
      KEY_PHONE,
      data.phone,
    );
    if (owner) throw new AppError(RESPONSE.existContact, 400);
  }

  const cdpId = newContactId(session.organizationId, {
    sourceName: "campaign",
  });
  const customFields =
    data.customFields && Object.keys(data.customFields).length
      ? data.customFields
      : {};
  const { rows } = await accountQuery<{ cdp_id: string }>(
    `INSERT INTO cdp.customer_profile (
       cdp_id, organization_id, first_name, last_name, company, city,
       custom_fields, created_at, updated_at, first_seen_at, last_seen_at,
       acquisition_channel
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, now(), now(), now(), now(),
       'campaign'
     )
     RETURNING cdp_id`,
    [
      cdpId,
      cdpOrg(session.organizationId),
      data.firstName,
      data.lastName,
      data.companyName,
      data.city,
      JSON.stringify(customFields),
    ],
  );

  if (!rows[0]?.cdp_id) {
    throw new AppError(RESPONSE.failedContact, 400);
  }

  try {
    await upsertIdentityKeys(session.organizationId, cdpId, data.email, data.phone);
  } catch (err) {
    // Roll back profile if identity insert hits unique constraint
    await accountQuery(
      `DELETE FROM cdp.customer_profile WHERE cdp_id::text = $1::text`,
      [cdpId],
    );
    throw err instanceof AppError
      ? err
      : new AppError(RESPONSE.existContact, 400);
  }

  const created = await getMappedById(session.organizationId, cdpId);
  if (!created) {
    throw new AppError(RESPONSE.failedContact, 400);
  }
  return created;
}

export async function updateContactDao(
  session: CampaignSessionUser,
  contactId: string,
  input: ContactInput,
): Promise<ContactRow> {
  const data = normalizeInput(input);

  const existing = await accountQuery<{ cdp_id: string }>(
    `SELECT cdp_id FROM cdp.customer_profile
     WHERE cdp_id::text = $1::text AND organization_id::text = $2::text
       AND coalesce((custom_fields->>'campaign_deleted')::boolean, false) = false
     LIMIT 1`,
    [contactId, cdpOrg(session.organizationId)],
  );
  if (!existing.rows[0]) {
    throw new AppError(RESPONSE.contactNotFound, 404);
  }

  if (data.email) {
    const owner = await findIdentityOwner(
      session.organizationId,
      KEY_EMAIL,
      data.email,
      contactId,
    );
    if (owner && String(owner) !== String(contactId)) {
      throw new AppError(RESPONSE.existContact, 400);
    }
  }
  if (data.phone) {
    const owner = await findIdentityOwner(
      session.organizationId,
      KEY_PHONE,
      data.phone,
      contactId,
    );
    if (owner && String(owner) !== String(contactId)) {
      throw new AppError(RESPONSE.existContact, 400);
    }
  }

  await accountQuery(
    `UPDATE cdp.customer_profile
     SET first_name = $1,
         last_name = $2,
         company = $3,
         city = $4,
         updated_at = now(),
         last_seen_at = now()
     WHERE cdp_id::text = $5::text AND organization_id::text = $6::text`,
    [
      data.firstName,
      data.lastName,
      data.companyName,
      data.city,
      contactId,
      cdpOrg(session.organizationId),
    ],
  );

  if (data.customFields && Object.keys(data.customFields).length) {
    await mergeCampaignCustomFields(
      session.organizationId,
      contactId,
      data.customFields,
    );
  }

  try {
    await upsertIdentityKeys(
      session.organizationId,
      contactId,
      data.email,
      data.phone,
    );
  } catch {
    throw new AppError(RESPONSE.existContact, 400);
  }

  const updated = await getMappedById(session.organizationId, contactId);
  if (!updated) {
    throw new AppError(RESPONSE.failedUpdateContact, 400);
  }
  return updated;
}

/**
 * Write only cdp.customer_profile.preferences_json (does not change identity /
 * name / custom_fields). Merges onto existing JSON so timing is not wiped.
 */
export async function setContactPreferencesDao(
  session: CampaignSessionUser,
  contactId: string,
  raw: unknown,
): Promise<ContactRow> {
  const existing = await accountQuery<{
    cdp_id: string;
    preferences_json: unknown;
  }>(
    `SELECT cdp_id, coalesce(preferences_json, '{}'::jsonb) AS preferences_json
     FROM cdp.customer_profile
     WHERE cdp_id::text = $1::text AND organization_id::text = $2::text
       AND coalesce((custom_fields->>'campaign_deleted')::boolean, false) = false
     LIMIT 1`,
    [contactId, cdpOrg(session.organizationId)],
  );
  if (!existing.rows[0]) {
    throw new AppError(RESPONSE.contactNotFound, 404);
  }

  const prefs = mergePreferencesJson(
    parseCustomFields(existing.rows[0].preferences_json),
    raw ?? emptyPreferences(),
  );

  await accountQuery(
    `UPDATE cdp.customer_profile
     SET preferences_json = $1::jsonb,
         updated_at = now()
     WHERE cdp_id::text = $2::text AND organization_id::text = $3::text`,
    [JSON.stringify(prefs), contactId, cdpOrg(session.organizationId)],
  );

  const updated = await getMappedById(session.organizationId, contactId);
  if (!updated) {
    throw new AppError(RESPONSE.failedUpdateContact, 400);
  }
  return updated;
}

/**
 * Recompute channel flags from campaign engagement; fill missing timing
 * windows from recipient timestamps. Does not overwrite stored windows.
 */
export async function refreshContactPreferencesFromEngagementDao(
  session: CampaignSessionUser,
  contactId: string,
): Promise<ContactRow> {
  const engagement = await getEngagementForContact(
    session.organizationId,
    contactId,
  );
  const flags = preferencesFromEngagement({
    email_open_count: engagement?.email_open_count ?? 0,
    email_click_count: engagement?.email_click_count ?? 0,
    email_unsubscribed: engagement?.email_unsubscribed ?? false,
  });

  const stored = await accountQuery<{ preferences_json: unknown }>(
    `SELECT coalesce(preferences_json, '{}'::jsonb) AS preferences_json
     FROM cdp.customer_profile
     WHERE cdp_id::text = $1::text AND organization_id::text = $2::text
     LIMIT 1`,
    [contactId, cdpOrg(session.organizationId)],
  );
  const existing = parseCustomFields(stored.rows[0]?.preferences_json);
  const tzHint = String(existing.timezone || "").trim();

  const campaignId = campaignContactIdFromCdp(contactId);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const recipients = await prisma.campaignSendRecipient.findMany({
    where: {
      organizationId: session.organizationId,
      contactId: campaignId,
      OR: [
        { openedAt: { gte: since } },
        { clickedAt: { gte: since } },
      ],
    },
    select: {
      openedAt: true,
      clickedAt: true,
      batch: { select: { channel: true } },
    },
    take: 2000,
  });
  const computed = computePreferenceWindows(
    recipients.map((row) => ({
      channel: row.batch?.channel,
      opened_at: row.openedAt,
      clicked_at: row.clickedAt,
    })),
    { timezoneName: tzHint || undefined },
  );
  const windows = fillMissingWindows(existing, computed);
  return setContactPreferencesDao(session, contactId, {
    ...flags,
    ...windows,
  });
}

/** Soft-delete via custom_fields.campaign_deleted (no column adds). */
export async function deleteContactDao(
  session: CampaignSessionUser,
  contactId: string,
): Promise<void> {
  const { rowCount } = await accountQuery(
    `UPDATE cdp.customer_profile
     SET custom_fields = coalesce(custom_fields, '{}'::jsonb)
                         || jsonb_build_object('campaign_deleted', true),
         updated_at = now()
     WHERE cdp_id::text = $1::text
       AND organization_id::text = $2::text
       AND coalesce((custom_fields->>'campaign_deleted')::boolean, false) = false`,
    [contactId, cdpOrg(session.organizationId)],
  );
  if (!rowCount) {
    throw new AppError(RESPONSE.contactNotFound, 404);
  }
  // Free email/phone for re-use (unique index is org+type+value).
  await accountQuery(
    `DELETE FROM cdp.identity_keys
     WHERE cdp_id::text = $1::text
       AND organization_id::text = $2::text
       AND lower(key_type) IN ('email', 'primary_email', 'phone', 'primary_phone', 'mobile')
       AND coalesce(source_system, '') = 'campaign'`,
    [contactId, cdpOrg(session.organizationId)],
  );
}

/** Name/email/company for audience reporting (includes contacts without email). */
export async function listContactSummariesByIdsDao(
  session: CampaignSessionUser,
  contactIds: string[],
  queryOpts?: ContactDbQueryOpts,
): Promise<
  Array<{
    contactId: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string;
  }>
> {
  const rows = await loadDbContactsByLookupIds(
    session,
    contactIds,
    "",
    queryOpts,
  );
  if (!rows.length) return [];

  return rows.map((row) => {
    const first = titleCasePersonName((row.first_name || "").trim());
    const last = titleCasePersonName((row.last_name || "").trim());
    const name = `${first} ${last}`.trim() || first || "Unknown";
    const email = (row.email || "").trim().toLowerCase() || null;
    const phone = (row.phone || "").trim() || null;
    const cdpId = String(row.id);
    return {
      // Match campaign.audience.contact_id (numeric tail / stable bigint), not raw cdp_id.
      contactId: campaignContactIdFromCdp(cdpId),
      name,
      email,
      phone,
      company: (row.company_name || "").trim(),
    };
  });
}

/** Resolve emails + personalization fields for frozen audience contact ids (cdp_id). */
export async function listContactEmailsByIdsDao(
  session: CampaignSessionUser,
  contactIds: string[],
  queryOpts?: ContactDbQueryOpts,
): Promise<
  Array<{
    contactId: string;
    email: string;
    firstName: string;
    company: string;
    city: string;
  }>
> {
  const lookupOpts: ContactDbQueryOpts = {
    ...queryOpts,
    // Default: no org-wide opaque scan (use launch_plan.audience_cdp_ids for batch send).
    skipOpaqueFallback: queryOpts?.skipOpaqueFallback ?? true,
  };
  const rows = await loadDbContactsByLookupIds(
    session,
    contactIds,
    `AND email_k.key_value IS NOT NULL
       AND btrim(email_k.key_value) <> ''`,
    lookupOpts,
  );
  if (!rows.length) return [];

  return rows
    .map((row) => {
      const email = (row.email || "").trim().toLowerCase();
      if (!email) return null;
      return {
        contactId: campaignContactIdFromCdp(String(row.id)),
        email,
        firstName: titleCasePersonName((row.first_name || "").trim()),
        company: (row.company_name || "").trim(),
        city: (row.city || "").trim(),
      };
    })
    .filter(
      (
        r,
      ): r is {
        contactId: string;
        email: string;
        firstName: string;
        company: string;
        city: string;
      } => Boolean(r),
    );
}

/**
 * Resolve phones + personalization for frozen audience contact ids.
 * Only returns contacts that have a phone identity key.
 */
export async function listContactPhonesByIdsDao(
  session: CampaignSessionUser,
  contactIds: string[],
): Promise<
  Array<{
    contactId: string;
    phone: string;
    firstName: string;
    company: string;
    city: string;
  }>
> {
  const rows = await loadDbContactsByLookupIds(
    session,
    contactIds,
    `AND phone_k.key_value IS NOT NULL
       AND btrim(phone_k.key_value) <> ''`,
  );
  if (!rows.length) return [];

  return rows
    .map((row) => {
      const phone = (row.phone || "").trim();
      if (!phone) return null;
      return {
        contactId: campaignContactIdFromCdp(String(row.id)),
        phone,
        firstName: titleCasePersonName((row.first_name || "").trim()),
        company: (row.company_name || "").trim(),
        city: (row.city || "").trim(),
      };
    })
    .filter(
      (
        r,
      ): r is {
        contactId: string;
        phone: string;
        firstName: string;
        company: string;
        city: string;
      } => Boolean(r),
    );
}

/** Personalization fields for push (does not require email). Soft PDOA merges. */
export async function listContactFirstNamesByIdsDao(
  session: CampaignSessionUser,
  contactIds: string[],
): Promise<
  Array<{
    contactId: string;
    firstName: string;
    company: string;
    city: string;
  }>
> {
  const rows = await loadDbContactsByLookupIds(session, contactIds);
  if (!rows.length) return [];

  return rows.map((row) => ({
    contactId: campaignContactIdFromCdp(String(row.id)),
    firstName: titleCasePersonName((row.first_name || "").trim()),
    company: (row.company_name || "").trim(),
    city: (row.city || "").trim(),
  }));
}

const MAX_IMPORT_ROWS = 2000;

export type ContactImportRowInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  city?: string | null;
  /** Combined name from CSV "Name" column — split if firstName empty. */
  name?: string | null;
  /** Explicit extras; unknown row keys also merge into custom_fields. */
  customFields?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type ContactImportOptions = {
  dryRun?: boolean;
  /** Update matched contacts; otherwise skip duplicates. */
  upsert?: boolean;
  /** Declared consent basis for the list (CCUIA provenance). */
  consentSource?: string | null;
  /**
   * Required to write when consentSource is weak (verbal/unknown/…).
   * Without it, import returns held_for_review and writes nothing.
   */
  complianceAcknowledged?: boolean;
  sourceLabel?: string | null;
};

export type ContactImportRowResult = {
  row: number;
  action: "created" | "updated" | "skipped" | "failed" | "held";
  contact_id?: string;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company_name?: string | null;
  city?: string | null;
  message?: string;
  conflicts?: string[];
};

export type ContactImportResult = {
  status: "completed" | "held_for_review" | "dry_run";
  consent_source: string;
  consent_weak: boolean;
  quality_score: number;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    held: number;
  };
  errors: ContactImportRowResult[];
  results: ContactImportRowResult[];
  created_ids: string[];
  updated_ids: string[];
};

function splitName(raw: string): { firstName: string; lastName: string | null } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

function isWeakConsent(source: string): boolean {
  return WEAK_CONSENT.has(source.trim().toLowerCase());
}

async function mergeCampaignCustomFields(
  organizationId: string,
  contactId: string,
  patch: Record<string, unknown>,
) {
  const cdpOrgId = cdpOrg(organizationId);
  await accountQuery(
    `UPDATE cdp.customer_profile
     SET custom_fields = coalesce(custom_fields, '{}'::jsonb) || $1::jsonb,
         updated_at = now()
     WHERE cdp_id::text = $2::text AND organization_id::text = $3::text`,
    [JSON.stringify(patch), contactId, cdpOrgId],
  );
}

/**
 * CCUIA bulk ingest: validate, normalize, dedupe by email/phone, optional upsert.
 * Weak consent lists are held unless complianceAcknowledged=true.
 */
export async function importContactsDao(
  session: CampaignSessionUser,
  rows: ContactImportRowInput[],
  options: ContactImportOptions = {},
): Promise<ContactImportResult> {
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError("Provide at least one contact row to import.", 400);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      `Import is limited to ${MAX_IMPORT_ROWS} rows per request.`,
      400,
    );
  }

  const dryRun = Boolean(options.dryRun);
  const upsert = Boolean(options.upsert);
  const consentSource = String(options.consentSource || "unknown").trim() || "unknown";
  const consentWeak = isWeakConsent(consentSource);
  const complianceOk = Boolean(options.complianceAcknowledged);
  const sourceLabel = String(options.sourceLabel || "csv").trim() || "csv";

  if (consentWeak && !complianceOk && !dryRun) {
    return {
      status: "held_for_review",
      consent_source: consentSource,
      consent_weak: true,
      quality_score: 0,
      summary: {
        total: rows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        held: rows.length,
      },
      errors: [
        {
          row: 0,
          action: "held",
          message:
            "Bulk import held for compliance review: consent source is weak or missing. " +
            "Set a stronger consentSource, or pass complianceAcknowledged=true after review.",
        },
      ],
      results: [],
      created_ids: [],
      updated_ids: [],
    };
  }

  const results: ContactImportRowResult[] = [];
  const errors: ContactImportRowResult[] = [];
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const provenance = {
    campaign_consent_source: consentSource,
    campaign_consent_at: new Date().toISOString(),
    campaign_import_source: sourceLabel,
    campaign_contactable: !consentWeak || complianceOk,
  };

  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i] || {};
    const rowNum = i + 1;
    try {
      let firstName = String(raw.firstName || "").trim();
      let lastName = raw.lastName != null ? String(raw.lastName).trim() : "";
      if (!firstName && raw.name) {
        const split = splitName(String(raw.name));
        firstName = split.firstName;
        if (!lastName && split.lastName) lastName = split.lastName;
      }

      const input: ContactInput = {
        firstName,
        lastName: lastName || null,
        email: raw.email != null ? String(raw.email) : null,
        phone: raw.phone != null ? String(raw.phone) : null,
        companyName: raw.companyName != null ? String(raw.companyName) : null,
        city: raw.city != null ? String(raw.city) : null,
        customFields: extractCustomFields(raw),
      };

      const data = normalizeInput(input);
      let matchId: string | null = null;
      if (data.email) {
        matchId = await findIdentityOwner(
          session.organizationId,
          KEY_EMAIL,
          data.email,
        );
      }
      if (!matchId && data.phone) {
        matchId = await findIdentityOwner(
          session.organizationId,
          KEY_PHONE,
          data.phone,
        );
      }

      if (matchId) {
        const existing = await getMappedById(session.organizationId, matchId);
        const conflicts: string[] = [];
        if (
          existing?.company_name &&
          data.companyName &&
          existing.company_name.trim().toLowerCase() !==
            data.companyName.trim().toLowerCase()
        ) {
          conflicts.push(
            `company: CDP has "${existing.company_name}", import has "${data.companyName}"`,
          );
        }

        if (!upsert) {
          skipped += 1;
          results.push({
            row: rowNum,
            action: "skipped",
            contact_id: matchId,
            email: data.email,
            phone: data.phone,
            message: "Contact already exists (duplicate email/phone).",
            conflicts: conflicts.length ? conflicts : undefined,
          });
          continue;
        }

        if (!dryRun) {
          await updateContactDao(session, matchId, input);
          await mergeCampaignCustomFields(session.organizationId, matchId, provenance);
          updatedIds.push(matchId);
        }
        updated += 1;
        results.push({
          row: rowNum,
          action: "updated",
          contact_id: matchId,
          email: data.email,
          phone: data.phone,
          conflicts: conflicts.length ? conflicts : undefined,
        });
        continue;
      }

      if (!dryRun) {
        const createdRow = await createContactDao(session, input);
        await mergeCampaignCustomFields(
          session.organizationId,
          createdRow.id,
          provenance,
        );
        createdIds.push(createdRow.id);
        created += 1;
        results.push({
          row: rowNum,
          action: "created",
          contact_id: createdRow.id,
          email: data.email,
          phone: data.phone,
        });
      } else {
        created += 1;
        results.push({
          row: rowNum,
          action: "created",
          email: data.email,
          phone: data.phone,
          message: "Would create (dry run).",
        });
      }
    } catch (err) {
      failed += 1;
      const message =
        err instanceof AppError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Row failed";
      const nameRaw = raw.name != null ? String(raw.name).trim() : "";
      const firstRaw =
        raw.firstName != null ? String(raw.firstName).trim() : "";
      const lastRaw = raw.lastName != null ? String(raw.lastName).trim() : "";
      const failRow: ContactImportRowResult = {
        row: rowNum,
        action: "failed",
        email: raw.email != null ? String(raw.email) : null,
        phone: raw.phone != null ? String(raw.phone) : null,
        first_name: firstRaw || null,
        last_name: lastRaw || null,
        name:
          nameRaw ||
          [firstRaw, lastRaw].filter(Boolean).join(" ").trim() ||
          null,
        company_name:
          raw.companyName != null ? String(raw.companyName).trim() || null : null,
        city: raw.city != null ? String(raw.city).trim() || null : null,
        message,
      };
      errors.push(failRow);
      results.push(failRow);
    }
  }

  const total = rows.length;
  const usable = Math.max(0, total - failed);
  const qualityScore =
    total === 0
      ? 0
      : Math.round(
          ((usable / total) * 0.7 +
            (created + updated) / Math.max(1, usable) * 0.3) *
            100,
        );

  return {
    status: dryRun ? "dry_run" : "completed",
    consent_source: consentSource,
    consent_weak: consentWeak,
    quality_score: qualityScore,
    summary: {
      total,
      created,
      updated,
      skipped,
      failed,
      held: 0,
    },
    errors,
    results: results.slice(0, 200),
    created_ids: createdIds,
    updated_ids: updatedIds,
  };
}
