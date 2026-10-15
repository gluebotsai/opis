import { getOrganizationBusinessType } from "../repositories/postgres/organizationBusinessType.js";
import { resolveDashboardFeatures } from "../utils/dashboardFeatures.js";
import { applyOrgSiteTypeToWebsites, siteTypeFromBusinessType, } from "../utils/organizationBusinessType.js";
export async function resolveOrgDashboardSite(prisma, organizationId, fallbackSiteType) {
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
export function overlayWebsiteSiteTypes(websites, orgSiteType, businessType) {
    if (!businessType)
        return websites;
    return applyOrgSiteTypeToWebsites(websites, orgSiteType);
}
