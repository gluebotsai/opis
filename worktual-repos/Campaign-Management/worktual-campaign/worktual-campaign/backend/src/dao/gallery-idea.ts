// @ts-nocheck
import { prisma } from "../plugins/prisma.js";
import { GALLERY_GENERATION_VERSION } from "../helpers/gallery-metadata.js";

export type PublicGalleryIdea = {
  id: string;
  organizationId: string;
  ideaKey: string;
  title: string;
  summary: string;
  industry: string;
  industryType: string;
  packId: string;
  imageUrl: string | null;
  imageMeta: Record<string, unknown>;
  generationVersion: string;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

function toPublic(row: {
  id: bigint | string;
  organizationId: bigint | string;
  ideaKey: string;
  title: string;
  summary: string;
  industry: string;
  industryType: string;
  packId: string;
  imageUrl: string | null;
  imageMeta: unknown;
  generationVersion: string;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): PublicGalleryIdea {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    ideaKey: row.ideaKey,
    title: row.title,
    summary: row.summary,
    industry: row.industry,
    industryType: row.industryType,
    packId: row.packId,
    imageUrl: row.imageUrl,
    imageMeta:
      row.imageMeta && typeof row.imageMeta === "object" && !Array.isArray(row.imageMeta)
        ? (row.imageMeta as Record<string, unknown>)
        : {},
    generationVersion: row.generationVersion,
    status: row.status,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function countActiveGalleryIdeas(organizationId: string): Promise<number> {
  return prisma.campaignGalleryIdea.count({
    where: { organizationId, status: "active" },
  });
}

export async function listGalleryIdeasDao(
  organizationId: string,
): Promise<PublicGalleryIdea[]> {
  const rows = await prisma.campaignGalleryIdea.findMany({
    where: { organizationId, status: "active" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return rows.map(toPublic);
}

export async function getGalleryIdeaByKey(
  organizationId: string,
  ideaKey: string,
): Promise<PublicGalleryIdea | null> {
  const row = await prisma.campaignGalleryIdea.findFirst({
    where: { organizationId, ideaKey },
  });
  return row ? toPublic(row) : null;
}

export async function upsertGalleryIdeaDao(input: {
  organizationId: string;
  ideaKey: string;
  title: string;
  summary?: string;
  industry?: string;
  industryType?: string;
  packId?: string;
  sortOrder?: number;
  generationVersion?: string;
  imageUrl?: string | null;
  imageMeta?: Record<string, unknown>;
}): Promise<PublicGalleryIdea> {
  const row = await prisma.campaignGalleryIdea.upsert({
    where: {
      organizationId_ideaKey: {
        organizationId: input.organizationId,
        ideaKey: input.ideaKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      ideaKey: input.ideaKey,
      title: input.title.trim(),
      summary: (input.summary || "").trim(),
      industry: (input.industry || "").trim(),
      industryType: (input.industryType || "").trim(),
      packId: input.packId || "generic-b2b",
      sortOrder: input.sortOrder ?? 0,
      generationVersion: input.generationVersion || GALLERY_GENERATION_VERSION,
      imageUrl: input.imageUrl ?? null,
      imageMeta: input.imageMeta || {},
      status: "active",
    },
    update: {
      title: input.title.trim(),
      summary: (input.summary || "").trim(),
      ...(input.industry != null ? { industry: input.industry.trim() } : {}),
      ...(input.industryType != null
        ? { industryType: input.industryType.trim() }
        : {}),
      ...(input.packId != null ? { packId: input.packId } : {}),
      ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.imageMeta != null ? { imageMeta: input.imageMeta } : {}),
    },
  });
  return toPublic(row);
}

export async function listGalleryIdeasNeedingTemplates(
  organizationId: string,
  limit = 1,
): Promise<PublicGalleryIdea[]> {
  const ideas = await listGalleryIdeasDao(organizationId);
  return ideas.slice(0, limit);
}
