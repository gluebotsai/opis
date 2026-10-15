import type { InsightsNarrative, InsightsSnapshot, InsightsResponse } from "../types/insights.js";
declare function priorityClass(priority: string): string;
export declare function fallbackNarrative(snapshot: InsightsSnapshot): InsightsNarrative;
export declare function mergeInsightsResponse(snapshot: InsightsSnapshot, narrative: InsightsNarrative): InsightsResponse;
export declare function enrichRecommendations(narrative: InsightsNarrative): InsightsNarrative;
export { priorityClass };
