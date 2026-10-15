/**
 * Keyword research: Semrush gateway for the seed (1 keyword_metrics call),
 * LLM for related terms and as fallback. SEO_KEYWORD_SOURCE=llm skips Semrush.
 */

import { getSemrushAppConnection } from "@/dao/account/setup-app-connections";
import {
  getSeoKeywordQueryByCacheKey,
  upsertSeoKeywordQuery,
  type SeoKeywordQueryRow,
} from "@/dao/seo/seo-store";
import { isSemrushMcpEnabled } from "@/service/seo/semrush-sync-job";
import {
  isSemrushGatewayConfigured,
  isSemrushQuotaError,
} from "@/service/seo/semrush-gateway";
import {
  filterKeywordRows,
  KEYWORD_CACHE_MAX_DAYS,
  keywordCacheKey,
  parseKeywordPayload,
  type KeywordFilters,
  type KeywordMetricSource,
  type KeywordRow,
} from "@/service/seo/keyword-cache";

const AI_BASE =
  process.env.AI_SERVICE_BASE_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const LLM_TTL_DAYS = 7;
const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function keywordResearchSource(): KeywordMetricSource {
  const raw = process.env.SEO_KEYWORD_SOURCE?.trim().toLowerCase();
  if (raw === "llm") return "llm";
  return "semrush";
}

export type KeywordResearchResult = {
  ok: boolean;
  cacheHit: boolean;
  query: SeoKeywordQueryRow | null;
  rows: KeywordRow[];
  error: string | null;
  source: KeywordMetricSource;
  fallback?: boolean;
  code?:
    | "SEMRUSH_DISABLED"
    | "SEMRUSH_NOT_CONNECTED"
    | "SEMRUSH_ERROR"
    | "LLM_ERROR";
};

function internalHeaders(): Record<string, string> {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) headers["x-internal-secret"] = secret;
  return headers;
}

async function callAiKeywordEstimates(input: {
  organizationId: string;
  seed: string;
  location: string;
  language: string;
}): Promise<{
  ok: boolean;
  rows: KeywordRow[];
  error?: string | null;
}> {
  const res = await fetch(`${AI_BASE}/ai/v1/internal/seo/keyword-estimates`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      organizationId: input.organizationId,
      seed: input.seed,
      location: input.location,
      language: input.language,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const nested =
    data.data && typeof data.data === "object"
      ? (data.data as Record<string, unknown>)
      : data;
  const rows = Array.isArray(nested.rows)
    ? (nested.rows as KeywordRow[])
    : Array.isArray(data.rows)
      ? (data.rows as KeywordRow[])
      : [];
  const ok = nested.ok !== false && data.ok !== false && res.ok;
  if (!ok) {
    return {
      ok: false,
      rows,
      error:
        typeof nested.error === "string"
          ? nested.error
          : typeof data.error === "string"
            ? data.error
            : `LLM keyword estimates failed (HTTP ${res.status})`,
    };
  }
  return { ok: true, rows, error: null };
}

async function callAiKeywordResearch(input: {
  organizationId: string;
  seed: string;
  location: string;
  language: string;
  connection?: {
    mcpUrl: string | null;
    oauthClientId: string | null;
    scopes: string | null;
    accessToken: string | null;
    refreshToken: string | null;
  };
}): Promise<{
  ok: boolean;
  rows: KeywordRow[];
  error?: string | null;
  budgetSkipped?: boolean;
  code?: string | null;
}> {
  const res = await fetch(`${AI_BASE}/ai/v1/internal/semrush/keywords`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      organizationId: input.organizationId,
      seed: input.seed,
      location: input.location,
      language: input.language,
      connection: input.connection,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const rows = Array.isArray(data.rows) ? (data.rows as KeywordRow[]) : [];
  if (!res.ok || data.ok === false) {
    return {
      ok: false,
      rows,
      error:
        typeof data.error === "string"
          ? data.error
          : `Semrush keyword research failed (HTTP ${res.status})`,
      budgetSkipped: Boolean(data.budgetSkipped),
      code: typeof data.code === "string" ? data.code : null,
    };
  }
  return {
    ok: true,
    rows,
    error: typeof data.error === "string" ? data.error : null,
    budgetSkipped: Boolean(data.budgetSkipped),
  };
}

function payloadRows(payload: unknown): KeywordRow[] {
  return parseKeywordPayload(payload);
}

function mergeSeedAndRelated(
  seed: string,
  semrushRows: KeywordRow[],
  related: KeywordRow[],
): KeywordRow[] {
  const skip = new Set<string>();
  skip.add(seed.trim().toLowerCase());
  const out: KeywordRow[] = [];
  for (const row of semrushRows) {
    const term = String(row.term || "").trim();
    if (!term) continue;
    skip.add(term.toLowerCase());
    out.push({ ...row, source: row.source || "semrush" });
  }
  for (const row of related) {
    const term = String(row.term || "").trim();
    if (!term || skip.has(term.toLowerCase())) continue;
    skip.add(term.toLowerCase());
    out.push(row);
  }
  return out;
}

async function persistAndReturnLlm(input: {
  organizationId: string;
  userId?: string | null;
  seed: string;
  location: string;
  language: string;
  filters?: KeywordFilters | null;
  now: number;
  fallback: boolean;
}): Promise<KeywordResearchResult> {
  const cacheKey = keywordCacheKey({
    organizationId: input.organizationId,
    seed: input.seed,
    location: input.location,
    language: input.language,
    source: "llm",
  });
  const cached = await getSeoKeywordQueryByCacheKey(
    input.organizationId,
    cacheKey,
  );
  if (cached && cached.expiresAt.getTime() > input.now && !cached.error) {
    return {
      ok: true,
      cacheHit: true,
      query: cached,
      rows: filterKeywordRows(payloadRows(cached.payload), input.filters),
      error: null,
      source: "llm",
      fallback: input.fallback,
    };
  }

  let live: { ok: boolean; rows: KeywordRow[]; error?: string | null };
  try {
    live = await callAiKeywordEstimates({
      organizationId: input.organizationId,
      seed: input.seed,
      location: input.location,
      language: input.language,
    });
  } catch (err) {
    live = {
      ok: false,
      rows: [],
      error:
        err instanceof Error ? err.message : "LLM keyword estimates failed",
    };
  }
  const query = await upsertSeoKeywordQuery({
    organizationId: input.organizationId,
    userId: input.userId,
    seed: input.seed,
    location: input.location,
    language: input.language,
    filters: { source: "llm", ...(input.filters ?? {}) } as object,
    cacheKey,
    semrushCalledAt: null,
    expiresAt: new Date(input.now + LLM_TTL_DAYS * 24 * 60 * 60 * 1000),
    payload: live.ok ? live.rows : [],
    error: live.ok ? null : live.error || "LLM keyword estimates failed",
    budgetSkipped: false,
  });
  if (!live.ok) {
    return {
      ok: false,
      cacheHit: false,
      query,
      rows: [],
      error: live.error || "LLM keyword estimates failed",
      source: "llm",
      fallback: input.fallback,
      code: "LLM_ERROR",
    };
  }
  return {
    ok: true,
    cacheHit: false,
    query,
    rows: filterKeywordRows(live.rows, input.filters),
    error: null,
    source: "llm",
    fallback: input.fallback,
  };
}

export async function researchSeoKeywords(input: {
  organizationId: string;
  userId?: string | null;
  seed: string;
  location?: string | null;
  language?: string | null;
  filters?: KeywordFilters | null;
}): Promise<KeywordResearchResult> {
  const source = keywordResearchSource();
  const seed = input.seed.trim();
  if (!seed) {
    return {
      ok: false,
      cacheHit: false,
      query: null,
      rows: [],
      error: "seed is required",
      source,
    };
  }
  const location = (input.location || "us").trim().toLowerCase() || "us";
  const language = (input.language || "en").trim().toLowerCase() || "en";
  const now = Date.now();

  if (source === "llm") {
    return persistAndReturnLlm({
      organizationId: input.organizationId,
      userId: input.userId,
      seed,
      location,
      language,
      filters: input.filters,
      now,
      fallback: false,
    });
  }

  const cacheKey = keywordCacheKey({
    organizationId: input.organizationId,
    seed,
    location,
    language,
    source: "semrush",
  });
  const cached = await getSeoKeywordQueryByCacheKey(
    input.organizationId,
    cacheKey,
  );
  if (cached && cached.expiresAt.getTime() > now && !cached.error) {
    return {
      ok: true,
      cacheHit: true,
      query: cached,
      rows: filterKeywordRows(payloadRows(cached.payload), input.filters),
      error: null,
      source: "semrush",
    };
  }

  const quotaBlocked =
    Boolean(cached?.error) &&
    cached!.expiresAt.getTime() > now &&
    isSemrushQuotaError(cached!.error);

  const useGateway = isSemrushGatewayConfigured();
  const useLegacyMcp = !useGateway && isSemrushMcpEnabled();

  if (!quotaBlocked && (useGateway || useLegacyMcp)) {
    let connection:
      | {
          mcpUrl: string | null;
          oauthClientId: string | null;
          scopes: string | null;
          accessToken: string | null;
          refreshToken: string | null;
        }
      | undefined;
    if (useLegacyMcp) {
      const conn = await getSemrushAppConnection(input.organizationId);
      if (conn) {
        connection = {
          mcpUrl: conn.mcpUrl,
          oauthClientId: conn.oauthClientId,
          scopes: conn.scopes,
          accessToken: conn.accessToken,
          refreshToken: conn.refreshToken,
        };
      }
    }

    if (useGateway || connection) {
      let live: {
        ok: boolean;
        rows: KeywordRow[];
        error?: string | null;
        budgetSkipped?: boolean;
        code?: string | null;
      };
      try {
        live = await callAiKeywordResearch({
          organizationId: input.organizationId,
          seed,
          location,
          language,
          connection,
        });
      } catch (err) {
        live = {
          ok: false,
          rows: [],
          error:
            err instanceof Error
              ? err.message
              : "Semrush keyword research failed",
        };
      }

      if (live.ok && live.rows.length) {
        let related: KeywordRow[] = [];
        try {
          const estimates = await callAiKeywordEstimates({
            organizationId: input.organizationId,
            seed,
            location,
            language,
          });
          if (estimates.ok) related = estimates.rows;
        } catch {
          related = [];
        }
        const merged = mergeSeedAndRelated(seed, live.rows, related);
        const query = await upsertSeoKeywordQuery({
          organizationId: input.organizationId,
          userId: input.userId,
          seed,
          location,
          language,
          filters: { source: "semrush", ...(input.filters ?? {}) } as object,
          cacheKey,
          semrushCalledAt: new Date(),
          expiresAt: new Date(now + KEYWORD_CACHE_MAX_DAYS * 24 * 60 * 60 * 1000),
          payload: merged,
          error: null,
          budgetSkipped: false,
        });
        return {
          ok: true,
          cacheHit: false,
          query,
          rows: filterKeywordRows(merged, input.filters),
          error: null,
          source: "semrush",
        };
      }

      if (live.budgetSkipped || isSemrushQuotaError(live.error)) {
        await upsertSeoKeywordQuery({
          organizationId: input.organizationId,
          userId: input.userId,
          seed,
          location,
          language,
          filters: { source: "semrush", ...(input.filters ?? {}) } as object,
          cacheKey,
          semrushCalledAt: null,
          expiresAt: new Date(now + QUOTA_COOLDOWN_MS),
          payload: [],
          error: live.error || "SEMRUSH_QUOTA",
          budgetSkipped: true,
        });
      }
    }
  }

  return persistAndReturnLlm({
    organizationId: input.organizationId,
    userId: input.userId,
    seed,
    location,
    language,
    filters: input.filters,
    now,
    fallback: true,
  });
}
