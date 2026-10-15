import { prisma } from "@/dao/db/prisma";
import { getContactProfileByAccountId } from "@/dao/contacts/contact-profile-repository";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";

function userIdText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * User whose inbox should show this contact's mail.
 * Contact owner, then the user who created the contact, then the company
 * or latest deal owner.
 */
export async function resolveContactOwnerUserId(
  contactId: string,
): Promise<string | null> {
  const id = contactId.trim();
  if (!id) return null;
  const profile = await getContactProfileByAccountId(id);
  const direct =
    userIdText(profile?.ownerUserId) || userIdText(profile?.createdByUserId);
  if (direct) return direct;

  if (profile?.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: profile.companyId },
      select: { ownerUserId: true },
    });
    const companyOwner = userIdText(company?.ownerUserId);
    if (companyOwner) return companyOwner;
  }

  const deal = await prisma.deal.findFirst({
    where: { contactId: id, ownerUserId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { ownerUserId: true },
  });
  return userIdText(deal?.ownerUserId);
}

/** Point this contact's unowned emails at the user who now owns them. */
export async function claimUnownedEmailsForContact(
  contactId: string,
  userId: string,
): Promise<void> {
  const id = userId.trim();
  if (!contactId.trim() || !/^\d+$/.test(id)) return;
  await prisma.contactActivity.updateMany({
    where: { contactId, type: "email", createdByUserId: null },
    data: { createdByUserId: BigInt(id) },
  });
}

/**
 * User id stored on an email activity.
 * A connected mailbox user wins; otherwise the contact owner.
 */
export async function resolveEmailActivityUserId(
  contactId: string,
  explicitUserId?: string | null,
): Promise<string | null> {
  const explicit = explicitUserId?.trim();
  if (explicit) return explicit;
  return resolveContactOwnerUserId(contactId);
}

/** True when the first header lines name this mailbox (From / To / Cc). */
export function emailHeadersMention(
  body: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const needle = email?.trim().toLowerCase();
  if (!needle || !needle.includes("@")) return false;
  const lines = (body ?? "").split(/\r?\n/).slice(0, 12);
  return lines.some((line) => {
    if (!/^\s*(from|to|cc)\s*:/i.test(line)) return false;
    return line.toLowerCase().includes(needle);
  });
}

export async function crmBotMailboxEmail(
  organizationId: string | null | undefined,
): Promise<string | null> {
  const orgId = organizationId?.trim();
  if (!orgId) return null;
  const mailbox = await resolveCrmBotMailbox(orgId).catch(() => null);
  const email = mailbox?.accountEmail || mailbox?.senderEmail || null;
  const text = email?.trim().toLowerCase() || "";
  return text.includes("@") ? text : null;
}

let unownedEmailBackfill: Promise<number> | null = null;

/**
 * Existing nurture / CRM-bot emails were stored with no user.
 * Point those rows at the contact owner so they show in that inbox.
 * Runs once per process.
 */
export function backfillUnownedEmailActivityUserIdsOnce(): Promise<number> {
  if (!unownedEmailBackfill) {
    unownedEmailBackfill = prisma
      .$executeRawUnsafe(
        `
        UPDATE contact_activities a
        SET created_by_user_id = src.user_id,
            updated_at = NOW()
        FROM (
          SELECT a2.id,
            COALESCE(
              p.owner_user_id,
              p.created_by_user_id,
              co.owner_user_id,
              d.owner_user_id,
              su.id
            ) AS user_id
          FROM contact_activities a2
          LEFT JOIN contact_profiles p
            ON p.account_contact_id = a2.contact_id
          LEFT JOIN companies co ON co.id = p.company_id
          LEFT JOIN LATERAL (
            SELECT owner_user_id
            FROM deals
            WHERE contact_id = a2.contact_id
              AND owner_user_id IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT 1
          ) d ON true
          LEFT JOIN LATERAL (
            SELECT id
            FROM accounts.setup_users
            WHERE lower(work_email) = lower((
              regexp_match(
                left(coalesce(a2.body, ''), 600),
                '(?im)^from:\\s*<?([^>\\s,]+)'
              )
            )[1])
            LIMIT 1
          ) su ON true
          WHERE a2.type = 'email'
            AND a2.created_by_user_id IS NULL
        ) src
        WHERE a.id = src.id
          AND src.user_id IS NOT NULL
        `,
      )
      .then((count) => (typeof count === "number" ? count : 0))
      .catch((error) => {
        unownedEmailBackfill = null;
        console.error(
          "[email-activity-user] owner backfill failed",
          error instanceof Error ? error.message : error,
        );
        return 0;
      });
  }
  return unownedEmailBackfill;
}
