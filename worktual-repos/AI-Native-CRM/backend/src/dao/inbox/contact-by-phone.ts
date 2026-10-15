import { accountQuery } from "@/dao/db/account-pool";
import { createContact, getContact, updateContact } from "@/dao/contacts/contact-service";
import { locationFromInbound } from "@/lib/inbound-location";

function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = phoneDigits(trimmed);
  if (digits.length < 7) return null;
  const normalized = trimmed.replace(/[^\d+]/g, "");
  return normalized || null;
}

function placeholderEmailForPhone(digits: string): string {
  return `call+${digits}@contacts.worktual.internal`;
}

function splitNameFromPhone(phone: string): { firstName: string; lastName: string } {
  const digits = phoneDigits(phone);
  const tail = digits.slice(-4) || "call";
  return { firstName: `Phone ${tail}`, lastName: "" };
}

async function findContactIdByPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const digits = phoneDigits(normalized);
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT cdp_id::text AS id
     FROM cdp.identity_keys
     WHERE key_type IN ('phone', 'phone_secondary')
       AND regexp_replace(key_value, '[^0-9]', '', 'g') = $1
     LIMIT 1`,
    [digits],
  );
  return rows[0]?.id ?? null;
}

/** Find existing contact by phone or create a lead for outbound calls. */
export async function findOrCreateContactByPhone(args: {
  phone: string;
  ownerUserId: string;
  displayName?: string | null;
  leadSource?: string;
}): Promise<string | null> {
  const normalized = normalizePhone(args.phone);
  if (!normalized) return null;

  const existing = await findContactIdByPhone(normalized);
  if (existing) {
    await backfillPhoneLocation(existing, normalized);
    return existing;
  }

  const digits = phoneDigits(normalized);
  const { firstName, lastName } = args.displayName?.trim()
    ? (() => {
        const parts = args.displayName!.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
          return { firstName: parts[0], lastName: "" };
        }
        return {
          firstName: parts[0],
          lastName: parts.slice(1).join(" ").slice(0, 80),
        };
      })()
    : splitNameFromPhone(normalized);

  try {
    const loc = locationFromInbound({}, normalized);
    const contact = await createContact({
      firstName,
      lastName,
      email: placeholderEmailForPhone(digits),
      phone: normalized,
      city: loc.city,
      country: loc.country,
      ownerUserId: args.ownerUserId,
      createdByUserId: args.ownerUserId,
      contactType: "lead",
      leadSource: args.leadSource ?? "call",
      tags: ["call"],
      status: "active",
      notes: "Auto-created from call activity.",
    });
    return contact.id;
  } catch {
    return findContactIdByPhone(normalized);
  }
}

async function backfillPhoneLocation(
  contactId: string,
  phone: string,
): Promise<void> {
  const loc = locationFromInbound({}, phone);
  if (!loc.country && !loc.city) return;
  try {
    const contact = await getContact(contactId);
    if (!contact) return;
    const patch: { city?: string; country?: string } = {};
    if (!contact.person.city?.trim() && loc.city) patch.city = loc.city;
    if (!contact.person.country?.trim() && loc.country) {
      patch.country = loc.country;
    }
    if (Object.keys(patch).length) await updateContact(contactId, patch);
  } catch {
    // Best-effort fill; call still proceeds with the existing contact.
  }
}
