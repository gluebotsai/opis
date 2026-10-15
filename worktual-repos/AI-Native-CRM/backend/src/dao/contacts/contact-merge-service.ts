import { accountQuery } from "@/dao/db/account-pool";
import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { getContact } from "@/dao/contacts/contact-service";
import { formatContactDisplayName } from "@/lib/contact-name";
import { randomUUID } from "node:crypto";
import {
  recommendPrimaryContactId,
  suggestFieldSource,
  MERGEABLE_FIELDS,
  type MergeableFieldKey,
} from "@/lib/contacts/duplicate-match";
import { revalidateCustomer360 } from "@/service/crm/revalidate-customer-360";

export { MERGEABLE_FIELDS, type MergeableFieldKey };

export type MergeContactSnapshot = {
  id: string;
  displayName: string;
  values: Record<MergeableFieldKey, string | null>;
  secondaryEmails: string[];
  secondaryPhones: string[];
  companyName: string | null;
  related: {
    deals: number;
    activities: number;
    orders: number;
    emails: number;
    calls: number;
    tasks: number;
  };
};

export type MergePreview = {
  contacts: MergeContactSnapshot[];
  recommendedPrimaryId: string;
  suggestedFieldSources: Record<MergeableFieldKey, string>;
  totalRelated: {
    deals: number;
    activities: number;
    orders: number;
  };
};

export type MergeExecuteInput = {
  primaryContactId: string;
  duplicateContactIds: string[];
  fieldSources: Partial<Record<MergeableFieldKey, string>>;
  actorUserId?: string | null;
};

function asFieldValues(contact: Awaited<ReturnType<typeof getContact>>) {
  if (!contact) {
    throw new Error("Contact not found.");
  }
  const values: Record<MergeableFieldKey, string | null> = {
    firstName: contact.person.firstName,
    lastName: contact.person.lastName,
    email: contact.person.email,
    phone: contact.person.phone,
    title: contact.person.title,
    addressLine: contact.person.addressLine,
    city: contact.person.city,
    country: contact.person.country,
    companyId: contact.person.companyId,
    locationId: contact.person.locationId,
    ownerUserId: contact.crm.ownerUserId,
    contactType: contact.person.contactType,
    leadStatus: contact.person.leadStatus,
    leadSource: contact.crm.leadSource,
    status: contact.crm.status,
    notes: contact.crm.notes,
    convertedDealId: contact.person.convertedDealId,
  };
  return values;
}

async function relatedCounts(contactId: string) {
  const [deals, activities, orders, emails, calls, tasks] = await Promise.all([
    prisma.deal.count({ where: { contactId } }),
    prisma.contactActivity.count({ where: { contactId } }),
    prisma.salesOrder.count({ where: { contactId } }),
    prisma.contactActivity.count({ where: { contactId, type: "email" } }),
    prisma.contactActivity.count({ where: { contactId, type: "call" } }),
    prisma.contactActivity.count({ where: { contactId, type: "task" } }),
  ]);
  return { deals, activities, orders, emails, calls, tasks };
}

export async function buildMergePreview(
  contactIds: string[],
): Promise<MergePreview> {
  const uniqueIds = [...new Set(contactIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length < 2) {
    throw new Error("Select at least two contacts to merge.");
  }
  if (uniqueIds.length > 10) {
    throw new Error("You can merge at most 10 contacts at once.");
  }

  const contacts: MergeContactSnapshot[] = [];
  for (const id of uniqueIds) {
    const contact = await getContact(id);
    if (!contact) throw new Error(`Contact not found: ${id}`);
    if (contact.crm.status === "archived") {
      throw new Error(`Contact ${contact.displayName} is already archived.`);
    }
    const related = await relatedCounts(id);
    contacts.push({
      id,
      displayName: contact.displayName,
      values: asFieldValues(contact),
      secondaryEmails: contact.person.secondaryEmails ?? [],
      secondaryPhones: contact.person.secondaryPhones ?? [],
      companyName: contact.person.company?.name ?? null,
      related,
    });
  }

  const recommendedPrimaryId = recommendPrimaryContactId(
    contacts.map((c) => ({
      id: c.id,
      firstName: c.values.firstName ?? "",
      lastName: c.values.lastName ?? "",
      email: c.values.email ?? "",
      phone: c.values.phone,
      secondaryEmails: c.secondaryEmails,
      secondaryPhones: c.secondaryPhones,
      companyId: c.values.companyId,
      companyName: c.companyName,
      city: c.values.city,
    })),
  );

  const suggestedFieldSources = {} as Record<MergeableFieldKey, string>;
  for (const field of MERGEABLE_FIELDS) {
    suggestedFieldSources[field.key] = suggestFieldSource(
      field.key,
      contacts.map((c) => ({ id: c.id, values: c.values })),
    );
  }

  const totalRelated = contacts.reduce(
    (acc, c) => ({
      deals: acc.deals + c.related.deals,
      activities: acc.activities + c.related.activities,
      orders: acc.orders + c.related.orders,
    }),
    { deals: 0, activities: 0, orders: 0 },
  );

  return {
    contacts,
    recommendedPrimaryId,
    suggestedFieldSources,
    totalRelated,
  };
}

function pickValue(
  field: MergeableFieldKey,
  primaryId: string,
  fieldSources: Partial<Record<MergeableFieldKey, string>>,
  byId: Map<string, MergeContactSnapshot>,
): string | null {
  const sourceId = fieldSources[field] || primaryId;
  const source = byId.get(sourceId) ?? byId.get(primaryId);
  return source?.values[field] ?? null;
}

/**
 * Safely merge contacts across dual DB:
 * 1) Reassign CRM relations to primary
 * 2) Merge account fields onto primary
 * 3) Soft-archive duplicates (is_active=false, unique archived email)
 * 4) Audit log
 *
 * Not a single cross-DB transaction — CRM reassignment happens first so
 * orphans cannot remain if account archive fails mid-way.
 */
export async function executeContactMerge(
  input: MergeExecuteInput,
): Promise<{ primaryContactId: string; archivedContactIds: string[] }> {
  const primaryId = input.primaryContactId.trim();
  const duplicateIds = [
    ...new Set(
      input.duplicateContactIds
        .map((id) => id.trim())
        .filter((id) => id && id !== primaryId),
    ),
  ];
  if (!primaryId || duplicateIds.length === 0) {
    throw new Error("Primary and at least one duplicate contact are required.");
  }

  const preview = await buildMergePreview([primaryId, ...duplicateIds]);
  const byId = new Map(preview.contacts.map((c) => [c.id, c]));
  if (!byId.has(primaryId)) throw new Error("Primary contact not found.");

  const primaryBefore = byId.get(primaryId)!;
  const resolved: Record<MergeableFieldKey, string | null> = {
    firstName: pickValue("firstName", primaryId, input.fieldSources, byId),
    lastName: pickValue("lastName", primaryId, input.fieldSources, byId),
    email: pickValue("email", primaryId, input.fieldSources, byId),
    phone: pickValue("phone", primaryId, input.fieldSources, byId),
    title: pickValue("title", primaryId, input.fieldSources, byId),
    addressLine: pickValue("addressLine", primaryId, input.fieldSources, byId),
    city: pickValue("city", primaryId, input.fieldSources, byId),
    country: pickValue("country", primaryId, input.fieldSources, byId),
    companyId: pickValue("companyId", primaryId, input.fieldSources, byId),
    locationId: pickValue("locationId", primaryId, input.fieldSources, byId),
    ownerUserId: pickValue("ownerUserId", primaryId, input.fieldSources, byId),
    contactType: pickValue(
      "contactType",
      primaryId,
      input.fieldSources,
      byId,
    ),
    leadStatus: pickValue("leadStatus", primaryId, input.fieldSources, byId),
    leadSource: pickValue("leadSource", primaryId, input.fieldSources, byId),
    status: pickValue("status", primaryId, input.fieldSources, byId),
    notes: pickValue("notes", primaryId, input.fieldSources, byId),
    convertedDealId: pickValue(
      "convertedDealId",
      primaryId,
      input.fieldSources,
      byId,
    ),
  };

  if (!resolved.firstName?.trim()) {
    throw new Error("Merged contact must keep a first name.");
  }
  if (!resolved.email?.trim() || !resolved.email.includes("@")) {
    throw new Error("Merged contact must keep a valid primary email.");
  }

  const secondaryEmails = uniqEmails([
    ...preview.contacts.flatMap((c) => c.secondaryEmails),
    ...preview.contacts.map((c) => c.values.email),
  ]).filter((e) => e !== resolved.email!.trim().toLowerCase());

  const secondaryPhones = uniqPhones([
    ...preview.contacts.flatMap((c) => c.secondaryPhones),
    ...preview.contacts.map((c) => c.values.phone),
  ]).filter((p) => normalizePhone(p) !== normalizePhone(resolved.phone));

  // --- CRM reassignment (must complete before account archive) ---
  for (const loserId of duplicateIds) {
    // Drop activities that would violate unique gmail_message_id on primary.
    await prisma.$executeRawUnsafe(
      `DELETE FROM contact_activities AS loser
       WHERE loser.contact_id = $1::text
         AND loser.gmail_message_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM contact_activities AS keeper
           WHERE keeper.contact_id = $2::text
             AND keeper.gmail_message_id = loser.gmail_message_id
         )`,
      loserId,
      primaryId,
    );

    await prisma.contactActivity.updateMany({
      where: { contactId: loserId },
      data: { contactId: primaryId },
    });

    const displayName = formatContactDisplayName(
      resolved.firstName,
      resolved.lastName,
    );
    await prisma.deal.updateMany({
      where: { contactId: loserId },
      data: {
        contactId: primaryId,
        contactName: displayName,
        contactEmail: resolved.email,
      },
    });

    await prisma.salesOrder.updateMany({
      where: { contactId: loserId },
      data: { contactId: primaryId },
    });
  }

  // Refresh denorm on any deals already on primary.
  await prisma.deal.updateMany({
    where: { contactId: primaryId },
    data: {
      contactName: formatContactDisplayName(
        resolved.firstName,
        resolved.lastName,
      ),
      contactEmail: resolved.email,
    },
  });

  // --- CDP: free conflicting keys on losers, update primary, hard-delete losers ---
  const targetEmail = resolved.email.trim().toLowerCase();
  const targetPhone = resolved.phone?.trim() || null;
  const { accountRepository } = await import("@/dao/account/account-repository");
  const primaryPerson = await accountRepository.getPerson(primaryId);
  const organizationId = primaryPerson?.organizationId;
  if (!organizationId) {
    throw new Error("Primary contact is missing organization_id.");
  }

  // Drop loser identity keys that would block unique (org, type, value) on primary.
  for (const loserId of duplicateIds) {
    await accountQuery(
      `DELETE FROM cdp.identity_keys
       WHERE cdp_id = $1::text
         AND (
           (key_type IN ('email', 'email_secondary') AND lower(key_value) = $2)
           OR ($3::text IS NOT NULL AND key_type IN ('phone', 'phone_secondary')
               AND regexp_replace(key_value, '\\D', '', 'g')
                 = regexp_replace($3, '\\D', '', 'g'))
         )`,
      [loserId, targetEmail, targetPhone],
    );
  }

  // Move remaining loser keys onto primary as secondary when slots free.
  for (const loserId of duplicateIds) {
    const { rows: loserKeys } = await accountQuery<{
      key_type: string;
      key_value: string;
    }>(
      `SELECT key_type, key_value FROM cdp.identity_keys WHERE cdp_id = $1::text`,
      [loserId],
    );
    for (const key of loserKeys) {
      const isEmail =
        key.key_type === "email" || key.key_type === "email_secondary";
      const isPhone =
        key.key_type === "phone" || key.key_type === "phone_secondary";
      if (!isEmail && !isPhone) continue;
      const destType = isEmail ? "email_secondary" : "phone_secondary";
      try {
        await accountQuery(
          `INSERT INTO cdp.identity_keys (
             identity_id, cdp_id, organization_id, key_type, key_value,
             verified, source_system, confidence_score
           ) VALUES ($1::text, $2::text, $3::bigint, $4, $5, false, 'crm', 1.0)
           ON CONFLICT (organization_id, key_type, key_value) DO NOTHING`,
          [randomUUID(), primaryId, organizationId, destType, key.key_value],
        );
      } catch {
        /* ignore key move failures */
      }
    }
    await accountQuery(
      `DELETE FROM cdp.identity_keys WHERE cdp_id = $1::text`,
      [loserId],
    );
  }

  await accountRepository.updatePerson(primaryId, {
    firstName: resolved.firstName.trim(),
    lastName: resolved.lastName.trim(),
    email: targetEmail,
    phone: targetPhone,
    secondaryEmails: secondaryEmails.slice(0, 1),
    secondaryPhones: secondaryPhones.slice(0, 1),
    title: resolved.title,
    addressLine: resolved.addressLine,
    city: resolved.city,
    country: resolved.country,
    companyName: byId.get(primaryId)?.companyName ?? null,
  });

  const { reenqueueLeadEnrichmentOnIdentityUpdate } = await import(
    "@/service/ai/lead-enrichment-job"
  );
  void reenqueueLeadEnrichmentOnIdentityUpdate({
    contactId: primaryId,
    organizationId,
    companyId: resolved.companyId ?? null,
  });

  const { upsertContactProfile, patchContactProfile } = await import(
    "@/dao/contacts/contact-profile-repository"
  );
  await upsertContactProfile(primaryId, {
    companyId: resolved.companyId,
    locationId: resolved.locationId,
    ownerUserId: resolved.ownerUserId,
    contactType: (resolved.contactType?.trim() ||
      "lead") as import("@/service/account/types").ContactType,
    leadStatus: (resolved.leadStatus?.trim() ||
      "new") as import("@/service/account/types").LeadStatus,
    leadSource: resolved.leadSource,
    status: (resolved.status?.trim() ||
      "active") as import("@/service/account/types").ContactStatus,
    notes: resolved.notes,
    convertedDealId: resolved.convertedDealId,
  });

  // Hard-delete merged-away contacts (CRM + CDP).
  for (const loserId of duplicateIds) {
    const loser = byId.get(loserId)!;
    try {
      const { deleteContact } = await import("@/dao/contacts/contact-service");
      await deleteContact(loserId);
    } catch {
      const noteSuffix = `\n\n[Merged into contact ${primaryId} on ${new Date().toISOString()}]`;
      await patchContactProfile(loserId, {
        status: "archived",
        notes: `${loser.values.notes ?? ""}${noteSuffix}`,
      }).catch(() => null);
    }
  }

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "merge",
    entityType: "contact",
    entityId: primaryId,
    meta: {
      primaryContactId: primaryId,
      archivedContactIds: duplicateIds,
      fieldSources: input.fieldSources,
      beforePrimaryEmail: primaryBefore.values.email,
      afterPrimaryEmail: targetEmail,
      relatedMoved: preview.totalRelated,
    },
  });

  await revalidateCustomer360({
    contactIds: [primaryId, ...duplicateIds],
    companyIds: preview.contacts.map((c) => c.values.companyId),
    locationIds: preview.contacts.map((c) => c.values.locationId),
  });

  return { primaryContactId: primaryId, archivedContactIds: duplicateIds };
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function uniqEmails(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const email = (raw ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    if (email.endsWith("@archived.invalid")) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function uniqPhones(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const phone = (raw ?? "").trim();
    const digits = normalizePhone(phone);
    if (!phone || digits.length < 7 || seen.has(digits)) continue;
    seen.add(digits);
    out.push(phone);
  }
  return out;
}
