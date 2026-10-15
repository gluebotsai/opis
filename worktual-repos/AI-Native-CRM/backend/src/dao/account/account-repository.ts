import { accountQuery, withAccountTransaction } from "@/dao/db/account-pool";
import { tryDeleteCdpCustomerProfile } from "@/dao/account/cdp-profile-delete";
import type {
  AccountPerson,
  AccountRepository,
  ContactType,
  CreatePersonInput,
  ListPeopleFilters,
  UpdatePersonInput,
} from "@/service/account/types";
import { getServerUserId } from "@/service/account/session-cookie";
import { getSetupUserById } from "@/service/account/setup-users";
import { newCrmCdpId } from "@/lib/cdp-id";
import {
  effectiveContactType,
  resolveContactTypeForChannels,
} from "@/lib/contact-lifecycle";
import { locationFromInbound } from "@/lib/inbound-location";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

/**
 * cdp.customer_profile + cdp.identity_keys (shared server — row DML only).
 * CRM fields stay in crm.contact_profiles (account_contact_id = cdp_id).
 * See docs/cdp-customer-identity.md for key_type / custom_fields conventions.
 *
 * Live Worktual: `cdp_id` is text. CRM-created people use
 * `CDP-crm-org{organization_id}-{unique}` (see `newCrmCdpId`). Older rows may
 * still be UUID-shaped. Cast cdp_id params as `::text`.
 * organization_id is bigint on worktual_bigint (`::bigint`).
 * CRM `contact_id` / `account_contact_id` are text and equal `cdp_id`.
 */

export type CustomerProfileRow = {
  cdp_id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  city: string | null;
  country: string | null;
  region: string | null;
  custom_fields: Record<string, unknown> | null;
  organization_id: string;
  contact_type: string | null;
  acquisition_channel: string | null;
  created_at: Date;
  updated_at: Date;
  email: string | null;
  phone: string | null;
  secondary_email: string | null;
  secondary_phone: string | null;
};

const PROFILE_SELECT = `
  p.cdp_id::text AS cdp_id,
  p.first_name, p.last_name,
  p.company, p.city, p.country, p.region,
  p.custom_fields,
  p.contact_type,
  p.acquisition_channel,
  p.organization_id::text AS organization_id,
  p.created_at, p.updated_at,
  (
    SELECT k.key_value FROM cdp.identity_keys k
    WHERE k.cdp_id = p.cdp_id AND k.key_type = 'email'
    ORDER BY k.created_at ASC NULLS LAST
    LIMIT 1
  ) AS email,
  (
    SELECT k.key_value FROM cdp.identity_keys k
    WHERE k.cdp_id = p.cdp_id AND k.key_type = 'phone'
    ORDER BY k.created_at ASC NULLS LAST
    LIMIT 1
  ) AS phone,
  (
    SELECT k.key_value FROM cdp.identity_keys k
    WHERE k.cdp_id = p.cdp_id AND k.key_type = 'email_secondary'
    ORDER BY k.created_at ASC NULLS LAST
    LIMIT 1
  ) AS secondary_email,
  (
    SELECT k.key_value FROM cdp.identity_keys k
    WHERE k.cdp_id = p.cdp_id AND k.key_type = 'phone_secondary'
    ORDER BY k.created_at ASC NULLS LAST
    LIMIT 1
  ) AS secondary_phone
`;

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function customField(
  fields: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  return asText(fields?.[key]);
}

function normalizeEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v || null;
}

/** Placeholder written by the old CDP ingest trigger. Not a real channel. */
function acquisitionChannelValue(value: string | null | undefined): string | null {
  const channel = value?.trim() || null;
  if (!channel || channel.toLowerCase() === "cdp_ingest") return null;
  return channel;
}

function normalizePhone(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v || null;
}

function comparablePhone(value: string | null | undefined): string {
  const normalized = normalizePhone(value);
  if (!normalized) return "";
  const digits = normalized.replace(/\D/g, "");
  return digits || normalized.toLowerCase();
}

function firstDistinctSecondaryEmail(
  primary: string | null | undefined,
  candidates: string[] | null | undefined,
): string | null {
  const primaryNormalized = normalizeEmail(primary);
  for (const candidate of candidates ?? []) {
    const normalized = normalizeEmail(candidate);
    if (normalized && normalized !== primaryNormalized) return normalized;
  }
  return null;
}

function firstDistinctSecondaryPhone(
  primary: string | null | undefined,
  candidates: string[] | null | undefined,
): string | null {
  const primaryComparable = comparablePhone(primary);
  for (const candidate of candidates ?? []) {
    const normalized = normalizePhone(candidate);
    if (normalized && comparablePhone(normalized) !== primaryComparable) {
      return normalized;
    }
  }
  return null;
}

function normalizeContactType(value: string | null | undefined): ContactType {
  return effectiveContactType(value);
}

/** Map joined profile + identity keys → AccountPerson. */
export function mapCustomerProfileRow(row: CustomerProfileRow): AccountPerson {
  const companyName = row.company?.trim();
  // Some identities only have `email_secondary` populated. Auto-reply needs a
  // usable reply address, so fall back to secondary when primary is missing.
  const primaryEmail = normalizeEmail(row.email);
  const secondaryEmail = normalizeEmail(row.secondary_email);
  const email = primaryEmail ?? secondaryEmail ?? "";
  const distinctSecondaryEmail = firstDistinctSecondaryEmail(email, [
    secondaryEmail ?? "",
  ]);
  const distinctSecondaryPhone = firstDistinctSecondaryPhone(row.phone, [
    row.secondary_phone ?? "",
  ]);
  const secondaryEmails = distinctSecondaryEmail
    ? [distinctSecondaryEmail]
    : [];
  const secondaryPhones = distinctSecondaryPhone
    ? [distinctSecondaryPhone]
    : [];
  const title = customField(row.custom_fields, "title");
  const industry =
    customField(row.custom_fields, "industry") ??
    asText(row.custom_fields?.industry);
  const addressLine =
    customField(row.custom_fields, "address_line") ??
    (row.region?.trim() || null);
  const companyDomain = customField(row.custom_fields, "company_domain");
  const loc = locationFromInbound(
    {
      ...(row.custom_fields ?? {}),
      city: row.city ?? customField(row.custom_fields, "city"),
      country: row.country ?? customField(row.custom_fields, "country"),
      region: row.region ?? customField(row.custom_fields, "region"),
      location:
        customField(row.custom_fields, "location") ??
        customField(row.custom_fields, "geography"),
      addressLine,
      phone: row.phone,
    },
    row.phone,
  );

  return {
    id: String(row.cdp_id),
    firstName: row.first_name?.trim() || "",
    lastName: row.last_name?.trim() || "",
    email,
    phone: normalizePhone(row.phone),
    secondaryEmails,
    secondaryPhones,
    title,
    addressLine: loc.addressLine ?? addressLine,
    city: loc.city,
    country: loc.country,
    companyId: null,
    locationId: null,
    company: companyName
      ? {
          id: null,
          name: companyName,
          domain: companyDomain,
          industry,
        }
      : null,
    ownerUserId: null,
    organizationId: row.organization_id,
    contactType: normalizeContactType(row.contact_type),
    leadSource: acquisitionChannelValue(row.acquisition_channel),
    leadStatus: "new",
    disqualifyReason: null,
    bantBudget: null,
    bantAuthority: null,
    bantNeed: null,
    bantTimeline: null,
    convertedDealId: null,
    tags: [],
    status: "active",
    notes: null,
    isPinned: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @deprecated Use mapCustomerProfileRow — kept for any leftover callers. */
export const mapSetupContact = mapCustomerProfileRow;

function buildCustomFields(input: {
  title?: string | null;
  addressLine?: string | null;
  companyDomain?: string | null;
  industry?: string | null;
  existing?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const next = { ...(input.existing ?? {}) };
  if (input.title !== undefined) {
    if (input.title?.trim()) next.title = input.title.trim();
    else delete next.title;
  }
  if (input.addressLine !== undefined) {
    if (input.addressLine?.trim()) next.address_line = input.addressLine.trim();
    else delete next.address_line;
  }
  if (input.companyDomain !== undefined) {
    if (input.companyDomain?.trim())
      next.company_domain = input.companyDomain.trim();
    else delete next.company_domain;
  }
  if (input.industry !== undefined) {
    if (input.industry?.trim()) next.industry = input.industry.trim();
    else delete next.industry;
  }
  return next;
}

async function resolveOrganizationId(
  explicit?: string | null,
): Promise<string | null> {
  const candidate = explicit?.trim() || null;
  if (!candidate) return null;
  try {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT id::text AS id FROM accounts.organizations WHERE id = $1::bigint LIMIT 1`,
      [candidate],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("resolveOrganizationId (accounts) failed", err);
    return null;
  }
}

function newCdpTextId(): string {
  return randomUUID();
}

async function insertIdentityKey(
  client: PoolClient,
  args: {
    cdpId: string;
    organizationId: string;
    keyType: string;
    keyValue: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cdp.identity_keys (
       identity_id, cdp_id, organization_id, key_type, key_value,
       verified, source_system, confidence_score
     ) VALUES (
       $1::text, $2::text, $3::bigint, $4, $5, false, 'crm', 1.0
     )`,
    [newCdpTextId(), args.cdpId, args.organizationId, args.keyType, args.keyValue],
  );
}

async function replaceIdentityKey(
  client: PoolClient,
  args: {
    cdpId: string;
    organizationId: string;
    keyType: string;
    keyValue: string | null;
  },
): Promise<void> {
  await client.query(
    `DELETE FROM cdp.identity_keys
     WHERE cdp_id = $1::text AND key_type = $2`,
    [args.cdpId, args.keyType],
  );
  if (!args.keyValue) return;
  await insertIdentityKey(client, {
    cdpId: args.cdpId,
    organizationId: args.organizationId,
    keyType: args.keyType,
    keyValue: args.keyValue,
  });
}

async function fetchProfileById(
  id: string,
  client?: PoolClient,
): Promise<CustomerProfileRow | null> {
  const sql = `SELECT ${PROFILE_SELECT}
     FROM cdp.customer_profile p
     WHERE p.cdp_id = $1::text`;
  const result = client
    ? await client.query<CustomerProfileRow>(sql, [id])
    : await accountQuery<CustomerProfileRow>(sql, [id]);
  return result.rows[0] ?? null;
}

/**
 * Primary identity key subquery — same ordering as PROFILE_SELECT (oldest email/phone wins).
 * Search must match what the UI shows, not every historical identity_keys row.
 */
function primaryIdentityValue(keyType: string): string {
  return `(SELECT k.key_value FROM cdp.identity_keys k
    WHERE k.cdp_id = p.cdp_id AND k.key_type = '${keyType}'
    ORDER BY k.created_at ASC NULLS LAST
    LIMIT 1)`;
}

/**
 * Match the fields shown on a contact: name, email, phone, company, title,
 * city, country, and the other profile text. Multi-token names still match
 * in either order ("Hansa Test" and "Test Hansa").
 */
function buildPersonSearchClause(
  startIndex: number,
  search: string,
): { sql: string; values: unknown[]; nextIndex: number } {
  const q = search.trim();
  const values: unknown[] = [`%${q}%`];
  let i = startIndex;
  const fullParam = i;
  i += 1;

  const custom = (key: string) =>
    `coalesce(p.custom_fields->>'${key}', '') ILIKE $${fullParam}`;

  const parts = [
    `p.first_name ILIKE $${fullParam}`,
    `p.last_name ILIKE $${fullParam}`,
    `p.company ILIKE $${fullParam}`,
    `p.city ILIKE $${fullParam}`,
    `p.country ILIKE $${fullParam}`,
    `p.region ILIKE $${fullParam}`,
    `p.contact_type ILIKE $${fullParam}`,
    `trim(both from coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) ILIKE $${fullParam}`,
    `${primaryIdentityValue("email")} ILIKE $${fullParam}`,
    `${primaryIdentityValue("phone")} ILIKE $${fullParam}`,
    `${primaryIdentityValue("email_secondary")} ILIKE $${fullParam}`,
    `${primaryIdentityValue("phone_secondary")} ILIKE $${fullParam}`,
    custom("title"),
    custom("industry"),
    custom("company_domain"),
    custom("address_line"),
    custom("city"),
    custom("country"),
    custom("region"),
    custom("location"),
    custom("geography"),
  ];

  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3) {
    const digitParam = i;
    values.push(`%${digits}%`);
    i += 1;
    for (const keyType of ["phone", "phone_secondary"] as const) {
      parts.push(
        `regexp_replace(coalesce(${primaryIdentityValue(keyType)}, ''), '[^0-9]', '', 'g') LIKE $${digitParam}`,
      );
    }
  }

  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length >= 2) {
    const tokenAnd = tokens.map((tok) => {
      const p = i;
      values.push(`%${tok}%`);
      i += 1;
      return `(p.first_name ILIKE $${p} OR p.last_name ILIKE $${p})`;
    });
    parts.push(`(${tokenAnd.join(" AND ")})`);
  }

  return {
    sql: `(${parts.join(" OR ")})`,
    values,
    nextIndex: i,
  };
}

/** Shared cdp.customer_profile + identity_keys — identity + company denorm only. */
export const accountRepository: AccountRepository = {
  async listPeople(filters: ListPeopleFilters) {
    const conditions: string[] = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;

    const q = filters.search?.trim();
    if (q) {
      const { sql, values, nextIndex } = buildPersonSearchClause(i, q);
      conditions.push(sql);
      params.push(...values);
      i = nextIndex;
    }

    const where = conditions.join(" AND ");
    const countResult = await accountQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM cdp.customer_profile p WHERE ${where}`,
      params,
    );
    const total = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);

    const limitParam = i;
    const offsetParam = i + 1;
    const { rows } = await accountQuery<CustomerProfileRow>(
      `SELECT ${PROFILE_SELECT}
       FROM cdp.customer_profile p
       WHERE ${where}
       ORDER BY p.updated_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, filters.limit, filters.offset],
    );

    return { items: rows.map(mapCustomerProfileRow), total };
  },

  async getPerson(id) {
    const row = await fetchProfileById(id);
    return row ? mapCustomerProfileRow(row) : null;
  },

  async createPerson(input: CreatePersonInput) {
    let organizationId = await resolveOrganizationId(input.organizationId);
    if (!organizationId) {
      const userId = await getServerUserId();
      const setupUser = userId ? await getSetupUserById(userId) : null;
      organizationId = setupUser?.organization_id?.trim() || null;
    }
    if (!organizationId) {
      throw new Error(
        "organizationId is required to create a contact — use the signed-in user's tenant.",
      );
    }

    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);

    const customFields = buildCustomFields({
      title: input.title,
      addressLine: input.addressLine,
      companyDomain: input.companyDomain,
      industry: input.companyIndustry,
    });
    const secondaryEmail = firstDistinctSecondaryEmail(
      email,
      input.secondaryEmails,
    );
    const secondaryPhone = firstDistinctSecondaryPhone(
      phone,
      input.secondaryPhones,
    );

    const generatedCdpId = newCrmCdpId(organizationId);
    if (!generatedCdpId.trim()) {
      throw new Error("Failed to allocate contact id.");
    }
    const loc = locationFromInbound(
      {
        city: input.city,
        country: input.country,
        addressLine: input.addressLine,
        phone,
      },
      phone,
    );
    const cdpId = await withAccountTransaction(async (client) => {
      const contactType = resolveContactTypeForChannels({
        requested: input.contactType,
        existing: "contact",
        email,
        phone,
        secondaryEmails: input.secondaryEmails,
        secondaryPhones: input.secondaryPhones,
      });
      const { rows } = await client.query<{ cdp_id: string }>(
        `INSERT INTO cdp.customer_profile (
           cdp_id, organization_id, first_name, last_name,
           company, city, country, region, custom_fields, contact_type,
           acquisition_channel
         ) VALUES ($1::text, $2::bigint, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11
         )
         RETURNING cdp_id::text AS cdp_id`,
        [
          generatedCdpId,
          organizationId,
          input.firstName.trim(),
          input.lastName.trim(),
          input.companyName?.trim() || null,
          input.city?.trim() || loc.city,
          input.country?.trim() || loc.country,
          input.addressLine?.trim() || loc.addressLine,
          JSON.stringify(customFields),
          contactType,
          acquisitionChannelValue(input.leadSource),
        ],
      );
      const id = rows[0]?.cdp_id;
      if (!id) throw new Error("Failed to create customer_profile.");

      if (email) {
        await insertIdentityKey(client, {
          cdpId: id,
          organizationId,
          keyType: "email",
          keyValue: email,
        });
      }
      if (phone) {
        await insertIdentityKey(client, {
          cdpId: id,
          organizationId,
          keyType: "phone",
          keyValue: phone,
        });
      }
      if (secondaryEmail) {
        await insertIdentityKey(client, {
          cdpId: id,
          organizationId,
          keyType: "email_secondary",
          keyValue: secondaryEmail,
        });
      }
      if (secondaryPhone) {
        await insertIdentityKey(client, {
          cdpId: id,
          organizationId,
          keyType: "phone_secondary",
          keyValue: secondaryPhone,
        });
      }
      return id;
    });

    const row = await fetchProfileById(cdpId);
    if (!row) throw new Error("Contact created but could not be reloaded.");
    return mapCustomerProfileRow(row);
  },

  async updatePerson(id, input: UpdatePersonInput) {
    const currentRow = await fetchProfileById(id);
    if (!currentRow) {
      throw new Error("Contact not found in cdp.customer_profile.");
    }
    const current = mapCustomerProfileRow(currentRow);

    const nextEmail =
      input.email !== undefined
        ? normalizeEmail(input.email)
        : normalizeEmail(current.email);
    const nextPhone =
      input.phone !== undefined
        ? normalizePhone(input.phone)
        : normalizePhone(current.phone);
    const secondaryEmail = firstDistinctSecondaryEmail(
      nextEmail,
      input.secondaryEmails !== undefined
        ? input.secondaryEmails
        : current.secondaryEmails,
    );
    const secondaryPhone = firstDistinctSecondaryPhone(
      nextPhone,
      input.secondaryPhones !== undefined
        ? input.secondaryPhones
        : current.secondaryPhones,
    );

    const customFields = buildCustomFields({
      title: input.title !== undefined ? input.title : current.title,
      addressLine:
        input.addressLine !== undefined ? input.addressLine : current.addressLine,
      companyDomain:
        input.companyDomain !== undefined
          ? input.companyDomain
          : current.company?.domain ?? null,
      industry:
        input.companyIndustry !== undefined
          ? input.companyIndustry
          : current.company?.industry ?? null,
      existing: currentRow.custom_fields,
    });

    const loc = locationFromInbound(
      {
        city: input.city !== undefined ? input.city : current.city,
        country: input.country !== undefined ? input.country : current.country,
        addressLine:
          input.addressLine !== undefined
            ? input.addressLine
            : current.addressLine,
        phone: nextPhone,
      },
      nextPhone,
    );
    const nextCity =
      (input.city !== undefined ? input.city?.trim() || null : current.city) ||
      loc.city;
    const nextCountry =
      (input.country !== undefined
        ? input.country?.trim() || null
        : current.country) || loc.country;
    const nextAddressLine =
      (input.addressLine !== undefined
        ? input.addressLine?.trim() || null
        : current.addressLine) || loc.addressLine;

    const organizationId =
      input.organizationId !== undefined
        ? (await resolveOrganizationId(input.organizationId)) ??
          current.organizationId
        : current.organizationId;
    if (!organizationId) {
      throw new Error("organizationId is required to update a contact.");
    }

    await withAccountTransaction(async (client) => {
      const nextContactType = resolveContactTypeForChannels({
        requested:
          input.contactType !== undefined
            ? input.contactType
            : current.contactType,
        existing: current.contactType,
        email: nextEmail,
        phone: nextPhone,
        secondaryEmails: secondaryEmail ? [secondaryEmail] : [],
        secondaryPhones: secondaryPhone ? [secondaryPhone] : [],
      });
      await client.query(
        `UPDATE cdp.customer_profile SET
           first_name = $2,
           last_name = $3,
           company = $4,
           city = $5,
           country = $6,
           region = $7,
           custom_fields = $8::jsonb,
           organization_id = $9::bigint,
           contact_type = $10,
           acquisition_channel = $11,
           updated_at = now()
         WHERE cdp_id = $1::text`,
        [
          id,
          input.firstName?.trim() ?? current.firstName,
          input.lastName?.trim() ?? current.lastName,
          input.companyName !== undefined
            ? input.companyName?.trim() || null
            : current.company?.name ?? null,
          nextCity,
          nextCountry,
          nextAddressLine,
          JSON.stringify(customFields),
          organizationId,
          nextContactType,
          input.leadSource !== undefined
            ? acquisitionChannelValue(input.leadSource)
            : current.leadSource,
        ],
      );

      await replaceIdentityKey(client, {
        cdpId: id,
        organizationId,
        keyType: "email",
        keyValue: nextEmail,
      });
      await replaceIdentityKey(client, {
        cdpId: id,
        organizationId,
        keyType: "phone",
        keyValue: nextPhone,
      });
      await replaceIdentityKey(client, {
        cdpId: id,
        organizationId,
        keyType: "email_secondary",
        keyValue: secondaryEmail,
      });
      await replaceIdentityKey(client, {
        cdpId: id,
        organizationId,
        keyType: "phone_secondary",
        keyValue: secondaryPhone,
      });
    });

    const row = await fetchProfileById(id);
    if (!row) throw new Error("Contact updated but could not be reloaded.");
    return mapCustomerProfileRow(row);
  },

  async setPersonPinned(id, _isPinned) {
    const person = await this.getPerson(id);
    if (!person) throw new Error("Contact not found in cdp.customer_profile.");
    return person;
  },

  async deletePerson(id) {
    // Soft-archive is CRM-side (contact_profiles). CDP has no is_active.
    // Hard-delete when nothing in shared CDP still references the person
    // (e.g. gold_customer_metrics). Do not ALTER those FKs from CRM.
    return tryDeleteCdpCustomerProfile(id);
  },
};

export async function findContactIdsBySearch(
  search: string,
  options?: { organizationId?: string | null; limit?: number },
): Promise<string[]> {
  const q = search.trim();
  if (!q) return [];
  const limit = options?.limit ?? 5000;
  const organizationId = options?.organizationId?.trim() || null;
  const { sql, values, nextIndex } = buildPersonSearchClause(1, q);
  const orgParam = nextIndex;
  const limitParam = nextIndex + 1;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.customer_profile p
     WHERE ($${orgParam}::bigint IS NULL OR p.organization_id = $${orgParam}::bigint)
       AND ${sql}
     ORDER BY p.updated_at DESC
     LIMIT $${limitParam}`,
    [...values, organizationId, limit],
  );
  return rows.map((r) => r.id);
}

export async function findContactIdsByContactType(
  contactType: ContactType,
  options?: { organizationId?: string | null; limit?: number },
): Promise<string[]> {
  const limit = options?.limit ?? 10_000;
  const organizationId = options?.organizationId?.trim() || null;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.customer_profile p
     WHERE lower(coalesce(p.contact_type, 'contact')) = lower($1)
       AND ($3::bigint IS NULL OR p.organization_id = $3::bigint)
     ORDER BY p.updated_at DESC
     LIMIT $2`,
    [contactType, limit, organizationId],
  );
  return rows.map((r) => r.id);
}

/** CDP profile ids for a tenant — drops stale cross-tenant CRM profiles. */
export async function listActiveContactIds(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<string[]> {
  const limit = options?.limit ?? 10_000;
  const organizationId = options?.organizationId?.trim() || null;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.customer_profile p
     WHERE ($2::bigint IS NULL OR p.organization_id = $2::bigint)
     ORDER BY p.updated_at DESC
     LIMIT $1`,
    [limit, organizationId],
  );
  return rows.map((r) => r.id);
}

const REACHABLE_KEY_TYPES = `('email', 'email_secondary', 'phone', 'phone_secondary')`;

/**
 * Filter CDP ids by whether they have any non-empty email/phone identity key.
 * Used for list filters: All/Active/Inactive exclude unreachable; Unknown is only those.
 */
export async function filterContactIdsByReachability(
  ids: string[],
  hasReachable: boolean,
): Promise<string[]> {
  const unique = [
    ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return [];
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.customer_profile p
     WHERE lower(p.cdp_id::text) = ANY(
       SELECT lower(x) FROM unnest($1::text[]) AS x
     )
       AND ${
         hasReachable ? "EXISTS" : "NOT EXISTS"
       } (
         SELECT 1
         FROM cdp.identity_keys k
         WHERE k.cdp_id = p.cdp_id
           AND k.key_type IN ${REACHABLE_KEY_TYPES}
           AND nullif(btrim(k.key_value), '') IS NOT NULL
       )`,
    [unique],
  );
  const allowed = new Set(rows.map((r) => r.id.toLowerCase()));
  return unique.filter((id) => allowed.has(id.toLowerCase()));
}

export async function getPeopleByIds(ids: string[]): Promise<AccountPerson[]> {
  if (ids.length === 0) return [];
  const unique = [
    ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return [];
  const { rows } = await accountQuery<CustomerProfileRow>(
    `SELECT ${PROFILE_SELECT}
     FROM cdp.customer_profile p
     WHERE lower(p.cdp_id::text) = ANY(
       SELECT lower(x) FROM unnest($1::text[]) AS x
     )`,
    [unique],
  );
  const byId = new Map(
    rows.map((r) => [
      String(r.cdp_id).toLowerCase(),
      mapCustomerProfileRow(r),
    ]),
  );
  return unique
    .map((id) => byId.get(id.toLowerCase()))
    .filter(Boolean) as AccountPerson[];
}

/** Lightweight name/email hydrate for peripheral modules (prefer over raw SQL). */
export async function getContactHydrateByIds(
  ids: string[],
): Promise<
  Map<
    string,
    {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      company: string | null;
    }
  >
> {
  const people = await getPeopleByIds(ids);
  return new Map(
    people.map((p) => [
      p.id,
      {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email || null,
        phone: p.phone,
        company: p.company?.name ?? null,
      },
    ]),
  );
}

export async function countActiveContactsForCompanyName(
  companyName: string,
): Promise<number> {
  const name = companyName.trim();
  if (!name) return 0;
  const { rows } = await accountQuery<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM cdp.customer_profile
     WHERE company IS NOT NULL
       AND lower(trim(company)) = lower($1)`,
    [name],
  );
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

/** Resolve cdp_id by identity key (org-scoped). */
export async function findCdpIdByIdentityKey(args: {
  organizationId: string;
  keyType: string | string[];
  keyValue: string;
}): Promise<string | null> {
  const value = args.keyValue.trim();
  if (!value) return null;
  const types = Array.isArray(args.keyType) ? args.keyType : [args.keyType];
  const { rows } = await accountQuery<{ cdp_id: string }>(
    `SELECT cdp_id::text AS cdp_id
     FROM cdp.identity_keys
     WHERE organization_id = $1::bigint
       AND key_type = ANY($2::text[])
       AND lower(key_value) = lower($3)
     LIMIT 1`,
    [args.organizationId, types, value],
  );
  return rows[0]?.cdp_id ?? null;
}
