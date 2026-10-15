import type { OrganizationBusinessType } from "./organizationBusinessType.js";
import { type VisitorAudience } from "./visitorAudienceClassifier.js";
/** Consumer / personal email domains (BA: B2C identification). */
export declare const FREE_CONSUMER_EMAIL_DOMAINS: readonly string[];
export type SegmentationSiteProfile = "b2b" | "b2c" | "default";
export type SegmentationProfileDefinition = {
    organization_business_type: OrganizationBusinessType | null;
    site_profile: SegmentationSiteProfile;
    panel_subtitle: string;
    account_behaviour_labels: {
        anonymous: string;
        logged_in: string;
        logged_out: string;
    };
    page_engagement_title: string;
    interaction_behaviour_title: string;
    intent_level_hint: string;
    page_engagement_hint: string;
    /** B2B orgs: no Forms nav or form metrics in segmentation. */
    include_form_metrics: boolean;
    /** BA doc: which visitor audience labels are primary for this org. */
    primary_audience_segments: VisitorAudience[];
};
/** ClickHouse filter: page views for page-engagement on this website only (not org-wide). */
export declare function pageEngagementPathFilter(siteProfile: SegmentationSiteProfile): string;
/** Resolve dashboard segmentation profile from accounts.organizations.business_type. */
export declare function getSegmentationProfile(businessType: OrganizationBusinessType | null): SegmentationProfileDefinition;
export type SegmentationValidationIssue = {
    code: string;
    message: string;
    severity: "info" | "warning";
};
export type AudienceBreakdown = Partial<Record<VisitorAudience, number>>;
/**
 * Validates that visitor audience mix is plausible for the org business_type from PostgreSQL.
 * Does not block API responses — surfaces BA alignment hints for the dashboard.
 */
export declare function validateSegmentationAgainstOrgProfile(businessType: OrganizationBusinessType | null, audience: AudienceBreakdown): SegmentationValidationIssue[];
/** ClickHouse `IN (...)` list for consumer email domains. */
export declare function clickhouseConsumerDomainInList(): string;
