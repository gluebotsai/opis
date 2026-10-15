export declare const COUNTRY_NAMES: Record<string, string>;
export declare function countryName(code: string | null | undefined): string;
export interface GeographySessionRow {
    session_id: string;
    visitor_id: string;
    country?: string | null;
    city?: string | null;
    region?: string | null;
}
export declare function aggregateGeography(rows: GeographySessionRow[]): {
    total_sessions: number;
    total_visitors: number;
    map: {
        country: string;
        country_code: string;
        country_name: string;
        visitors: number;
        sessions: number;
    }[];
    countries: {
        percentage: number;
        country_code: string;
        country: string;
        visitors: number;
        sessions: number;
    }[];
    cities: {
        percentage: number;
        city: string;
        country_code: string;
        country: string;
        visitors: number;
        sessions: number;
    }[];
};
