/** Maps accounts.organizations.business_type (B2C / B2B) to dashboard site type. */
export function normalizeBusinessType(raw) {
    const value = String(raw ?? "").trim().toUpperCase();
    if (value === "B2C")
        return "B2C";
    if (value === "B2B")
        return "B2B";
    return null;
}
/** Profile Site Type: B2C → ecommerce, B2B → b2b. */
export function siteTypeFromBusinessType(businessType) {
    return businessType === "B2C" ? "ecommerce" : "b2b";
}
export function applyOrgSiteTypeToWebsites(websites, orgSiteType) {
    if (!orgSiteType)
        return websites;
    return websites.map((row) => ({ ...row, site_type: orgSiteType }));
}
