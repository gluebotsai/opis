import type { AppPrismaClient } from "../plugins/prisma.js";
import { type OrganizationBusinessType } from "../utils/organizationBusinessType.js";
export type OrgDashboardSite = {
    siteType: string;
    features: Record<string, boolean>;
    businessType: OrganizationBusinessType | null;
};
export declare function resolveOrgDashboardSite(prisma: AppPrismaClient, organizationId: number | null | undefined, fallbackSiteType: string): Promise<OrgDashboardSite>;
export declare function overlayWebsiteSiteTypes<T extends {
    site_type: string;
}>(websites: T[], orgSiteType: string, businessType: OrganizationBusinessType | null): T[];
