import { accountQuery } from "@/dao/db/account-pool";
import { prisma } from "@/dao/db/prisma";
import { createContact } from "@/dao/contacts/contact-service";
import { parseEmailAddress } from "@/service/google/gmail";

function normalizeEmail(raw: string): string | null {
  const parsed = parseEmailAddress(raw.trim()) ?? raw.trim().toLowerCase();
  if (!parsed || !parsed.includes("@")) return null;
  return parsed.toLowerCase();
}

function splitNameFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split("@")[0]?.replace(/[._+-]/g, " ").trim() || "Unknown";
  const parts = local.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ").slice(0, 80),
  };
}

function splitDisplayName(fromHeader: string | null): {
  firstName: string;
  lastName: string;
} {
  if (!fromHeader?.trim()) return { firstName: "Unknown", lastName: "" };
  const withoutEmail = fromHeader.replace(/<[^>]+>/g, "").replace(/"/g, "").trim();
  if (!withoutEmail || withoutEmail.includes("@")) {
    const local = (parseEmailAddress(fromHeader) ?? "unknown").split("@")[0];
    return { firstName: local.slice(0, 40) || "Unknown", lastName: "" };
  }
  const parts = withoutEmail.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ").slice(0, 80),
  };
}

async function findContactIdByEmail(email: string): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT cdp_id::text AS id
     FROM cdp.identity_keys
     WHERE key_type IN ('email', 'email_secondary')
       AND lower(key_value) = $1
     LIMIT 1`,
    [normalized],
  );
  return rows[0]?.id ?? null;
}

/**
 * Resolve an existing CRM contact (CDP + contact_profiles) for this tenant.
 * Does not create leads — used by mailbox sync so noreply/noise stay out of Contacts.
 */
export async function findCrmContactIdByEmail(
  email: string,
  organizationId: string,
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  const orgId = organizationId.trim();
  if (!normalized || !orgId) return null;

  const { rows } = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.identity_keys k
     INNER JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
     WHERE k.key_type IN ('email', 'email_secondary')
       AND lower(k.key_value) = $1
       AND p.organization_id = $2::bigint
     LIMIT 1`,
    [normalized, orgId],
  );
  const accountContactId = rows[0]?.id ?? null;
  if (!accountContactId) return null;

  const profile = await prisma.contactProfile.findFirst({
    where: { accountContactId, organizationId: orgId },
    select: { accountContactId: true },
  });
  return profile?.accountContactId ?? null;
}

/** Find first existing CRM contact among emails (no create). */
export async function findCrmContactIdByEmails(
  emails: string[],
  organizationId: string,
): Promise<string | null> {
  for (const raw of emails) {
    const id = await findCrmContactIdByEmail(raw, organizationId);
    if (id) return id;
  }
  return null;
}

/**
 * Find existing contact by email or create a lead.
 * Use only for explicit compose/send/draft — not mailbox sync.
 */
export async function findOrCreateContactByEmail(args: {
  email: string;
  ownerUserId: string;
  displayName?: string | null;
  leadSource?: string;
}): Promise<string | null> {
  const normalized = normalizeEmail(args.email);
  if (!normalized) return null;

  const existing = await findContactIdByEmail(normalized);
  if (existing) return existing;

  const { firstName, lastName } = args.displayName?.trim()
    ? splitDisplayName(args.displayName)
    : splitNameFromEmail(normalized);

  try {
    const contact = await createContact({
      firstName,
      lastName,
      email: normalized,
      ownerUserId: args.ownerUserId,
      createdByUserId: args.ownerUserId,
      contactType: "lead",
      leadSource: args.leadSource ?? "email",
      tags: [],
      status: "active",
      notes: "Auto-created from email activity.",
    });
    return contact.id;
  } catch {
    return findContactIdByEmail(normalized);
  }
}

export async function findContactIdByEmails(
  emails: string[],
): Promise<string | null> {
  for (const raw of emails) {
    const id = await findContactIdByEmail(raw);
    if (id) return id;
  }
  return null;
}

export { splitDisplayName, normalizeEmail };
