import {
  findDuplicateContacts,
} from "@/dao/contacts/contact-duplicate-service";
import {
  buildMergePreview,
  executeContactMerge,
  type MergeableFieldKey,
} from "@/dao/contacts/contact-merge-service";
import {
  createContact,
  getContact,
  updateContact,
  type ContactInput,
  type ContactView,
} from "@/dao/contacts/contact-service";
import { recommendPrimaryContactId } from "@/lib/contacts/duplicate-match";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { locationFromInbound } from "@/lib/inbound-location";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
const AUTO_MERGE_CODES = new Set([
  "exact_email",
  "secondary_email",
  "exact_phone",
]);

function isStrongDuplicate(
  confidence: number,
  reasons: Array<{ code: string }>,
): boolean {
  if (confidence < 85) return false;
  return reasons.some((r) => AUTO_MERGE_CODES.has(r.code));
}

function fillBlank<T>(current: T, incoming: T): T {
  if (current == null || current === "") return incoming;
  if (typeof current === "string" && !current.trim()) return incoming;
  return current;
}

/**
 * Create a lead, or update+merge into an existing strong duplicate.
 * Never leaves a second active contact for exact email/phone matches.
 */
export async function upsertLeadContact(
  input: ContactInput,
  options?: {
    organizationId?: string | null;
    actorUserId?: string | null;
    source?: string;
  },
): Promise<{
  contact: ContactView;
  merged: boolean;
  primaryContactId: string;
  archivedContactIds: string[];
  matchReasons: string[];
}> {
  const organizationId = await resolveRequestOrganizationId(options?.organizationId);
  const loc = locationFromInbound(
    {
      city: input.city,
      country: input.country,
      addressLine: input.addressLine,
      phone: input.phone,
    },
    input.phone,
  );
  input = {
    ...input,
    city: input.city?.trim() || loc.city,
    country: input.country?.trim() || loc.country,
    addressLine: input.addressLine?.trim() || loc.addressLine,
  };
  const duplicates = await findDuplicateContacts({
    organizationId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    secondaryEmails: input.secondaryEmails,
    secondaryPhones: input.secondaryPhones,
    companyId: input.companyId,
    companyName: input.companyName,
    city: input.city,
    limit: 10,
  });

  const strong = duplicates.filter((d) =>
    isStrongDuplicate(d.confidence, d.reasons),
  );

  if (strong.length === 0) {
    const created = await createContact({
      ...input,
      createdByUserId: input.createdByUserId ?? options?.actorUserId ?? null,
      contactType: input.contactType ?? "lead",
    });
    return {
      contact: created,
      merged: false,
      primaryContactId: created.id,
      archivedContactIds: [],
      matchReasons: [],
    };
  }

  // Prefer existing contact as primary.
  const matchInputs = strong.map((d) => ({
    id: d.id,
    firstName: d.displayName.split(" ")[0] ?? "",
    lastName: d.displayName.split(" ").slice(1).join(" ") || "",
    email: d.email,
    phone: d.phone,
    secondaryEmails: [] as string[],
    secondaryPhones: [] as string[],
    companyId: null as string | null,
    companyName: d.companyName,
    city: d.city,
    updatedAt: d.updatedAt,
  }));

  let primaryId = recommendPrimaryContactId(matchInputs) || strong[0]!.id;
  const primaryExisting = await getContact(primaryId);
  if (!primaryExisting) {
    const created = await createContact({
      ...input,
      createdByUserId: input.createdByUserId ?? options?.actorUserId ?? null,
    });
    return {
      contact: created,
      merged: false,
      primaryContactId: created.id,
      archivedContactIds: [],
      matchReasons: [],
    };
  }

  const matchReasons = [
    ...new Set(
      strong.flatMap((d) => d.reasons.map((r) => r.label).filter(Boolean)),
    ),
  ];

  const p = primaryExisting.person;
  await updateContact(primaryId, {
    firstName: fillBlank(p.firstName, input.firstName),
    lastName: fillBlank(p.lastName, input.lastName),
    email: fillBlank(p.email, input.email),
    phone: fillBlank(p.phone, input.phone ?? null),
    title: fillBlank(p.title, input.title ?? null),
    addressLine: fillBlank(p.addressLine, input.addressLine ?? null),
    city: fillBlank(p.city, input.city ?? null),
    country: fillBlank(p.country, input.country ?? null),
    companyId: fillBlank(p.companyId, input.companyId ?? null),
    locationId: fillBlank(p.locationId, input.locationId ?? null),
    companyName: fillBlank(p.company?.name ?? null, input.companyName ?? null),
    companyDomain: fillBlank(
      p.company?.domain ?? null,
      input.companyDomain ?? null,
    ),
    companyIndustry: fillBlank(
      p.company?.industry ?? null,
      input.companyIndustry ?? null,
    ),
    leadSource: fillBlank(p.leadSource, input.leadSource ?? null),
    notes: fillBlank(p.notes, input.notes ?? null),
    tags: [...new Set([...(p.tags ?? []), ...(input.tags ?? [])])],
    ownerUserId:
      p.ownerUserId ?? input.ownerUserId ?? null,
    contactType: p.contactType,
    leadStatus: p.leadStatus,
  });

  // Soft-merge any other strong duplicates into primary.
  const others = strong.map((d) => d.id).filter((id) => id !== primaryId);
  let archived: string[] = [];
  if (others.length) {
    const preview = await buildMergePreview([primaryId, ...others]);
    const fieldSources = { ...preview.suggestedFieldSources } as Record<
      MergeableFieldKey,
      string
    >;
    const result = await executeContactMerge({
      primaryContactId: primaryId,
      duplicateContactIds: others,
      fieldSources,
      actorUserId: options?.actorUserId ?? null,
    });
    archived = result.archivedContactIds;
    primaryId = result.primaryContactId;
  }

  await writeAuditLog({
    action: others.length ? "merge" : "update",
    entityType: "contact",
    entityId: primaryId,
    organizationId,
    actorUserId: options?.actorUserId ?? null,
    meta: {
      source: options?.source ?? "inbound_dedupe",
      matchedIds: strong.map((d) => d.id),
      archivedContactIds: archived,
    },
  });

  const contact = await getContact(primaryId);
  if (!contact) throw new Error("Primary contact missing after merge.");
  return {
    contact,
    merged: true,
    primaryContactId: primaryId,
    archivedContactIds: archived,
    matchReasons,
  };
}
