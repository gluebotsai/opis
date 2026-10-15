import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import {
  CUSTOMER_PROFILE_LIST_SELECT,
  CUSTOMER_PROFILE_SELECT,
  IDENTITY_KEY_TYPES,
  emailIdentityExists,
  findCdpIdByMatchingPhone,
  isIdentityKeyConflict,
  phonesMatchWithCountryCode,
  readCustomFieldBool,
  readCustomFieldString,
  replaceSiblingIdentityKeys,
  upsertIdentityKey,
} from "./cdp-customer-profile.js";

export const contactListQuerySchema = z.object({
  search: z.string().optional(),
  filter: z.enum(["all", "active", "inactive", "unknown"]).optional().default("all"),
  sort: z.enum(["updatedAt", "fullName", "primaryEmail"]).optional().default("updatedAt"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  includeStats: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const contactCreatedCountQuerySchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: "startDate must be on or before endDate",
    path: ["endDate"],
  });

export type ContactCreatedCountQuery = z.infer<typeof contactCreatedCountQuerySchema>;

export type ContactListStats = {
  total: number;
  active: number;
  completeProfile: number;
};

export async function countContactsCreated(
  db: DbClient,
  organizationId: string,
  query: ContactCreatedCountQuery,
): Promise<{ count: number; startDate: string; endDate: string }> {
  const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(
    `
    SELECT COUNT(*)::int AS count
    FROM cdp.customer_profile
    WHERE organization_id = $1::bigint
      AND created_at >= $2::date
      AND created_at < ($3::date + INTERVAL '1 day')
    `,
    organizationId,
    query.startDate,
    query.endDate,
  );

  return {
    count: rows[0]?.count ?? 0,
    startDate: query.startDate,
    endDate: query.endDate,
  };
}

const CONTACT_IDENTITY_JOINS = `
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

const CONTACT_FULL_NAME = `btrim(concat_ws(' ', cp.first_name, cp.last_name))`;

/** Split a directory query into name tokens so "Sanju Ravi" matches first+last. */
export function splitContactSearchTokens(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean);
}

/**
 * Match the name shown in the list, email, phone, company, or city.
 * A spaced phone matches the stored digits. Every word must match a name part.
 */
export function buildContactSearchFilter(
  startIndex: number,
  search: string,
): { sql: string; values: unknown[] } {
  const trimmed = search.trim();
  if (!trimmed) {
    return { sql: "TRUE", values: [] };
  }

  const values: unknown[] = [`%${trimmed}%`];
  let index = startIndex;
  const full = `$${index++}`;
  const fieldMatch = (pattern: string) => `
    cp.first_name ILIKE ${pattern}
    OR cp.last_name ILIKE ${pattern}
    OR ${CONTACT_FULL_NAME} ILIKE ${pattern}
    OR COALESCE(cp.custom_fields->>'customerName', '') ILIKE ${pattern}
    OR COALESCE(cp.custom_fields->>'displayName', '') ILIKE ${pattern}
    OR COALESCE(email_ik.key_value, '') ILIKE ${pattern}
    OR COALESCE(email2_ik.key_value, '') ILIKE ${pattern}
    OR COALESCE(phone_ik.key_value, '') ILIKE ${pattern}
    OR COALESCE(phone2_ik.key_value, '') ILIKE ${pattern}
    OR COALESCE(cp.company, '') ILIKE ${pattern}
    OR COALESCE(cp.custom_fields->>'industry', '') ILIKE ${pattern}
    OR COALESCE(cp.city, '') ILIKE ${pattern}
    OR COALESCE(cp.country, '') ILIKE ${pattern}
  `;

  const phoneDigitMatch = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 3) return "";
    values.push(`%${digits}%`);
    const pattern = `$${index++}`;
    return `
      OR regexp_replace(COALESCE(phone_ik.key_value, ''), '\\D', '', 'g') LIKE ${pattern}
      OR regexp_replace(COALESCE(phone2_ik.key_value, ''), '\\D', '', 'g') LIKE ${pattern}
    `;
  };

  const tokens = splitContactSearchTokens(trimmed);
  if (tokens.length < 2) {
    return { sql: `(${fieldMatch(full)} ${phoneDigitMatch(trimmed)})`, values };
  }

  const tokenSql = tokens.map((token) => {
    values.push(`%${token}%`);
    const pattern = `$${index++}`;
    return `(
      cp.first_name ILIKE ${pattern}
      OR cp.last_name ILIKE ${pattern}
      OR ${CONTACT_FULL_NAME} ILIKE ${pattern}
      OR COALESCE(cp.custom_fields->>'customerName', '') ILIKE ${pattern}
      OR COALESCE(cp.custom_fields->>'displayName', '') ILIKE ${pattern}
    )`;
  });

  return {
    sql: `((${fieldMatch(full)} ${phoneDigitMatch(trimmed)}) OR (${tokenSql.join(" AND ")}))`,
    values,
  };
}

const COMPLETE_PROFILE_FILTER = `
  (
    NULLIF(trim(COALESCE(cp.first_name, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(cp.last_name, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(cp.custom_fields->>'customerName', '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(cp.custom_fields->>'displayName', '')), '') IS NOT NULL
  )
  AND (
    NULLIF(trim(COALESCE(email_ik.key_value, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(phone_ik.key_value, '')), '') IS NOT NULL
  )
`;

const CONTACT_HAS_DETAILS_FILTER = `
  (
    NULLIF(trim(COALESCE(email_ik.key_value, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(phone_ik.key_value, '')), '') IS NOT NULL
  )
`;

const CONTACT_UNKNOWN_FILTER = `
  (
    NULLIF(trim(COALESCE(email_ik.key_value, '')), '') IS NULL
    AND NULLIF(trim(COALESCE(phone_ik.key_value, '')), '') IS NULL
  )
`;

function contactListFilterClause(filter: ContactListQuery["filter"]): string {
  switch (filter) {
    case "inactive":
      return `AND COALESCE((cp.custom_fields->>'isActive')::boolean, TRUE) = FALSE`;
    case "unknown":
      return `AND ${CONTACT_UNKNOWN_FILTER}`;
    case "active":
      return `AND COALESCE((cp.custom_fields->>'isActive')::boolean, TRUE) = TRUE`;
    case "all":
    default:
      return `AND ${CONTACT_HAS_DETAILS_FILTER}`;
  }
}

async function getContactStats(
  db: DbClient,
  organizationId: string,
  search: string,
  filter: ContactListQuery["filter"] = "all",
): Promise<ContactListStats> {
  const { sql: searchSql, values: searchValues } = buildContactSearchFilter(2, search);
  const listFilter = contactListFilterClause(filter);
  const rows = await db.$queryRawUnsafe<Array<{
    total: number;
    active: number;
    complete_profile: number;
  }>>(
    `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE COALESCE((cp.custom_fields->>'isActive')::boolean, TRUE) = TRUE
      )::int AS active,
      COUNT(*) FILTER (WHERE ${COMPLETE_PROFILE_FILTER})::int AS complete_profile
    FROM cdp.customer_profile cp
    ${CONTACT_IDENTITY_JOINS}
    WHERE cp.organization_id = $1::bigint
      ${listFilter}
      AND ${searchSql}
    `,
    organizationId,
    ...searchValues,
  );

  const row = rows[0];
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    completeProfile: row?.complete_profile ?? 0,
  };
}

const CONTACT_FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  primaryEmail: "Primary email",
  primaryPhone: "Primary phone",
  secondaryEmail: "Secondary email",
  secondaryPhone: "Secondary phone",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  company: "Company",
  industry: "Industry",
  city: "City",
  region: "Region",
  country: "Country",
  language: "Language",
  timezone: "Timezone",
  sourceSystem: "Source",
  customFields: "Custom fields",
  isActive: "Active",
  blocked: "Blocked",
};

function optionalText(max: number, label: string) {
  return z
    .string({ invalid_type_error: `${label} must be text.` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));
}

function optionalEmail(label: string) {
  const message = `${label} must be a valid email address.`;
  return z
    .preprocess(
      (value) => (value === "" ? null : value),
      z
        .string({ invalid_type_error: message })
        .trim()
        .email(message)
        .max(320, `${label} must be 320 characters or fewer.`)
        .nullable()
        .optional(),
    )
    .transform((value) => value?.toLowerCase() ?? null);
}

const baseContactSchema = z.object({
  firstName: z
    .string({
      required_error: "First name is required.",
      invalid_type_error: "First name is required.",
    })
    .trim()
    .min(1, "First name is required.")
    .max(120, "First name must be 120 characters or fewer."),
  lastName: optionalText(120, "Last name"),
  primaryEmail: optionalEmail("Primary email"),
  primaryPhone: optionalText(50, "Primary phone"),
  secondaryEmail: optionalEmail("Secondary email"),
  secondaryPhone: optionalText(50, "Secondary phone"),
  gender: optionalText(50, "Gender"),
  dateOfBirth: z.preprocess(
    (value) => (value === "" ? null : value),
    z
      .string({ invalid_type_error: "Date of birth must be a valid date." })
      .date("Date of birth must be a valid date.")
      .nullable()
      .optional(),
  ),
  company: optionalText(200, "Company"),
  industry: optionalText(160, "Industry"),
  city: optionalText(160, "City"),
  region: optionalText(160, "Region"),
  country: optionalText(160, "Country"),
  language: optionalText(80, "Language"),
  timezone: optionalText(100, "Timezone"),
  sourceSystem: optionalText(100, "Source").default("worktual"),
  customFields: z
    .record(z.string(), z.unknown(), {
      invalid_type_error: "Custom fields must be an object.",
    })
    .optional()
    .default({}),
  isActive: z
    .boolean({ invalid_type_error: "Active must be true or false." })
    .optional()
    .default(true),
  blocked: z
    .boolean({ invalid_type_error: "Blocked must be true or false." })
    .optional()
    .default(false),
});

function emailsEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const first = String(left ?? "").trim().toLowerCase();
  const second = String(right ?? "").trim().toLowerCase();
  return Boolean(first) && first === second;
}

export function contactDuplicateChannelMessage(input: {
  primaryEmail?: string | null;
  secondaryEmail?: string | null;
  primaryPhone?: string | null;
  secondaryPhone?: string | null;
}): string | null {
  if (emailsEquivalent(input.primaryEmail, input.secondaryEmail)) {
    return "Primary email and secondary email must be different.";
  }
  if (phonesMatchWithCountryCode(input.primaryPhone, input.secondaryPhone)) {
    return "Primary phone and secondary phone must be different.";
  }
  return null;
}

function rejectDuplicateChannels(
  data: {
    primaryEmail?: string | null;
    secondaryEmail?: string | null;
    primaryPhone?: string | null;
    secondaryPhone?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const message = contactDuplicateChannelMessage(data);
  if (!message) return;
  ctx.addIssue({ code: "custom", message });
}

function humanizeContactIssue(issue: z.ZodIssue): string {
  if (!issue.message.startsWith("Expected ") && issue.message !== "Required") {
    return issue.message;
  }
  const key = typeof issue.path[0] === "string" ? issue.path[0] : "";
  const label = CONTACT_FIELD_LABELS[key];
  if (!label) return issue.message;
  if (issue.code === "invalid_type" && (issue.received === "null" || issue.received === "undefined")) {
    return `${label} is required.`;
  }
  return `${label} is invalid.`;
}

/** Field-named messages for every Zod issue on a contact payload. */
export function formatContactSchemaError(error: z.ZodError): string {
  const messages: string[] = [];
  for (const issue of error.issues) {
    const text = humanizeContactIssue(issue);
    if (text && !messages.includes(text)) messages.push(text);
  }
  return messages.join(" ") || "Check the contact fields and try again.";
}

export const contactCreateSchema = baseContactSchema.superRefine((data, ctx) => {
  if (!data.primaryEmail && !data.primaryPhone) {
    ctx.addIssue({
      code: "custom",
      message: "Primary email or primary phone is required.",
    });
  }
  rejectDuplicateChannels(data, ctx);
});

export const contactUpdateSchema = baseContactSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one contact field is required")
  .superRefine(rejectDuplicateChannels);

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

export class ContactConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactConflictError";
  }
}

export type CdpProfileRecord = {
  id: string;
  organizationId: string;
  externalId: string | null;
  email: string | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CdpContactRecord = {
  id: string;
  organizationId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  secondaryEmail: string | null;
  secondaryPhone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  company: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  language: string | null;
  timezone: string | null;
  sourceSystem: string | null;
  customFields: Record<string, unknown>;
  isActive: boolean;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  profile: CdpProfileRecord | null;
};

type ContactRow = {
  id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  secondary_email: string | null;
  secondary_phone: string | null;
  gender: string | null;
  date_of_birth: Date | null;
  company: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  language: string | null;
  timezone: string | null;
  source_system: string | null;
  custom_fields: Record<string, unknown> | null;
  blocked: boolean;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
  whatsapp_display_name: string | null;
};

const GENERIC_WHATSAPP_SUBJECTS = new Set(["whatsapp", "e2e customer"]);

function isGenericWhatsAppSubject(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || GENERIC_WHATSAPP_SUBJECTS.has(normalized);
}

function resolveWhatsAppDisplayName(row: ContactRow): string | null {
  const candidate = row.whatsapp_display_name?.trim();
  if (!candidate || isPhoneLikeName(candidate) || isGenericWhatsAppSubject(candidate)) {
    return null;
  }
  return candidate;
}

function splitDisplayName(displayName: string): { firstName: string; lastName: string | null } {
  const trimmed = displayName.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: trimmed, lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function isPhoneLikeName(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const significant = trimmed.replace(/[\s().+-]/g, "");
  return digits.length >= significant.length * 0.8;
}

function isEmailLocalPartName(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  return (
    !trimmed.includes(" ") &&
    !trimmed.includes("@") &&
    /^[a-z0-9._+-]+$/i.test(trimmed) &&
    trimmed.length >= 3
  );
}

function isWeakProfileName(value: string | null | undefined): boolean {
  return isPhoneLikeName(value) || isEmailLocalPartName(value);
}

function fullName(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
  phone: string | null,
  customFields?: Record<string, unknown> | null,
  whatsappDisplayName?: string | null,
) {
  const parts = [firstName, lastName].filter(
    (part): part is string => Boolean(part) && !isWeakProfileName(part),
  );
  if (parts.length > 0) return parts.join(" ");

  if (whatsappDisplayName?.trim() && !isPhoneLikeName(whatsappDisplayName)) {
    return whatsappDisplayName.trim();
  }

  const customName =
    typeof customFields?.customerName === "string"
      ? customFields.customerName
      : typeof customFields?.displayName === "string"
        ? customFields.displayName
        : null;
  if (customName?.trim() && !isPhoneLikeName(customName)) {
    return customName.trim();
  }

  if (email) return email;
  if (phone) return phone;
  return "Unknown contact";
}

function mapContact(row: ContactRow): CdpContactRecord {
  const customFields = row.custom_fields ?? {};
  const whatsappDisplayName = resolveWhatsAppDisplayName(row);
  const needsNameRepair = Boolean(
    whatsappDisplayName && (isWeakProfileName(row.first_name) || !row.first_name?.trim()),
  );
  const repairedName = needsNameRepair && whatsappDisplayName
    ? splitDisplayName(whatsappDisplayName)
    : null;
  const firstName = repairedName?.firstName ?? row.first_name;
  const lastName = repairedName?.lastName ?? row.last_name;
  const enrichedCustomFields =
    whatsappDisplayName && !customFields.customerName
      ? { ...customFields, customerName: whatsappDisplayName }
      : customFields;
  const profileAttributes = customFields.profileAttributes;
  const profile =
    profileAttributes && typeof profileAttributes === "object" && !Array.isArray(profileAttributes)
      ? {
          id: String(row.id),
          organizationId: String(row.organization_id),
          externalId: String(row.id),
          email: row.primary_email,
          attributes: profileAttributes as Record<string, unknown>,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }
      : null;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    firstName,
    lastName,
    fullName: fullName(
      firstName,
      lastName,
      row.primary_email,
      row.primary_phone,
      enrichedCustomFields,
      whatsappDisplayName,
    ),
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    secondaryEmail: row.secondary_email,
    secondaryPhone: row.secondary_phone,
    gender: row.gender,
    dateOfBirth: row.date_of_birth ? row.date_of_birth.toISOString().slice(0, 10) : null,
    company: row.company,
    industry: readCustomFieldString(customFields, "industry"),
    city: row.city,
    region: row.region,
    country: row.country,
    language: row.language,
    timezone: row.timezone,
    sourceSystem: row.source_system,
    customFields: enrichedCustomFields,
    isActive: readCustomFieldBool(customFields, "isActive", true),
    blocked: Boolean(row.blocked),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    profile,
  };
}

function sortColumn(sort: ContactListQuery["sort"]) {
  switch (sort) {
    case "fullName":
      return "cp.first_name";
    case "primaryEmail":
      return "email_ik.key_value";
    default:
      return "cp.updated_at";
  }
}

function buildCustomFields(
  input: Pick<ContactCreateInput, "customFields" | "industry" | "isActive">,
): Record<string, unknown> {
  return {
    ...(input.customFields ?? {}),
    ...(input.industry !== undefined ? { industry: input.industry } : {}),
    isActive: input.isActive ?? true,
  };
}

async function assertPhoneNotTaken(
  db: DbClient,
  organizationId: string,
  phone: string | null | undefined,
  excludingCdpId?: string,
): Promise<void> {
  if (!phone) return;
  const owner = await findCdpIdByMatchingPhone(db, organizationId, phone, excludingCdpId);
  if (owner) {
    throw new ContactConflictError(`A contact with phone "${phone}" already exists`);
  }
}

async function syncIdentityKeys(
  db: DbClient,
  organizationId: string,
  cdpId: string,
  input: {
    primaryEmail?: string | null;
    primaryPhone?: string | null;
    secondaryEmail?: string | null;
    secondaryPhone?: string | null;
    sourceSystem?: string | null;
  },
): Promise<void> {
  if (input.primaryEmail) {
    await upsertIdentityKey(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.EMAIL,
      input.primaryEmail,
      input.sourceSystem,
    );
    await replaceSiblingIdentityKeys(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.EMAIL,
      input.primaryEmail,
    );
  }
  if (input.primaryPhone) {
    await upsertIdentityKey(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.PHONE,
      input.primaryPhone,
      input.sourceSystem,
    );
    await replaceSiblingIdentityKeys(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.PHONE,
      input.primaryPhone,
    );
  }
  if (input.secondaryEmail) {
    await upsertIdentityKey(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.EMAIL_SECONDARY,
      input.secondaryEmail,
      input.sourceSystem,
    );
    await replaceSiblingIdentityKeys(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.EMAIL_SECONDARY,
      input.secondaryEmail,
    );
  }
  if (input.secondaryPhone) {
    await upsertIdentityKey(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.PHONE_SECONDARY,
      input.secondaryPhone,
      input.sourceSystem,
    );
    await replaceSiblingIdentityKeys(
      db,
      organizationId,
      cdpId,
      IDENTITY_KEY_TYPES.PHONE_SECONDARY,
      input.secondaryPhone,
    );
  }
}

export async function listContacts(
  db: DbClient,
  organizationId: string,
  query: ContactListQuery,
): Promise<{
  contacts: CdpContactRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  stats: ContactListStats | null;
}> {
  const search = query.search?.trim() ?? "";
  const { sql: searchSql, values: searchValues } = buildContactSearchFilter(2, search);
  const limitIndex = 2 + searchValues.length;
  const offsetIndex = limitIndex + 1;
  const order = query.order === "asc" ? "ASC" : "DESC";
  const column = sortColumn(query.sort);
  const offset = (query.page - 1) * query.pageSize;
  const includeStats = query.includeStats ?? query.page === 1;
  const listFilter = contactListFilterClause(query.filter);

  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `
    ${CUSTOMER_PROFILE_LIST_SELECT}
    WHERE cp.organization_id = $1::bigint
      ${listFilter}
      AND ${searchSql}
    ORDER BY ${column} ${order}
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    organizationId,
    ...searchValues,
    query.pageSize,
    offset,
  );

  const countRows = await db.$queryRawUnsafe<Array<{ count: number }>>(
    `
    SELECT COUNT(*)::int AS count
    FROM cdp.customer_profile cp
    ${CONTACT_IDENTITY_JOINS}
    WHERE cp.organization_id = $1::bigint
      ${listFilter}
      AND ${searchSql}
    `,
    organizationId,
    ...searchValues,
  );

  const total = countRows[0]?.count ?? 0;
  const stats = includeStats
    ? await getContactStats(db, organizationId, search, query.filter)
    : null;

  return {
    contacts: rows.map(mapContact),
    total,
    page: query.page,
    pageSize: query.pageSize,
    hasMore: offset + rows.length < total,
    stats,
  };
}

async function repairWhatsAppProfileName(
  db: DbClient,
  organizationId: string,
  contactId: string,
  row: ContactRow,
): Promise<void> {
  const whatsappDisplayName = resolveWhatsAppDisplayName(row);
  if (!whatsappDisplayName) return;
  if (row.first_name?.trim() && !isWeakProfileName(row.first_name)) return;

  const { firstName, lastName } = splitDisplayName(whatsappDisplayName);
  const customFields = row.custom_fields ?? {};
  const enrichedCustomFields = customFields.customerName
    ? customFields
    : { ...customFields, customerName: whatsappDisplayName };

  await db.$executeRawUnsafe(
    `
    UPDATE cdp.customer_profile
    SET first_name = $3,
        last_name = COALESCE($4, last_name),
        custom_fields = $5::jsonb,
        updated_at = NOW()
    WHERE organization_id = $1::bigint
      AND cdp_id = $2::text
    `,
    organizationId,
    contactId,
    firstName,
    lastName,
    JSON.stringify(enrichedCustomFields),
  );
}

export async function getContact(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<CdpContactRecord | null> {
  const rows = await db.$queryRawUnsafe<ContactRow[]>(
    `
    ${CUSTOMER_PROFILE_SELECT}
    WHERE cp.organization_id = $1::bigint
      AND cp.cdp_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );

  const row = rows[0];
  if (!row) return null;

  await repairWhatsAppProfileName(db, organizationId, contactId, row).catch(() => undefined);

  return mapContact(row);
}

export async function createContact(
  db: DbClient,
  organizationId: string,
  input: ContactCreateInput,
): Promise<CdpContactRecord> {
  const duplicateChannel = contactDuplicateChannelMessage(input);
  if (duplicateChannel) throw new ContactConflictError(duplicateChannel);

  if (input.primaryEmail && (await emailIdentityExists(db, organizationId, input.primaryEmail))) {
    throw new ContactConflictError(`A contact with email "${input.primaryEmail}" already exists`);
  }
  await assertPhoneNotTaken(db, organizationId, input.primaryPhone);
  await assertPhoneNotTaken(db, organizationId, input.secondaryPhone);

  const id = randomUUID();
  const customFields = buildCustomFields(input);

  try {
    await db.$executeRawUnsafe(
      `
      INSERT INTO cdp.customer_profile (
        cdp_id, organization_id, first_name, last_name, gender, date_of_birth,
        company, city, region, country, language, timezone,
        acquisition_channel, custom_fields, blocked, first_seen_at, last_seen_at,
        created_at, updated_at
      ) VALUES (
        $1, $2::bigint, $3, $4, $5, $6::date,
        $7, $8, $9, $10, $11, $12,
        $13, $14::jsonb, $15, NOW(), NOW(),
        NOW(), NOW()
      )
      `,
      id,
      organizationId,
      input.firstName ?? null,
      input.lastName ?? null,
      input.gender ?? null,
      input.dateOfBirth ?? null,
      input.company ?? null,
      input.city ?? null,
      input.region ?? null,
      input.country ?? null,
      input.language ?? null,
      input.timezone ?? null,
      input.sourceSystem ?? "worktual",
      JSON.stringify(customFields),
      input.blocked ?? false,
    );

    await syncIdentityKeys(db, organizationId, id, {
      primaryEmail: input.primaryEmail,
      primaryPhone: input.primaryPhone,
      secondaryEmail: input.secondaryEmail,
      secondaryPhone: input.secondaryPhone,
      sourceSystem: input.sourceSystem ?? "worktual",
    });
  } catch (error) {
    if (isIdentityKeyConflict(error)) {
      throw new ContactConflictError(`A contact with email "${input.primaryEmail}" already exists`);
    }
    throw error;
  }

  const contact = await getContact(db, organizationId, id);
  if (!contact) throw new Error("Created contact could not be loaded");
  return contact;
}

export async function updateContact(
  db: DbClient,
  organizationId: string,
  contactId: string,
  input: ContactUpdateInput,
): Promise<CdpContactRecord | null> {
  const current = await getContact(db, organizationId, contactId);
  if (!current) return null;

  const duplicateChannel = contactDuplicateChannelMessage({
    primaryEmail: input.primaryEmail !== undefined ? input.primaryEmail : current.primaryEmail,
    secondaryEmail:
      input.secondaryEmail !== undefined ? input.secondaryEmail : current.secondaryEmail,
    primaryPhone: input.primaryPhone !== undefined ? input.primaryPhone : current.primaryPhone,
    secondaryPhone:
      input.secondaryPhone !== undefined ? input.secondaryPhone : current.secondaryPhone,
  });
  if (duplicateChannel) throw new ContactConflictError(duplicateChannel);

  if (
    input.primaryEmail &&
    input.primaryEmail !== current.primaryEmail &&
    (await emailIdentityExists(db, organizationId, input.primaryEmail, contactId))
  ) {
    throw new ContactConflictError(`A contact with email "${input.primaryEmail}" already exists`);
  }
  if (input.primaryPhone !== undefined) {
    await assertPhoneNotTaken(db, organizationId, input.primaryPhone, contactId);
  }
  if (input.secondaryPhone !== undefined) {
    await assertPhoneNotTaken(db, organizationId, input.secondaryPhone, contactId);
  }

  const nextCustomFields = {
    ...current.customFields,
    ...(input.customFields ?? {}),
    ...(input.industry !== undefined ? { industry: input.industry } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };

  const profileUpdates: Array<{ column: string; value: unknown; cast?: string }> = [];
  if (input.firstName !== undefined) profileUpdates.push({ column: "first_name", value: input.firstName });
  if (input.lastName !== undefined) profileUpdates.push({ column: "last_name", value: input.lastName });
  if (input.gender !== undefined) profileUpdates.push({ column: "gender", value: input.gender });
  if (input.dateOfBirth !== undefined) {
    profileUpdates.push({ column: "date_of_birth", value: input.dateOfBirth, cast: "::date" });
  }
  if (input.company !== undefined) profileUpdates.push({ column: "company", value: input.company });
  if (input.city !== undefined) profileUpdates.push({ column: "city", value: input.city });
  if (input.region !== undefined) profileUpdates.push({ column: "region", value: input.region });
  if (input.country !== undefined) profileUpdates.push({ column: "country", value: input.country });
  if (input.language !== undefined) profileUpdates.push({ column: "language", value: input.language });
  if (input.timezone !== undefined) profileUpdates.push({ column: "timezone", value: input.timezone });
  if (input.sourceSystem !== undefined) {
    profileUpdates.push({ column: "acquisition_channel", value: input.sourceSystem });
  }
  if (input.blocked !== undefined) {
    profileUpdates.push({ column: "blocked", value: input.blocked });
  }
  if (
    input.customFields !== undefined ||
    input.industry !== undefined ||
    input.isActive !== undefined
  ) {
    profileUpdates.push({
      column: "custom_fields",
      value: JSON.stringify(nextCustomFields),
      cast: "::jsonb",
    });
  }

  try {
    if (profileUpdates.length > 0) {
      const values: unknown[] = [organizationId, contactId];
      const assignments = profileUpdates.map((entry, index) => {
        values.push(entry.value);
        return `${entry.column} = $${index + 3}${entry.cast ?? ""}`;
      });
      await db.$executeRawUnsafe(
        `
        UPDATE cdp.customer_profile
        SET ${assignments.join(", ")}, updated_at = NOW(), last_seen_at = NOW()
        WHERE organization_id = $1::bigint
          AND cdp_id = $2::text
        `,
        ...values,
      );
    }

    if (
      input.primaryEmail !== undefined ||
      input.primaryPhone !== undefined ||
      input.secondaryEmail !== undefined ||
      input.secondaryPhone !== undefined
    ) {
      await syncIdentityKeys(db, organizationId, contactId, {
        primaryEmail: input.primaryEmail,
        primaryPhone: input.primaryPhone,
        secondaryEmail: input.secondaryEmail,
        secondaryPhone: input.secondaryPhone,
        sourceSystem: input.sourceSystem ?? current.sourceSystem,
      });
    }
  } catch (error) {
    if (isIdentityKeyConflict(error)) {
      throw new ContactConflictError(
        `A contact with email "${input.primaryEmail}" already exists`,
      );
    }
    throw error;
  }

  return getContact(db, organizationId, contactId);
}

export async function deleteContact(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<CdpContactRecord | null> {
  const current = await getContact(db, organizationId, contactId);
  if (!current) return null;

  const customFields = {
    ...current.customFields,
    isActive: false,
  };

  await db.$executeRawUnsafe(
    `
    UPDATE cdp.customer_profile
    SET custom_fields = $3::jsonb, updated_at = NOW()
    WHERE organization_id = $1::bigint
      AND cdp_id = $2::text
    `,
    organizationId,
    contactId,
    JSON.stringify(customFields),
  );
  return current;
}
