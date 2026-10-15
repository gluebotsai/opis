import { cacheGet, cacheSet } from "../plugins/redis.js";

const VERSION_TTL_SECONDS = 60 * 60;
const SERIES_CACHE_TTL_SECONDS = 25;

function versionKey(orgId: string): string {
  return `dash:metrics:v:${orgId}`;
}

export async function dashboardMetricsCacheVersion(
  orgId: string,
): Promise<string> {
  return (await cacheGet(versionKey(orgId))) || "0";
}

/** Bump cache generation after sends / opens / clicks (best-effort). */
export async function invalidateDashboardMetricsCache(
  orgId: string,
): Promise<void> {
  await cacheSet(versionKey(orgId), String(Date.now()), VERSION_TTL_SECONDS);
}

export function portfolioActivitySeriesCacheKey(input: {
  orgId: string;
  fromYmd: string;
  toYmd: string;
  channelsKey: string;
  version: string;
}): string {
  return `dash:series:${input.orgId}:${input.fromYmd}:${input.toYmd}:${input.channelsKey}:${input.version}`;
}

export const PORTFOLIO_ACTIVITY_SERIES_CACHE_TTL = SERIES_CACHE_TTL_SECONDS;

const touchThrottleMs = 5_000;
const lastTouchByOrg = new Map<string, number>();

/** After sends / lifecycle changes — avoid invalidating on every recipient row. */
export async function touchDashboardMetrics(
  organizationId: string | bigint | null | undefined,
): Promise<void> {
  const orgId = organizationId != null ? String(organizationId).trim() : "";
  if (!orgId) return;
  const now = Date.now();
  const prev = lastTouchByOrg.get(orgId) ?? 0;
  if (now - prev < touchThrottleMs) return;
  lastTouchByOrg.set(orgId, now);
  await invalidateDashboardMetricsCache(orgId);
}
