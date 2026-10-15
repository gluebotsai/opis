import { api, apiGet } from "@/services/api";

type ApiEnvelope<T> = {
  statusCode?: number;
  message?: string;
} & T;

export type ImageGalleryAsset = {
  id: string;
  media_id: string;
  image_url: string;
  short_description: string;
  generation_prompt: string;
  source: "ai_generated" | "uploaded" | "imported" | string;
  channel: string;
  context: Record<string, unknown>;
  reuse_tags: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function fetchImageGallery(opts?: {
  q?: string;
  status?: "active" | "archived";
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  const { data } = await apiGet<
    ApiEnvelope<{ assets: ImageGalleryAsset[]; total: number }>
  >(`/image-gallery${qs ? `?${qs}` : ""}`);
  return {
    assets: data.assets || [],
    total: typeof data.total === "number" ? data.total : 0,
  };
}

export async function registerImageGalleryAsset(payload: {
  image_url: string;
  media_id?: string;
  short_description?: string;
  generation_prompt?: string;
  source?: "ai_generated" | "uploaded" | "imported";
  channel?: string;
}) {
  const { data } = await api.post<
    ApiEnvelope<{ asset: ImageGalleryAsset }>
  >("/image-gallery/register", payload);
  return data.asset;
}

export async function archiveImageGalleryAsset(id: string) {
  const { data } = await api.patch<ApiEnvelope<{ asset: ImageGalleryAsset }>>(
    `/image-gallery/${id}/archive`,
    {},
  );
  return data.asset;
}
