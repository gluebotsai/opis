import { prisma } from "@/dao/db/prisma";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { createCompany } from "@/dao/companies/company-service";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { defaultDealTitle } from "@/lib/default-deal-title";
export type ConvertLeadInput = {
  contactId: string;
  companyId?: string | null;
  companyName?: string | null;
  locationId?: string | null;
  locationName?: string;
  dealTitle?: string;
  amount?: number | null;
  ownerUserId?: string | null;
  actorUserId?: string | null;
};

/**
 * Convert a qualified lead contact into Company + Location + Deal,
 * then mark the contact as converted / customer-bound.
 */
export async function convertLeadToDeal(input: ConvertLeadInput) {
  const contact = await getContact(input.contactId);
  if (!contact) throw new Error("Contact not found.");
  if (contact.person.leadStatus === "converted" && contact.person.convertedDealId) {
    return { dealId: contact.person.convertedDealId, alreadyConverted: true as const };
  }
  if (contact.person.leadStatus === "disqualified") {
    throw new Error("Disqualified leads cannot be converted.");
  }
  if (contact.person.leadStatus !== "qualified") {
    throw new Error(
      "Lead must be Qualified before converting to a deal. Update lead status on the contact first.",
    );
  }

  const organizationId = await resolveRequestOrganizationId(contact.person.organizationId);
  let companyId = input.companyId?.trim() || contact.person.companyId;
  let locationId =
    input.locationId?.trim() || contact.person.locationId || null;

  if (!companyId) {
    const name =
      input.companyName?.trim() ||
      contact.person.company?.name ||
      `${contact.displayName} Account`;
    const company = await createCompany({
      name,
      industry: contact.person.company?.industry ?? null,
      employeeCount: null,
      ownerUserId: input.ownerUserId ?? contact.person.ownerUserId,
      organizationId,
    });
    companyId = company.id;
  }

  if (!locationId) {
    const existing = await prisma.companyLocation.findFirst({
      where: { companyId },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      locationId = existing.id;
    } else {
      const companyOwner =
        (
          await prisma.company.findUnique({
            where: { id: companyId },
            select: { ownerUserId: true },
          })
        )?.ownerUserId ??
        input.ownerUserId ??
        contact.person.ownerUserId ??
        null;
      const loc = await prisma.companyLocation.create({
        data: {
          organizationId,
          companyId,
          name: input.locationName?.trim() || "Headquarters",
          type: "hq",
          city: contact.person.city,
          industry: contact.person.company?.industry ?? null,
          ownerUserId: companyOwner,
        },
      });
      locationId = loc.id;
    }
  }

  const [companyRow, locationRow] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    }),
    prisma.companyLocation.findUnique({
      where: { id: locationId },
      select: { ownerUserId: true },
    }),
  ]);

  // Prefer explicit / contact owner (regional assign, convert CTA), then
  // location / company territory owners. Leads may still be unowned.
  const dealOwnerUserId =
    input.ownerUserId?.trim() ||
    contact.crm.ownerUserId?.trim() ||
    contact.person.ownerUserId?.trim() ||
    locationRow?.ownerUserId?.trim() ||
    companyRow?.ownerUserId?.trim() ||
    null;

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      title:
        input.dealTitle?.trim() ||
        defaultDealTitle({
          contactName: contact.displayName,
          companyName:
            input.companyName?.trim() ||
            contact.person.company?.name ||
            null,
        }),
      stage: "qualification",
      amount: input.amount ?? null,
      companyId,
      locationId,
      contactId: contact.id,
      contactName: contact.displayName,
      contactEmail: contact.person.email,
      ownerUserId: dealOwnerUserId,
    },
  });

  await updateContact(contact.id, {
    companyId,
    // Bind the contact to the deal's location so it attributes to the right
    // location card (deal/customer funnel counts read contact.locationId).
    locationId,
    companyName:
      input.companyName?.trim() ||
      contact.person.company?.name ||
      undefined,
    leadStatus: "converted",
    convertedDealId: deal.id,
    contactType: "prospect",
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "convert",
    entityType: "contact",
    entityId: contact.id,
    organizationId,
    meta: { dealId: deal.id, companyId },
  });

  return { dealId: deal.id, companyId, locationId, alreadyConverted: false as const };
}
