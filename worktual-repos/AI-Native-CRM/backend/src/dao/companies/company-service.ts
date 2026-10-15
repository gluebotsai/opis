import type { CompanyChannelRole, LocationType, Prisma } from "@prisma/client";
import {
  clampPage,
  clampPageSize,
  COMPANY_LIST_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  paginatedResult,
  type PaginatedResult,
  type PaginationInput,
} from "@/lib/pagination";
import { prisma } from "@/dao/db/prisma";
import { getCurrentOrganizationId, resolveRequestOrganizationId } from "@/service/auth/require-role";
import { UNOWNED_SCOPE_SENTINEL } from "@/service/auth/ownership-scope";
import {
  companyNameMatchesLinkedinUrl,
  displayCompanyLogoUrl,
  isPlausibleLogoUrl,
  trustedCompanyDomain,
  logoUrlBelongsToCompany,
} from "@/service/ai/lead-enrichment-types";

export type CompanyInput = {
  name: string;
  domain?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  linkedinUrl?: string | null;
  ownerUserId?: string | null;
  organizationId?: string | null;
  channelRole?: CompanyChannelRole | null;
  parentCompanyId?: string | null;
};

export type LocationInput = {
  name: string;
  type: LocationType;
  address?: string | null;
  city?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  ownerUserId?: string | null;
};

/** Pipeline rollup for a company location. */
export type LocationPipelineCounts = {
  leadCount: number;
  dealCount: number;
  customerCount: number;
};

export function pipelineCountsFromStages(
  stages: Array<{ stage: string }>,
): LocationPipelineCounts {
  let leadCount = 0;
  let dealCount = 0;
  let customerCount = 0;
  for (const { stage } of stages) {
    // Qualification+ are deals after convert. Contact leads are counted separately.
    if (stage === "closed_won") customerCount += 1;
    else if (stage !== "closed_lost") dealCount += 1;
  }
  return { leadCount, dealCount, customerCount };
}

export type CompanyListItem = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  locationCount: number;
  logoUrl: string | null;
  createdAt: Date;
  expansionSignal: string | null;
};

/**
 * Scoped company visibility for sales_rep / viewer / marketing.
 * Matches detail access: own companies, unowned pool, and companies linked to
 * contacts or deals the user owns (so assigned leads' companies appear).
 * Fail-closed sentinel keeps the exact-owner-only empty filter.
 */
export function companyOwnerScopeWhere(
  ownerUserId: string | null | undefined,
): Prisma.CompanyWhereInput {
  if (!ownerUserId) return {};
  if (ownerUserId === UNOWNED_SCOPE_SENTINEL) {
    return { ownerUserId };
  }
  return {
    OR: [
      { ownerUserId },
      { ownerUserId: null },
      {
        contactProfiles: {
          some: { ownerUserId },
        },
      },
      {
        deals: {
          some: { ownerUserId },
        },
      },
    ],
  };
}

export async function listCompanies(
  filters: PaginationInput & {
    search?: string;
    /** When set, scope visibility for this user (not exact-owner-only). */
    ownerUserId?: string | null;
    organizationId?: string | null;
  } = {},
): Promise<PaginatedResult<CompanyListItem>> {
  const organizationId = await resolveRequestOrganizationId(
    filters.organizationId,
  );

  // Contact create/update/delete links the company on that write.
  // Older contact company names are backfilled by the company-contact-sync cron,
  // so opening this list only reads one page.

  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize, COMPANY_LIST_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  const where: Prisma.CompanyWhereInput = {
    organizationId,
    ...companyOwnerScopeWhere(filters.ownerUserId),
  };
  if (filters.search?.trim()) {
    const q = filters.search.trim();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { industry: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: pageSize,
      include: {
        _count: { select: { locations: true } },
      },
    }),
  ]);

  const logoById = new Map<string, string | null>();
  if (companies.length) {
    const logoRows = await prisma.$queryRawUnsafe<
      Array<{ id: string; logo_url: string | null }>
    >(
      `SELECT id, logo_url FROM companies WHERE id = ANY($1::text[])`,
      companies.map((c) => c.id),
    );
    for (const row of logoRows) {
      logoById.set(row.id, row.logo_url ?? null);
    }
  }

  const clearLogoIds: string[] = [];
  const clearDomainIds: string[] = [];
  const items = companies.map((company) => {
    const storedLogo = logoById.get(company.id) ?? null;
    const trustedDomain = trustedCompanyDomain(company.name, company.domain);
    if (company.domain && !trustedDomain) clearDomainIds.push(company.id);
    if (
      storedLogo &&
      (!isPlausibleLogoUrl(storedLogo) ||
        !logoUrlBelongsToCompany(company.name, storedLogo, {
          companyDomain: trustedDomain,
        }))
    ) {
      clearLogoIds.push(company.id);
    }
    return {
      id: company.id,
      name: company.name,
      domain: trustedDomain,
      industry: company.industry,
      employeeCount: company.employeeCount,
      locationCount: company._count.locations,
      logoUrl: displayCompanyLogoUrl({
        name: company.name,
        domain: trustedDomain,
        logoUrl: storedLogo,
      }),
      createdAt: company.createdAt,
      expansionSignal: company.expansionSignal,
    };
  });

  if (clearLogoIds.length || clearDomainIds.length) {
    void repairMismatchedCompanyIdentity({
      clearLogoIds,
      clearDomainIds,
    }).catch(() => {});
  }

  return paginatedResult(items, total, page, pageSize);
}

async function repairMismatchedCompanyIdentity(input: {
  clearLogoIds?: string[];
  clearDomainIds?: string[];
  clearLinkedinIds?: string[];
}) {
  const logoIds = input.clearLogoIds ?? [];
  const domainIds = input.clearDomainIds ?? [];
  const linkedinIds = input.clearLinkedinIds ?? [];
  if (logoIds.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE companies SET logo_url = NULL, updated_at = NOW() WHERE id = ANY($1::text[])`,
      logoIds,
    );
  }
  if (domainIds.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE companies SET domain = NULL, updated_at = NOW() WHERE id = ANY($1::text[])`,
      domainIds,
    );
  }
  if (linkedinIds.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE companies SET linkedin_url = NULL, updated_at = NOW() WHERE id = ANY($1::text[])`,
      linkedinIds,
    );
  }
}

export async function getCompany(
  id: string,
  options?: { dealOwnerUserId?: string | null },
) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      locations: {
        orderBy: [{ type: "asc" }, { name: "asc" }],
        include: {
          deals: {
            where: options?.dealOwnerUserId
              ? { ownerUserId: options.dealOwnerUserId }
              : undefined,
            select: { stage: true, contactId: true, ownerUserId: true },
          },
        },
      },
    },
  });
  if (!company) return null;
  const liRows = await prisma.$queryRawUnsafe<
    Array<{ linkedin_url: string | null; logo_url: string | null }>
  >(
    `SELECT linkedin_url, logo_url FROM companies WHERE id = $1 LIMIT 1`,
    id,
  );
  const storedLinkedin = liRows[0]?.linkedin_url ?? null;
  const storedLogo = liRows[0]?.logo_url ?? null;
  const trustedDomain = trustedCompanyDomain(company.name, company.domain);
  const trustedLinkedin = companyNameMatchesLinkedinUrl(
    company.name,
    storedLinkedin,
  )
    ? storedLinkedin
    : null;
  const logoUrl = displayCompanyLogoUrl({
    name: company.name,
    domain: trustedDomain,
    logoUrl: storedLogo,
  });
  const clearLogo =
    Boolean(storedLogo) &&
    (!isPlausibleLogoUrl(storedLogo) ||
      !logoUrlBelongsToCompany(company.name, storedLogo, {
        companyDomain: trustedDomain,
      }));
  const clearDomain = Boolean(company.domain) && !trustedDomain;
  const clearLinkedin = Boolean(storedLinkedin) && !trustedLinkedin;
  if (clearLogo || clearDomain || clearLinkedin) {
    await repairMismatchedCompanyIdentity({
      clearLogoIds: clearLogo ? [company.id] : [],
      clearDomainIds: clearDomain ? [company.id] : [],
      clearLinkedinIds: clearLinkedin ? [company.id] : [],
    }).catch(() => {});
  }
  return {
    ...company,
    domain: trustedDomain,
    linkedinUrl: trustedLinkedin,
    logoUrl,
  };
}

export async function createCompany(input: CompanyInput) {
  const channelRole = input.channelRole?.trim()
    ? (input.channelRole as CompanyChannelRole)
    : "standard";
  const parentCompanyId = input.parentCompanyId?.trim() || null;
  const company = await prisma.company.create({
    data: {
      organizationId: await resolveRequestOrganizationId(input.organizationId),
      name: input.name.trim(),
      domain: input.domain?.trim() || null,
      industry: input.industry?.trim() || null,
      employeeCount: input.employeeCount ?? null,
      ownerUserId: input.ownerUserId || null,
      channelRole,
      parentCompanyId,
    },
  });
  const linkedinUrl = input.linkedinUrl?.trim() || null;
  if (linkedinUrl) {
    await prisma.$executeRawUnsafe(
      `UPDATE companies SET linkedin_url = $2, updated_at = NOW() WHERE id = $1`,
      company.id,
      linkedinUrl,
    );
  }
  return { ...company, linkedinUrl };
}

/** Create company and its first location in one step. */
export async function createCompanyWithLocation(
  companyInput: CompanyInput,
  locationInput: LocationInput,
) {
  return prisma.$transaction(async (tx) => {
    const channelRole = companyInput.channelRole?.trim()
      ? (companyInput.channelRole as CompanyChannelRole)
      : "standard";
    const parentCompanyId = companyInput.parentCompanyId?.trim() || null;
    const company = await tx.company.create({
      data: {
        organizationId: await resolveRequestOrganizationId(companyInput.organizationId),
        name: companyInput.name.trim(),
        domain: companyInput.domain?.trim() || null,
        industry: companyInput.industry?.trim() || null,
        employeeCount: companyInput.employeeCount ?? null,
        ownerUserId: companyInput.ownerUserId || null,
        channelRole,
        parentCompanyId,
      },
    });

    const linkedinUrl = companyInput.linkedinUrl?.trim() || null;
    if (linkedinUrl) {
      await tx.$executeRawUnsafe(
        `UPDATE companies SET linkedin_url = $2, updated_at = NOW() WHERE id = $1`,
        company.id,
        linkedinUrl,
      );
    }

    const location = await tx.companyLocation.create({
      data: {
        organizationId: company.organizationId,
        companyId: company.id,
        name: locationInput.name.trim(),
        type: locationInput.type,
        address: locationInput.address?.trim() || null,
        city: locationInput.city?.trim() || null,
        industry:
          locationInput.industry?.trim() ||
          companyInput.industry?.trim() ||
          null,
        employeeCount: locationInput.employeeCount ?? null,
        ownerUserId:
          locationInput.ownerUserId || companyInput.ownerUserId || null,
      },
    });

    return { company: { ...company, linkedinUrl }, location };
  });
}

export async function updateCompany(id: string, input: CompanyInput) {
  const company = await prisma.company.update({
    where: { id },
    data: {
      name: input.name.trim(),
      domain: input.domain?.trim() || null,
      industry: input.industry?.trim() || null,
      employeeCount: input.employeeCount ?? null,
      ...(input.ownerUserId !== undefined
        ? { ownerUserId: input.ownerUserId || null }
        : {}),
      ...(input.channelRole !== undefined
        ? {
            channelRole: (input.channelRole?.trim() ||
              "standard") as CompanyChannelRole,
          }
        : {}),
      ...(input.parentCompanyId !== undefined
        ? { parentCompanyId: input.parentCompanyId?.trim() || null }
        : {}),
    },
  });
  const linkedinUrl = input.linkedinUrl?.trim() || null;
  await prisma.$executeRawUnsafe(
    `UPDATE companies SET linkedin_url = $2, updated_at = NOW() WHERE id = $1`,
    id,
    linkedinUrl,
  );
  return { ...company, linkedinUrl };
}

export async function deleteCompany(id: string) {
  await prisma.company.delete({ where: { id } });
}

export async function getLocation(companyId: string, locationId: string) {
  const location = await prisma.companyLocation.findFirst({
    where: { id: locationId, companyId },
    include: {
      company: true,
      deals: {
        orderBy: { updatedAt: "desc" },
        take: DEFAULT_PAGE_SIZE,
      },
      _count: { select: { deals: true } },
    },
  });
  return location;
}

/** Full pipeline rollup for one location (not limited to the list page size). */
export async function getLocationPipelineCounts(
  locationId: string,
): Promise<LocationPipelineCounts> {
  const rows = await prisma.deal.groupBy({
    by: ["stage"],
    where: { locationId },
    _count: { _all: true },
  });

  let leadCount = 0;
  let dealCount = 0;
  let customerCount = 0;
  for (const row of rows) {
    const n = row._count._all;
    if (row.stage === "closed_won") customerCount += n;
    else if (row.stage !== "closed_lost") dealCount += n;
  }
  return { leadCount, dealCount, customerCount };
}

export async function createLocation(companyId: string, input: LocationInput) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { organizationId: true },
  });
  if (!company) throw new Error("Company not found.");

  if (input.type === "hq") {
    const existingHq = await prisma.companyLocation.findFirst({
      where: { companyId, type: "hq" },
      select: { id: true },
    });
    if (existingHq) {
      throw new Error("This company already has an HQ. Add a Branch instead.");
    }
  }

  return prisma.companyLocation.create({
    data: {
      organizationId: company.organizationId,
      companyId,
      name: input.name.trim(),
      type: input.type,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      industry: input.industry?.trim() || null,
      employeeCount: input.employeeCount ?? null,
      ownerUserId: input.ownerUserId || null,
    },
  });
}

export async function updateLocation(
  companyId: string,
  locationId: string,
  input: LocationInput,
) {
  const existing = await prisma.companyLocation.findFirst({
    where: { id: locationId, companyId },
  });
  if (!existing) throw new Error("Location not found.");

  if (input.type === "hq") {
    const otherHq = await prisma.companyLocation.findFirst({
      where: {
        companyId,
        type: "hq",
        NOT: { id: locationId },
      },
      select: { id: true },
    });
    if (otherHq) {
      throw new Error("This company already has an HQ.");
    }
  }

  return prisma.companyLocation.update({
    where: { id: locationId },
    data: {
      name: input.name.trim(),
      type: input.type,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      industry: input.industry?.trim() || null,
      employeeCount: input.employeeCount ?? null,
      ...(input.ownerUserId !== undefined
        ? { ownerUserId: input.ownerUserId || null }
        : {}),
    },
  });
}

export async function deleteLocation(companyId: string, locationId: string) {
  const existing = await prisma.companyLocation.findFirst({
    where: { id: locationId, companyId },
  });
  if (!existing) throw new Error("Location not found.");
  await prisma.companyLocation.delete({ where: { id: locationId } });
}

const MAX_SELECT = 500;

/** Lightweight select for forms — capped + owner-scoped for sales_rep. */
export async function listCompaniesForSelect(options?: {
  limit?: number;
  ownerUserId?: string | null;
}) {
  const limit = Math.min(options?.limit ?? MAX_SELECT, MAX_SELECT);
  let ownerUserId = options?.ownerUserId;
  if (ownerUserId === undefined) {
    const { resolveRecordOwnerScope } = await import(
      "@/service/auth/ownership-scope"
    );
    ownerUserId = (await resolveRecordOwnerScope()).ownerUserId;
  }
  return prisma.company.findMany({
    where: {
      organizationId: await getCurrentOrganizationId(),
      ...companyOwnerScopeWhere(ownerUserId),
    },
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      industry: true,
      ownerUserId: true,
      locations: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true, ownerUserId: true },
      },
    },
  });
}
