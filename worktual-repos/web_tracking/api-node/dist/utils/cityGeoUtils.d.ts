/** Normalize reverse-geocode / IP city labels (mirrors etl/ingest/city_normalize.py). */
export declare function normalizeCityName(value: unknown): string | null;
export declare function resolveDisplayCity(options: {
    primary?: unknown;
    locality?: unknown;
    stateDistrict?: unknown;
    ipCity?: unknown;
}): string | null;
export declare function resolveCityForSession(sessionRow: Record<string, unknown> | null | undefined, geo: Record<string, unknown> | null): string;
