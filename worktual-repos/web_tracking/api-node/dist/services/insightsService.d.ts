import type { InsightsNarrative, InsightsSnapshot } from "../types/insights.js";
export declare function fetchInsightsNarrative(snapshot: InsightsSnapshot, tenant?: {
    organizationId?: number | null;
    userId?: number | null;
}): Promise<InsightsNarrative>;
