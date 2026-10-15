import type { AppPrismaClient } from "../plugins/prisma.js";
import { getOrganizationBusinessType } from "../repositories/postgres/organizationBusinessType.js";
import { resolveDashboardFeatures } from "../utils/dashboardFeatures.js";
import {
  applyOrgSiteTypeToWebsites,
  siteTypeFromBusinessType,
  type OrganizationBusinessType,
} from "../utils/organizationBusinessType.js";

export type OrgDashboardSite = {
  siteType: string;
  features: Record<string, boolean>;
  businessType: OrganizationBusinessType | null;
};

export async function resolveOrgDashboardSite(
  prisma: AppPrismaClient,
  organizationId: number | null | undefined,
  fallbackSiteType: string,
): Promise<OrgDashboardSite> {
  const businessType = await getOrganizationBusinessType(prisma, organizationId);
  const siteType = businessType
    ? siteTypeFromBusinessType(businessType)
    : fallbackSiteType || "blog";
  return {
    siteType,
    features: resolveDashboardFeatures(siteType),
    businessType,
  };
}

export function overlayWebsiteSiteTypes<T extends { site_type: string }>(
  websites: T[],
  orgSiteType: string,
  businessType: OrganizationBusinessType | null,
): T[] {
  if (!businessType) return websites;
  return applyOrgSiteTypeToWebsites(websites, orgSiteType);
}
