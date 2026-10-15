export declare function maskIp(ip: string | null | undefined): string | null;
export declare function ipFromGeoData(geoData: unknown): string | null;
export declare function formatBrowserLabel(browser: string | null | undefined, version: string | null | undefined): string | null;
export declare function buildDeviceSummary(sessionRow: Record<string, unknown> | null | undefined): {
    browser: string | null;
    browser_version: string | null;
    browser_label: string | null;
    os: string | null;
    device: string | null;
    language: string | null;
    timezone: string | null;
    user_agent: string | null;
};
export declare function buildLocationSummary(sessionRow: Record<string, unknown> | null | undefined, visitorCountry?: string | null): {
    country: string | null;
    country_name: string | null;
    city: string;
    region: string | null;
    ip_masked: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    location_source: "gps" | "ip" | null;
    location_source_label: string | null;
    accuracy_meters: number | null;
    altitude: number | null;
    accuracy_note: string;
};
export declare function buildVisitorTrafficSource(sessions: Record<string, unknown>[], journey?: {
    page_path?: string;
}[], topPages?: {
    page_path?: string;
}[]): {
    channel: string;
    channel_label: string;
    source_label: string;
    referrer: string | null;
    referrer_domain: string | null;
    landing_page: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
    utm_captured: boolean;
    utm_note: string | null;
};
/** Journey step shape returned from ClickHouse. */
export interface JourneyStep {
    page_path?: string;
    page_title?: string;
    created_at?: string;
}
/**
 * Collapse rapid re-tracking of the same page (new session / duplicate events within ~2 minutes).
 * Keeps distinct revisits when the visitor navigates away and returns later.
 */
export declare function collapseJourneySteps(steps: JourneyStep[]): JourneyStep[];
