export declare const SEARCH_ENGINES: Record<string, string>;
export declare const SOCIAL_NETWORKS: Record<string, string>;
export declare const PAID_MEDIUMS: Set<string>;
export declare const EMAIL_MEDIUMS: Set<string>;
export declare const AFFILIATE_MEDIUMS: Set<string>;
export declare const DISPLAY_MEDIUMS: Set<string>;
export declare const SOCIAL_MEDIUMS: Set<string>;
export declare const CHANNEL_LABELS: Record<string, string>;
export declare const CARD_CHANNELS: readonly ["direct", "organic_search", "referral", "social", "paid_search"];
export declare const DISPLAY_CHANNELS: readonly ["direct", "organic_search", "referral", "social", "paid_search", "email", "other"];
export interface TrafficSourceSessionRow {
    session_id: string;
    visitor_id: string;
    referrer?: string | null;
    referrer_domain?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    pageview_count?: number | null;
    duration_seconds?: number | null;
    conversions?: number | null;
}
export declare function classifyChannel(referrer: string | null | undefined, referrerDomain: string | null | undefined, utmSource: string | null | undefined, utmMedium: string | null | undefined, _utmCampaign?: string | null): string;
export declare function displayChannel(channel: string): string;
export declare function sourceLabel(referrer: string | null | undefined, referrerDomain: string | null | undefined, utmSource: string | null | undefined, utmMedium: string | null | undefined, _utmCampaign: string | null | undefined, channel: string): string;
export declare function aggregateTrafficSources(rows: TrafficSourceSessionRow[]): {
    total_visitors: number;
    total_sessions: number;
    channel_cards: {
        channel: "social" | "direct" | "organic_search" | "referral" | "paid_search";
        label: string;
        visitors: number;
        sessions: number;
        percentage: number;
    }[];
    channels: {
        source: string;
        channel: "other" | "email" | "social" | "direct" | "organic_search" | "referral" | "paid_search";
        visitors: number;
        sessions: number;
        percentage: number;
    }[];
    chart: {
        source: string;
        channel: "other" | "email" | "social" | "direct" | "organic_search" | "referral" | "paid_search";
        visitors: number;
        sessions: number;
        percentage: number;
    }[];
    sources: {
        source: string;
        channel: string;
        visitors: number;
        sessions: number;
        conversions: number;
        bounce_rate: number;
    }[];
};
