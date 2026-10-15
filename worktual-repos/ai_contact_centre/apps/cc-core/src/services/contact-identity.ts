import { z } from "zod";

import { createLogger } from "@ai-contact-center/observability";

import type { DbClient } from "../lib/rls.js";
import { isCallChannel } from "../lib/channels.js";
import {
  IDENTITY_KEY_TYPES,
  IdentityKeyConflictError,
  emailIdentityExists,
  findCdpIdByIdentityKey,
  findCdpIdByMatchingPhone,
  upsertIdentityKey,
} from "./cdp-customer-profile.js";
import { buildInboundCdpIdFromInput } from "./cdp-id.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { mergeContacts, resolveCanonicalContactId } from "./contact-merge.js";
import { getContact, type CdpContactRecord } from "./contacts.js";
import { scheduleOmniChannelSummaryRefresh } from "./omni-channel-summary.js";
import { entityIdSchema } from "../lib/id-schema.js";
import { toCdpIdText } from "../lib/sql-uuid.js";

const contactEnrichLogger = createLogger({ service: "cc-core-contact-enrich" });

export const inboundChannelSchema = z.enum([
  "email",
  "webchat",
  "whatsapp",
  "instagram",
  "facebook",
  "call",
  "voice",
]);
export type InboundChannel = z.infer<typeof inboundChannelSchema>;

export const resolveContactInputSchema = z.object({
  channel: inboundChannelSchema,
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  visitorId: z.string().max(128).optional(),
  displayName: z.string().max(200).optional(),
});

export type ResolveContactInput = z.infer<typeof resolveContactInputSchema>;

export type ResolveContactResult = {
  contactId: string;
  created: boolean;
  merged: boolean;
  contact: CdpContactRecord | null;
};

export const contactEnrichmentOutcomes = [
  "created",
  "enriched",
  "partial",
  "confirmation_required",
  "linked_existing",
  "merged_existing",
  "no_change",
] as const;
export type ContactEnrichmentOutcome = (typeof contactEnrichmentOutcomes)[number];
export type ContactEnrichmentField =
  | "email"
  | "phone"
  | "firstName"
  | "lastName"
  | "displayName"
  | "company"
  | "city"
  | "country";
export type ContactEnrichmentSkipReason =
  | "already_on_profile"
  | "profile_conflict"
  | "invalid_value"
  | "identity_owned_by_other_contact";
export type ContactEnrichmentSkippedField = {
  field: ContactEnrichmentField;
  proposedValue: string;
  currentValue: string | null;
  reason: ContactEnrichmentSkipReason;
  message: string;
};
export type ContactEnrichmentResult = {
  outcome: ContactEnrichmentOutcome;
  canonicalContactId: string;
  previousContactId: string | null;
  appliedFields: ContactEnrichmentField[];
  skippedFields: ContactEnrichmentSkippedField[];
  requiresConfirmation: ContactEnrichmentField[];
  contact: CdpContactRecord;
  idempotentReplay: boolean;
};

function summarizeSkippedFields(fields: ContactEnrichmentSkippedField[]) {
  return fields.map(({ field, reason }) => ({ field, reason }));
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || /\s/.test(trimmed)) return null;
  return z.string().email().safeParse(trimmed).success ? trimmed : null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    /[a-z]/i.test(trimmed) ||
    !/^\+?[\d\s().-]+$/.test(trimmed) ||
    (trimmed.includes("+") && !trimmed.startsWith("+"))
  ) {
    return null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

export function extractIdentityFromText(text: string): { email?: string; phone?: string } {
  const emailMatch = text.match(EMAIL_PATTERN);
  const phoneMatch = text.match(PHONE_PATTERN);
  return {
    email: normalizeEmail(emailMatch?.[0]) ?? undefined,
    phone: normalizePhone(phoneMatch?.[0]) ?? undefined,
  };
}

function normalizeLocationValue(value: string): string {
  const trimmed = value.trim().replace(/[.,!?;:]+$/g, "");
  if (!trimmed) return "";
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function extractLocationFromText(text: string): { city?: string; country?: string } {
  const patterns = [
    /\b(?:my\s+)?location\s+is\s+([a-z][a-z\s.'-]{1,60})/i,
    /\bbased\s+in\s+([a-z][a-z\s.'-]{1,60})/i,
    /\blive\s+in\s+([a-z][a-z\s.'-]{1,60})/i,
    /\bi(?:'m| am)\s+from\s+([a-z][a-z\s.'-]{1,60})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeLocationValue(match?.[1] ?? "");
    if (candidate.length >= 2 && candidate.length <= 60) {
      return { city: candidate };
    }
  }

  return {};
}

export function extractPrechatIdentity(
  prechatAnswers?: Record<string, unknown> | null,
): { email?: string; phone?: string; displayName?: string } {
  if (!prechatAnswers) return {};
  const lowerEntries = Object.entries(prechatAnswers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ] as const);
  let email: string | undefined;
  let phone: string | undefined;
  let displayName: string | undefined;
  for (const [key, value] of lowerEntries) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (!email && (key.includes("email") || value.includes("@"))) {
      email = normalizeEmail(value) ?? undefined;
    }
    if (!phone && (key.includes("phone") || key.includes("mobile") || key.includes("tel"))) {
      phone = normalizePhone(value) ?? undefined;
    }
    if (!displayName && (key.includes("name") || key === "fullname")) {
      displayName = value.trim();
    }
  }
  return { email, phone, displayName };
}

export function extractContactEntitiesFromFacts(
  facts: string[],
): EnrichContactInput {
  const result: EnrichContactInput = {};

  for (const fact of facts) {
    const prefixed = fact.match(/^contact\.([a-z_]+)=(.+)$/i);
    if (prefixed) {
      const key = prefixed[1]!.toLowerCase();
      const value = prefixed[2]!.trim();
      if (!value) continue;
      if (key === "email" && !result.email) result.email = normalizeEmail(value) ?? undefined;
      if (key === "phone" && !result.phone) result.phone = normalizePhone(value) ?? undefined;
      if ((key === "first_name" || key === "firstname") && !result.firstName) {
        result.firstName = value;
      }
      if ((key === "last_name" || key === "lastname") && !result.lastName) {
        result.lastName = value;
      }
      if (key === "display_name" && !result.displayName) result.displayName = value;
      if (key === "company" && !result.company) result.company = value;
      if (key === "city" && !result.city) result.city = value;
      if (key === "country" && !result.country) result.country = value;
      continue;
    }
    const extracted = extractIdentityFromText(fact);
    result.email = result.email ?? extracted.email;
    result.phone = result.phone ?? extracted.phone;
  }

  return result;
}

export const contactEntitiesSchema = z.object({
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  displayName: z.string().max(200).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  city: z.string().max(160).nullable().optional(),
  country: z.string().max(160).nullable().optional(),
});

export type ContactEntitiesInput = z.infer<typeof contactEntitiesSchema>;

export type EnrichContactInput = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  company?: string;
  city?: string;
  country?: string;
  sourceMessageId?: string;
  confirmedFields?: ContactEnrichmentField[];
};

export function mergeContactCaptureSources(input: {
  customerText?: string;
  importantFacts?: string[];
  contactEntities?: ContactEntitiesInput | null;
}): EnrichContactInput {
  const fromText = extractIdentityFromText(input.customerText ?? "");
  const fromLocation = extractLocationFromText(input.customerText ?? "");
  const fromFacts = extractContactEntitiesFromFacts(input.importantFacts ?? []);
  const entities = input.contactEntities ?? {};

  return {
    email:
      normalizeEmail(entities.email ?? undefined) ??
      fromFacts.email ??
      fromText.email,
    phone:
      normalizePhone(entities.phone ?? undefined) ??
      fromFacts.phone ??
      fromText.phone,
    displayName:
      entities.displayName?.trim() ||
      fromFacts.displayName ||
      undefined,
    firstName: entities.firstName?.trim() || fromFacts.firstName || undefined,
    lastName: entities.lastName?.trim() || fromFacts.lastName || undefined,
    company: entities.company?.trim() || fromFacts.company || undefined,
    city: entities.city?.trim() || fromFacts.city || fromLocation.city || undefined,
    country: entities.country?.trim() || fromFacts.country || fromLocation.country || undefined,
  };
}

export function hasEnrichableContactData(input: EnrichContactInput): boolean {
  return Boolean(
    input.email ||
      input.phone ||
      input.firstName ||
      input.lastName ||
      input.displayName ||
      input.company ||
      input.city ||
      input.country,
  );
}

/** Profile fields worth persisting — excludes phone-only channel identity. */
export function hasProfileEnrichmentData(input: EnrichContactInput): boolean {
  return Boolean(
    input.firstName ||
      input.lastName ||
      input.displayName ||
      input.email ||
      input.company ||
      input.city ||
      input.country,
  );
}

function enrichmentDisplayName(enrich: EnrichContactInput): string | undefined {
  const explicit = enrich.displayName?.trim();
  if (explicit) return explicit;
  const parts = [enrich.firstName?.trim(), enrich.lastName?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function hasIdentityEnrichmentKeys(input: EnrichContactInput): boolean {
  return Boolean(input.email || input.phone);
}

const confirmationProtectedFields = new Set<ContactEnrichmentField>(["email", "phone"]);

function contactFieldValue(
  contact: CdpContactRecord,
  field: ContactEnrichmentField,
): string | null {
  switch (field) {
    case "email":
      return contact.primaryEmail;
    case "phone":
      return contact.primaryPhone;
    case "firstName":
      return contact.firstName;
    case "lastName":
      return contact.lastName;
    case "displayName":
      return contact.fullName;
    case "company":
      return contact.company;
    case "city":
      return contact.city;
    case "country":
      return contact.country;
  }
}

function normalizedFieldValue(
  field: ContactEnrichmentField,
  value: string | null | undefined,
): string | null {
  if (field === "email") return normalizeEmail(value);
  if (field === "phone") return normalizePhone(value);
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

async function hasPendingFieldConfirmation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  field: ContactEnrichmentField,
  proposedValue: string,
): Promise<boolean> {
  if (!confirmationProtectedFields.has(field)) return false;
  const normalized = normalizedFieldValue(field, proposedValue);
  if (!normalized) return false;

  const rows = await db.$queryRaw<Array<{ pending: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM cdp.interaction_events ie
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(ie.metadata->'skippedFields', '[]'::jsonb)
      ) skipped
      WHERE ie.organization_id = ${organizationId}::bigint
        AND ie.conversation_id = ${conversationId}::bigint
        AND ie.event_type = 'contact.enriched'
        AND skipped->>'field' = ${field}
        AND skipped->>'reason' = 'profile_conflict'
        AND (
          CASE
            WHEN ${field} = 'phone'
              THEN regexp_replace(skipped->>'proposedValue', '[^0-9]', '', 'g')
            ELSE lower(trim(skipped->>'proposedValue'))
          END
        ) = ${normalized}
        AND NOT EXISTS (
          SELECT 1
          FROM cdp.interaction_events later
          WHERE later.organization_id = ie.organization_id
            AND later.conversation_id = ie.conversation_id
            AND later.event_type = 'contact.enriched'
            AND later.occurred_at > ie.occurred_at
            AND jsonb_exists(
              COALESCE(later.metadata->'appliedFields', '[]'::jsonb),
              ${field}
            )
        )
    ) AS pending
  `;
  return rows[0]?.pending ?? false;
}

async function validatedConfirmedFields(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  enrich: EnrichContactInput,
): Promise<ContactEnrichmentField[]> {
  const validated: ContactEnrichmentField[] = [];
  for (const field of enrich.confirmedFields ?? []) {
    const proposed = enrich[field];
    if (
      typeof proposed === "string" &&
      await hasPendingFieldConfirmation(
        db,
        organizationId,
        conversationId,
        field,
        proposed,
      )
    ) {
      validated.push(field);
    }
  }
  return validated;
}

export function partitionContactEnrichment(
  contact: CdpContactRecord | null,
  enrich: EnrichContactInput,
): {
  applicable: EnrichContactInput;
  skippedFields: ContactEnrichmentSkippedField[];
  requiresConfirmation: ContactEnrichmentField[];
} {
  if (!contact) {
    return { applicable: enrich, skippedFields: [], requiresConfirmation: [] };
  }

  const applicable: EnrichContactInput = {
    sourceMessageId: enrich.sourceMessageId,
    confirmedFields: enrich.confirmedFields,
  };
  const skippedFields: ContactEnrichmentSkippedField[] = [];
  const requiresConfirmation: ContactEnrichmentField[] = [];
  const proposedValues: Partial<Record<ContactEnrichmentField, string | undefined>> = {
    email: enrich.email,
    phone: enrich.phone,
    firstName: enrich.firstName,
    lastName: enrich.lastName,
    displayName: enrich.displayName,
    company: enrich.company,
    city: enrich.city,
    country: enrich.country,
  };

  for (const field of Object.keys(proposedValues) as ContactEnrichmentField[]) {
    const proposed = proposedValues[field]?.trim();
    if (!proposed) continue;
    const current = contactFieldValue(contact, field);
    const normalizedProposed = normalizedFieldValue(field, proposed);
    const normalizedCurrent = normalizedFieldValue(field, current);

    if (!normalizedProposed) {
      skippedFields.push({
        field,
        proposedValue: proposed,
        currentValue: current,
        reason: "invalid_value",
        message: `${field} was not updated because the value is invalid.`,
      });
      continue;
    }
    if (normalizedCurrent === normalizedProposed) {
      skippedFields.push({
        field,
        proposedValue: proposed,
        currentValue: current,
        reason: "already_on_profile",
        message:
          field === "email"
            ? `Email ${proposed} is already on this contact. Do not call contact_enrich for it again.`
            : field === "phone"
              ? `Phone ${proposed} is already on this contact. Do not call contact_enrich for it again.`
              : `${field} already matches the contact profile.`,
      });
      continue;
    }
    applicable[field] = proposed;
  }

  return { applicable, skippedFields, requiresConfirmation };
}

/** Drop an email or phone that already belongs to a different contact. */
export function omitIdentityOwnedByAnotherContact(
  enrich: EnrichContactInput,
  owned: { email: boolean; phone: boolean },
): {
  enrich: EnrichContactInput;
  skippedFields: ContactEnrichmentSkippedField[];
} {
  const next: EnrichContactInput = { ...enrich };
  const skippedFields: ContactEnrichmentSkippedField[] = [];
  if (owned.email && next.email) {
    skippedFields.push({
      field: "email",
      proposedValue: next.email,
      currentValue: null,
      reason: "identity_owned_by_other_contact",
      message: `Email ${next.email} already belongs to another contact. Do not update it.`,
    });
    delete next.email;
  }
  if (owned.phone && next.phone) {
    skippedFields.push({
      field: "phone",
      proposedValue: next.phone,
      currentValue: null,
      reason: "identity_owned_by_other_contact",
      message: `Phone ${next.phone} already belongs to another contact. Do not update it.`,
    });
    delete next.phone;
  }
  return { enrich: next, skippedFields };
}

/** Block only a replacement. An empty email or phone is how an unknown visitor is recognized. */
export function blockIdentityOwnedByAnotherContact(
  owned: { email: boolean; phone: boolean },
  current: { email?: string | null; phone?: string | null },
): { email: boolean; phone: boolean } {
  return {
    email: Boolean(owned.email && current.email?.trim()),
    phone: Boolean(owned.phone && current.phone?.trim()),
  };
}

async function identityOwnedByAnotherContact(
  db: DbClient,
  organizationId: string,
  contactId: string,
  enrich: EnrichContactInput,
): Promise<{ email: boolean; phone: boolean }> {
  const email = enrich.email
    ? await emailIdentityExists(db, organizationId, enrich.email, contactId)
    : false;
  const phone = enrich.phone
    ? Boolean(await findCdpIdByMatchingPhone(db, organizationId, enrich.phone, contactId))
    : false;
  return { email, phone };
}

function namesMatch(
  proposed: string | null | undefined,
  existing: string | null | undefined,
): boolean {
  const left = proposed?.trim().toLowerCase();
  const right = existing?.trim().toLowerCase();
  return Boolean(left && right && left === right);
}

/** Drop enrich fields that already match the linked contact profile. */
export function pruneRedundantEnrichmentFields(
  contact: CdpContactRecord | null,
  enrich: EnrichContactInput,
): EnrichContactInput {
  if (!contact) return enrich;

  const pruned: EnrichContactInput = { ...enrich };
  if (
    pruned.email &&
    normalizeEmail(pruned.email) === normalizeEmail(contact.primaryEmail)
  ) {
    delete pruned.email;
  }
  if (
    pruned.phone &&
    normalizePhone(pruned.phone) === normalizePhone(contact.primaryPhone)
  ) {
    delete pruned.phone;
  }
  if (pruned.firstName && namesMatch(pruned.firstName, contact.firstName)) {
    delete pruned.firstName;
  }
  if (pruned.lastName && namesMatch(pruned.lastName, contact.lastName)) {
    delete pruned.lastName;
  }
  if (
    pruned.displayName &&
    !pruned.firstName &&
    !pruned.lastName &&
    namesMatch(pruned.displayName, contact.fullName)
  ) {
    delete pruned.displayName;
  }
  if (pruned.company && namesMatch(pruned.company, contact.company)) {
    delete pruned.company;
  }
  if (pruned.city && namesMatch(pruned.city, contact.city)) {
    delete pruned.city;
  }
  if (pruned.country && namesMatch(pruned.country, contact.country)) {
    delete pruned.country;
  }
  return pruned;
}

async function replacePrimaryIdentity(
  db: DbClient,
  organizationId: string,
  contactId: string,
  keyType: typeof IDENTITY_KEY_TYPES.EMAIL | typeof IDENTITY_KEY_TYPES.PHONE,
  keyValue: string,
  sourceChannel: InboundChannel,
): Promise<void> {
  await db.$executeRaw`
    DELETE FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${contactId}::text
      AND key_type = ${keyType}
      AND key_value <> ${keyValue}
  `;
  await registerIdentity(db, organizationId, contactId, keyType, keyValue, sourceChannel);
}

/** Apply explicit first/last name fields, preserving existing parts when only one is supplied. */
export function resolveExplicitNameEnrichment(
  enrich: Pick<EnrichContactInput, "firstName" | "lastName">,
  existing: { firstName: string | null; lastName: string | null },
): { firstName: string | null; lastName: string | null } | null {
  const first = enrich.firstName?.trim();
  const last = enrich.lastName?.trim();
  if (!first && !last) return null;

  return {
    firstName: first ?? existing.firstName?.trim() ?? null,
    lastName: last ?? existing.lastName?.trim() ?? null,
  };
}

/** Merge a display_name update with existing profile names (legacy fallback). */
export function resolveNameEnrichment(
  displayName: string | undefined,
  existing: { firstName: string | null; lastName: string | null },
): { firstName: string | null; lastName: string | null } | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      firstName: parts[0]!,
      lastName: parts.slice(1).join(" "),
    };
  }

  const token = parts[0]!;
  const first = existing.firstName?.trim() || null;
  const last = existing.lastName?.trim() || null;

  if (first && last) {
    if (token.toLowerCase() === last.toLowerCase()) return null;
    if (token.toLowerCase() === first.toLowerCase()) return { firstName: first, lastName: last };
    return { firstName: first, lastName: token };
  }

  if (first && !last) {
    if (token.toLowerCase() === first.toLowerCase()) return null;
    return { firstName: first, lastName: token };
  }

  if (!first && last) {
    if (token.toLowerCase() === last.toLowerCase()) return null;
    return { firstName: token, lastName: last };
  }

  return { firstName: token, lastName: null };
}

async function applyProfileEnrichment(
  db: DbClient,
  organizationId: string,
  contactId: string,
  enrich: EnrichContactInput,
  channel: InboundChannel,
): Promise<void> {
  if (!hasEnrichableContactData(enrich)) return;

  let firstNameUpdate: string | null = null;
  let lastNameUpdate: string | null = null;

  const existingRows = await db.$queryRaw<
    Array<{ first_name: string | null; last_name: string | null }>
  >`
    SELECT first_name, last_name
    FROM cdp.customer_profile
    WHERE cdp_id = ${contactId}::text
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const existingNames = {
    firstName: existingRows[0]?.first_name ?? null,
    lastName: existingRows[0]?.last_name ?? null,
  };

  if (enrich.firstName?.trim() || enrich.lastName?.trim()) {
    const resolved = resolveExplicitNameEnrichment(enrich, existingNames);
    if (resolved) {
      firstNameUpdate = resolved.firstName;
      lastNameUpdate = resolved.lastName;
    }
  } else if (enrich.displayName?.trim()) {
    const resolved = resolveNameEnrichment(enrich.displayName, existingNames);
    if (resolved) {
      firstNameUpdate = resolved.firstName;
      lastNameUpdate = resolved.lastName;
    }
  }

  await db.$executeRaw`
    UPDATE cdp.customer_profile
    SET
      first_name = COALESCE(${firstNameUpdate}, first_name),
      last_name = COALESCE(${lastNameUpdate}, last_name),
      company = COALESCE(NULLIF(${enrich.company ?? ""}, ''), company),
      city = COALESCE(NULLIF(${enrich.city ?? ""}, ''), city),
      country = COALESCE(NULLIF(${enrich.country ?? ""}, ''), country),
      last_seen_at = NOW(),
      updated_at = NOW()
    WHERE cdp_id = ${contactId}::text
      AND organization_id = ${organizationId}::bigint
  `;

  const email = normalizeEmail(enrich.email);
  const phone = normalizePhone(enrich.phone);
  if (email) {
    if (enrich.confirmedFields?.includes("email")) {
      await replacePrimaryIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.EMAIL,
        email,
        channel,
      );
    } else {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.EMAIL,
        email,
        channel,
      );
    }
  }
  if (phone) {
    if (enrich.confirmedFields?.includes("phone")) {
      await replacePrimaryIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.PHONE,
        phone,
        channel,
      );
    } else {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.PHONE,
        phone,
        channel,
      );
    }
    if (channel === "whatsapp") {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
        phone,
        channel,
      );
    }
  }
}

async function findContactIdByEmail(
  db: DbClient,
  organizationId: string,
  email: string,
): Promise<string | null> {
  const byPrimary = await findCdpIdByIdentityKey(
    db,
    organizationId,
    IDENTITY_KEY_TYPES.EMAIL,
    email,
  );
  if (byPrimary) return byPrimary;
  return findCdpIdByIdentityKey(db, organizationId, IDENTITY_KEY_TYPES.EMAIL_SECONDARY, email);
}

function contactHasPersonName(contact: CdpContactRecord | null | undefined): boolean {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  if (!name) return false;
  const digits = name.replace(/\D/g, "");
  return digits.length < 7;
}

async function findContactIdByPhone(
  db: DbClient,
  organizationId: string,
  phone: string,
): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return findCdpIdByMatchingPhone(db, organizationId, digits);
}

async function registerIdentity(
  db: DbClient,
  organizationId: string,
  contactId: string,
  keyType: (typeof IDENTITY_KEY_TYPES)[keyof typeof IDENTITY_KEY_TYPES],
  keyValue: string,
  sourceChannel: InboundChannel,
  options: { allowReassign?: boolean } = {},
): Promise<"registered" | "unchanged"> {
  return upsertIdentityKey(
    db,
    organizationId,
    contactId,
    keyType,
    keyValue,
    sourceChannel,
    options,
  );
}

async function createInboundContact(
  db: DbClient,
  organizationId: string,
  input: ResolveContactInput,
): Promise<{ contactId: string; created: boolean }> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const cdpId = buildInboundCdpIdFromInput(organizationId, {
    channel: input.channel,
    email,
    phone,
    visitorId: input.visitorId ?? null,
  });
  const nameParts = input.displayName?.trim().split(/\s+/) ?? [];
  const firstName = nameParts[0] ?? null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const existingRows = await db.$queryRaw<Array<{ cdp_id: string }>>`
    SELECT cdp_id
    FROM cdp.customer_profile
    WHERE cdp_id = ${cdpId}::text
    LIMIT 1
  `;
  const created = existingRows.length === 0;

  const rows = await db.$queryRaw<Array<{ cdp_id: string }>>`
    INSERT INTO cdp.customer_profile (
      cdp_id, organization_id, first_name, last_name,
      acquisition_channel, custom_fields, first_seen_at, last_seen_at,
      created_at, updated_at
    )
    VALUES (
      ${cdpId},
      ${organizationId}::bigint,
      ${firstName},
      ${lastName},
      ${`inbound_${input.channel}`},
      ${JSON.stringify({ inboundChannel: input.channel, isActive: true })}::jsonb,
      NOW(),
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (cdp_id) DO UPDATE
      SET
        last_seen_at = NOW(),
        updated_at = NOW()
    RETURNING cdp_id
  `;

  const id = rows[0]?.cdp_id;
  if (!id) {
    throw new Error("Failed to create inbound contact profile");
  }

  if (email) {
    await registerIdentity(db, organizationId, id, IDENTITY_KEY_TYPES.EMAIL, email, input.channel);
  }
  if (phone) {
    await registerIdentity(
      db,
      organizationId,
      id,
      IDENTITY_KEY_TYPES.PHONE,
      phone,
      input.channel,
    );
  }

  return { contactId: id, created };
}

export async function resolveOrCreateContact(
  db: DbClient,
  organizationId: string,
  rawInput: ResolveContactInput,
): Promise<ResolveContactResult> {
  const input = resolveContactInputSchema.parse(rawInput);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const rawEmailOwner = email
    ? await findContactIdByEmail(db, organizationId, email)
    : null;
  const rawPhoneOwner = phone
    ? await findContactIdByPhone(db, organizationId, phone)
    : null;
  const emailOwner = rawEmailOwner
    ? await resolveCanonicalContactId(db, organizationId, rawEmailOwner)
    : null;
  const phoneOwner = rawPhoneOwner
    ? await resolveCanonicalContactId(db, organizationId, rawPhoneOwner)
    : null;
  let contactId: string | null = emailOwner ?? phoneOwner;
  let merged = false;

  if (emailOwner && phoneOwner && emailOwner !== phoneOwner) {
    await mergeContacts(db, organizationId, {
      winnerId: emailOwner,
      loserId: phoneOwner,
      reason: "strong_identity_resolution",
    });
    contactId = emailOwner;
    merged = true;
  }
  if (!contactId && input.channel === "webchat" && input.visitorId) {
    contactId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
      input.visitorId,
    );
    if (contactId) {
      contactId = await resolveCanonicalContactId(db, organizationId, contactId);
    }
  }
  if (!contactId && input.channel === "whatsapp" && phone) {
    contactId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
      phone,
    );
    if (contactId) {
      contactId = await resolveCanonicalContactId(db, organizationId, contactId);
    }
  }
  if (!contactId && input.channel === "instagram" && input.visitorId) {
    contactId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.INSTAGRAM_USER,
      input.visitorId,
    );
    if (contactId) {
      contactId = await resolveCanonicalContactId(db, organizationId, contactId);
    }
  }
  if (!contactId && input.channel === "facebook" && input.visitorId) {
    contactId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.FACEBOOK_USER,
      input.visitorId,
    );
    if (contactId) {
      contactId = await resolveCanonicalContactId(db, organizationId, contactId);
    }
  }

  let created = false;
  if (!contactId) {
    const inboundContact = await createInboundContact(db, organizationId, {
      ...input,
      email: email ?? undefined,
      phone: phone ? input.phone : undefined,
    });
    contactId = inboundContact.contactId;
    created = inboundContact.created;
  }

  if (email) {
    await registerIdentity(db, organizationId, contactId, IDENTITY_KEY_TYPES.EMAIL, email, input.channel);
  }
  if (phone) {
    await registerIdentity(db, organizationId, contactId, IDENTITY_KEY_TYPES.PHONE, phone, input.channel);
    if (input.channel === "whatsapp") {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
        phone,
        input.channel,
      );
    }
  }
  if (input.channel === "webchat" && input.visitorId) {
    const visitorOwner = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
      input.visitorId,
    );
    if (!visitorOwner || visitorOwner === contactId) {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
        input.visitorId,
        input.channel,
      );
    }
  }
  if (input.channel === "instagram" && input.visitorId) {
    const visitorOwner = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.INSTAGRAM_USER,
      input.visitorId,
    );
    if (!visitorOwner || visitorOwner === contactId) {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.INSTAGRAM_USER,
        input.visitorId,
        input.channel,
      );
    }
  }
  if (input.channel === "facebook" && input.visitorId) {
    const visitorOwner = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.FACEBOOK_USER,
      input.visitorId,
    );
    if (!visitorOwner || visitorOwner === contactId) {
      await registerIdentity(
        db,
        organizationId,
        contactId,
        IDENTITY_KEY_TYPES.FACEBOOK_USER,
        input.visitorId,
        input.channel,
      );
    }
  }

  const contact = await getContact(db, organizationId, contactId);
  return { contactId, created, merged, contact };
}

export async function linkConversationToContact(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  contactId: string,
): Promise<void> {
  const canonicalContactId = await resolveCanonicalContactId(db, organizationId, contactId);
  if (!canonicalContactId) {
    return;
  }

  const updated = await db.$executeRaw`
    UPDATE ccass.conversations
    SET contact_id = ${canonicalContactId},
        updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND contact_id IS DISTINCT FROM ${canonicalContactId}
  `;
  if (Number(updated) === 0) return;

  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "contact.linked",
    metadata: { contactId: canonicalContactId },
  });
}

type ConversationContactLookup = {
  id: string;
  contactId?: string | null;
  visitorId?: string | null;
  channel?: string | null;
};

export async function resolveConversationContactId(
  db: DbClient,
  organizationId: string,
  conversation: ConversationContactLookup,
): Promise<string | null> {
  if (isCallChannel(conversation.channel) && conversation.visitorId?.trim()) {
    const phone = normalizePhone(conversation.visitorId);
    if (phone) {
      const byPhone = await findContactIdByPhone(db, organizationId, phone);
      if (byPhone) {
        const canonical = await resolveCanonicalContactId(db, organizationId, byPhone);
        const linkedId = conversation.contactId?.trim();
        if (!linkedId || linkedId === canonical) return canonical;
        const linked = await getContact(db, organizationId, linkedId);
        if (!contactHasPersonName(linked)) return canonical;
      }
    }
  }

  if (conversation.contactId?.trim()) {
    return resolveCanonicalContactId(db, organizationId, conversation.contactId.trim());
  }

  if (conversation.channel === "webchat" && conversation.visitorId?.trim()) {
    const cdpId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
      conversation.visitorId.trim(),
    );
    if (cdpId) {
      return resolveCanonicalContactId(db, organizationId, cdpId);
    }
  }

  if (conversation.channel === "instagram" && conversation.visitorId?.trim()) {
    const cdpId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.INSTAGRAM_USER,
      conversation.visitorId.trim(),
    );
    if (cdpId) {
      return resolveCanonicalContactId(db, organizationId, cdpId);
    }
  }

  if (conversation.channel === "facebook" && conversation.visitorId?.trim()) {
    const cdpId = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.FACEBOOK_USER,
      conversation.visitorId.trim(),
    );
    if (cdpId) {
      return resolveCanonicalContactId(db, organizationId, cdpId);
    }
  }

  return null;
}

/** Use the named contact for a call when `+` made the number look like a different person. */
export async function ensureNamedCallContact(
  db: DbClient,
  organizationId: string,
  conversation: ConversationContactLookup,
): Promise<CdpContactRecord | null> {
  if (!isCallChannel(conversation.channel)) return null;
  const existing = conversation.contactId?.trim()
    ? await getContact(db, organizationId, conversation.contactId.trim())
    : null;
  if (contactHasPersonName(existing)) return existing;
  return resolveConversationContact(db, organizationId, conversation);
}

export async function resolveConversationContact(
  db: DbClient,
  organizationId: string,
  conversation: ConversationContactLookup,
): Promise<CdpContactRecord | null> {
  const contactId = await resolveConversationContactId(db, organizationId, conversation);
  if (!contactId) {
    return null;
  }

  await linkConversationToContact(db, organizationId, conversation.id, contactId);
  return getContact(db, organizationId, contactId);
}

const VOICE_SESSION_UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStoredConversationId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

export function voiceSessionIdsMatch(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const uuidA = a.match(VOICE_SESSION_UUID)?.[0]?.toLowerCase();
  const uuidB = b.match(VOICE_SESSION_UUID)?.[0]?.toLowerCase();
  return Boolean(uuidA && uuidB && uuidA === uuidB);
}

/** Numeric conversation ids pass through. A voice session id is resolved to that call's id. */
export async function resolveConversationIdForEnrich(
  db: DbClient,
  organizationId: string,
  conversationOrSessionId: string,
): Promise<string | null> {
  const raw = conversationOrSessionId.trim();
  if (!raw) return null;
  if (isStoredConversationId(raw)) return raw;

  const uuid = raw.match(VOICE_SESSION_UUID)?.[0]?.toLowerCase() ?? "";
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      external_thread_id: string | null;
      provider_thread_id: string | null;
    }>
  >`
    SELECT id::text AS id, external_thread_id, provider_thread_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND (
        external_thread_id = ${raw}
        OR provider_thread_id = ${raw}
        OR (
          ${uuid} <> ''
          AND (
            external_thread_id LIKE ${`%${uuid}`}
            OR provider_thread_id LIKE ${`%${uuid}`}
          )
        )
      )
    ORDER BY updated_at DESC
    LIMIT 5
  `;
  const match = rows.find(
    (row) =>
      voiceSessionIdsMatch(raw, row.external_thread_id || "") ||
      voiceSessionIdsMatch(raw, row.provider_thread_id || ""),
  );
  return match?.id ?? null;
}

export async function enrichContactFromConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  enrich: EnrichContactInput,
): Promise<ContactEnrichmentResult | null> {
  if (enrich.sourceMessageId) {
    await db.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${organizationId}:${conversationId}:${enrich.sourceMessageId}`}, 0)
      )
    `;
    const replayRows = await db.$queryRaw<
      Array<{
        outcome: ContactEnrichmentOutcome;
        canonical_contact_id: string;
        previous_contact_id: string | null;
        applied_fields: ContactEnrichmentField[];
        skipped_fields: ContactEnrichmentSkippedField[];
        requires_confirmation: ContactEnrichmentField[];
      }>
    >`
      SELECT
        ie.metadata->>'outcome' AS outcome,
        ie.metadata->>'canonicalContactId' AS canonical_contact_id,
        NULLIF(ie.metadata->>'previousContactId', '') AS previous_contact_id,
        ARRAY(
          SELECT jsonb_array_elements_text(COALESCE(ie.metadata->'appliedFields', '[]'::jsonb))
        ) AS applied_fields,
        COALESCE(ie.metadata->'skippedFields', '[]'::jsonb) AS skipped_fields,
        ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(ie.metadata->'requiresConfirmation', '[]'::jsonb)
          )
        ) AS requires_confirmation
      FROM cdp.interaction_events ie
      WHERE ie.organization_id = ${organizationId}::bigint
        AND ie.conversation_id = ${conversationId}::bigint
        AND ie.event_type = 'contact.enriched'
        AND ie.metadata->>'sourceMessageId' = ${enrich.sourceMessageId}
      ORDER BY ie.occurred_at DESC
      LIMIT 1
    `;
    const replay = replayRows[0];
    if (
      replay &&
      contactEnrichmentOutcomes.includes(replay.outcome) &&
      replay.canonical_contact_id
    ) {
      const contact = await getContact(db, organizationId, replay.canonical_contact_id);
      if (contact) {
        return {
          outcome: replay.outcome,
          canonicalContactId: replay.canonical_contact_id,
          previousContactId: replay.previous_contact_id,
          appliedFields: replay.applied_fields,
          skippedFields: replay.skipped_fields,
          requiresConfirmation: replay.requires_confirmation,
          contact,
          idempotentReplay: true,
        };
      }
    }
  }

  const rows = await db.$queryRaw<
    Array<{ channel: string; visitor_id: string | null; contact_id: string | null }>
  >`
    SELECT channel, visitor_id, contact_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
    LIMIT 1
  `;
  const conversation = rows[0];
  if (!conversation) return null;

  const channel = isCallChannel(conversation.channel)
    ? "call"
    : conversation.channel === "email" ||
        conversation.channel === "whatsapp" ||
        conversation.channel === "instagram" ||
        conversation.channel === "facebook"
      ? conversation.channel
      : "webchat";

  const normalizedEnrich: EnrichContactInput = {
    ...enrich,
    email: normalizeEmail(enrich.email) ?? undefined,
    phone: normalizePhone(enrich.phone) ?? undefined,
    firstName: enrich.firstName?.trim() || undefined,
    lastName: enrich.lastName?.trim() || undefined,
    displayName: enrich.displayName?.trim() || undefined,
    company: enrich.company?.trim() || undefined,
    city: enrich.city?.trim() || undefined,
    country: enrich.country?.trim() || undefined,
    confirmedFields: enrich.confirmedFields,
  };
  if (!hasEnrichableContactData(normalizedEnrich)) {
    return null;
  }

  contactEnrichLogger.info(
    {
      event: "contact_enrich.started",
      organizationId,
      conversationId,
      sourceMessageId: enrich.sourceMessageId ?? null,
    },
    "contact enrich started",
  );

  const previousContactId = toCdpIdText(conversation.contact_id);
  const previousContact = previousContactId
    ? await getContact(db, organizationId, previousContactId)
    : null;

  const confirmedFields = previousContact
    ? await validatedConfirmedFields(
        db,
        organizationId,
        conversationId,
        normalizedEnrich,
      )
    : normalizedEnrich.confirmedFields ?? [];
  const partitioned = partitionContactEnrichment(previousContact, {
    ...normalizedEnrich,
    confirmedFields,
  });
  const ownedByAnother = previousContactId
    ? await identityOwnedByAnotherContact(
        db,
        organizationId,
        previousContactId,
        partitioned.applicable,
      )
    : { email: false, phone: false };
  const filtered = omitIdentityOwnedByAnotherContact(
    partitioned.applicable,
    blockIdentityOwnedByAnotherContact(ownedByAnother, {
      email: previousContact?.primaryEmail,
      phone: previousContact?.primaryPhone,
    }),
  );
  const effectiveEnrich = filtered.enrich;
  const skippedFields = [...partitioned.skippedFields, ...filtered.skippedFields];
  const { requiresConfirmation } = partitioned;
  if (
    !hasEnrichableContactData(effectiveEnrich)
  ) {
    contactEnrichLogger.info(
      {
        event:
          requiresConfirmation.length > 0
            ? "contact_enrich.confirmation_required"
            : "contact_enrich.no_change",
        organizationId,
        conversationId,
        contactId: previousContactId,
        skippedFields: summarizeSkippedFields(skippedFields),
        requiresConfirmation,
      },
      requiresConfirmation.length > 0
        ? "contact enrich requires customer confirmation"
        : "contact enrich skipped — values already on profile",
    );
    if (!previousContactId || !previousContact) {
      return null;
    }
    const noChangeResult: ContactEnrichmentResult = {
      outcome:
        requiresConfirmation.length > 0 ? "confirmation_required" : "no_change",
      canonicalContactId: previousContactId,
      previousContactId,
      appliedFields: [],
      skippedFields,
      requiresConfirmation,
      contact: previousContact,
      idempotentReplay: false,
    };
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: "contact.enriched",
      metadata: {
        outcome: noChangeResult.outcome,
        canonicalContactId: previousContactId,
        previousContactId,
        appliedFields: [],
        skippedFields,
        requiresConfirmation,
        sourceMessageId: enrich.sourceMessageId ?? null,
      },
    });
    return noChangeResult;
  }

  let resolveResult: ResolveContactResult | null = null;
  let canonicalContactId = previousContactId;
  let mergedExisting = false;

  if (hasIdentityEnrichmentKeys(effectiveEnrich)) {
    resolveResult = await resolveOrCreateContact(db, organizationId, {
      channel,
      email: effectiveEnrich.email,
      phone: effectiveEnrich.phone,
      visitorId: conversation.visitor_id ?? undefined,
      displayName: enrichmentDisplayName(effectiveEnrich),
    });
    canonicalContactId = toCdpIdText(resolveResult.contactId);
    if (
      previousContactId &&
      canonicalContactId &&
      previousContactId !== canonicalContactId
    ) {
      const mergeResult = await mergeContacts(db, organizationId, {
        winnerId: canonicalContactId,
        loserId: previousContactId,
        reason: "identity_enrichment",
        triggerConversationId: conversationId,
      });
      mergedExisting = !mergeResult.noOp;
      if (mergedExisting) {
        contactEnrichLogger.info(
          {
            event: "contact_enrich.merged",
            organizationId,
            conversationId,
            canonicalContactId,
            previousContactId,
          },
          "contact enrich merged duplicate contacts",
        );
      }
    } else if (
      canonicalContactId &&
      (!previousContactId || previousContactId !== canonicalContactId)
    ) {
      await linkConversationToContact(db, organizationId, conversationId, canonicalContactId);
    }
  } else if (!canonicalContactId) {
    resolveResult = await resolveOrCreateContact(db, organizationId, {
      channel,
      visitorId: conversation.visitor_id ?? undefined,
      displayName: enrichmentDisplayName(effectiveEnrich),
    });
    canonicalContactId = toCdpIdText(resolveResult.contactId);
    if (canonicalContactId) {
      await linkConversationToContact(db, organizationId, conversationId, canonicalContactId);
    }
  }

  if (!canonicalContactId) {
    throw Object.assign(new Error("Authoritative contact id missing after enrichment"), {
      status: 500,
    });
  }

  const profileBeforeApply = await getContact(db, organizationId, canonicalContactId);
  const identityConflictSkipped: ContactEnrichmentSkippedField[] = [];
  try {
    await applyProfileEnrichment(
      db,
      organizationId,
      canonicalContactId,
      effectiveEnrich,
      channel,
    );
  } catch (error) {
    if (error instanceof IdentityKeyConflictError) {
      identityConflictSkipped.push(identityConflictToSkippedField(error));
    } else {
      throw error;
    }
  }
  const mergedSkippedFields = [...skippedFields, ...identityConflictSkipped];
  scheduleOmniChannelSummaryRefresh(organizationId, canonicalContactId);

  const contact = await getContact(db, organizationId, canonicalContactId);
  if (!contact) {
    throw Object.assign(new Error("Authoritative contact not found after enrichment"), {
      status: 500,
    });
  }
  const appliedFields = getAppliedEnrichmentFields(
    profileBeforeApply ?? previousContact,
    contact,
    effectiveEnrich,
  );
  const outcome = classifyContactEnrichmentOutcome({
    created: resolveResult?.created ?? false,
    merged: mergedExisting || (resolveResult?.merged ?? false),
    previousContactId,
    appliedFields,
    skippedFields: mergedSkippedFields,
  });
  const enrichmentResult: ContactEnrichmentResult = {
    outcome,
    canonicalContactId,
    previousContactId,
    appliedFields,
    skippedFields: mergedSkippedFields,
    requiresConfirmation,
    contact,
    idempotentReplay: false,
  };
  contactEnrichLogger.info(
    {
      event:
        outcome === "confirmation_required"
          ? "contact_enrich.confirmation_required"
          : outcome === "no_change"
          ? "contact_enrich.no_change"
          : outcome === "merged_existing"
            ? "contact_enrich.merged"
            : "contact_enrich.applied",
      organizationId,
      conversationId,
      canonicalContactId,
      previousContactId,
      outcome,
      appliedFields,
      skippedFields: summarizeSkippedFields(mergedSkippedFields),
      requiresConfirmation,
    },
    "contact enrich completed",
  );
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "contact.enriched",
    metadata: {
      outcome,
      canonicalContactId,
      previousContactId,
      appliedFields,
      skippedFields: mergedSkippedFields,
      requiresConfirmation,
      sourceMessageId: enrich.sourceMessageId ?? null,
    },
  });
  return enrichmentResult;
}

export function getAppliedEnrichmentFields(
  before: CdpContactRecord | null,
  after: CdpContactRecord,
  input: EnrichContactInput,
): ContactEnrichmentField[] {
  const fields: ContactEnrichmentField[] = [];
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizePhone(input.phone);
  if (
    normalizedEmail &&
    normalizeEmail(before?.primaryEmail) !== normalizeEmail(after.primaryEmail)
  ) {
    fields.push("email");
  }
  if (normalizedPhone && normalizePhone(before?.primaryPhone) !== normalizePhone(after.primaryPhone)) {
    fields.push("phone");
  }
  if (
    input.firstName?.trim() &&
    (before?.firstName?.trim() ?? "") !== (after.firstName?.trim() ?? "")
  ) {
    fields.push("firstName");
  }
  if (
    input.lastName?.trim() &&
    (before?.lastName?.trim() ?? "") !== (after.lastName?.trim() ?? "")
  ) {
    fields.push("lastName");
  }
  const displayName = input.displayName?.trim();
  if (
    displayName &&
    !input.firstName?.trim() &&
    !input.lastName?.trim() &&
    before?.fullName.trim() !== after.fullName.trim()
  ) {
    fields.push("displayName");
  }
  if (input.company?.trim() && before?.company !== after.company) fields.push("company");
  if (input.city?.trim() && before?.city !== after.city) fields.push("city");
  if (input.country?.trim() && before?.country !== after.country) fields.push("country");
  return fields;
}

export function classifyContactEnrichmentOutcome(input: {
  created: boolean;
  merged: boolean;
  previousContactId: string | null;
  appliedFields: ContactEnrichmentField[];
  skippedFields?: ContactEnrichmentSkippedField[];
}): ContactEnrichmentOutcome {
  if (input.created) return "created";
  if (input.merged) return "merged_existing";
  if (!input.previousContactId) return "linked_existing";
  if (
    input.appliedFields.length > 0 &&
    (input.skippedFields?.length ?? 0) > 0
  ) {
    return "partial";
  }
  if (input.appliedFields.length > 0) return "enriched";
  if (input.skippedFields?.some((field) => field.reason === "profile_conflict")) {
    return "confirmation_required";
  }
  if (
    input.skippedFields?.some(
      (field) => field.reason === "identity_owned_by_other_contact",
    )
  ) {
    return "no_change";
  }
  return "no_change";
}

export async function resolveInboundConversationContact(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: ResolveContactInput,
): Promise<ResolveContactResult> {
  const result = await resolveOrCreateContact(db, organizationId, input);
  await linkConversationToContact(db, organizationId, conversationId, result.contactId);
  await applyProfileEnrichment(db, organizationId, result.contactId, {
    email: normalizeEmail(input.email) ?? undefined,
    phone: normalizePhone(input.phone) ?? undefined,
    displayName: input.displayName?.trim() || undefined,
  }, input.channel);
  return result;
}

/**
 * Enrich contact from an inbound customer message when the bot is not active
 * (live agent, post-handoff, or bot-disabled channels). Bot turns use NLP
 * contact_enrich with richer entities; this path covers agent conversations
 * and regex extraction from raw message text (phone/email in body).
 */
export async function maybeEnrichContactFromCustomerMessage(
  _db: DbClient,
  _organizationId: string,
  _conversationId: string,
  input: {
    messageId: string;
    body: string;
    botActive: boolean;
  },
): Promise<ContactEnrichmentResult | null> {
  if (input.botActive) return null;
  // Contact enrichment from customer text is handled by channel orchestrators via NLP.
  return null;
}

export { IdentityKeyConflictError } from "./cdp-customer-profile.js";

function identityConflictToSkippedField(
  error: IdentityKeyConflictError,
): ContactEnrichmentSkippedField {
  const field: ContactEnrichmentField =
    error.keyType === IDENTITY_KEY_TYPES.PHONE ||
    error.keyType === IDENTITY_KEY_TYPES.PHONE_SECONDARY ||
    error.keyType === IDENTITY_KEY_TYPES.WHATSAPP_PHONE
      ? "phone"
      : error.keyType === IDENTITY_KEY_TYPES.EMAIL ||
          error.keyType === IDENTITY_KEY_TYPES.EMAIL_SECONDARY
        ? "email"
        : "email";
  return {
    field,
    proposedValue: error.keyValue,
    currentValue: null,
    reason: "identity_owned_by_other_contact",
    message:
      field === "email"
        ? `Email ${error.keyValue} is already linked to another contact. Ask the customer to confirm or use a different email.`
        : `Phone ${error.keyValue} is already linked to another contact. Ask the customer to confirm or use a different number.`,
  };
}

export const enrichConversationContactSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  city: z.string().max(160).optional(),
  country: z.string().max(160).optional(),
  customerText: z.string().max(8000).optional(),
  contactEntities: contactEntitiesSchema.optional(),
  importantFacts: z.array(z.string()).max(20).optional(),
  sourceMessageId: entityIdSchema.optional(),
  confirmedFields: z.array(z.enum([
    "email",
    "phone",
    "firstName",
    "lastName",
    "displayName",
    "company",
    "city",
    "country",
  ])).max(8).optional(),
});
