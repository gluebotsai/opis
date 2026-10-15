import { prisma } from "@/dao/db/prisma";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { defaultDealTitle } from "@/lib/default-deal-title";

/**
 * Sales pipeline is `crm.deals`, not contact ownership alone.
 * When a contact leaves the lead pool with an owner + company, ensure an open
 * deal exists so the owner sees them on `/sales`. Also keep open-deal owners
 * aligned with the contact owner.
 */
export async function ensureContactInSalesPipeline(
  contactId: string,
  options?: { actorUserId?: string | null },
): Promise<{ dealId: string | null; created: boolean; synced: boolean }> {
  const contact = await getContact(contactId);
  if (!contact) {
    return { dealId: null, created: false, synced: false };
  }

  const lifecycle = contact.person.contactType;
  if (
    lifecycle === "lead" ||
    lifecycle === "contact" ||
    lifecycle === "churned"
  ) {
    return { dealId: null, created: false, synced: false };
  }

  const companyId = contact.person.companyId?.trim() || null;
  if (!companyId) {
    return { dealId: null, created: false, synced: false };
  }

  const ownerUserId =
    contact.crm.ownerUserId?.trim() ||
    contact.person.ownerUserId?.trim() ||
    null;

  const organizationId = await resolveRequestOrganizationId(contact.person.organizationId);

  const openDeals = await prisma.deal.findMany({
    where: {
      contactId: contact.id,
      organizationId,
      stage: { notIn: ["closed_won", "closed_lost"] },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (openDeals.length > 0) {
    let synced = false;
    if (ownerUserId) {
      const stale = openDeals.filter((d) => d.ownerUserId !== ownerUserId);
      if (stale.length > 0) {
        await prisma.deal.updateMany({
          where: { id: { in: stale.map((d) => d.id) } },
          data: { ownerUserId },
        });
        synced = true;
        for (const deal of stale) {
          await writeAuditLog({
            actorUserId: options?.actorUserId ?? ownerUserId,
            action: "assign",
            entityType: "deal",
            entityId: deal.id,
            organizationId,
            meta: {
              fromOwnerUserId: deal.ownerUserId,
              toOwnerUserId: ownerUserId,
              reason: "contact_owner_pipeline_sync",
            },
          });
        }
      }
    }
    const primaryId = openDeals[0]?.id ?? null;
    if (
      primaryId &&
      !contact.person.convertedDealId &&
      lifecycle === "prospect"
    ) {
      await updateContact(contact.id, { convertedDealId: primaryId }).catch(
        () => undefined,
      );
    }
    return { dealId: primaryId, created: false, synced };
  }

  // No open deal — prospect/customer with an owner enters that owner's board.
  if (!ownerUserId) {
    return { dealId: null, created: false, synced: false };
  }

  let locationId = contact.person.locationId?.trim() || null;
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
        )?.ownerUserId?.trim() || ownerUserId;
      const loc = await prisma.companyLocation.create({
        data: {
          organizationId,
          companyId,
          name: "Headquarters",
          type: "hq",
          city: contact.person.city,
          industry: contact.person.company?.industry ?? null,
          ownerUserId: companyOwner,
        },
      });
      locationId = loc.id;
    }
  }

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      title: defaultDealTitle({
        contactName: contact.displayName,
        companyName: contact.person.company?.name ?? null,
      }),
      stage: "qualification",
      amount: null,
      companyId,
      locationId,
      contactId: contact.id,
      contactName: contact.displayName,
      contactEmail: contact.person.email,
      ownerUserId,
    },
  });

  await updateContact(contact.id, {
    locationId,
    convertedDealId: deal.id,
    ...(contact.person.leadStatus !== "disqualified"
      ? { leadStatus: "converted" as const }
      : {}),
  });

  await writeAuditLog({
    actorUserId: options?.actorUserId ?? ownerUserId,
    action: "create",
    entityType: "deal",
    entityId: deal.id,
    organizationId,
    meta: {
      stage: deal.stage,
      ownerUserId,
      title: deal.title,
      reason: "contact_owner_pipeline_entry",
      contactId: contact.id,
    },
  });

  return { dealId: deal.id, created: true, synced: false };
}
