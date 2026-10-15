import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import type {
  ContactStatus,
  LeadStatus,
} from "@/service/account/types";

export type ContactProfileRecord = {
  id: string;
  accountContactId: string;
  organizationId: string;
  companyId: string | null;
  locationId: string | null;
  ownerUserId: string | null;
  createdByUserId: string | null;
  leadSource: string | null;
  leadStatus: LeadStatus;
  disqualifyReason: string | null;
  bantBudget: boolean | null;
  bantAuthority: boolean | null;
  bantNeed: boolean | null;
  bantTimeline: boolean | null;
  bantBudgetDetail: string | null;
  bantAuthorityDetail: string | null;
  bantNeedDetail: string | null;
  bantTimelineDetail: string | null;
  convertedDealId: string | null;
  tags: string[];
  status: ContactStatus;
  notes: string | null;
  isPinned: boolean;
  customAttributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ContactProfileInput = {
  organizationId?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  ownerUserId?: string | null;
  createdByUserId?: string | null;
  leadSource?: string | null;
  leadStatus?: LeadStatus;
  disqualifyReason?: string | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
  bantBudgetDetail?: string | null;
  bantAuthorityDetail?: string | null;
  bantNeedDetail?: string | null;
  bantTimelineDetail?: string | null;
  convertedDealId?: string | null;
  tags?: string[];
  status?: ContactStatus;
  notes?: string | null;
  isPinned?: boolean;
  customAttributes?: Record<string, unknown> | null;
};

export type ListContactProfilesFilters = {
  searchAccountIds?: string[] | null;
  leadStatus?: LeadStatus | "all";
  status?: ContactStatus | "all";
  companyId?: string | null;
  /** When set with ownerUserId, expand visibility to franchise companies. */
  channelCompanyIds?: string[] | null;
  locationId?: string | null;
  ownerUserId?: string | null;
  limit: number;
  offset: number;
};

function asAttributes(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapProfile(row: {
  id: string;
  accountContactId: string;
  organizationId: string;
  companyId: string | null;
  locationId: string | null;
  ownerUserId: string | null;
  createdByUserId: string | null;
  leadSource: string | null;
  leadStatus: string;
  disqualifyReason: string | null;
  bantBudget: boolean | null;
  bantAuthority: boolean | null;
  bantNeed: boolean | null;
  bantTimeline: boolean | null;
  bantBudgetDetail?: string | null;
  bantAuthorityDetail?: string | null;
  bantNeedDetail?: string | null;
  bantTimelineDetail?: string | null;
  convertedDealId: string | null;
  tags: string[];
  status: string;
  notes: string | null;
  isPinned: boolean;
  customAttributes?: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ContactProfileRecord {
  return {
    id: row.id,
    accountContactId: row.accountContactId,
    organizationId: row.organizationId,
    companyId: row.companyId,
    locationId: row.locationId,
    ownerUserId: row.ownerUserId,
    createdByUserId: row.createdByUserId,
    leadSource: row.leadSource,
    leadStatus: (row.leadStatus as LeadStatus) || "new",
    disqualifyReason: row.disqualifyReason,
    bantBudget: row.bantBudget,
    bantAuthority: row.bantAuthority,
    bantNeed: row.bantNeed,
    bantTimeline: row.bantTimeline,
    bantBudgetDetail: row.bantBudgetDetail ?? null,
    bantAuthorityDetail: row.bantAuthorityDetail ?? null,
    bantNeedDetail: row.bantNeedDetail ?? null,
    bantTimelineDetail: row.bantTimelineDetail ?? null,
    convertedDealId: row.convertedDealId,
    tags: row.tags ?? [],
    status: row.status as ContactStatus,
    notes: row.notes,
    isPinned: row.isPinned,
    customAttributes: asAttributes(row.customAttributes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Scoped contact list: assigned owner, creator, or franchise channel companies.
 * Null/undefined ownerUserId = no owner filter (admin/manager org-wide).
 */
export function contactOwnerScopeWhere(filters: {
  ownerUserId?: string | null;
  channelCompanyIds?: string[] | null;
}): Prisma.ContactProfileWhereInput {
  const ownerUserId = filters.ownerUserId?.trim();
  if (!ownerUserId) return {};
  const branches: Prisma.ContactProfileWhereInput[] = [
    { ownerUserId },
    { createdByUserId: ownerUserId },
  ];
  if (filters.channelCompanyIds && filters.channelCompanyIds.length > 0) {
    branches.push({ companyId: { in: filters.channelCompanyIds } });
  }
  return { OR: branches };
}

function buildWhere(
  filters: ListContactProfilesFilters,
): Prisma.ContactProfileWhereInput {
  const where: Prisma.ContactProfileWhereInput = {};

  if (filters.searchAccountIds) {
    where.accountContactId = { in: filters.searchAccountIds };
  }
  if (filters.leadStatus && filters.leadStatus !== "all") {
    where.leadStatus = filters.leadStatus;
  }
  if (filters.status && filters.status !== "all") {
    where.status = filters.status;
  } else {
    where.status = { not: "archived" };
  }
  if (filters.companyId?.trim()) {
    where.companyId = filters.companyId.trim();
  }
  if (filters.locationId?.trim()) {
    where.locationId = filters.locationId.trim();
  }
  Object.assign(
    where,
    contactOwnerScopeWhere({
      ownerUserId: filters.ownerUserId,
      channelCompanyIds: filters.channelCompanyIds,
    }),
  );
  return where;
}

/** Match CRM company name, domain, industry, or location → contact profile ids. */
export async function findContactIdsByCompanyNameSearch(
  search: string,
  organizationId: string,
): Promise<string[]> {
  const q = search.trim();
  if (!q) return [];
  const orgId = BigInt(organizationId);
  const text = { contains: q, mode: "insensitive" as const };
  const [companies, locations] = await Promise.all([
    prisma.company.findMany({
      where: {
        organizationId: orgId,
        OR: [{ name: text }, { domain: text }, { industry: text }],
      },
      select: { id: true },
      take: 500,
    }),
    prisma.companyLocation.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { name: text },
          { city: text },
          { address: text },
          { industry: text },
        ],
      },
      select: { id: true, companyId: true },
      take: 500,
    }),
  ]);
  const companyIds = [
    ...new Set([
      ...companies.map((c) => c.id),
      ...locations.map((loc) => loc.companyId),
    ]),
  ];
  const locationIds = locations.map((loc) => loc.id);
  if (companyIds.length === 0 && locationIds.length === 0) return [];
  const profiles = await prisma.contactProfile.findMany({
    where: {
      organizationId: orgId,
      OR: [
        ...(companyIds.length > 0 ? [{ companyId: { in: companyIds } }] : []),
        ...(locationIds.length > 0
          ? [{ locationId: { in: locationIds } }]
          : []),
      ],
    },
    select: { accountContactId: true },
    take: 5000,
  });
  return profiles.map((p) => p.accountContactId);
}

/** Lead status, source, notes, and tags live on the CRM overlay, not CDP. */
export async function findContactIdsByOverlaySearch(
  search: string,
  organizationId: string,
): Promise<string[]> {
  const q = search.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const rows = await prisma.$queryRaw<{ account_contact_id: string }[]>`
    SELECT account_contact_id
    FROM crm.contact_profiles
    WHERE organization_id = ${BigInt(organizationId)}
      AND (
        lead_source ILIKE ${like}
        OR lead_status ILIKE ${like}
        OR coalesce(notes, '') ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ${like}
        )
      )
    LIMIT 5000
  `;
  return rows.map((row) => row.account_contact_id);
}

export async function listContactProfiles(
  filters: ListContactProfilesFilters,
): Promise<{ items: ContactProfileRecord[]; total: number }> {
  if (filters.searchAccountIds && filters.searchAccountIds.length === 0) {
    return { items: [], total: 0 };
  }

  const where = buildWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.contactProfile.count({ where }),
    prisma.contactProfile.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: filters.limit,
      skip: filters.offset,
    }),
  ]);
  return { items: rows.map(mapProfile), total };
}

export async function getContactProfileByAccountId(
  accountContactId: string,
): Promise<ContactProfileRecord | null> {
  const row = await prisma.contactProfile.findUnique({
    where: { accountContactId },
  });
  return row ? mapProfile(row) : null;
}

export async function getContactProfilesByAccountIds(
  accountContactIds: string[],
): Promise<Map<string, ContactProfileRecord>> {
  if (accountContactIds.length === 0) return new Map();
  const rows = await prisma.contactProfile.findMany({
    where: { accountContactId: { in: accountContactIds } },
  });
  const map = new Map<string, ContactProfileRecord>();
  for (const row of rows) {
    map.set(row.accountContactId, mapProfile(row));
  }
  return map;
}

export async function upsertContactProfile(
  accountContactId: string,
  input: ContactProfileInput,
): Promise<ContactProfileRecord> {
  const existing = await prisma.contactProfile.findUnique({
    where: { accountContactId },
    select: { organizationId: true, createdByUserId: true },
  });
  const organizationId =
    input.organizationId?.trim() || existing?.organizationId || null;
  if (!organizationId) {
    throw new Error("organizationId is required to create a contact profile.");
  }

  const createdByUserId = input.createdByUserId ?? null;
  const data = {
    organizationId,
    companyId: input.companyId?.trim() || null,
    locationId: input.locationId?.trim() || null,
    ownerUserId: input.ownerUserId ?? null,
    leadSource: input.leadSource?.trim() || null,
    leadStatus: input.leadStatus ?? "new",
    disqualifyReason: input.disqualifyReason?.trim() || null,
    bantBudget: input.bantBudget ?? null,
    bantAuthority: input.bantAuthority ?? null,
    bantNeed: input.bantNeed ?? null,
    bantTimeline: input.bantTimeline ?? null,
    bantBudgetDetail: input.bantBudgetDetail?.trim() || null,
    bantAuthorityDetail: input.bantAuthorityDetail?.trim() || null,
    bantNeedDetail: input.bantNeedDetail?.trim() || null,
    bantTimelineDetail: input.bantTimelineDetail?.trim() || null,
    convertedDealId: input.convertedDealId?.trim() || null,
    tags: input.tags ?? [],
    status: input.status ?? "active",
    notes: input.notes?.trim() || null,
    isPinned: input.isPinned ?? false,
  };

  const attrs =
    input.customAttributes !== undefined
      ? {
          customAttributes: (input.customAttributes ??
            {}) as Prisma.InputJsonValue,
        }
      : {};

  const row = await prisma.contactProfile.upsert({
    where: { accountContactId },
    create: {
      accountContactId,
      ...data,
      createdByUserId,
      customAttributes: (input.customAttributes ?? {}) as Prisma.InputJsonValue,
    },
    update: {
      ...data,
      ...attrs,
      ...(!existing?.createdByUserId && createdByUserId
        ? { createdByUserId }
        : {}),
    },
  });
  return mapProfile(row);
}

export async function patchContactProfile(
  accountContactId: string,
  input: ContactProfileInput,
): Promise<ContactProfileRecord> {
  const existing = await getContactProfileByAccountId(accountContactId);
  if (!existing) {
    return upsertContactProfile(accountContactId, input);
  }

  const row = await prisma.contactProfile.update({
    where: { accountContactId },
    data: {
      ...(input.organizationId !== undefined
        ? {
            organizationId: (() => {
              const orgId = input.organizationId?.trim();
              if (!orgId) {
                throw new Error("organizationId cannot be cleared.");
              }
              return orgId;
            })(),
          }
        : {}),
      ...(input.companyId !== undefined
        ? { companyId: input.companyId?.trim() || null }
        : {}),
      ...(input.locationId !== undefined
        ? { locationId: input.locationId?.trim() || null }
        : {}),
      ...(input.ownerUserId !== undefined
        ? { ownerUserId: input.ownerUserId }
        : {}),
      ...(input.createdByUserId !== undefined && !existing.createdByUserId
        ? { createdByUserId: input.createdByUserId }
        : {}),
      ...(input.leadSource !== undefined
        ? { leadSource: input.leadSource?.trim() || null }
        : {}),
      ...(input.leadStatus !== undefined
        ? { leadStatus: input.leadStatus }
        : {}),
      ...(input.disqualifyReason !== undefined
        ? { disqualifyReason: input.disqualifyReason?.trim() || null }
        : {}),
      ...(input.bantBudget !== undefined ? { bantBudget: input.bantBudget } : {}),
      ...(input.bantAuthority !== undefined
        ? { bantAuthority: input.bantAuthority }
        : {}),
      ...(input.bantNeed !== undefined ? { bantNeed: input.bantNeed } : {}),
      ...(input.bantTimeline !== undefined
        ? { bantTimeline: input.bantTimeline }
        : {}),
      ...(input.bantBudgetDetail !== undefined
        ? { bantBudgetDetail: input.bantBudgetDetail?.trim() || null }
        : {}),
      ...(input.bantAuthorityDetail !== undefined
        ? { bantAuthorityDetail: input.bantAuthorityDetail?.trim() || null }
        : {}),
      ...(input.bantNeedDetail !== undefined
        ? { bantNeedDetail: input.bantNeedDetail?.trim() || null }
        : {}),
      ...(input.bantTimelineDetail !== undefined
        ? { bantTimelineDetail: input.bantTimelineDetail?.trim() || null }
        : {}),
      ...(input.convertedDealId !== undefined
        ? { convertedDealId: input.convertedDealId?.trim() || null }
        : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined
        ? { notes: input.notes?.trim() || null }
        : {}),
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      ...(input.customAttributes !== undefined
        ? {
            customAttributes: (input.customAttributes ??
              {}) as Prisma.InputJsonValue,
          }
        : {}),
    },
  });
  return mapProfile(row);
}

export async function setContactProfilePinned(
  accountContactId: string,
  isPinned: boolean,
): Promise<ContactProfileRecord> {
  return patchContactProfile(accountContactId, { isPinned });
}

export async function deleteContactProfile(
  accountContactId: string,
): Promise<void> {
  await prisma.contactProfile.deleteMany({ where: { accountContactId } });
}

/** Align lead_status for customer/churned contacts using CDP contact_type. */
export async function repairInconsistentLeadStatuses(): Promise<number> {
  const { rows } = await prisma.$queryRaw<{ account_contact_id: string }[]>`
    SELECT cp.account_contact_id
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id = cp.account_contact_id
    WHERE lower(coalesce(p.contact_type, 'contact')) IN ('customer', 'churned')
      AND cp.lead_status IS DISTINCT FROM 'converted'`;
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.account_contact_id);
  const result = await prisma.contactProfile.updateMany({
    where: { accountContactId: { in: ids } },
    data: { leadStatus: "converted" },
  });
  return result.count;
}

export async function countActiveProfilesForCompanyId(
  companyId: string,
): Promise<number> {
  const id = companyId.trim();
  if (!id) return 0;
  return prisma.contactProfile.count({
    where: { companyId: id, status: "active" },
  });
}

export async function listAccountContactIdsForCompanyIds(
  companyIds: string[],
): Promise<string[]> {
  if (companyIds.length === 0) return [];
  const rows = await prisma.contactProfile.findMany({
    where: { companyId: { in: companyIds } },
    select: { accountContactId: true },
  });
  return rows.map((r) => r.accountContactId);
}

export async function listAccountContactIdsForLocationIds(
  locationIds: string[],
): Promise<string[]> {
  if (locationIds.length === 0) return [];
  const rows = await prisma.contactProfile.findMany({
    where: { locationId: { in: locationIds } },
    select: { accountContactId: true },
  });
  return rows.map((r) => r.accountContactId);
}
