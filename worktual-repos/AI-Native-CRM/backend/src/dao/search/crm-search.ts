import { prisma } from "@/dao/db/prisma";
import { companyOwnerScopeWhere } from "@/dao/companies/company-service";
import { resolveRecordOwnerScope } from "@/service/auth/ownership-scope";
import {
  getCurrentBusinessType,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import { isModuleEnabledForType } from "@/config/modules";

export type SearchResult = {
  contacts: Array<{ id: string; name: string; email: string }>;
  companies: Array<{ id: string; name: string; industry: string | null }>;
  deals: Array<{
    id: string;
    title: string;
    stage: string;
    amount: unknown;
  }>;
};

/**
 * Org-scoped search for contacts (account DB) and companies/deals (crm DB).
 * Respects business-type module gating, contact tags, and ownership.
 */
export async function searchCrm(
  query: string,
  organizationId?: string | null,
): Promise<SearchResult> {
  const q = query.trim();
  if (!q || q.length < 2) {
    return { contacts: [], companies: [], deals: [] };
  }

  const [orgId, businessType, scope] = await Promise.all([
    resolveRequestOrganizationId(organizationId),
    getCurrentBusinessType(),
    resolveRecordOwnerScope(),
  ]);
  const take = 12;

  const includeCompanies = isModuleEnabledForType("company", businessType);
  const includeDeals = isModuleEnabledForType("sales", businessType);

  const { listContacts } = await import("@/dao/contacts/contact-service");

  const [contactsPage, companies, deals] = await Promise.all([
    listContacts({
      search: q,
      ownerUserId: scope.ownerUserId ?? undefined,
      channelCompanyIds: scope.channelCompanyIds,
      page: 1,
      pageSize: take,
    }),
    includeCompanies
      ? prisma.company.findMany({
          where: {
            organizationId: orgId,
            ...companyOwnerScopeWhere(scope.ownerUserId),
            AND: [
              {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { industry: { contains: q, mode: "insensitive" } },
                ],
              },
            ],
          },
          take,
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, industry: true },
        })
      : Promise.resolve([]),
    includeDeals
      ? prisma.deal.findMany({
          where: {
            organizationId: orgId,
            ...(scope.ownerUserId
              ? { ownerUserId: scope.ownerUserId }
              : {}),
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { contactEmail: { contains: q, mode: "insensitive" } },
            ],
          },
          take,
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, stage: true, amount: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    contacts: contactsPage.items.map((c) => ({
      id: c.id,
      name: c.displayName,
      email: c.person.email,
    })),
    companies,
    deals,
  };
}
