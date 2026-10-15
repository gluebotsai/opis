import { api } from "./api";

export type SeoProject = {
  id: string;
  organizationId: string;
  externalProjectId: string;
  domain: string | null;
  market: string | null;
  syncedAt: string;
};

export type SeoGeneratedContent = {
  id: string;
  organizationId: string;
  userId: string | null;
  projectId: string | null;
  contentType: string;
  title: string;
  slug: string | null;
  seoScore: number | null;
  body: Record<string, unknown>;
  status?: string;
  campaignId?: string | null;
  primaryKeyword?: string | null;
  keywordQueryId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SeoKeywordRow = {
  term: string;
  intent?: string | null;
  volume?: number | null;
  kd?: number | null;
  cpc?: number | null;
  competition?: number | string | null;
  opportunity?: number | null;
  source?: string | null;
};

export type SeoKeywordQuery = {
  id: string;
  seed: string;
  location: string;
  language: string;
  payload: SeoKeywordRow[] | unknown;
  filters?: Record<string, unknown> | null;
  error: string | null;
  expiresAt: string;
  semrushCalledAt: string | null;
  budgetSkipped: boolean;
};

export type SeoSocialPost = {
  id: string;
  contentId: string | null;
  platform: string;
  postType: string;
  copy: Record<string, unknown>;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalPostId: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type SeoSocialConnection = {
  platform: "linkedin" | "facebook" | "instagram";
  connected: boolean;
  needsReauth: boolean;
  connectionId: string | null;
  displayName: string | null;
  accountEmail: string | null;
};

export async function fetchSeoProjects() {
  const { data } = await api.get<{ projects: SeoProject[] }>("/api/seo/projects");
  return data.projects ?? [];
}

export async function fetchSeoContent(params?: {
  contentType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const { data } = await api.get<{
    items: SeoGeneratedContent[];
    total: number;
  }>("/api/seo/content", { params });
  return data;
}

export async function fetchSeoContentById(id: string) {
  const { data } = await api.get<{ item: SeoGeneratedContent }>(
    `/api/seo/content/${id}`,
  );
  return data.item;
}

export async function deleteSeoContent(id: string) {
  await api.delete(`/api/seo/content/${id}`);
}

export async function deleteSeoSocialPost(id: string) {
  const { data } = await api.delete<{
    ok?: boolean;
    error?: string | null;
    id?: string;
  }>(`/api/seo/social/${id}`);
  if (data.ok === false) {
    throw new Error(data.error || "Could not delete post.");
  }
  return data;
}

export async function fetchSeoKeywords(params?: {
  queryId?: string;
  intent?: string;
  minVolume?: number;
  maxKd?: number;
  search?: string;
}) {
  const { data } = await api.get<{
    query: SeoKeywordQuery | null;
    rows: SeoKeywordRow[];
    saved: { term: string; queryId: string }[];
    error: string | null;
    source?: "llm" | "semrush" | null;
  }>("/api/seo/keywords", { params });
  return data;
}

export async function saveSeoKeyword(input: {
  queryId: string;
  term: string;
  metrics?: Record<string, unknown>;
}) {
  const { data } = await api.post<{ item: unknown }>("/api/seo/keywords/save", input);
  return data.item;
}

export async function fetchSeoSocial(params?: {
  contentId?: string;
  platform?: string;
}) {
  const { data } = await api.get<{
    items?: SeoSocialPost[];
    data?: { items?: SeoSocialPost[] };
  }>("/api/seo/social", {
    params,
  });
  const inner =
    data?.data && typeof data.data === "object" ? data.data : data;
  const items = inner?.items ?? data?.items;
  return Array.isArray(items) ? items : [];
}

export async function publishSeoSocialPost(id: string) {
  const { data } = await api.post<{
    ok?: boolean;
    error?: string | null;
    data?: {
      ok?: boolean;
      error?: string | null;
      post?: SeoSocialPost | null;
    };
    post?: SeoSocialPost | null;
  }>(`/api/seo/social/${id}/publish`);
  const inner = data.data ?? data;
  return {
    ok: Boolean(inner.ok),
    error: inner.error || (data.ok === false ? "Publish failed" : null),
    post: inner.post ?? data.post ?? null,
  };
}

export async function scheduleSeoSocialPost(
  id: string,
  scheduledAt?: string | Date,
) {
  const when =
    scheduledAt instanceof Date
      ? scheduledAt.toISOString()
      : scheduledAt || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data } = await api.post<{
    ok?: boolean;
    error?: string | null;
    item?: SeoSocialPost | null;
  }>(`/api/seo/social/${id}/schedule`, { scheduledAt: when }, { timeout: 30_000 });
  if (data.ok === false || !data.item) {
    throw new Error(data.error || "Could not schedule this post.");
  }
  return data.item;
}

export async function fetchSeoSocialConnections() {
  const { data } = await api.get<{ platforms: SeoSocialConnection[] }>(
    "/api/seo/social-connections",
  );
  return data.platforms ?? [];
}

export async function patchSeoSocialPost(
  id: string,
  body: {
    copy?: Record<string, unknown>;
    status?: string;
    scheduledAt?: string | null;
  },
) {
  const { data } = await api.patch<{
    ok?: boolean;
    error?: string | null;
    item?: SeoSocialPost | null;
  }>(`/api/seo/social/${id}`, body, { timeout: 30_000 });
  if (data.ok === false || !data.item) {
    throw new Error(data.error || "Could not save draft.");
  }
  return data.item;
}

export async function generateSeoSocialPosts(
  contentId: string,
  opts?: { platform?: "linkedin" | "facebook" | "instagram" },
) {
  const { data } = await api.post<{
    ok?: boolean;
    error?: string | null;
    data?: {
      ok?: boolean;
      error?: string | null;
      items?: SeoSocialPost[];
      counts?: Record<string, number>;
      images?: number;
    };
    items?: SeoSocialPost[];
    counts?: Record<string, number>;
    images?: number;
  }>(
    "/api/seo/social/generate",
    { contentId, platform: opts?.platform },
    { timeout: 240_000 },
  );
  const inner = data.data ?? data;
  return {
    ok: inner.ok !== false,
    error:
      inner.error ||
      data.error ||
      (data.ok === false ? "Could not generate social posts." : null),
    items: inner.items ?? data.items ?? [],
    counts: inner.counts ?? {},
    images: inner.images ?? 0,
  };
}
