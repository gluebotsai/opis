// @ts-nocheck
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";

export type GalleryJobType = "bootstrap" | "channel_delta" | "industry_append";
export type GalleryJobStatus = "queued" | "running" | "completed" | "failed";

export type GalleryJobProgress = {
  phase?: string;
  ideasDone?: number;
  ideasTarget?: number;
  templatesDone?: number;
  templatesTarget?: number;
  legacyHidden?: boolean;
  ideasEmptyRetries?: number;
  imageEmptyRetries?: number;
  lastImageError?: string;
  templateFailures?: Record<string, number>;
  lastTemplateError?: string;
};

export type PublicGalleryJob = {
  id: string;
  organizationId: string;
  jobType: GalleryJobType;
  status: GalleryJobStatus;
  channelsSnapshot: string[];
  progress: GalleryJobProgress;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseProgress(raw: unknown): GalleryJobProgress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as GalleryJobProgress;
}

function toPublic(row: {
  id: bigint | string;
  organizationId: bigint | string;
  jobType: string;
  status: string;
  channelsSnapshot: unknown;
  progress: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PublicGalleryJob {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    jobType: row.jobType as GalleryJobType,
    status: row.status as GalleryJobStatus,
    channelsSnapshot: Array.isArray(row.channelsSnapshot)
      ? row.channelsSnapshot.map(String)
      : [],
    progress: parseProgress(row.progress),
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getActiveGalleryJob(
  organizationId: string,
): Promise<PublicGalleryJob | null> {
  const row = await prisma.campaignGalleryJob.findFirst({
    where: {
      organizationId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? toPublic(row) : null;
}

export async function getLatestGalleryJob(
  organizationId: string,
): Promise<PublicGalleryJob | null> {
  const row = await prisma.campaignGalleryJob.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toPublic(row) : null;
}

export async function enqueueGalleryJob(input: {
  organizationId: string;
  jobType: GalleryJobType;
  channelsSnapshot: string[];
  progress?: GalleryJobProgress;
}): Promise<PublicGalleryJob> {
  const active = await getActiveGalleryJob(input.organizationId);
  if (active) return active;

  const row = await prisma.campaignGalleryJob.create({
    data: {
      organizationId: input.organizationId,
      jobType: input.jobType,
      status: "queued",
      channelsSnapshot: input.channelsSnapshot,
      progress: (input.progress || {
        phase: "queued",
        ideasTarget: 10,
      }) as Prisma.InputJsonValue,
    },
  });
  return toPublic(row);
}

export async function claimNextQueuedGalleryJob(): Promise<PublicGalleryJob | null> {
  const row = await prisma.campaignGalleryJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!row) return null;
  const updated = await prisma.campaignGalleryJob.update({
    where: { id: row.id },
    data: {
      status: "running",
      startedAt: row.startedAt ?? new Date(),
      progress: {
        ...parseProgress(row.progress),
        phase: "running",
      } as Prisma.InputJsonValue,
    },
  });
  return toPublic(updated);
}

export async function updateGalleryJobProgress(
  jobId: string,
  input: {
    progress?: GalleryJobProgress;
    status?: GalleryJobStatus;
    errorMessage?: string | null;
    channelsSnapshot?: string[];
  },
): Promise<PublicGalleryJob> {
  const row = await prisma.campaignGalleryJob.update({
    where: { id: jobId },
    data: {
      ...(input.progress != null
        ? { progress: input.progress as Prisma.InputJsonValue }
        : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.errorMessage !== undefined
        ? { errorMessage: input.errorMessage }
        : {}),
      ...(input.channelsSnapshot != null
        ? { channelsSnapshot: input.channelsSnapshot }
        : {}),
      ...(input.status === "completed" || input.status === "failed"
        ? { finishedAt: new Date() }
        : {}),
    },
  });
  return toPublic(row);
}

export async function listRunningGalleryJobs(): Promise<PublicGalleryJob[]> {
  const rows = await prisma.campaignGalleryJob.findMany({
    where: { status: "running" },
    orderBy: { startedAt: "asc" },
  });
  return rows.map(toPublic);
}

export async function hasPendingGalleryJobs(): Promise<boolean> {
  const count = await prisma.campaignGalleryJob.count({
    where: { status: { in: ["queued", "running"] } },
  });
  return count > 0;
}
