/**
 * The assignment rules pick a rep for the lead, but the company the lead
 * belongs to was left unassigned, so the account had no owner on the company
 * card even though a salesperson owned the person.
 *
 * This fills that gap in one direction only. An unowned company inherits the
 * owner the rules just chose; a company that already has an owner is never
 * touched, because company ownership is its own decision and the docs are
 * explicit that company owner and lead owner are not the same thing
 * (docs/lead-agent-pipeline.md, docs/contact-module.md). Nothing here copies a
 * company owner down onto a lead.
 */

import { prisma } from "@/dao/db/prisma";

function userIdBigInt(value: string | null | undefined): bigint | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * Give the contact's company the owner the rules assigned, when it has none.
 * Returns the company id when it was claimed, else null. Never throws — a
 * failure here must not fail the assignment that triggered it.
 */
export async function backfillCompanyOwnerFromContact(input: {
  contactId: string;
  ownerUserId: string | null | undefined;
  companyId?: string | null;
}): Promise<string | null> {
  const ownerUserId = userIdBigInt(input.ownerUserId);
  if (!ownerUserId) return null;

  try {
    let companyId = input.companyId?.trim() || null;
    if (!companyId) {
      const profile = await prisma.contactProfile.findUnique({
        where: { accountContactId: input.contactId.trim() },
        select: { companyId: true },
      });
      companyId = profile?.companyId?.trim() || null;
    }
    if (!companyId) return null;

    // Conditional update: only an unowned company is claimed, so two leads
    // assigned at once cannot fight over it.
    const claimed = await prisma.company.updateMany({
      where: { id: companyId, ownerUserId: null },
      data: { ownerUserId },
    });
    if (claimed.count === 0) return null;

    console.info("[company-owner] claimed from lead assignment", {
      companyId,
      contactId: input.contactId,
      ownerUserId: String(ownerUserId),
    });
    return companyId;
  } catch (error) {
    console.error(
      "[company-owner] backfill failed",
      input.contactId,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
