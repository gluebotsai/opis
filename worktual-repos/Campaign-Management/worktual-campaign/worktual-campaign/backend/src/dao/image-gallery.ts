// @ts-nocheck — worktual_bigint Prisma BigInt ids
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";

export type ImageGallerySource = "ai_generated" | "uploaded" | "imported";

export function toPublicImageGalleryAsset(row: {
  id: bigint | string;
  organizationId: bigint | string;
  mediaId: string;
  imageUrl: string;
  shortDescription: string;
  generationPrompt: string;
  source: string;
  channel: string;
  context: Prisma.JsonValue;
  reuseTags: Prisma.JsonValue;
  status: string;
  createdByUserId: bigint | string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(row.id),
    media_id: row.mediaId,
    image_url: row.imageUrl,
    short_description: row.shortDescription,
    generation_prompt: row.generationPrompt,
    source: row.source,
    channel: row.channel,
    context:
      row.context && typeof row.context === "object" && !Array.isArray(row.context)
        ? row.context
        : {},
    reuse_tags:
      row.reuseTags &&
      typeof row.reuseTags === "object" &&
      !Array.isArray(row.reuseTags)
        ? row.reuseTags
        : {},
    status: row.status,
    created_by_user_id: row.createdByUserId ? String(row.createdByUserId) : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

const UUID_IN_URL =
  /\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

export function mediaIdFromImageUrl(imageUrl: string, explicit?: string): string {
  const id = String(explicit || "").trim();
  if (id) return id;
  const match = String(imageUrl || "").match(UUID_IN_URL);
  return match?.[1] || "";
}

export async function listImageGalleryAssetsDao(
  organizationId: bigint | string,
  opts?: {
    q?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
) {
  const orgId = BigInt(organizationId);
  const status = (opts?.status || "active").trim() || "active";
  const q = String(opts?.q || "").trim();
  const limit = Math.min(Math.max(opts?.limit ?? 48, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);

  const where: Prisma.CampaignImageGalleryAssetWhereInput = {
    organizationId: orgId,
    status,
  };
  if (q) {
    where.OR = [
      { shortDescription: { contains: q, mode: "insensitive" } },
      { generationPrompt: { contains: q, mode: "insensitive" } },
      { channel: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.campaignImageGalleryAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.campaignImageGalleryAsset.count({ where }),
  ]);

  return {
    assets: rows.map(toPublicImageGalleryAsset),
    total,
  };
}

export async function registerImageGalleryAssetDao(
  session: CampaignSessionUser,
  input: {
    media_id?: string;
    image_url: string;
    short_description?: string;
    generation_prompt?: string;
    source?: string;
    channel?: string;
    context?: Record<string, unknown>;
    reuse_tags?: Record<string, unknown>;
  },
) {
  const orgId = BigInt(session.organizationId);
  const imageUrl = String(input.image_url || "").trim();
  if (!imageUrl) {
    throw new Error("image_url is required");
  }
  const mediaId = mediaIdFromImageUrl(imageUrl, input.media_id);
  if (!mediaId) {
    throw new Error("Could not resolve media_id from image_url");
  }

  const existing = await prisma.campaignImageGalleryAsset.findUnique({
    where: {
      organizationId_mediaId: {
        organizationId: orgId,
        mediaId,
      },
    },
  });
  if (existing) {
    return toPublicImageGalleryAsset(existing);
  }

  const source = String(input.source || "uploaded").trim() || "uploaded";
  const row = await prisma.campaignImageGalleryAsset.create({
    data: {
      organizationId: orgId,
      mediaId,
      imageUrl,
      shortDescription: String(input.short_description || "").trim().slice(0, 500),
      generationPrompt: String(input.generation_prompt || "").trim().slice(0, 8000),
      source,
      channel: String(input.channel || "").trim().slice(0, 64),
      context: (input.context || {}) as Prisma.InputJsonValue,
      reuseTags: (input.reuse_tags || {}) as Prisma.InputJsonValue,
      status: "active",
      createdByUserId: BigInt(session.id),
    },
  });
  return toPublicImageGalleryAsset(row);
}

export async function archiveImageGalleryAssetDao(
  session: CampaignSessionUser,
  assetId: string,
) {
  const orgId = BigInt(session.organizationId);
  const id = BigInt(assetId);
  const row = await prisma.campaignImageGalleryAsset.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!row) return null;
  const updated = await prisma.campaignImageGalleryAsset.update({
    where: { id: row.id },
    data: { status: "archived" },
  });
  return toPublicImageGalleryAsset(updated);
}
