import { fetchEmbedSession, type MarketingEmbedSession } from "@/services/marketing";

const CACHE_MS = 30_000;
const WARM_STALE_MS = 25_000;

let cached: MarketingEmbedSession | null = null;
let cachedAt = 0;
let inflight: Promise<MarketingEmbedSession> | null = null;

export function clearMarketingEmbedCache() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}

export async function loadMarketingEmbedSession(
  options: { force?: boolean } = {},
): Promise<MarketingEmbedSession> {
  const now = Date.now();
  if (
    !options.force &&
    cached &&
    now - cachedAt < CACHE_MS
  ) {
    return cached;
  }

  if (!options.force && inflight) {
    return inflight;
  }

  inflight = fetchEmbedSession()
    .then((session) => {
      cached = session;
      cachedAt = Date.now();
      inflight = null;
      return session;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });

  return inflight;
}

export function isMarketingEmbedWarm(): boolean {
  return Boolean(cached && Date.now() - cachedAt < WARM_STALE_MS);
}

export function peekMarketingEmbedSession(): MarketingEmbedSession | null {
  if (!cached || Date.now() - cachedAt >= CACHE_MS) return null;
  return cached;
}
