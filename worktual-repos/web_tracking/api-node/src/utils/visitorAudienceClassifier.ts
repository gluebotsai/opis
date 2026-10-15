/**
 * Visitor audience classification (B2B / B2C / Hybrid / Generic) per BA "B2B segment" PDF.
 * Pure functions — used by ClickHouse post-processing and unit tests.
 */

export type VisitorAudience = "B2B" | "B2C" | "Hybrid" | "Generic";

export type VisitorAudienceSignals = {
  workEmail?: boolean;
  personalEmail?: boolean;
  companyIdentified?: boolean;
  multiVisitorCompanyDomain?: boolean;
  loggedIn?: boolean;
  b2bHighValuePageViews?: number;
  b2cHighValuePageViews?: number;
  leadOrDemoForm?: boolean;
  addToCart?: boolean;
  purchase?: boolean;
};

export type VisitorIntentLevel = "Low" | "Medium" | "High";

export function scoreAudienceSignals(signals: VisitorAudienceSignals): { b2b: number; b2c: number } {
  let b2b = 0;
  let b2c = 0;

  if (signals.workEmail) b2b += 2;
  if (signals.personalEmail) b2c += 2;
  if (signals.companyIdentified) b2b += 2;
  if (signals.multiVisitorCompanyDomain) b2b += 1;
  if (signals.loggedIn) {
    b2b += 1;
    b2c += 1;
  }

  b2b += Math.min(Math.max(0, signals.b2bHighValuePageViews ?? 0), 3);
  b2c += Math.min(Math.max(0, signals.b2cHighValuePageViews ?? 0), 3);

  if (signals.leadOrDemoForm) b2b += 2;
  if (signals.addToCart) b2c += 2;
  if (signals.purchase) b2c += 3;

  return { b2b, b2c };
}

/**
 * If at least one B2B and one B2C signal → Hybrid unless one side clearly dominates.
 */
export function classifyVisitorAudience(signals: VisitorAudienceSignals): VisitorAudience {
  const { b2b, b2c } = scoreAudienceSignals(signals);
  if (b2b === 0 && b2c === 0) return "Generic";
  if (b2b >= 1 && b2c >= 1) {
    if (b2b > b2c) return "B2B";
    if (b2c > b2b) return "B2C";
    return "Hybrid";
  }
  if (b2b >= 1) return "B2B";
  return "B2C";
}

export function classifyVisitorIntent(
  audience: VisitorAudience,
  signals: VisitorAudienceSignals,
  engagementLevel?: "low" | "medium" | "high",
): VisitorIntentLevel {
  if (signals.purchase || signals.leadOrDemoForm) return "High";
  if (audience === "Generic" && (engagementLevel ?? "low") === "low") return "Low";
  if (engagementLevel === "high") return "High";
  if (audience === "Generic") return "Low";
  const { b2b, b2c } = scoreAudienceSignals(signals);
  if (b2b + b2c >= 4) return "High";
  if (b2b + b2c >= 2) return "Medium";
  return "Low";
}

/** Path heuristics aligned with BA doc (pricing, demo, product, cart, etc.). */
export const B2B_PAGE_PATH_SQL =
  "pricing|/demo|contact[-_]?sales|enterprise|documentation|/docs|request[-_]?demo|book[-_]?demo";

export const B2C_PAGE_PATH_SQL =
  "/product|/products|/cart|checkout|/category|/shop|add[-_]?to[-_]?cart|collection";

export const B2B_PAGE_PATH_REGEX = new RegExp(B2B_PAGE_PATH_SQL, "i");

export const B2C_PAGE_PATH_REGEX = new RegExp(B2C_PAGE_PATH_SQL, "i");

export const LOW_VALUE_INFO_PATH_REGEX =
  /^\/$|\/home|\/about|\/blog|\/news|\/privacy|\/terms/i;

export function pathMatchesB2bIntent(pagePath: string): boolean {
  return B2B_PAGE_PATH_REGEX.test(pagePath);
}

export function pathMatchesB2cIntent(pagePath: string): boolean {
  return B2C_PAGE_PATH_REGEX.test(pagePath);
}
