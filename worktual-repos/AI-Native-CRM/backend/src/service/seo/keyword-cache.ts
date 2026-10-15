import { createHash } from "node:crypto";

export type KeywordRow = {
  term: string;
  intent?: string | null;
  volume?: number | null;
  kd?: number | null;
  cpc?: number | null;
  competition?: number | string | null;
  opportunity?: number | null;
  source?: string | null;
};

export type KeywordMetricSource = "semrush" | "llm";

export type KeywordFilters = {
  intent?: string | null;
  minVolume?: number | null;
  maxKd?: number | null;
  search?: string | null;
};

export const KEYWORD_CACHE_MAX_DAYS = 31;

export function normalizeKeywordSeed(seed: string): string {
  return seed.trim().toLowerCase().replace(/\s+/g, " ");
}

export function keywordCacheKey(input: {
  organizationId: string;
  seed: string;
  location?: string | null;
  language?: string | null;
  source?: KeywordMetricSource | null;
}): string {
  const seed = normalizeKeywordSeed(input.seed);
  const location = (input.location || "us").trim().toLowerCase() || "us";
  const language = (input.language || "en").trim().toLowerCase() || "en";
  const source = input.source === "llm" ? "llm" : "semrush";
  const raw =
    source === "llm"
      ? `${input.organizationId}|${seed}|${location}|${language}|llm`
      : `${input.organizationId}|${seed}|${location}|${language}`;
  return createHash("sha256").update(raw).digest("hex");
}

export function parseKeywordPayload(payload: unknown): KeywordRow[] {
  if (typeof payload === "string") {
    try {
      return parseKeywordPayload(JSON.parse(payload));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(payload)) return [];
  const rows: KeywordRow[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const term = String(rec.term || rec.keyword || rec.phrase || "").trim();
    if (!term) continue;
    const volume =
      typeof rec.volume === "number"
        ? rec.volume
        : Number(rec.searchVolume ?? rec.search_volume);
    const kd =
      typeof rec.kd === "number"
        ? rec.kd
        : Number(
            rec.difficulty ?? rec.keywordDifficulty ?? rec.keyword_difficulty,
          );
    const cpc =
      typeof rec.cpc === "number" ? rec.cpc : Number(rec.cpcUsd ?? rec.cpc_usd);
    const opportunity =
      typeof rec.opportunity === "number" ? rec.opportunity : null;
    rows.push({
      term,
      intent: rec.intent == null ? null : String(rec.intent),
      volume: Number.isFinite(volume) ? volume : null,
      kd: Number.isFinite(kd) ? kd : null,
      cpc: Number.isFinite(cpc) ? cpc : null,
      competition:
        rec.competition == null ? null : (rec.competition as number | string),
      opportunity: Number.isFinite(Number(opportunity))
        ? Number(opportunity)
        : null,
      source: rec.source == null ? null : String(rec.source),
    });
  }
  return rows;
}

export function filterKeywordRows(
  rows: KeywordRow[],
  filters?: KeywordFilters | null,
): KeywordRow[] {
  const intent = filters?.intent?.trim().toLowerCase() || "";
  const search = filters?.search?.trim().toLowerCase() || "";
  const minVolume =
    typeof filters?.minVolume === "number" && Number.isFinite(filters.minVolume)
      ? filters.minVolume
      : null;
  const maxKd =
    typeof filters?.maxKd === "number" && Number.isFinite(filters.maxKd)
      ? filters.maxKd
      : null;
  return rows.filter((row) => {
    if (intent && String(row.intent || "").toLowerCase() !== intent) return false;
    if (search && !row.term.toLowerCase().includes(search)) return false;
    if (minVolume != null && (row.volume ?? 0) < minVolume) return false;
    if (maxKd != null && (row.kd ?? 0) > maxKd) return false;
    return true;
  });
}
