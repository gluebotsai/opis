import type { ActivityType, DealStage, Prisma } from "@prisma/client";
import {
  BOARD_STAGE_LIMIT,
  clampPage,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  paginatedResult,
  type PaginatedResult,
  type PaginationInput,
} from "@/lib/pagination";
import { parseNoteBody } from "@/lib/note-body";
import { prisma } from "@/dao/db/prisma";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { DEAL_STAGES, isTerminalStage } from "@/service/sales/stages";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type DealInput = {
  title: string;
  stage: DealStage;
  amount?: number | null;
  companyId: string;
  locationId: string;
  contactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  ownerUserId?: string | null;
  expectedCloseDate?: Date | null;
};

export type ActivityInput = {
  type: ActivityType;
  subject: string;
  body?: string | null;
  dueAt?: Date | null;
};

export type DealListFilters = PaginationInput & {
  stage?: DealStage | "all";
  search?: string;
  organizationId?: string | null;
  ownerUserId?: string | null;
  companyId?: string | null;
};

const dealListInclude = {
  company: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, type: true } },
} as const;

async function resolveDealListOrganizationId(
  explicit?: string | null,
): Promise<string> {
  return resolveRequestOrganizationId(explicit);
}

function buildDealWhere(
  organizationId: string,
  filters?: Omit<DealListFilters, "organizationId">,
): Prisma.DealWhereInput {
  const where: Prisma.DealWhereInput = { organizationId };
  if (filters?.stage && filters.stage !== "all") {
    where.stage = filters.stage;
  }
  if (filters?.ownerUserId) {
    where.ownerUserId = filters.ownerUserId;
  }
  if (filters?.companyId) {
    where.companyId = filters.companyId;
  }
  if (filters?.search?.trim()) {
    const q = filters.search.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { contactEmail: { contains: q, mode: "insensitive" } },
      { company: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

function closedAtForStage(stage: DealStage): Date | null {
  return isTerminalStage(stage) ? new Date() : null;
}

/** Resolve contact picker → hard link + denormalized name/email. */
async function resolveDealContact(input: DealInput): Promise<DealInput> {
  const contactId = input.contactId?.trim() || null;
  if (!contactId) {
    return {
      ...input,
      contactId: null,
      contactName: null,
      contactEmail: null,
    };
  }

  const contact = await getContact(contactId);
  if (!contact) {
    throw new Error("Selected contact was not found.");
  }

  return {
    ...input,
    contactId: contact.id,
    contactName: contact.displayName,
    contactEmail: contact.person.email,
  };
}

/** Paginated deal list (Sales list view / filtered queries). */
export async function listDeals(
  filters: DealListFilters = {},
): Promise<PaginatedResult<Prisma.DealGetPayload<{ include: typeof dealListInclude }>>> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize, DEFAULT_PAGE_SIZE);
  const skip = (page - 1) * pageSize;
  const organizationId = await resolveDealListOrganizationId(
    filters.organizationId,
  );
  const where = buildDealWhere(organizationId, filters);

  const [total, items] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      include: dealListInclude,
    }),
  ]);

  return paginatedResult(items, total, page, pageSize);
}

/**
 * Board view: one bounded query per stage so we never pull all deals.
 * Returns totals so the UI can show "40 of 12,340" per column.
 */
export async function listDealsForBoard(
  search?: string,
  ownerUserId?: string | null,
  organizationId?: string | null,
) {
  const orgId = await resolveDealListOrganizationId(organizationId);
  const baseWhere = buildDealWhere(orgId, { search, ownerUserId });

  const columns = await Promise.all(
    DEAL_STAGES.map(async (stage) => {
      const where: Prisma.DealWhereInput = { ...baseWhere, stage };
      const [total, deals] = await Promise.all([
        prisma.deal.count({ where }),
        prisma.deal.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: BOARD_STAGE_LIMIT,
          include: dealListInclude,
        }),
      ]);
      return { stage, total, deals };
    }),
  );

  return columns;
}

export async function getDeal(id: string) {
  return prisma.deal.findUnique({
    where: { id },
    include: {
      company: true,
      location: true,
      activities: {
        orderBy: { createdAt: "desc" },
        take: DEFAULT_PAGE_SIZE,
      },
    },
  });
}

export async function createDeal(
  input: DealInput,
  options?: { actorUserId?: string | null; organizationId?: string | null },
) {
  const location = await prisma.companyLocation.findFirst({
    where: { id: input.locationId, companyId: input.companyId },
  });
  if (!location) throw new Error("Location does not belong to the selected company.");

  const resolved = await resolveDealContact(input);
  const organizationId = await resolveDealListOrganizationId(
    options?.organizationId,
  );

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      title: resolved.title.trim(),
      stage: resolved.stage,
      amount: resolved.amount ?? null,
      companyId: resolved.companyId,
      locationId: resolved.locationId,
      contactId: resolved.contactId || null,
      contactName: resolved.contactName?.trim() || null,
      contactEmail: resolved.contactEmail?.trim() || null,
      notes: resolved.notes?.trim() || null,
      ownerUserId: resolved.ownerUserId?.trim() || null,
      expectedCloseDate: resolved.expectedCloseDate ?? null,
      closedAt: closedAtForStage(resolved.stage),
    },
  });

  await writeAuditLog({
    actorUserId: options?.actorUserId ?? resolved.ownerUserId,
    action: "create",
    entityType: "deal",
    entityId: deal.id,
    organizationId: deal.organizationId,
    meta: {
      stage: deal.stage,
      amount: deal.amount?.toString() ?? null,
      ownerUserId: deal.ownerUserId,
      title: deal.title,
    },
  });

  return deal;
}

export async function updateDeal(
  id: string,
  input: DealInput,
  options?: { actorUserId?: string | null },
) {
  const location = await prisma.companyLocation.findFirst({
    where: { id: input.locationId, companyId: input.companyId },
  });
  if (!location) throw new Error("Location does not belong to the selected company.");

  const existing = await prisma.deal.findUnique({ where: { id } });
  if (!existing) throw new Error("Deal not found.");

  const resolved = await resolveDealContact(input);
  const nextOwner =
    resolved.ownerUserId !== undefined
      ? resolved.ownerUserId?.trim() || null
      : existing.ownerUserId;
  const nextAmount =
    resolved.amount === undefined ? existing.amount : resolved.amount ?? null;

  const deal = await prisma.deal.update({
    where: { id },
    data: {
      title: resolved.title.trim(),
      stage: resolved.stage,
      amount: resolved.amount ?? null,
      companyId: resolved.companyId,
      locationId: resolved.locationId,
      contactId: resolved.contactId || null,
      contactName: resolved.contactName?.trim() || null,
      contactEmail: resolved.contactEmail?.trim() || null,
      notes: resolved.notes?.trim() || null,
      ownerUserId:
        resolved.ownerUserId !== undefined
          ? resolved.ownerUserId?.trim() || null
          : undefined,
      expectedCloseDate: resolved.expectedCloseDate ?? null,
      closedAt: closedAtForStage(resolved.stage),
    },
  });

  const actorUserId = options?.actorUserId ?? null;

  if (existing.stage !== deal.stage) {
    await writeAuditLog({
      actorUserId,
      action: "stage_change",
      entityType: "deal",
      entityId: id,
      organizationId: deal.organizationId,
      meta: {
        fromStage: existing.stage,
        toStage: deal.stage,
        stage: deal.stage,
      },
    });
  }

  const prevAmt =
    existing.amount == null ? null : Number(existing.amount);
  const nextAmt = nextAmount == null ? null : Number(nextAmount);
  const amountChanged =
    (prevAmt == null && nextAmt != null) ||
    (prevAmt != null && nextAmt == null) ||
    (prevAmt != null &&
      nextAmt != null &&
      Math.abs(prevAmt - nextAmt) > 0.0001);
  if (amountChanged) {
    await writeAuditLog({
      actorUserId,
      action: "update",
      entityType: "deal",
      entityId: id,
      organizationId: deal.organizationId,
      meta: {
        kind: "amount",
        fromAmount: existing.amount?.toString() ?? null,
        toAmount: deal.amount?.toString() ?? null,
      },
    });
  }

  if (existing.ownerUserId !== nextOwner) {
    await writeAuditLog({
      actorUserId,
      action: "assign",
      entityType: "deal",
      entityId: id,
      organizationId: deal.organizationId,
      meta: {
        fromOwnerUserId: existing.ownerUserId,
        toOwnerUserId: nextOwner,
      },
    });
  }

  return deal;
}

/** Reassign deal ownership (admin / sales_manager). */
export async function updateDealOwner(
  id: string,
  ownerUserId: string | null,
  options?: { actorUserId?: string | null },
) {
  const existing = await prisma.deal.findUnique({ where: { id } });
  if (!existing) throw new Error("Deal not found.");

  const nextOwner = ownerUserId?.trim() || null;
  const deal = await prisma.deal.update({
    where: { id },
    data: { ownerUserId: nextOwner },
  });

  if (existing.ownerUserId !== nextOwner) {
    await writeAuditLog({
      actorUserId: options?.actorUserId,
      action: "assign",
      entityType: "deal",
      entityId: id,
      organizationId: deal.organizationId,
      meta: {
        fromOwnerUserId: existing.ownerUserId,
        toOwnerUserId: nextOwner,
      },
    });
  }

  return deal;
}

export async function updateDealStage(
  id: string,
  stage: DealStage,
  options?: { lostReason?: string | null; actorUserId?: string | null },
) {
  if (stage === "closed_lost") {
    const reason = options?.lostReason?.trim();
    if (!reason) {
      throw new Error("Lost reason is required when marking a deal Closed Lost.");
    }
  }

  const existing = await prisma.deal.findUnique({ where: { id } });
  if (!existing) throw new Error("Deal not found.");

  if (existing.stage === stage && stage !== "closed_lost") {
    return {
      deal: existing,
      wonExtras: {
        contactPromoted: false,
        contactId: existing.contactId,
        contractId: null,
        contractCreated: false,
        serviceHandoff: null,
      },
    };
  }

  const deal = await prisma.deal.update({
    where: { id },
    data: {
      stage,
      closedAt: closedAtForStage(stage),
      lostReason:
        stage === "closed_lost"
          ? options?.lostReason?.trim() || null
          : stage === "closed_won"
            ? null
            : existing.lostReason,
    },
  });

  await writeAuditLog({
    actorUserId: options?.actorUserId,
    action: "stage_change",
    entityType: "deal",
    entityId: id,
    organizationId: deal.organizationId,
    meta: {
      fromStage: existing.stage,
      toStage: stage,
      stage,
      lostReason: deal.lostReason,
    },
  });

  const wonExtras: ClosedWonExtras = {
    contactPromoted: false,
    contactId: deal.contactId,
    contractId: null,
    contractCreated: false,
    serviceHandoff: null,
  };

  if (stage === "closed_won") {
    if (deal.contactId) {
      await updateContact(deal.contactId, {
        contactType: "customer",
        leadStatus: "converted",
      });
      wonExtras.contactPromoted = true;
    }

    // Service is a separate microservice — hand off onboarding; do not write tickets into crm_qa.
    const { requestServiceOnboarding } = await import(
      "@/service/integrations/service-ms"
    );
    wonExtras.serviceHandoff = await requestServiceOnboarding({
      organizationId: await resolveRequestOrganizationId(deal.organizationId),
      companyId: deal.companyId,
      dealId: deal.id,
      contactId: deal.contactId,
      subject: `Onboarding — ${deal.title}`,
      amount: deal.amount?.toString() ?? null,
    });

    const renewalContract = await prisma.contract.findFirst({
      where: { renewDealId: deal.id },
    });
    if (renewalContract) {
      const { extendContractFromRenewalWon } = await import(
        "@/service/sales/contract-commands"
      );
      const extended = await extendContractFromRenewalWon({
        contractId: renewalContract.id,
        dealAmount: deal.amount != null ? Number(deal.amount) : null,
        organizationId: deal.organizationId,
      });
      wonExtras.contractId = extended.id;
      wonExtras.contractCreated = false;
    } else {
      const existingContract = await prisma.contract.findFirst({
        where: { dealId: deal.id },
      });
      if (existingContract) {
        wonExtras.contractId = existingContract.id;
        wonExtras.contractCreated = false;
      } else {
        const { createContractFromWonDeal } = await import(
          "@/dao/sales/renewal-service"
        );
        const contract = await createContractFromWonDeal({
          organizationId: await resolveRequestOrganizationId(deal.organizationId),
          companyId: deal.companyId,
          dealId: deal.id,
          title: `Contract — ${deal.title}`,
          arr: deal.amount != null ? Number(deal.amount) : null,
        });
        wonExtras.contractId = contract.id;
        wonExtras.contractCreated = true;
      }
    }
  }

  if (deal.contactId) {
    triggerLeadLifecycle({
      contactId: deal.contactId,
      organizationId: deal.organizationId,
      triggerReason: `deal_stage:${stage}`,
    });
  }

  return { deal, wonExtras: stage === "closed_won" ? wonExtras : null };
}

export type ClosedWonExtras = {
  contactPromoted: boolean;
  contactId: string | null;
  contractId: string | null;
  contractCreated: boolean;
  serviceHandoff: {
    ok: boolean;
    externalId?: string;
    skipped?: boolean;
    error?: string;
  } | null;
};

export async function listContractsForDeal(dealId: string) {
  return prisma.contract.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
  });
}

/** Deals hard-linked to a contact (plus optional convert-lead fallback id). */
export async function listDealsForContact(
  contactId: string,
  convertedDealId?: string | null,
  organizationId?: string | null,
) {
  const orgId = await resolveDealListOrganizationId(organizationId);
  const deals = await prisma.deal.findMany({
    where: { organizationId: orgId, contactId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      stage: true,
      amount: true,
      updatedAt: true,
      company: { select: { id: true, name: true } },
    },
  });

  const fallbackId = convertedDealId?.trim() || null;
  if (fallbackId && !deals.some((deal) => deal.id === fallbackId)) {
    const fallback = await prisma.deal.findFirst({
      where: { organizationId: orgId, id: fallbackId },
      select: {
        id: true,
        title: true,
        stage: true,
        amount: true,
        updatedAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    if (fallback) deals.unshift(fallback);
  }

  return deals;
}

export async function deleteDeal(id: string) {
  await prisma.deal.delete({ where: { id } });
}

const MAX_DEAL_SELECT = 500;

/** Lightweight deal picker for quotes / order forms — owner-scoped. */
export async function listDealsForSelect(options?: {
  limit?: number;
  organizationId?: string | null;
  ownerUserId?: string | null;
}) {
  const limit = Math.min(options?.limit ?? MAX_DEAL_SELECT, MAX_DEAL_SELECT);
  let ownerUserId = options?.ownerUserId;
  if (ownerUserId === undefined) {
    const { resolveRecordOwnerScope } = await import(
      "@/service/auth/ownership-scope"
    );
    ownerUserId = (await resolveRecordOwnerScope()).ownerUserId;
  }
  const organizationId = await resolveDealListOrganizationId(
    options?.organizationId,
  );
  return prisma.deal.findMany({
    where: {
      organizationId,
      stage: { not: "closed_lost" },
      ...(ownerUserId ? { ownerUserId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      stage: true,
      companyId: true,
      contactName: true,
      company: { select: { name: true } },
    },
  });
}

/** Activities logged on any of the given deals (for contact timeline merge). */
export async function listActivitiesForDealIds(dealIds: string[]) {
  const ids = [...new Set(dealIds.filter(Boolean))];
  if (ids.length === 0) return [];

  return prisma.dealActivity.findMany({
    where: { dealId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      dealId: true,
      type: true,
      subject: true,
      body: true,
      dueAt: true,
      createdAt: true,
      deal: { select: { title: true } },
    },
  });
}

export async function createActivity(dealId: string, input: ActivityInput) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { organizationId: true },
  });
  if (!deal) throw new Error("Deal not found.");

  if (input.type === "note") {
    const rawBody = input.body?.trim() || input.subject.trim() || "";
    if (!rawBody) throw new Error("Note description is required.");
    const parsed = parseNoteBody(rawBody);
    if (!parsed.plain && parsed.attachments.length === 0) {
      throw new Error("Note description is required.");
    }
    const subject =
      parsed.plain.length > 80
        ? `${parsed.plain.slice(0, 77)}…`
        : parsed.plain ||
          (parsed.attachments.length
            ? `Note with ${parsed.attachments.length} attachment${parsed.attachments.length === 1 ? "" : "s"}`
            : "Note");

    return prisma.dealActivity.create({
      data: {
        organizationId: deal.organizationId,
        dealId,
        type: "note",
        subject,
        body: rawBody,
        dueAt: null,
      },
    });
  }

  const subject = input.subject.trim();
  if (!subject) throw new Error("Activity subject is required.");

  return prisma.dealActivity.create({
    data: {
      organizationId: deal.organizationId,
      dealId,
      type: input.type,
      subject,
      body: input.body?.trim() || null,
      dueAt: input.dueAt ?? null,
    },
  });
}

export async function deleteActivity(dealId: string, activityId: string) {
  const existing = await prisma.dealActivity.findFirst({
    where: { id: activityId, dealId },
  });
  if (!existing) throw new Error("Activity not found.");
  await prisma.dealActivity.delete({ where: { id: activityId } });
}
