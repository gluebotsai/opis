import type { OrganizationBusinessType } from "./organizationBusinessType.js";
import {
  B2B_PAGE_PATH_SQL,
  B2C_PAGE_PATH_SQL,
  type VisitorAudience,
} from "./visitorAudienceClassifier.js";

/** Consumer / personal email domains (BA: B2C identification). */
export const FREE_CONSUMER_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "msn.com",
];

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
export function pageEngagementPathFilter(siteProfile: SegmentationSiteProfile): string {
  if (siteProfile === "b2b") {
    return ` AND match(lower(page_path), '${B2B_PAGE_PATH_SQL}')`;
  }
  if (siteProfile === "b2c") {
    return ` AND match(lower(page_path), '${B2C_PAGE_PATH_SQL}')`;
  }
  return "";
}

const B2B_PROFILE: Omit<SegmentationProfileDefinition, "organization_business_type"> = {
  site_profile: "b2b",
  panel_subtitle:
    "Segmentation for the selected website in this period (account, conversion, interaction, engagement).",
  account_behaviour_labels: {
    anonymous: "Anonymous",
    logged_in: "Logged-in",
    logged_out: "Identified / account-mapped",
  },
  page_engagement_title: "Page engagement",
  interaction_behaviour_title: "Interaction behaviour",
  intent_level_hint:
    "This website only: purchase → High; else session depth/duration, email/company, and pricing/demo paths in the period.",
  page_engagement_hint:
    "This website only: threshold from peak views on pricing, demo, and enterprise paths on this site (not other sites in the org).",
  include_form_metrics: false,
  primary_audience_segments: ["B2B", "Hybrid", "Generic"],
};

const B2C_PROFILE: Omit<SegmentationProfileDefinition, "organization_business_type"> = {
  site_profile: "b2c",
  panel_subtitle:
    "Segmentation for the selected website in this period (account, conversion, interaction, engagement).",
  account_behaviour_labels: {
    anonymous: "Anonymous",
    logged_in: "Logged-in",
    logged_out: "Logged-in (known visitor)",
  },
  page_engagement_title: "Page engagement",
  interaction_behaviour_title: "Interaction behaviour",
  intent_level_hint:
    "This website only: purchase or form submit → High; else session depth/duration, product/cart paths, and consumer signals in the period.",
  page_engagement_hint:
    "This website only: threshold from peak views on product, cart, and checkout paths on this site (not other sites in the org).",
  include_form_metrics: true,
  primary_audience_segments: ["B2C", "Hybrid", "Generic"],
};

const DEFAULT_PROFILE: Omit<SegmentationProfileDefinition, "organization_business_type"> = {
  site_profile: "default",
  panel_subtitle:
    "Segmentation for the selected website in this period. Set organization business_type in PostgreSQL for B2B/B2C path rules.",
  account_behaviour_labels: {
    anonymous: "Anonymous",
    logged_in: "Logged-in",
    logged_out: "Logged-out",
  },
  page_engagement_title: "Page engagement",
  interaction_behaviour_title: "Interaction behaviour",
  intent_level_hint:
    "This website only: purchase or form submit → High; else session engagement and on-site behaviour in the period.",
  page_engagement_hint:
    "This website only: threshold from peak page views on this site (all paths).",
  include_form_metrics: true,
  primary_audience_segments: ["B2B", "B2C", "Hybrid", "Generic"],
};

/** Resolve dashboard segmentation profile from accounts.organizations.business_type. */
export function getSegmentationProfile(
  businessType: OrganizationBusinessType | null,
): SegmentationProfileDefinition {
  if (businessType === "B2B") {
    return { organization_business_type: "B2B", ...B2B_PROFILE };
  }
  if (businessType === "B2C") {
    return { organization_business_type: "B2C", ...B2C_PROFILE };
  }
  return { organization_business_type: null, ...DEFAULT_PROFILE };
}

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
export function validateSegmentationAgainstOrgProfile(
  businessType: OrganizationBusinessType | null,
  audience: AudienceBreakdown,
): SegmentationValidationIssue[] {
  const issues: SegmentationValidationIssue[] = [];
  const total =
    (audience.B2B ?? 0) +
    (audience.B2C ?? 0) +
    (audience.Hybrid ?? 0) +
    (audience.Generic ?? 0);
  if (total <= 0) {
    issues.push({
      code: "no_audience_data",
      message: "No active visitors in period to classify.",
      severity: "info",
    });
    return issues;
  }

  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  const genericPct = pct(audience.Generic ?? 0);
  const b2bPct = pct(audience.B2B ?? 0);
  const b2cPct = pct(audience.B2C ?? 0);
  const hybridPct = pct(audience.Hybrid ?? 0);

  if (!businessType) {
    issues.push({
      code: "missing_org_business_type",
      message:
        "Organization business_type is not set (PostgreSQL accounts.organizations). Using generic BA labels.",
      severity: "info",
    });
    return issues;
  }

  if (businessType === "B2B") {
    if (b2cPct > 45 && b2cPct > b2bPct + hybridPct) {
      issues.push({
        code: "b2b_org_consumer_heavy",
        message: `B2B organization but ${b2cPct}% of visitors classify as B2C — check mixed storefront or Hybrid rules.`,
        severity: "warning",
      });
    }
    if (genericPct > 60) {
      issues.push({
        code: "b2b_org_mostly_generic",
        message: `${genericPct}% Generic — add identify/company traits or pricing/demo tracking for clearer B2B signals.`,
        severity: "warning",
      });
    }
  }

  if (businessType === "B2C") {
    if (b2bPct + hybridPct > 40 && b2bPct > b2cPct) {
      issues.push({
        code: "b2c_org_b2b_heavy",
        message: `B2C organization but ${b2bPct + hybridPct}% B2B/Hybrid — work emails or enterprise pages may dominate.`,
        severity: "warning",
      });
    }
  }

  if (hybridPct >= 15) {
    issues.push({
      code: "hybrid_share",
      message: `${hybridPct}% Hybrid (both B2B and B2C signals) — expected for mixed buying journeys.`,
      severity: "info",
    });
  }

  return issues;
}

/** ClickHouse `IN (...)` list for consumer email domains. */
export function clickhouseConsumerDomainInList(): string {
  return FREE_CONSUMER_EMAIL_DOMAINS.map((d) => `'${d}'`).join(", ");
}
