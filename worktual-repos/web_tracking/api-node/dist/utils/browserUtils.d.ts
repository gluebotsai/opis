export declare const BROWSER_ORDER: readonly ["Chrome", "Edge", "Firefox", "Safari", "Opera", "Other"];
export declare function parseBrowser(userAgent: string | null | undefined): string;
export interface BrowserSessionRow {
    session_id: string;
    visitor_id: string;
    user_agent?: string | null;
}
export declare function aggregateBrowsers(rows: BrowserSessionRow[]): {
    total_sessions: number;
    total_visitors: number;
    chart: {
        percentage: number;
        browser: "Chrome" | "Edge" | "Firefox" | "Safari" | "Opera" | "Other";
        visitors: number;
        sessions: number;
    }[];
    browsers: {
        percentage: number;
        browser: "Chrome" | "Edge" | "Firefox" | "Safari" | "Opera" | "Other";
        visitors: number;
        sessions: number;
    }[];
};
