export interface TouchAttribution {
    channel: string;
    channel_label: string;
    source_label: string;
    referrer: string | null;
    referrer_domain: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
    click_id: string | null;
    click_id_type: string | null;
    captured_at: string | null;
    has_attribution: boolean;
}
export interface HybridTouchAttribution {
    model: "hybrid";
    same_channel: boolean;
    same_source: boolean;
    path_label: string;
    first_channel_label: string;
    last_channel_label: string;
    note: string | null;
}
export interface SourceJourneyStep {
    source_label: string;
    channel_label: string;
    session_count: number;
}
export interface SourceJourney {
    steps: SourceJourneyStep[];
    path_label: string;
}
export interface VisitorTouchAttribution {
    first_touch: TouchAttribution;
    last_touch: TouchAttribution;
    hybrid_touch: HybridTouchAttribution;
    source_journey: SourceJourney;
    source: "campaign_profile" | "session_fallback" | "mixed";
}
export declare function buildTouchFromRecord(input: Record<string, unknown> | null | undefined): TouchAttribution;
export declare function buildTouchFromSession(session: Record<string, unknown> | null | undefined): TouchAttribution;
export declare function buildSourceJourney(sessions: Record<string, unknown>[]): SourceJourney;
export declare function buildHybridTouch(firstTouch: TouchAttribution, lastTouch: TouchAttribution): HybridTouchAttribution;
export declare function buildSessionChannelMix(sessions: Record<string, unknown>[]): {
    channel: string;
    channel_label: string;
    sessions: number;
}[];
export declare function enrichSessionsWithTouch<T extends Record<string, unknown>>(sessions: T[]): (T & {
    touch: TouchAttribution;
    bounce_page: string;
})[];
export declare function buildVisitorTouchAttribution(campaignJson: unknown, sessions: Record<string, unknown>[]): VisitorTouchAttribution;
