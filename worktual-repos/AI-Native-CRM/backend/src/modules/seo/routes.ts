/**
 * Marketing SEO HTTP API — projects, snapshots, generated content.
 * Prefix: /api/seo
 */

import type { FastifyPluginAsync } from "fastify";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  requireModuleEnabled,
  requireRole,
} from "@/service/auth/require-role";
import { canAccessMarketingSeo } from "@/service/seo/seo-access";
import {
  deleteSeoGeneratedContent,
  getLatestSeoKeywordQuery,
  getSeoGeneratedContent,
  getSeoKeywordQuery,
  getSeoSocialPost,
  getSeoSocialPostById,
  mergeSocialCopy,
  listSeoGeneratedContent,
  listSeoProjects,
  listSeoSavedKeywords,
  listSeoSocialPosts,
  listSeoToolSnapshots,
  deleteSeoSocialPost,
  getSeoSocialPostStatus,
  patchSeoSocialCopyFields,
  saveSeoGeneratedContent,
  saveSeoKeyword,
  scheduleSeoSocialPostRow,
  slimSocialPostForClient,
  socialCopyPatchNeedsFullUpsert,
  upsertSeoSocialPost,
} from "@/dao/seo/seo-store";
import { researchSeoKeywords } from "@/service/seo/keyword-research";
import {
  filterKeywordRows,
  parseKeywordPayload,
  type KeywordFilters,
} from "@/service/seo/keyword-cache";
import { listSocialPublishingStatus } from "@/dao/account/setup-app-connections";
import { publishSeoSocialPost } from "@/service/seo/social-publish";
import { generateSeoSocialFromContent } from "@/service/seo/social-generate";
import {
  copyImageBytes,
  verifySocialImageSig,
} from "@/service/seo/social-image-public";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError } from "../../helpers/response.js";
import type { Prisma } from "@prisma/client";
import { RESPONSE } from "../../helpers/constants.js";
import { getServerUserId } from "@/service/account/session-cookie";

export const seoRoutes: FastifyPluginAsync = async (app) => {
  async function gate(reply: Parameters<typeof sendError>[0]) {
    try {
      await requireModuleEnabled("marketing");
      await requireRole(canAccessMarketingSeo);
      return true;
    } catch (err) {
      if (err instanceof ForbiddenError) {
        await sendError(reply, err.message, err.statusCode);
        return false;
      }
      throw err;
    }
  }

  /** Instagram Graph fetches this without a session cookie. HMAC-gated. */
  app.get<{
    Params: { id: string };
    Querystring: { exp?: string; sig?: string };
  }>("/public/social-image/:id", async (request, reply) => {
    const id = String(request.params.id || "").trim();
    const exp = String(request.query.exp || "");
    const sig = String(request.query.sig || "");
    if (!verifySocialImageSig(id, exp, sig)) {
      return sendError(reply, "Invalid or expired image link", 403);
    }
    const post = await getSeoSocialPostById(id);
    const image = post ? copyImageBytes(post.copy) : null;
    if (!image) return sendError(reply, "Image not found", 404);
    return reply
      .header("Cache-Control", "private, max-age=300")
      .type(image.mime)
      .send(image.bytes);
  });

  app.get("/projects", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const projects = await listSeoProjects(organizationId);
        return sendSuccess(reply, { projects });
      },
      request,
    );
  });

  app.get<{
    Querystring: { projectId?: string; toolName?: string };
  }>("/snapshots", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const snapshots = await listSeoToolSnapshots(
          organizationId,
          request.query.projectId,
          request.query.toolName,
        );
        return sendSuccess(reply, { snapshots });
      },
      request,
    );
  });

  app.get<{
    Querystring: {
      contentType?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>("/content", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const result = await listSeoGeneratedContent(organizationId, {
          contentType: request.query.contentType,
          search: request.query.search,
          limit: request.query.limit
            ? Number(request.query.limit)
            : undefined,
          offset: request.query.offset
            ? Number(request.query.offset)
            : undefined,
        });
        return sendSuccess(reply, {
          items: result.rows,
          total: result.total,
        });
      },
      request,
    );
  });

  app.get<{ Params: { id: string } }>("/content/:id", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const item = await getSeoGeneratedContent(
          organizationId,
          request.params.id,
        );
        if (!item) return sendError(reply, "Not found", 404);
        return sendSuccess(reply, { item });
      },
      request,
    );
  });

  app.post<{
    Body: {
      id?: string;
      projectId?: string;
      contentType?: string;
      title?: string;
      slug?: string;
      seoScore?: number;
      body?: Record<string, unknown>;
      status?: string;
      campaignId?: string;
      primaryKeyword?: string;
      keywordQueryId?: string;
    };
  }>("/content", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const body = request.body || {};
        const contentType = String(body.contentType || "").trim();
        const title = String(body.title || "").trim();
        if (!contentType || !title) {
          return sendError(reply, "contentType and title are required", 400);
        }
        const actorId = (await getServerUserId()) || userId;
        const item = await saveSeoGeneratedContent({
          organizationId,
          userId: actorId,
          projectId: body.projectId ?? null,
          contentType,
          title,
          slug: body.slug ?? null,
          seoScore:
            typeof body.seoScore === "number" ? body.seoScore : null,
          body: (body.body ?? {}) as import("@prisma/client").Prisma.InputJsonValue,
          id: body.id ?? null,
          status: body.status ?? null,
          campaignId: body.campaignId ?? null,
          primaryKeyword: body.primaryKeyword ?? null,
          keywordQueryId: body.keywordQueryId ?? null,
        });
        return sendSuccess(reply, { item }, RESPONSE.success_message, 201);
      },
      request,
    );
  });

  app.delete<{ Params: { id: string } }>(
    "/content/:id",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          if (!(await gate(reply))) return;
          const organizationId = await getCurrentOrganizationId();
          const ok = await deleteSeoGeneratedContent(
            organizationId,
            request.params.id,
          );
          if (!ok) return sendError(reply, "Not found", 404);
          return sendSuccess(reply, { deleted: true });
        },
        request,
      );
    },
  );

  app.get<{
    Querystring: {
      queryId?: string;
      intent?: string;
      minVolume?: string;
      maxKd?: string;
      search?: string;
    };
  }>("/keywords", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const query = request.query.queryId
          ? await getSeoKeywordQuery(organizationId, request.query.queryId)
          : await getLatestSeoKeywordQuery(organizationId);
        const filters: KeywordFilters = {
          intent: request.query.intent || null,
          minVolume: request.query.minVolume
            ? Number(request.query.minVolume)
            : null,
          maxKd: request.query.maxKd ? Number(request.query.maxKd) : null,
          search: request.query.search || null,
        };
        const raw = parseKeywordPayload(query?.payload);
        const saved = query
          ? await listSeoSavedKeywords(organizationId, query.id)
          : [];
        const queryFilters =
          query?.filters && typeof query.filters === "object" && !Array.isArray(query.filters)
            ? (query.filters as Record<string, unknown>)
            : {};
        const source =
          queryFilters.source === "llm" ||
          (query ? filterKeywordRows(raw, filters) : []).some(
            (row) => row.source === "llm_estimate",
          )
            ? "llm"
            : query
              ? "semrush"
              : null;
        return sendSuccess(reply, {
          query,
          rows: query ? filterKeywordRows(raw, filters) : [],
          saved,
          error: query?.error ?? null,
          source,
        });
      },
      request,
    );
  });

  app.post<{
    Body: {
      seed?: string;
      location?: string;
      language?: string;
      filters?: KeywordFilters;
    };
  }>("/keywords/research", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const actorId = (await getServerUserId()) || userId;
        const seed = String(request.body?.seed || "").trim();
        if (!seed) return sendError(reply, "seed is required", 400);
        const result = await researchSeoKeywords({
          organizationId,
          userId: actorId,
          seed,
          location: request.body?.location,
          language: request.body?.language,
          filters: request.body?.filters,
        });
        if (!result.ok) {
          return sendSuccess(
            reply,
            { data: result },
            result.error || "Semrush unavailable",
          );
        }
        return sendSuccess(reply, { data: result });
      },
      request,
    );
  });

  app.post<{
    Body: {
      queryId?: string;
      term?: string;
      metrics?: Record<string, unknown>;
      contentId?: string;
    };
  }>("/keywords/save", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const queryId = String(request.body?.queryId || "").trim();
        const term = String(request.body?.term || "").trim();
        if (!queryId || !term) {
          return sendError(reply, "queryId and term are required", 400);
        }
        const item = await saveSeoKeyword({
          organizationId,
          queryId,
          term,
          metrics: (request.body?.metrics ?? {}) as Prisma.InputJsonValue,
          contentId: request.body?.contentId ?? null,
        });
        return sendSuccess(reply, { item }, RESPONSE.success_message, 201);
      },
      request,
    );
  });

  app.get<{
    Querystring: { contentId?: string; platform?: string };
  }>("/social", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const items = await listSeoSocialPosts(organizationId, {
          contentId: request.query.contentId,
          platform: request.query.platform,
        });
        return sendSuccess(reply, { items });
      },
      request,
    );
  });

  app.get<{ Params: { id: string } }>(
    "/social/:id/image",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          if (!(await gate(reply))) return;
          const organizationId = await getCurrentOrganizationId();
          const post = await getSeoSocialPost(
            organizationId,
            request.params.id,
          );
          const image = post ? copyImageBytes(post.copy) : null;
          if (!image) return sendError(reply, "Image not found", 404);
          return reply
            .header("Cache-Control", "private, max-age=120")
            .type(image.mime)
            .send(image.bytes);
        },
        request,
      );
    },
  );

  app.post<{
    Body: {
      contentId?: string;
      platform?: string;
      linkedinCount?: number;
      facebookCount?: number;
      instagramCount?: number;
    };
  }>("/social/generate", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const contentId = String(request.body?.contentId || "").trim();
        if (!contentId) return sendError(reply, "contentId is required", 400);
        const existing = await getSeoGeneratedContent(organizationId, contentId);
        if (!existing) return sendError(reply, "Content not found", 404);
        const actorId = (await getServerUserId()) || userId;
        const result = await generateSeoSocialFromContent({
          organizationId,
          userId: actorId,
          contentId,
          platform: request.body?.platform,
          linkedinCount: request.body?.linkedinCount,
          facebookCount: request.body?.facebookCount,
          instagramCount: request.body?.instagramCount,
        });
        if (!result.ok) {
          return sendError(
            reply,
            result.error || "Could not generate social posts.",
            503,
          );
        }
        return sendSuccess(reply, { data: result });
      },
      request,
    );
  });

  app.get("/social-connections", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const platforms = await listSocialPublishingStatus(organizationId);
        return sendSuccess(reply, { platforms });
      },
      request,
    );
  });

  app.patch<{
    Params: { id: string };
    Body: {
      copy?: Record<string, unknown>;
      status?: string;
      scheduledAt?: string | null;
    };
  }>("/social/:id", { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const copyPatch = request.body?.copy;
        const lightCopy =
          copyPatch &&
          typeof copyPatch === "object" &&
          !Array.isArray(copyPatch) &&
          !socialCopyPatchNeedsFullUpsert(copyPatch);
        const scheduledAt =
          request.body?.scheduledAt === null
            ? null
            : request.body?.scheduledAt
              ? new Date(request.body.scheduledAt)
              : undefined;

        // Caption/status-only saves: merge in SQL, never load image bytes.
        if (
          lightCopy ||
          (!copyPatch &&
            (request.body?.status != null || scheduledAt !== undefined))
        ) {
          const item = await patchSeoSocialCopyFields({
            organizationId,
            id: request.params.id,
            copyPatch: lightCopy
              ? (copyPatch as Record<string, unknown>)
              : {},
            status: request.body?.status,
            scheduledAt: scheduledAt ?? undefined,
            clearScheduledAt: request.body?.scheduledAt === null,
          });
          if (!item) return sendError(reply, "Not found", 404);
          return sendSuccess(reply, { item });
        }

        const existing = await getSeoSocialPost(
          organizationId,
          request.params.id,
        );
        if (!existing) return sendError(reply, "Not found", 404);
        const item = await upsertSeoSocialPost({
          organizationId,
          id: existing.id,
          userId: existing.userId,
          contentId: existing.contentId,
          platform: existing.platform,
          postType: existing.postType,
          copy: mergeSocialCopy(existing.copy, request.body?.copy),
          status: request.body?.status ?? existing.status,
          scheduledAt:
            scheduledAt !== undefined ? scheduledAt : existing.scheduledAt,
          publishedAt: existing.publishedAt,
          externalPostId: existing.externalPostId,
          lastError: existing.lastError,
          accountsConnectionId: existing.accountsConnectionId,
        });
        return sendSuccess(reply, {
          item: item ? slimSocialPostForClient(item) : null,
        });
      },
      request,
    );
  });

  app.post<{
    Params: { id: string };
    Body: { scheduledAt?: string };
  }>("/social/:id/schedule", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        if (!(await gate(reply))) return;
        const organizationId = await getCurrentOrganizationId();
        const existing = await getSeoSocialPost(
          organizationId,
          request.params.id,
        );
        if (!existing) return sendError(reply, "Not found", 404);
        const when = request.body?.scheduledAt
          ? new Date(request.body.scheduledAt)
          : new Date(Date.now() + 60 * 60 * 1000);
        if (Number.isNaN(when.getTime())) {
          return sendError(reply, "Invalid scheduledAt", 400);
        }
        const item = await scheduleSeoSocialPostRow({
          organizationId,
          id: existing.id,
          scheduledAt: when,
        });
        return sendSuccess(reply, {
          item: item ? slimSocialPostForClient(item) : null,
        });
      },
      request,
    );
  });

  app.post<{ Params: { id: string } }>(
    "/social/:id/publish",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          if (!(await gate(reply))) return;
          const organizationId = await getCurrentOrganizationId();
          const result = await publishSeoSocialPost({
            organizationId,
            postId: request.params.id,
          });
          return sendSuccess(reply, { data: result });
        },
        request,
      );
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/social/:id",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          if (!(await gate(reply))) return;
          const organizationId = await getCurrentOrganizationId();
          const ok = await deleteSeoSocialPost(
            organizationId,
            request.params.id,
          );
          if (ok) {
            return sendSuccess(reply, { ok: true, id: request.params.id });
          }
          const status = await getSeoSocialPostStatus(
            organizationId,
            request.params.id,
          );
          if (status === "published") {
            return sendError(
              reply,
              "Published posts cannot be deleted from here.",
              400,
            );
          }
          return sendError(reply, "Not found", 404);
        },
        request,
      );
    },
  );
};
