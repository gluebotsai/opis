// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import { AppError } from "../helpers/response-builders.js";
import {
  parseGalleryMetadata,
  shouldShowInGalleryList,
} from "../helpers/gallery-metadata.js";
import { isCurrentGalleryTemplateKey } from "../helpers/gallery-template-specs.js";

export function publicLibraryTemplate(row: {
  id: string;
  organizationId: string;
  source: string;
  seedSlug: string | null;
  seedCatalog: string;
  name: string;
  description: string;
  styleNotes: string;
  goal: string;
  primaryChannel: string;
  channels: unknown;
  audience: string;
  flowSteps: unknown;
  starterMessage: string;
  approvalStatus: string;
  bodyPreview: string;
  contentBody: string;
  previewImage: string | null;
  preview: unknown;
  fields: unknown;
  metadata: unknown;
  usedCount: number;
  externalTemplateId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const metadata = parseGalleryMetadata(row.metadata);
  return {
    id: String(row.id),
    source: row.source,
    seedSlug: row.seedSlug,
    seedCatalog: row.seedCatalog || undefined,
    galleryKey: row.seedSlug || undefined,
    name: row.name,
    description: row.description,
    styleNotes: row.styleNotes,
    goal: row.goal,
    primaryChannel: row.primaryChannel,
    externalTemplateId: row.externalTemplateId || "",
    channels: Array.isArray(row.channels) ? row.channels : [],
    audience: row.audience,
    flowSteps: Array.isArray(row.flowSteps) ? row.flowSteps : [],
    starterMessage: row.starterMessage,
    approvalStatus: row.approvalStatus === "draft" ? "draft" : "approved",
    bodyPreview: row.bodyPreview,
    contentBody: row.contentBody,
    usedCount: row.usedCount || 0,
    previewImage: row.previewImage ?? null,
    preview: row.preview && typeof row.preview === "object" ? row.preview : null,
    fields:
      row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
        ? row.fields
        : null,
    metadata,
    createdByUserId: row.createdByUserId ? String(row.createdByUserId) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ListLibraryTemplatesOptions = {
  includeLocked?: boolean;
  includeHidden?: boolean;
};

export async function hideLegacyStaticLibraryTemplates(
  organizationId: string,
): Promise<number> {
  const rows = await prisma.campaignLibraryTemplate.findMany({
    where: { organizationId, source: "system" },
    select: { id: true, metadata: true },
  });
  let updated = 0;
  for (const row of rows) {
    const meta = parseGalleryMetadata(row.metadata);
    if (meta.galleryStatus === "hidden") continue;
    await prisma.campaignLibraryTemplate.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...meta,
          galleryStatus: "hidden",
          legacyStaticSeed: true,
        } as Prisma.InputJsonValue,
      },
    });
    updated += 1;
  }
  return updated;
}

/** Remove static seeds and pre-gallery generated rows for this org. */
export async function purgeObsoleteLibraryTemplates(
  organizationId: string,
): Promise<{ deletedSystem: number; deletedStaleGenerated: number }> {
  const system = await prisma.campaignLibraryTemplate.deleteMany({
    where: { organizationId, source: "system" },
  });

  const generated = await prisma.campaignLibraryTemplate.findMany({
    where: { organizationId, source: "generated" },
    select: { id: true, seedSlug: true },
  });
  const staleIds = generated
    .filter((row) => {
      const key = String(row.seedSlug || "").trim();
      return !key || !isCurrentGalleryTemplateKey(key);
    })
    .map((row) => row.id);

  let deletedStaleGenerated = 0;
  if (staleIds.length) {
    const res = await prisma.campaignLibraryTemplate.deleteMany({
      where: { organizationId, id: { in: staleIds } },
    });
    deletedStaleGenerated = res.count;
  }

  return {
    deletedSystem: system.count,
    deletedStaleGenerated,
  };
}

export async function listLibraryTemplatesDao(
  organizationId: string,
  options: ListLibraryTemplatesOptions = {},
) {
  const rows = await prisma.campaignLibraryTemplate.findMany({
    where: { organizationId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows
    .filter((row) =>
      shouldShowInGalleryList({
        source: row.source,
        metadata: row.metadata,
        seedSlug: row.seedSlug,
        includeLocked: options.includeLocked,
        includeHidden: options.includeHidden,
      }),
    )
    .map(publicLibraryTemplate);
}

export async function libraryTemplateExistsByGalleryKey(
  organizationId: string,
  galleryKey: string,
): Promise<boolean> {
  const row = await prisma.campaignLibraryTemplate.findFirst({
    where: { organizationId, seedSlug: galleryKey },
    select: { id: true, contentBody: true },
  });
  return Boolean(row && String(row.contentBody || "").trim());
}

export async function upsertGeneratedLibraryTemplateDao(input: {
  organizationId: string;
  galleryKey: string;
  name: string;
  description?: string;
  styleNotes?: string;
  goal?: string;
  primaryChannel: string;
  channels?: string[];
  bodyPreview?: string;
  contentBody?: string;
  previewImage?: string | null;
  preview?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}): Promise<ReturnType<typeof publicLibraryTemplate>> {
  const existing = await prisma.campaignLibraryTemplate.findFirst({
    where: {
      organizationId: input.organizationId,
      seedSlug: input.galleryKey,
    },
  });

  const data = {
    source: "generated",
    seedCatalog: "gallery-v1",
    name: input.name.trim(),
    description: (input.description || "").trim(),
    styleNotes: (input.styleNotes || "").trim(),
    goal: (input.goal || "Engagement").trim(),
    primaryChannel: input.primaryChannel,
    channels: (input.channels?.length ? input.channels : [input.primaryChannel]) as Prisma.InputJsonValue,
    audience: "",
    flowSteps: [] as Prisma.InputJsonValue,
    starterMessage: `Started from ${input.name.trim()}.`,
    approvalStatus: "approved",
    bodyPreview: (input.bodyPreview || "").trim(),
    contentBody: (input.contentBody || "").trim(),
    previewImage: input.previewImage ?? null,
    preview: (input.preview ?? null) as Prisma.InputJsonValue,
    fields: (input.fields ?? null) as Prisma.InputJsonValue,
    metadata: (input.metadata || {}) as Prisma.InputJsonValue,
  };

  const row = existing
    ? await prisma.campaignLibraryTemplate.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.campaignLibraryTemplate.create({
        data: {
          organizationId: input.organizationId,
          seedSlug: input.galleryKey,
          externalTemplateId: "",
          usedCount: 0,
          ...data,
        },
      });

  return publicLibraryTemplate(row);
}

export async function setLibraryTemplatesChannelLock(
  organizationId: string,
  channel: string,
  locked: boolean,
): Promise<number> {
  const rows = await prisma.campaignLibraryTemplate.findMany({
    where: { organizationId, primaryChannel: channel, source: "generated" },
    select: { id: true, metadata: true },
  });
  let count = 0;
  for (const row of rows) {
    const meta = parseGalleryMetadata(row.metadata);
    const nextStatus = locked ? "locked" : "active";
    if (meta.galleryStatus === nextStatus) continue;
    await prisma.campaignLibraryTemplate.update({
      where: { id: row.id },
      data: {
        metadata: { ...meta, galleryStatus: nextStatus } as Prisma.InputJsonValue,
      },
    });
    count += 1;
  }
  return count;
}

export async function getLibraryTemplateDao(
  organizationId: string,
  id: string,
) {
  const row = await prisma.campaignLibraryTemplate.findFirst({
    where: { id, organizationId },
  });
  return row ? publicLibraryTemplate(row) : null;
}

export type CreateLibraryTemplateInput = {
  name: string;
  description?: string;
  styleNotes?: string;
  goal?: string;
  primaryChannel: string;
  channels?: string[];
  audience?: string;
  flowSteps?: string[];
  starterMessage?: string;
  approvalStatus?: "draft" | "approved";
  bodyPreview?: string;
  contentBody?: string;
  previewImage?: string | null;
  preview?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  externalTemplateId?: string;
  createdByUserId?: string | null;
};

export async function createLibraryTemplateDao(
  organizationId: string,
  input: CreateLibraryTemplateInput,
) {
  const channelLabel =
    input.channels?.[0] ||
    ({
      email: "Email",
      sms: "SMS",
      whatsapp: "WhatsApp",
      web_push: "Web Push",
      app_push: "App Push",
      ppc: "PPC",
    }[input.primaryChannel] ??
      input.primaryChannel);

  const contentBody =
    input.contentBody?.trim() ||
    input.bodyPreview?.trim() ||
    input.description?.trim() ||
    "";

  const row = await prisma.campaignLibraryTemplate.create({
    data: {
      organizationId,
      source: "user",
      seedSlug: null,
      seedCatalog: "",
      name: input.name.trim(),
      description: (input.description || "").trim(),
      styleNotes: (input.styleNotes || "").trim(),
      goal: (input.goal || "Engagement").trim(),
      primaryChannel: input.primaryChannel,
      channels: (input.channels?.length
        ? input.channels
        : [channelLabel]) as Prisma.InputJsonValue,
      audience: (input.audience || "All contacts").trim(),
      flowSteps: (input.flowSteps?.length
        ? input.flowSteps
        : [
            "Audience enters campaign",
            `First touch: ${channelLabel}`,
          ]) as Prisma.InputJsonValue,
      starterMessage:
        (input.starterMessage || "").trim() ||
        `Started from your ${channelLabel} template. Tell me what to change.`,
      approvalStatus: input.approvalStatus || "approved",
      bodyPreview:
        (input.bodyPreview || "").trim() ||
        contentBody.slice(0, 280) ||
        "Sample marketing copy for this channel.",
      contentBody,
      previewImage: input.previewImage ?? null,
      preview: (input.preview ?? null) as Prisma.InputJsonValue,
      fields: (input.fields ?? null) as Prisma.InputJsonValue,
      metadata: {
        ...(input.metadata || {}),
        galleryStatus: "active",
      } as Prisma.InputJsonValue,
      externalTemplateId: input.externalTemplateId || "",
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return publicLibraryTemplate(row);
}

export type UpdateLibraryTemplateInput = Partial<CreateLibraryTemplateInput>;

export async function updateLibraryTemplateDao(
  organizationId: string,
  id: string,
  input: UpdateLibraryTemplateInput,
) {
  const existing = await prisma.campaignLibraryTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new AppError("Template not found", 404);

  const row = await prisma.campaignLibraryTemplate.update({
    where: { id },
    data: {
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.description != null
        ? { description: input.description.trim() }
        : {}),
      ...(input.styleNotes != null
        ? { styleNotes: input.styleNotes.trim() }
        : {}),
      ...(input.goal != null ? { goal: input.goal.trim() } : {}),
      ...(input.primaryChannel != null
        ? { primaryChannel: input.primaryChannel }
        : {}),
      ...(input.channels != null
        ? { channels: input.channels as Prisma.InputJsonValue }
        : {}),
      ...(input.audience != null ? { audience: input.audience.trim() } : {}),
      ...(input.flowSteps != null
        ? { flowSteps: input.flowSteps as Prisma.InputJsonValue }
        : {}),
      ...(input.starterMessage != null
        ? { starterMessage: input.starterMessage.trim() }
        : {}),
      ...(input.approvalStatus != null
        ? { approvalStatus: input.approvalStatus }
        : {}),
      ...(input.bodyPreview != null
        ? { bodyPreview: input.bodyPreview.trim() }
        : {}),
      ...(input.contentBody != null
        ? { contentBody: input.contentBody.trim() }
        : {}),
      ...(input.previewImage !== undefined
        ? { previewImage: input.previewImage }
        : {}),
      ...(input.preview !== undefined
        ? { preview: input.preview as Prisma.InputJsonValue }
        : {}),
      ...(input.fields !== undefined
        ? { fields: input.fields as Prisma.InputJsonValue }
        : {}),
      ...(input.metadata != null
        ? { metadata: input.metadata as Prisma.InputJsonValue }
        : {}),
      ...(input.externalTemplateId != null
        ? { externalTemplateId: input.externalTemplateId }
        : {}),
    },
  });
  return publicLibraryTemplate(row);
}

export async function deleteLibraryTemplateDao(
  organizationId: string,
  id: string,
) {
  const existing = await prisma.campaignLibraryTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new AppError("Template not found", 404);
  if (existing.source === "system") {
    throw new AppError("Legacy system templates cannot be deleted.", 400);
  }
  await prisma.campaignLibraryTemplate.delete({ where: { id } });
}

export async function bumpLibraryTemplateUsedDao(
  organizationId: string,
  id: string,
) {
  const existing = await prisma.campaignLibraryTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) return null;
  const row = await prisma.campaignLibraryTemplate.update({
    where: { id },
    data: { usedCount: { increment: 1 } },
  });
  return publicLibraryTemplate(row);
}
