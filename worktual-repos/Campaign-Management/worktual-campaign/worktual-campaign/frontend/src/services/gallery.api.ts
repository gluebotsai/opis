import { apiGet, apiPost } from "@/services/api";

export type GalleryJobProgress = {
  phase?: string;
  ideasDone?: number;
  ideasTarget?: number;
  templatesDone?: number;
  templatesTarget?: number;
  legacyHidden?: boolean;
  ideasEmptyRetries?: number;
  templateFailures?: Record<string, number>;
  lastTemplateError?: string;
};

export type GalleryJobDto = {
  id: string;
  organizationId: string;
  jobType: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  channelsSnapshot: string[];
  progress: GalleryJobProgress;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type GalleryStatusDto = {
  enabled: boolean;
  job: GalleryJobDto | null;
  ideaCount: number;
  templateCount: number;
  minIdeas: number;
  galleryComplete?: boolean;
  readyChannels?: string[];
  missingTemplates?: number;
};

type ApiBody<T> = { statusCode?: number; message?: string } & T;

let bootstrapPromise: Promise<void> | null = null;

export async function postGalleryBootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      await apiPost<ApiBody<{ enqueued?: boolean }>>(
        "/templates/gallery/bootstrap",
        {},
      );
    } catch {
      /* non-blocking on login */
    } finally {
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}

export async function fetchGalleryStatus(): Promise<GalleryStatusDto | null> {
  try {
    const { data } = await apiGet<ApiBody<GalleryStatusDto>>(
      "/templates/gallery/status",
    );
    return data;
  } catch {
    return null;
  }
}
