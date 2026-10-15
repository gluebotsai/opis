/**
 * In-memory LLM hit log for local debugging (console + GET /api/coworker/llm-hits).
 */

export type LlmHit = {
  id: string;
  at: string;
  source: string;
  model: string;
  ok: boolean;
  ms: number;
  status?: number;
  userPreview?: string;
  replyPreview?: string;
  error?: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

const MAX_HITS = 120;
const hits: LlmHit[] = [];

function preview(text: string | null | undefined, n = 160): string | undefined {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function recordLlmHit(
  hit: Omit<LlmHit, "id" | "at"> & { id?: string; at?: string }
): LlmHit {
  const entry: LlmHit = {
    id: hit.id || `llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: hit.at || new Date().toISOString(),
    source: hit.source,
    model: hit.model,
    ok: hit.ok,
    ms: hit.ms,
    status: hit.status,
    userPreview: hit.userPreview,
    replyPreview: hit.replyPreview,
    error: hit.error,
    meta: hit.meta,
  };
  hits.unshift(entry);
  if (hits.length > MAX_HITS) hits.length = MAX_HITS;

  const flag = entry.ok ? "OK" : "FAIL";
  const metaBits = entry.meta
    ? " " +
      Object.entries(entry.meta)
        .filter(([, v]) => v !== undefined && v !== null && String(v).length)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    : "";
  console.log(
    `[LLM ${flag}] ${entry.source} ${entry.ms}ms model=${entry.model}${metaBits}` +
      (entry.userPreview ? ` | in: ${entry.userPreview}` : "") +
      (entry.replyPreview ? ` | out: ${entry.replyPreview}` : "") +
      (entry.error ? ` | err: ${entry.error}` : "")
  );
  return entry;
}

export function listLlmHits(limit = 50): LlmHit[] {
  const n = Math.max(1, Math.min(MAX_HITS, Number(limit) || 50));
  return hits.slice(0, n);
}

export function clearLlmHits(): void {
  hits.length = 0;
}

export function llmHitPreviews(user: string, reply: string | null | undefined) {
  return {
    userPreview: preview(user),
    replyPreview: preview(reply),
  };
}
