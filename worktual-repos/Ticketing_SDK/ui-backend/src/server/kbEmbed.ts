/**
 * Express client for the standalone kb-embed service.
 * Article rows stay in Postgres; this only extracts file text and indexes published articles.
 */
const DEFAULT_TIMEOUT_SEC = 20;

export type KbEmbedArticle = {
  organizationId: string;
  articleId: string;
  title: string;
  content: string;
};

export type KbEmbedSyncInput = KbEmbedArticle & {
  previousStatus?: string | null;
  nextStatus: string;
};

export function kbEmbedBaseUrl(): string {
  return String(process.env.KB_EMBED_URL || "")
    .trim()
    .replace(/\/$/, "");
}

export function kbEmbedTimeoutMs(): number {
  const raw = Number(process.env.KB_EMBED_TIMEOUT || DEFAULT_TIMEOUT_SEC);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_SEC * 1000;
  return raw * 1000;
}

export function normalizeKbStatus(raw: string | null | undefined): "Published" | "Draft" | "" {
  const st = String(raw || "").trim().toLowerCase();
  if (st === "published") return "Published";
  if (st === "draft") return "Draft";
  return "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = String(process.env.KB_EMBED_TOKEN || "").trim();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

async function kbEmbedFetch(
  path: string,
  init: RequestInit,
  timeoutMs = kbEmbedTimeoutMs()
): Promise<Response> {
  const base = kbEmbedBaseUrl();
  if (!base) {
    throw new Error("KB_EMBED_URL is not configured");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mimeForExtract(filename: string): string {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (name.endsWith(".rtf")) return "application/rtf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function extractPdfViaEmbed(
  file: Buffer,
  filename: string
): Promise<string> {
  return extractFileViaEmbed(file, filename);
}

export async function extractFileViaEmbed(
  file: Buffer,
  filename: string
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(file)], {
    type: mimeForExtract(filename),
  });
  form.append("file", blob, filename || "article.bin");
  const res = await kbEmbedFetch("/extract-text", {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const body = (await res.json().catch(() => null)) as { content?: string; detail?: string } | null;
  if (!res.ok) {
    throw new Error(String(body?.detail || `extract-text failed (${res.status})`));
  }
  return String(body?.content || "");
}

export async function ingestPublishedArticle(input: KbEmbedArticle): Promise<void> {
  const res = await kbEmbedFetch("/ingest-article", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      organization_id: input.organizationId,
      article_id: input.articleId,
      title: input.title,
      content: input.content,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(String(body?.detail || `ingest-article failed (${res.status})`));
  }
}

export async function deleteArticleIndex(input: {
  organizationId: string;
  articleId: string;
}): Promise<void> {
  const res = await kbEmbedFetch("/delete-document", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      organization_id: input.organizationId,
      article_id: input.articleId,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(String(body?.detail || `delete-document failed (${res.status})`));
  }
}

/** Ingest on publish; drop the index row when a published article returns to draft. */
export async function syncKbEmbedAfterWrite(input: KbEmbedSyncInput): Promise<void> {
  if (!kbEmbedBaseUrl()) return;
  const next = normalizeKbStatus(input.nextStatus);
  const prev = normalizeKbStatus(input.previousStatus);
  try {
    if (next === "Published") {
      await ingestPublishedArticle(input);
      return;
    }
    if (next === "Draft" && prev === "Published") {
      await deleteArticleIndex({
        organizationId: input.organizationId,
        articleId: input.articleId,
      });
    }
  } catch (err) {
    console.error("[kb-embed] sync failed", err);
  }
}

export function scheduleKbEmbedSync(input: KbEmbedSyncInput): void {
  void syncKbEmbedAfterWrite(input);
}

/** Drop the embed index after a hard delete so portal/search cannot reuse it. */
export function scheduleKbEmbedDelete(input: {
  organizationId: string;
  articleId: string;
}): void {
  if (!kbEmbedBaseUrl()) return;
  void deleteArticleIndex(input).catch((err) => {
    console.error("[kb-embed] delete failed", err);
  });
}

export type KbSearchHit = {
  articleId: string;
  title: string;
  symptoms: string[];
  steps: string[];
  text: string;
  score: number;
};

export type KbSearchResult = {
  hit: KbSearchHit | null;
  reason?: "no_match" | "meili_unavailable";
};

/** Webchat payload: whether this query matched a published article. */
export function webchatRelatedArticlePayload(hit: KbSearchHit | null): {
  related: boolean;
  article: {
    articleId: string;
    title: string;
    symptoms: string[];
    steps: string[];
    text: string;
    score: number;
  } | null;
} {
  if (!hit) {
    return { related: false, article: null };
  }
  return {
    related: true,
    article: {
      articleId: hit.articleId,
      title: hit.title,
      symptoms: hit.symptoms,
      steps: hit.steps,
      text: hit.text,
      score: hit.score,
    },
  };
}

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

function compactHitFromEmbed(raw: unknown): KbSearchHit | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const articleId = String(row.article_id || row.articleId || row.id || "").trim();
  const title = String(row.title || "").trim();
  const text = String(row.text || "").trim();
  if (!articleId && !title) return null;
  const scoreRaw = Number(row.score);
  return {
    articleId,
    title,
    symptoms: asStringList(row.symptoms),
    steps: asStringList(row.steps),
    text,
    score: Number.isFinite(scoreRaw) ? scoreRaw : 0,
  };
}

function tokenOverlapScore(query: string, blob: string): number {
  const q = new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) || []).map((t) => t));
  const b = blob.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (!q.size || !b.length) return 0;
  let hits = 0;
  for (const tok of b) {
    if (q.has(tok)) hits += 1;
  }
  return hits / Math.max(q.size, 1);
}

/** One compact row from published titles + short excerpts. Never return the catalog. */
export function scorePublishedKbFallback(
  query: string,
  rows: Array<{
    id?: string;
    title?: string;
    content?: string;
    excerpt?: string;
    body?: string;
  }>
): KbSearchHit | null {
  const q = String(query || "").trim();
  if (!q) return null;
  let best: KbSearchHit | null = null;
  for (const row of rows) {
    const title = String(row.title || "").trim();
    const excerpt = String(row.excerpt || row.content || row.body || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    const articleId = String(row.id || "").trim();
    if (!articleId && !title) continue;
    const score = tokenOverlapScore(q, `${title} ${excerpt}`);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        articleId,
        title,
        symptoms: [],
        steps: [],
        text: excerpt,
        score: Math.round(score * 10000) / 10000,
      };
    }
  }
  return best;
}

export async function searchKbViaEmbed(
  organizationId: string,
  query: string
): Promise<KbSearchResult> {
  const org = String(organizationId || "").trim();
  const q = String(query || "").trim();
  if (!org || !q) {
    return { hit: null, reason: "no_match" };
  }
  if (!kbEmbedBaseUrl()) {
    return { hit: null, reason: "meili_unavailable" };
  }
  try {
    const res = await kbEmbedFetch("/search", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ organization_id: org, query: q }),
    });
    const body = (await res.json().catch(() => null)) as {
      hit?: unknown;
      reason?: string;
      detail?: string;
    } | null;
    if (res.status === 503 || res.status >= 500) {
      return { hit: null, reason: "meili_unavailable" };
    }
    if (!res.ok) {
      throw new Error(String(body?.detail || `search failed (${res.status})`));
    }
    const hit = compactHitFromEmbed(body?.hit);
    if (!hit) {
      return { hit: null, reason: "no_match" };
    }
    return { hit };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cannot reach meilisearch|meili|fetch|network|abort/i.test(message)) {
      return { hit: null, reason: "meili_unavailable" };
    }
    throw err;
  }
}
