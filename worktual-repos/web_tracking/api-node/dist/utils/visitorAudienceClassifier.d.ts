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
export declare function scoreAudienceSignals(signals: VisitorAudienceSignals): {
    b2b: number;
    b2c: number;
};
/**
 * If at least one B2B and one B2C signal → Hybrid unless one side clearly dominates.
 */
export declare function classifyVisitorAudience(signals: VisitorAudienceSignals): VisitorAudience;
export declare function classifyVisitorIntent(audience: VisitorAudience, signals: VisitorAudienceSignals, engagementLevel?: "low" | "medium" | "high"): VisitorIntentLevel;
/** Path heuristics aligned with BA doc (pricing, demo, product, cart, etc.). */
export declare const B2B_PAGE_PATH_SQL = "pricing|/demo|contact[-_]?sales|enterprise|documentation|/docs|request[-_]?demo|book[-_]?demo";
export declare const B2C_PAGE_PATH_SQL = "/product|/products|/cart|checkout|/category|/shop|add[-_]?to[-_]?cart|collection";
export declare const B2B_PAGE_PATH_REGEX: RegExp;
export declare const B2C_PAGE_PATH_REGEX: RegExp;
export declare const LOW_VALUE_INFO_PATH_REGEX: RegExp;
export declare function pathMatchesB2bIntent(pagePath: string): boolean;
export declare function pathMatchesB2cIntent(pagePath: string): boolean;
