/**
 * CRM SEO Semrush project + tool snapshot cache.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { Prisma } from "@prisma/client";

function cuidLike(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

const ANALYSIS_SNAPSHOT_TOOLS = new Set([
  "keyword_research",
  "organic_research",
  "competitors_research",
  "position_tracking",
  "audience_research",
  "site_audit",
  "backlinks_research",
  "traffic_overview",
  "paid_search_research",
  "domain_overview",
]);

export type SeoProjectRow = {
  id: string;
  organizationId: string;
  externalProjectId: string;
  domain: string | null;
  market: string | null;
  raw: Prisma.JsonValue;
  syncedAt: Date;
};

export type SeoToolSnapshotRow = {
  id: string;
  organizationId: string;
  externalProjectId: string;
  toolName: string;
  payload: Prisma.JsonValue;
  error: string | null;
  fetchedAt: Date;
};

export type SeoGeneratedContentRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  projectId: string | null;
  contentType: string;
  title: string;
  slug: string | null;
  seoScore: number | null;
  body: Prisma.JsonValue;
  status: string;
  campaignId: string | null;
  primaryKeyword: string | null;
  keywordQueryId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SeoKeywordQueryRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  seed: string;
  location: string;
  language: string;
  filters: Prisma.JsonValue;
  cacheKey: string;
  semrushCalledAt: Date | null;
  expiresAt: Date;
  payload: Prisma.JsonValue;
  error: string | null;
  budgetSkipped: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SeoSavedKeywordRow = {
  id: string;
  organizationId: string;
  queryId: string;
  term: string;
  metrics: Prisma.JsonValue;
  contentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SeoSocialPostRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  contentId: string | null;
  platform: string;
  postType: string;
  copy: Prisma.JsonValue;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  externalPostId: string | null;
  lastError: string | null;
  accountsConnectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapProject(r: Record<string, unknown>): SeoProjectRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    externalProjectId: String(r.external_project_id),
    domain: r.domain == null ? null : String(r.domain),
    market: r.market == null ? null : String(r.market),
    raw: (r.raw as Prisma.JsonValue) ?? null,
    syncedAt: new Date(String(r.synced_at)),
  };
}

function mapSnapshot(r: Record<string, unknown>): SeoToolSnapshotRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    externalProjectId: String(r.external_project_id),
    toolName: String(r.tool_name),
    payload: (r.payload as Prisma.JsonValue) ?? null,
    error: r.error == null ? null : String(r.error),
    fetchedAt: new Date(String(r.fetched_at)),
  };
}

function mapContent(r: Record<string, unknown>): SeoGeneratedContentRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    userId: r.user_id == null ? null : String(r.user_id),
    projectId: r.project_id == null ? null : String(r.project_id),
    contentType: String(r.content_type),
    title: String(r.title),
    slug: r.slug == null ? null : String(r.slug),
    seoScore:
      r.seo_score == null || r.seo_score === ""
        ? null
        : Number(r.seo_score),
    body: (r.body as Prisma.JsonValue) ?? {},
    status: String(r.status || "draft"),
    campaignId: r.campaign_id == null ? null : String(r.campaign_id),
    primaryKeyword:
      r.primary_keyword == null ? null : String(r.primary_keyword),
    keywordQueryId:
      r.keyword_query_id == null ? null : String(r.keyword_query_id),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

function mapKeywordQuery(r: Record<string, unknown>): SeoKeywordQueryRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    userId: r.user_id == null ? null : String(r.user_id),
    seed: String(r.seed || ""),
    location: String(r.location || "us"),
    language: String(r.language || "en"),
    filters: (r.filters as Prisma.JsonValue) ?? {},
    cacheKey: String(r.cache_key),
    semrushCalledAt: r.semrush_called_at
      ? new Date(String(r.semrush_called_at))
      : null,
    expiresAt: new Date(String(r.expires_at)),
    payload: (r.payload as Prisma.JsonValue) ?? [],
    error: r.error == null ? null : String(r.error),
    budgetSkipped: Boolean(r.budget_skipped),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

function mapSavedKeyword(r: Record<string, unknown>): SeoSavedKeywordRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    queryId: String(r.query_id),
    term: String(r.term),
    metrics: (r.metrics as Prisma.JsonValue) ?? {},
    contentId: r.content_id == null ? null : String(r.content_id),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

function mapSocialPost(r: Record<string, unknown>): SeoSocialPostRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    userId: r.user_id == null ? null : String(r.user_id),
    contentId: r.content_id == null ? null : String(r.content_id),
    platform: String(r.platform),
    postType: String(r.post_type || "feed"),
    copy: (r.copy as Prisma.JsonValue) ?? {},
    status: String(r.status || "draft"),
    scheduledAt: r.scheduled_at ? new Date(String(r.scheduled_at)) : null,
    publishedAt: r.published_at ? new Date(String(r.published_at)) : null,
    externalPostId:
      r.external_post_id == null ? null : String(r.external_post_id),
    lastError: r.last_error == null ? null : String(r.last_error),
    accountsConnectionId:
      r.accounts_connection_id == null
        ? null
        : String(r.accounts_connection_id),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

/** Strip image bytes from API payloads — clients use GET /social/:id/image. */
export function slimSocialPostForClient(
  post: SeoSocialPostRow,
): SeoSocialPostRow {
  const copy =
    post.copy && typeof post.copy === "object" && !Array.isArray(post.copy)
      ? { ...(post.copy as Record<string, unknown>) }
      : {};
  const hasBytes =
    typeof copy.imageDataUrl === "string" &&
    copy.imageDataUrl.startsWith("data:image");
  const hasUrl =
    typeof copy.imageUrl === "string" &&
    /^https?:\/\//i.test(copy.imageUrl.trim());
  delete copy.imageDataUrl;
  copy.hasImage = Boolean(hasBytes || hasUrl || copy.hasImage);
  return { ...post, copy: copy as Prisma.JsonValue };
}

/** Keep Gemini image bytes in the DB; never send them on list payloads. */
export function mergeSocialCopy(
  existing: unknown,
  incoming: unknown,
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return base as Prisma.InputJsonValue;
  }
  const patch = incoming as Record<string, unknown>;
  const next = { ...base, ...patch };
  if (!("imageDataUrl" in patch) && base.imageDataUrl) {
    next.imageDataUrl = base.imageDataUrl;
  }
  return next as Prisma.InputJsonValue;
}

/** True when the patch carries image bytes / URLs (needs full upsert). */
export function socialCopyPatchNeedsFullUpsert(copy: unknown): boolean {
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) return false;
  const patch = copy as Record<string, unknown>;
  return "imageDataUrl" in patch || "imageUrl" in patch;
}

const SOCIAL_POST_SLIM_RETURNING = `
  id, organization_id, user_id, content_id, platform, post_type,
  (
    (copy - 'imageDataUrl')
    || jsonb_build_object(
      'hasImage',
      CASE
        WHEN COALESCE(copy->>'imageDataUrl', '') LIKE 'data:image%'
          OR COALESCE(copy->>'imageUrl', '') LIKE 'http%'
        THEN TRUE
        ELSE FALSE
      END
    )
  ) AS copy,
  status, scheduled_at, published_at, external_post_id, last_error,
  accounts_connection_id, created_at, updated_at
`;

/**
 * Merge small copy fields (caption, hashtags, …) in Postgres without
 * loading or rewriting imageDataUrl — keeps Save draft fast.
 */
export async function patchSeoSocialCopyFields(input: {
  organizationId: string;
  id: string;
  copyPatch: Record<string, unknown>;
  status?: string | null;
  scheduledAt?: Date | null;
  clearScheduledAt?: boolean;
}): Promise<SeoSocialPostRow | null> {
  const prisma = getPrismaClient();
  const patchJson = JSON.stringify(input.copyPatch ?? {});
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE crm.seo_social_posts
    SET
      copy = copy || $3::jsonb,
      status = COALESCE($4, status),
      scheduled_at = CASE
        WHEN $5::boolean THEN NULL
        WHEN $6::timestamptz IS NOT NULL THEN $6::timestamptz
        ELSE scheduled_at
      END,
      updated_at = NOW()
    WHERE organization_id = $1::bigint AND id = $2
    RETURNING ${SOCIAL_POST_SLIM_RETURNING}
    `,
    input.organizationId,
    input.id,
    patchJson,
    input.status?.trim() || null,
    Boolean(input.clearScheduledAt),
    input.clearScheduledAt ? null : input.scheduledAt ?? null,
  );
  return rows[0] ? mapSocialPost(rows[0]) : null;
}

export async function listSeoProjects(
  organizationId: string,
): Promise<SeoProjectRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_projects
     WHERE organization_id = $1::bigint
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    organizationId,
  );
  return rows.map(mapProject);
}

export async function upsertSeoProject(input: {
  organizationId: string;
  externalProjectId: string;
  domain?: string | null;
  market?: string | null;
  raw?: Prisma.InputJsonValue | null;
}): Promise<SeoProjectRow | null> {
  const prisma = getPrismaClient();
  const id = cuidLike("seop");
  const rawJson = JSON.stringify(input.raw ?? {});
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO crm.seo_projects (
      id, organization_id, external_project_id, domain, market, raw, synced_at, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3, $4, $5, $6::jsonb, NOW(), NOW(), NOW()
    )
    ON CONFLICT (organization_id, external_project_id) DO UPDATE SET
      domain = EXCLUDED.domain,
      market = EXCLUDED.market,
      raw = EXCLUDED.raw,
      synced_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.externalProjectId,
    input.domain ?? null,
    input.market ?? null,
    rawJson,
  );
  return rows[0] ? mapProject(rows[0]) : null;
}

export async function upsertSeoToolSnapshot(input: {
  organizationId: string;
  externalProjectId: string;
  toolName: string;
  payload?: Prisma.InputJsonValue | null;
  error?: string | null;
}): Promise<SeoToolSnapshotRow | null> {
  const prisma = getPrismaClient();
  const id = cuidLike("seos");
  const payloadJson = JSON.stringify(input.payload ?? null);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO crm.seo_tool_snapshots (
      id, organization_id, external_project_id, tool_name, payload, error, fetched_at, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3, $4, $5::jsonb, $6, NOW(), NOW(), NOW()
    )
    ON CONFLICT (organization_id, external_project_id, tool_name) DO UPDATE SET
      payload = EXCLUDED.payload,
      error = EXCLUDED.error,
      fetched_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.externalProjectId,
    input.toolName,
    payloadJson,
    input.error ?? null,
  );
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

export async function listSeoToolSnapshots(
  organizationId: string,
  _externalProjectId?: string | null,
  toolName?: string | null,
): Promise<SeoToolSnapshotRow[]> {
  const prisma = getPrismaClient();
  const first = await listSeoProjects(organizationId);
  const projectId = first[0]?.externalProjectId ?? null;
  if (!projectId) return [];
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM crm.seo_tool_snapshots
    WHERE organization_id = $1::bigint
      AND external_project_id = $2
      AND ($3::text IS NULL OR tool_name = $3)
    ORDER BY tool_name ASC
    `,
    organizationId,
    projectId,
    toolName?.trim() || null,
  );
  return rows
    .map(mapSnapshot)
    .filter((row) => ANALYSIS_SNAPSHOT_TOOLS.has(row.toolName));
}

export async function listSeoGeneratedContent(
  organizationId: string,
  opts?: {
    contentType?: string | null;
    search?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<{ rows: SeoGeneratedContentRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const contentType = opts?.contentType?.trim() || null;
  const search = opts?.search?.trim() || null;
  const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `
    SELECT COUNT(*)::bigint AS count
    FROM crm.seo_generated_content
    WHERE organization_id = $1::bigint
      AND ($2::text IS NULL OR content_type = $2)
      AND (
        $3::text IS NULL
        OR title ILIKE '%' || $3 || '%'
        OR coalesce(slug, '') ILIKE '%' || $3 || '%'
      )
    `,
    organizationId,
    contentType,
    search,
  );
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM crm.seo_generated_content
    WHERE organization_id = $1::bigint
      AND ($2::text IS NULL OR content_type = $2)
      AND (
        $3::text IS NULL
        OR title ILIKE '%' || $3 || '%'
        OR coalesce(slug, '') ILIKE '%' || $3 || '%'
      )
    ORDER BY updated_at DESC
    LIMIT $4 OFFSET $5
    `,
    organizationId,
    contentType,
    search,
    limit,
    offset,
  );
  return {
    rows: rows.map(mapContent),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export async function getSeoGeneratedContent(
  organizationId: string,
  id: string,
): Promise<SeoGeneratedContentRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_generated_content
     WHERE organization_id = $1::bigint AND id = $2
     LIMIT 1`,
    organizationId,
    id,
  );
  return rows[0] ? mapContent(rows[0]) : null;
}

export async function saveSeoGeneratedContent(input: {
  organizationId: string;
  userId?: string | null;
  projectId?: string | null;
  contentType: string;
  title: string;
  slug?: string | null;
  seoScore?: number | null;
  body: Prisma.InputJsonValue;
  id?: string | null;
  status?: string | null;
  campaignId?: string | null;
  primaryKeyword?: string | null;
  keywordQueryId?: string | null;
}): Promise<SeoGeneratedContentRow | null> {
  const prisma = getPrismaClient();
  const id = input.id?.trim() || cuidLike("seoc");
  const bodyJson = JSON.stringify(input.body ?? {});
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO crm.seo_generated_content (
      id, organization_id, user_id, project_id, content_type, title, slug, seo_score, body,
      status, campaign_id, primary_keyword, keyword_query_id, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9::jsonb,
      $10, $11, $12, $13, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      project_id = EXCLUDED.project_id,
      content_type = EXCLUDED.content_type,
      title = EXCLUDED.title,
      slug = EXCLUDED.slug,
      seo_score = EXCLUDED.seo_score,
      body = EXCLUDED.body,
      status = EXCLUDED.status,
      campaign_id = EXCLUDED.campaign_id,
      primary_keyword = EXCLUDED.primary_keyword,
      keyword_query_id = EXCLUDED.keyword_query_id,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.userId?.trim() || null,
    input.projectId ?? null,
    input.contentType,
    input.title,
    input.slug ?? null,
    input.seoScore ?? null,
    bodyJson,
    input.status?.trim() || "draft",
    input.campaignId ?? null,
    input.primaryKeyword ?? null,
    input.keywordQueryId ?? null,
  );
  return rows[0] ? mapContent(rows[0]) : null;
}

export async function deleteSeoGeneratedContent(
  organizationId: string,
  id: string,
): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `DELETE FROM crm.seo_generated_content
     WHERE organization_id = $1::bigint AND id = $2
     RETURNING id`,
    organizationId,
    id,
  );
  return rows.length > 0;
}

export async function getSeoKeywordQueryByCacheKey(
  organizationId: string,
  cacheKey: string,
): Promise<SeoKeywordQueryRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_keyword_queries
     WHERE organization_id = $1::bigint AND cache_key = $2
     LIMIT 1`,
    organizationId,
    cacheKey,
  );
  return rows[0] ? mapKeywordQuery(rows[0]) : null;
}

export async function getSeoKeywordQuery(
  organizationId: string,
  id: string,
): Promise<SeoKeywordQueryRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_keyword_queries
     WHERE organization_id = $1::bigint AND id = $2
     LIMIT 1`,
    organizationId,
    id,
  );
  return rows[0] ? mapKeywordQuery(rows[0]) : null;
}

export async function getLatestSeoKeywordQuery(
  organizationId: string,
): Promise<SeoKeywordQueryRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_keyword_queries
     WHERE organization_id = $1::bigint
     ORDER BY updated_at DESC
     LIMIT 1`,
    organizationId,
  );
  return rows[0] ? mapKeywordQuery(rows[0]) : null;
}

export async function upsertSeoKeywordQuery(input: {
  organizationId: string;
  userId?: string | null;
  seed: string;
  location: string;
  language: string;
  filters?: Prisma.InputJsonValue;
  cacheKey: string;
  semrushCalledAt?: Date | null;
  expiresAt: Date;
  payload: Prisma.InputJsonValue;
  error?: string | null;
  budgetSkipped?: boolean;
  id?: string | null;
}): Promise<SeoKeywordQueryRow | null> {
  const prisma = getPrismaClient();
  const id = input.id?.trim() || cuidLike("seokq");
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO crm.seo_keyword_queries (
      id, organization_id, user_id, seed, location, language, filters, cache_key,
      semrush_called_at, expires_at, payload, error, budget_skipped, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::bigint, $4, $5, $6, $7::jsonb, $8,
      $9, $10, $11::jsonb, $12, $13, NOW(), NOW()
    )
    ON CONFLICT (organization_id, cache_key) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, crm.seo_keyword_queries.user_id),
      seed = EXCLUDED.seed,
      location = EXCLUDED.location,
      language = EXCLUDED.language,
      filters = EXCLUDED.filters,
      semrush_called_at = EXCLUDED.semrush_called_at,
      expires_at = EXCLUDED.expires_at,
      payload = EXCLUDED.payload,
      error = EXCLUDED.error,
      budget_skipped = EXCLUDED.budget_skipped,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.userId?.trim() || null,
    input.seed,
    input.location,
    input.language,
    JSON.stringify(input.filters ?? {}),
    input.cacheKey,
    input.semrushCalledAt ?? null,
    input.expiresAt,
    JSON.stringify(input.payload ?? []),
    input.error ?? null,
    input.budgetSkipped ?? false,
  );
  return rows[0] ? mapKeywordQuery(rows[0]) : null;
}

export async function listSeoSavedKeywords(
  organizationId: string,
  queryId?: string | null,
): Promise<SeoSavedKeywordRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_saved_keywords
     WHERE organization_id = $1::bigint
       AND ($2::text IS NULL OR query_id = $2)
     ORDER BY updated_at DESC`,
    organizationId,
    queryId?.trim() || null,
  );
  return rows.map(mapSavedKeyword);
}

export async function saveSeoKeyword(input: {
  organizationId: string;
  queryId: string;
  term: string;
  metrics?: Prisma.InputJsonValue;
  contentId?: string | null;
}): Promise<SeoSavedKeywordRow | null> {
  const prisma = getPrismaClient();
  const id = cuidLike("seosk");
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO crm.seo_saved_keywords (
      id, organization_id, query_id, term, metrics, content_id, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3, $4, $5::jsonb, $6, NOW(), NOW()
    )
    ON CONFLICT (organization_id, query_id, term) DO UPDATE SET
      metrics = EXCLUDED.metrics,
      content_id = COALESCE(EXCLUDED.content_id, crm.seo_saved_keywords.content_id),
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.queryId,
    input.term.trim(),
    JSON.stringify(input.metrics ?? {}),
    input.contentId ?? null,
  );
  return rows[0] ? mapSavedKeyword(rows[0]) : null;
}

export async function listSeoSocialPosts(
  organizationId: string,
  opts?: { contentId?: string | null; platform?: string | null },
): Promise<SeoSocialPostRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT
        id, organization_id, user_id, content_id, platform, post_type,
        (
          (copy - 'imageDataUrl')
          || jsonb_build_object(
            'hasImage',
            CASE
              WHEN COALESCE(copy->>'imageDataUrl', '') LIKE 'data:image%'
                OR COALESCE(copy->>'imageUrl', '') LIKE 'http%'
              THEN TRUE
              ELSE FALSE
            END
          )
        ) AS copy,
        status, scheduled_at, published_at, external_post_id, last_error,
        accounts_connection_id, created_at, updated_at
     FROM crm.seo_social_posts
     WHERE organization_id = $1::bigint
       AND ($2::text IS NULL OR content_id = $2)
       AND ($3::text IS NULL OR platform = $3)
     ORDER BY updated_at DESC
     LIMIT 200`,
    organizationId,
    opts?.contentId?.trim() || null,
    opts?.platform?.trim() || null,
  );
  return rows.map(mapSocialPost);
}

export async function getSeoSocialPost(
  organizationId: string,
  id: string,
): Promise<SeoSocialPostRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_social_posts
     WHERE organization_id = $1::bigint AND id = $2
     LIMIT 1`,
    organizationId,
    id,
  );
  return rows[0] ? mapSocialPost(rows[0]) : null;
}

export async function getSeoSocialPostById(
  id: string,
): Promise<SeoSocialPostRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_social_posts WHERE id = $1 LIMIT 1`,
    id,
  );
  return rows[0] ? mapSocialPost(rows[0]) : null;
}

export async function upsertSeoSocialPost(input: {
  organizationId: string;
  userId?: string | null;
  contentId?: string | null;
  platform: string;
  postType?: string | null;
  copy: Prisma.InputJsonValue;
  status?: string | null;
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  externalPostId?: string | null;
  lastError?: string | null;
  accountsConnectionId?: string | null;
  id?: string | null;
}): Promise<SeoSocialPostRow | null> {
  const prisma = getPrismaClient();
  const id = input.id?.trim() || cuidLike("seosp");
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO crm.seo_social_posts (
      id, organization_id, user_id, content_id, platform, post_type, copy, status,
      scheduled_at, published_at, external_post_id, last_error, accounts_connection_id,
      created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::bigint, $4, $5, $6, $7::jsonb, $8,
      $9, $10, $11, $12, $13, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      content_id = EXCLUDED.content_id,
      platform = EXCLUDED.platform,
      post_type = EXCLUDED.post_type,
      copy = EXCLUDED.copy,
      status = EXCLUDED.status,
      scheduled_at = EXCLUDED.scheduled_at,
      published_at = EXCLUDED.published_at,
      external_post_id = EXCLUDED.external_post_id,
      last_error = EXCLUDED.last_error,
      accounts_connection_id = EXCLUDED.accounts_connection_id,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.userId?.trim() || null,
    input.contentId ?? null,
    input.platform,
    input.postType?.trim() || "feed",
    JSON.stringify(input.copy ?? {}),
    input.status?.trim() || "draft",
    input.scheduledAt ?? null,
    input.publishedAt ?? null,
    input.externalPostId ?? null,
    input.lastError ?? null,
    input.accountsConnectionId ?? null,
  );
  return rows[0] ? mapSocialPost(rows[0]) : null;
}

export async function scheduleSeoSocialPostRow(input: {
  organizationId: string;
  id: string;
  scheduledAt: Date;
}): Promise<SeoSocialPostRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE crm.seo_social_posts
    SET status = 'scheduled',
        scheduled_at = $3,
        updated_at = NOW()
    WHERE organization_id = $1::bigint AND id = $2
    RETURNING
      id, organization_id, user_id, content_id, platform, post_type,
      (
        (copy - 'imageDataUrl')
        || jsonb_build_object(
          'hasImage',
          CASE
            WHEN COALESCE(copy->>'imageDataUrl', '') LIKE 'data:image%'
              OR COALESCE(copy->>'imageUrl', '') LIKE 'http%'
            THEN TRUE
            ELSE FALSE
          END
        )
      ) AS copy,
      status, scheduled_at, published_at, external_post_id, last_error,
      accounts_connection_id, created_at, updated_at
    `,
    input.organizationId,
    input.id,
    input.scheduledAt,
  );
  return rows[0] ? mapSocialPost(rows[0]) : null;
}

export async function deleteSeoSocialPost(
  organizationId: string,
  id: string,
): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    DELETE FROM crm.seo_social_posts
    WHERE organization_id = $1::bigint
      AND id = $2
      AND COALESCE(status, 'draft') <> 'published'
    RETURNING id
    `,
    organizationId,
    id,
  );
  return Boolean(rows[0]?.id);
}

export async function getSeoSocialPostStatus(
  organizationId: string,
  id: string,
): Promise<string | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ status: string }[]>(
    `
    SELECT COALESCE(status, 'draft') AS status
    FROM crm.seo_social_posts
    WHERE organization_id = $1::bigint AND id = $2
    LIMIT 1
    `,
    organizationId,
    id,
  );
  return rows[0]?.status ?? null;
}

export async function listDueSeoSocialPosts(
  limit = 25,
): Promise<SeoSocialPostRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM crm.seo_social_posts
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT $1`,
    Math.min(Math.max(limit, 1), 100),
  );
  return rows.map(mapSocialPost);
}
