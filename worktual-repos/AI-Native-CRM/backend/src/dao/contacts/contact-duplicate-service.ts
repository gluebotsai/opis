import { accountQuery } from "@/dao/db/account-pool";
import { getContact } from "@/dao/contacts/contact-service";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  scoreContactPair,
  recommendPrimaryContactId,
  type ContactMatchInput,
  type DuplicateMatchResult,
} from "@/lib/contacts/duplicate-match";
import { formatContactDisplayName } from "@/lib/contact-name";

export type DuplicateCandidateView = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  city: string | null;
  contactType: string;
  confidence: number;
  reasons: Array<{ code: string; label: string; weight: number }>;
  updatedAt: string;
};

function toMatchInput(args: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  secondaryEmails: string[] | null;
  secondaryPhones: string[] | null;
  companyId: string | null;
  companyName: string | null;
  city: string | null;
}): ContactMatchInput {
  return {
    id: args.id,
    firstName: args.firstName,
    lastName: args.lastName,
    email: args.email,
    phone: args.phone,
    secondaryEmails: args.secondaryEmails ?? [],
    secondaryPhones: args.secondaryPhones ?? [],
    companyId: args.companyId,
    companyName: args.companyName,
    city: args.city,
  };
}

type CandidateRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  secondary_emails: string[] | null;
  secondary_phones: string[] | null;
  company_name: string | null;
  city: string | null;
  contact_type: string | null;
  updated_at: Date;
};

/**
 * Find likely duplicate contacts for a seed contact or draft fields.
 * Uses email/phone/name heuristics with confidence scores + reasons.
 */
export async function findDuplicateContacts(input: {
  organizationId?: string | null;
  excludeContactId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  secondaryEmails?: string[];
  secondaryPhones?: string[];
  companyId?: string | null;
  companyName?: string | null;
  city?: string | null;
  limit?: number;
}): Promise<DuplicateCandidateView[]> {
  const organizationId = await resolveRequestOrganizationId(
    input.organizationId,
  );
  const seed: ContactMatchInput = {
    id: input.excludeContactId?.trim() || "__draft__",
    firstName: (input.firstName ?? "").trim(),
    lastName: (input.lastName ?? "").trim(),
    email: (input.email ?? "").trim(),
    phone: input.phone?.trim() || null,
    secondaryEmails: input.secondaryEmails ?? [],
    secondaryPhones: input.secondaryPhones ?? [],
    companyId: input.companyId?.trim() || null,
    companyName: input.companyName?.trim() || null,
    city: input.city?.trim() || null,
  };

  const email = seed.email.toLowerCase();
  const phoneDigits = (seed.phone ?? "").replace(/\D+/g, "");
  const fullName = `${seed.firstName} ${seed.lastName}`.trim().toLowerCase();
  const limit = Math.min(50, Math.max(5, input.limit ?? 25));

  const { rows } = await accountQuery<CandidateRow>(
    `SELECT p.cdp_id::text AS id,
            p.first_name, p.last_name,
            (
              SELECT k.key_value FROM cdp.identity_keys k
              WHERE k.cdp_id = p.cdp_id AND k.key_type = 'email'
              ORDER BY k.created_at ASC LIMIT 1
            ) AS email,
            (
              SELECT k.key_value FROM cdp.identity_keys k
              WHERE k.cdp_id = p.cdp_id AND k.key_type = 'phone'
              ORDER BY k.created_at ASC LIMIT 1
            ) AS phone,
            COALESCE(
              (
                SELECT array_agg(k.key_value)
                FROM cdp.identity_keys k
                WHERE k.cdp_id = p.cdp_id AND k.key_type = 'email_secondary'
              ),
              '{}'::text[]
            ) AS secondary_emails,
            COALESCE(
              (
                SELECT array_agg(k.key_value)
                FROM cdp.identity_keys k
                WHERE k.cdp_id = p.cdp_id AND k.key_type = 'phone_secondary'
              ),
              '{}'::text[]
            ) AS secondary_phones,
            p.company AS company_name,
            p.city, p.contact_type, p.updated_at
     FROM cdp.customer_profile p
     WHERE p.organization_id = $6::bigint
       AND ($1::text IS NULL OR p.cdp_id::text <> $1)
       AND (
         ($2::text <> '' AND EXISTS (
           SELECT 1 FROM cdp.identity_keys k
           WHERE k.cdp_id = p.cdp_id
             AND k.key_type IN ('email', 'email_secondary')
             AND lower(k.key_value) = $2
         ))
         OR ($3::text <> '' AND length($3) >= 7 AND EXISTS (
           SELECT 1 FROM cdp.identity_keys k
           WHERE k.cdp_id = p.cdp_id
             AND k.key_type IN ('phone', 'phone_secondary')
             AND regexp_replace(k.key_value, '\\D', '', 'g') = $3
         ))
         OR (
           $4::text <> ''
           AND lower(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))) = $4
         )
       )
     ORDER BY p.updated_at DESC
     LIMIT $5`,
    [
      input.excludeContactId?.trim() || null,
      email || "",
      phoneDigits || "",
      fullName || "",
      limit,
      organizationId,
    ],
  );

  const { getContactProfilesByAccountIds } = await import(
    "@/dao/contacts/contact-profile-repository"
  );
  const profiles = await getContactProfilesByAccountIds(rows.map((r) => r.id));

  const matches: DuplicateCandidateView[] = [];
  for (const row of rows) {
    const profile = profiles.get(row.id);
    if (profile?.status === "archived") continue;
    if (profile && String(profile.organizationId) !== String(organizationId)) {
      continue;
    }
    // Optional company-id name match filter
    if (
      seed.companyId &&
      fullName &&
      profile?.companyId === seed.companyId &&
      `${row.first_name} ${row.last_name}`.trim().toLowerCase() !== fullName
    ) {
      // keep — company match alone is not required; scoring handles weight
    }
    const other = toMatchInput({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      secondaryEmails: row.secondary_emails,
      secondaryPhones: row.secondary_phones,
      companyId: profile?.companyId ?? null,
      companyName: row.company_name,
      city: row.city,
    });
    const scored = scoreContactPair(seed, other);
    if (!scored) continue;
    matches.push({
      id: row.id,
      displayName: formatContactDisplayName(row.first_name, row.last_name),
      email: row.email,
      phone: row.phone,
      companyName: row.company_name,
      city: row.city,
      contactType: row.contact_type?.trim() || "contact",
      confidence: scored.confidence,
      reasons: scored.reasons,
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}

export async function findDuplicatesForContactId(
  contactId: string,
): Promise<{
  seed: DuplicateCandidateView | null;
  duplicates: DuplicateCandidateView[];
  recommendedPrimaryId: string | null;
}> {
  const contact = await getContact(contactId);
  if (!contact) {
    return { seed: null, duplicates: [], recommendedPrimaryId: null };
  }

  const duplicates = await findDuplicateContacts({
    organizationId: contact.person.organizationId,
    excludeContactId: contactId,
    firstName: contact.person.firstName,
    lastName: contact.person.lastName,
    email: contact.person.email,
    phone: contact.person.phone,
    secondaryEmails: contact.person.secondaryEmails ?? [],
    secondaryPhones: contact.person.secondaryPhones ?? [],
    companyId: contact.person.companyId,
    companyName: contact.person.company?.name ?? null,
    city: contact.person.city,
  });

  const seed: DuplicateCandidateView = {
    id: contact.id,
    displayName: contact.displayName,
    email: contact.person.email,
    phone: contact.person.phone,
    companyName: contact.person.company?.name ?? null,
    city: contact.person.city,
    contactType: contact.person.contactType,
    confidence: 100,
    reasons: [{ code: "seed", label: "Current contact", weight: 100 }],
    updatedAt:
      contact.person.updatedAt instanceof Date
        ? contact.person.updatedAt.toISOString()
        : String(contact.person.updatedAt),
  };

  const recommendedPrimaryId = recommendPrimaryContactId([
    {
      id: contact.id,
      firstName: contact.person.firstName,
      lastName: contact.person.lastName,
      email: contact.person.email,
      phone: contact.person.phone,
      secondaryEmails: contact.person.secondaryEmails ?? [],
      secondaryPhones: contact.person.secondaryPhones ?? [],
      companyId: contact.person.companyId,
      companyName: contact.person.company?.name ?? null,
      city: contact.person.city,
      updatedAt: contact.person.updatedAt,
    },
    ...duplicates.map((d) => ({
      id: d.id,
      firstName: d.displayName.split(" ")[0] ?? "",
      lastName: d.displayName.split(" ").slice(1).join(" "),
      email: d.email,
      phone: d.phone,
      secondaryEmails: [] as string[],
      secondaryPhones: [] as string[],
      companyId: null as string | null,
      companyName: d.companyName,
      city: d.city,
      updatedAt: d.updatedAt,
    })),
  ]);

  return { seed, duplicates, recommendedPrimaryId };
}

export type { DuplicateMatchResult };
