import { accountQuery } from "@/dao/db/account-pool";
import { getPeopleByIds } from "@/dao/account/account-repository";
import {
  parseGuestsFromMeetingBody,
  parseOrganizerFromMeetingBody,
} from "@/lib/meeting-body";

export type CrmMeetingParticipant = {
  contactId: string;
  email: string;
  firstName: string;
};

function normalizeEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  return e;
}

/**
 * Resolve meeting participant emails to CRM contacts/leads.
 * Includes the primary activity contact + Guests: body emails that exist in CDP.
 * Skips organizer email and addresses that are not CRM contacts.
 */
export async function resolveCrmMeetingParticipants(args: {
  contactId: string;
  body: string | null | undefined;
  organizerEmail?: string | null;
}): Promise<CrmMeetingParticipant[]> {
  const organizer =
    normalizeEmail(args.organizerEmail) ||
    normalizeEmail(parseOrganizerFromMeetingBody(args.body)?.email);

  const emails = new Set<string>();
  for (const g of parseGuestsFromMeetingBody(args.body)) {
    const n = normalizeEmail(g);
    if (n) emails.add(n);
  }

  const [primaryPerson] = await getPeopleByIds([args.contactId]);
  const primaryEmail = normalizeEmail(primaryPerson?.email);
  if (primaryEmail) emails.add(primaryEmail);

  if (emails.size === 0) return [];

  const emailList = [...emails];
  const { rows } = await accountQuery<{
    id: string;
    first_name: string;
    email: string;
  }>(
    `SELECT p.cdp_id::text AS id,
            p.first_name,
            lower(k.key_value) AS email
     FROM cdp.identity_keys k
     JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
     WHERE k.key_type IN ('email', 'email_secondary')
       AND lower(k.key_value) = ANY($1::text[])`,
    [emailList],
  );

  const byEmail = new Map(rows.map((r) => [r.email, r]));
  const byId = new Map<string, CrmMeetingParticipant>();

  for (const email of emailList) {
    if (organizer && email === organizer) continue;
    const row = byEmail.get(email);
    if (!row) continue;
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      contactId: row.id,
      email: row.email,
      firstName: row.first_name?.trim() || "there",
    });
  }

  if (
    primaryPerson &&
    primaryEmail &&
    (!organizer || primaryEmail !== organizer)
  ) {
    if (!byId.has(primaryPerson.id)) {
      byId.set(primaryPerson.id, {
        contactId: primaryPerson.id,
        email: primaryEmail,
        firstName: primaryPerson.firstName?.trim() || "there",
      });
    }
  }

  return [...byId.values()];
}
