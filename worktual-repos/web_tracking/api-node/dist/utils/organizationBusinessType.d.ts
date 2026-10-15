/** Maps accounts.organizations.business_type (B2C / B2B) to dashboard site type. */
export type OrganizationBusinessType = "B2C" | "B2B";
export declare function normalizeBusinessType(raw: string | null | undefined): OrganizationBusinessType | null;
/** Profile Site Type: B2C → ecommerce, B2B → b2b. */
export declare function siteTypeFromBusinessType(businessType: OrganizationBusinessType): "ecommerce" | "b2b";
export declare function applyOrgSiteTypeToWebsites<T extends {
    site_type: string;
}>(websites: T[], orgSiteType: string | null): T[];
