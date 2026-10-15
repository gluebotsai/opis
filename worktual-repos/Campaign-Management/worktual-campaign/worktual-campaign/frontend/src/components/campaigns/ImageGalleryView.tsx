import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Copy,
  ImageIcon,
  Loader2,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { uploadTemplateImage } from "@/services/media.api";
import {
  archiveImageGalleryAsset,
  fetchImageGallery,
  registerImageGalleryAsset,
  type ImageGalleryAsset,
} from "@/services/imageGallery.api";
import { normalizeTemplateMediaUrl } from "@/lib/template-preview-images";

const PAGE_SIZE = 30;

type Props = {
  /** When false, skips fetch (e.g. user is on the templates tab). */
  active?: boolean;
  /** manage = org catalog; pick = choose one image (e.g. template preview). */
  mode?: "manage" | "pick";
  onPick?: (url: string) => void;
  /** Campaign module: ids currently in the shared selection bar. */
  selectedForCampaignIds?: string[];
  onToggleCampaignSelect?: (asset: ImageGalleryAsset) => void;
};

export function ImageGalleryView({
  active = true,
  mode = "manage",
  onPick,
  selectedForCampaignIds = [],
  onToggleCampaignSelect,
}: Props) {
  const isPick = mode === "pick";
  const campaignSelectSet = new Set(selectedForCampaignIds);
  const [assets, setAssets] = useState<ImageGalleryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadDescription, setUploadDescription] = useState("");
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [detail, setDetail] = useState<ImageGalleryAsset | null>(null);
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const copyImageUrl = async (asset: ImageGalleryAsset) => {
    const href =
      normalizeTemplateMediaUrl(asset.image_url) || asset.image_url;
    try {
      await navigator.clipboard.writeText(href);
      setCopiedId(asset.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Could not copy link");
    }
  };

  const closePendingUpload = useCallback(() => {
    setPendingUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setUploadDescription("");
  }, []);

  useEffect(() => {
    return () => {
      if (pendingUpload) URL.revokeObjectURL(pendingUpload.previewUrl);
    };
  }, [pendingUpload]);

  const load = useCallback(async (search: string, pageIndex: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchImageGallery({
        q: search,
        status: "active",
        limit: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
      });
      setAssets(result.assets);
      setTotal(result.total);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gallery");
      setAssets([]);
      setTotal(0);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load(query, page);
  }, [active, load, query, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total);

  const onFileChosen = (file: File | undefined) => {
    if (!file) return;
    setUploadDescription("");
    setPendingUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  };

  const confirmUpload = async () => {
    if (!pendingUpload) return;
    setUploadBusy(true);
    setError(null);
    try {
      const url = await uploadTemplateImage(pendingUpload.file);
      await registerImageGalleryAsset({
        image_url: url,
        source: "uploaded",
        short_description: uploadDescription.trim() || undefined,
      });
      closePendingUpload();
      setPage(0);
      await load(query, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  };

  const onArchive = async (asset: ImageGalleryAsset) => {
    try {
      await archiveImageGalleryAsset(asset.id);
      if (detail?.id === asset.id) setDetail(null);
      const result = await load(query, page);
      if (
        result &&
        result.assets.length === 0 &&
        page > 0 &&
        result.total > 0
      ) {
        setPage(page - 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface p-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-caption" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search descriptions…"
            className="h-9 w-full rounded-lg border border-border-default bg-canvas pl-8 pr-3 text-sm outline-none focus:border-brand"
          />
        </div>
        {isPick ? null : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/*"
              className="hidden"
              onChange={(e) => {
                onFileChosen(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="h-9 gap-1.5"
              disabled={uploadBusy}
              onClick={() => fileRef.current?.click()}
            >
              {uploadBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" strokeWidth={1.75} />
              )}
              Upload image
            </Button>
          </>
        )}
      </div>

      {error ? <p className="text-xs text-text-danger">{error}</p> : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-text-caption">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading…
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-default bg-canvas px-6 py-16 text-center">
          <ImageIcon
            className="mb-3 size-10 text-text-caption"
            strokeWidth={1.25}
          />
          <p className="text-sm font-medium text-text-primary">No images yet</p>
          <p className="mt-1 max-w-sm text-xs text-text-caption">
            Upload an image above, or generate images while creating campaigns
            — they will be saved here for reuse.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-caption">
              {totalPages > 1
                ? `Showing ${rangeStart}–${rangeEnd} of ${total} images`
                : `${total} image${total === 1 ? "" : "s"}`}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={page <= 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-text-caption">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={page >= totalPages - 1 || loading}
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {assets.map((asset) => {
              const src = normalizeTemplateMediaUrl(asset.image_url);
              return (
                <article
                  key={asset.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-border-default bg-white"
                >
                  <button
                    type="button"
                    className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100"
                    onClick={() => setDetail(asset)}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-text-caption">
                        <ImageIcon className="size-8" />
                      </div>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    <p className="line-clamp-2 text-xs text-text-primary">
                      {asset.short_description || "Marketing image"}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-1">
                      {isPick && onPick ? (
                        <Button
                          type="button"
                          variant="brand"
                          className="h-7 flex-1 px-2 text-xs"
                          onClick={() => onPick(asset.image_url)}
                        >
                          Select
                        </Button>
                      ) : (
                        <>
                          {onToggleCampaignSelect ? (
                            <Button
                              type="button"
                              variant={
                                campaignSelectSet.has(asset.id)
                                  ? "brand"
                                  : "secondary"
                              }
                              className="h-7 flex-1 px-2 text-xs"
                              onClick={() => onToggleCampaignSelect(asset)}
                            >
                              {campaignSelectSet.has(asset.id) ? (
                                <>
                                  <Check className="size-3" />
                                  Selected
                                </>
                              ) : (
                                <>
                                  <Plus className="size-3" />
                                  Add to campaign
                                </>
                              )}
                            </Button>
                          ) : null}
                          <button
                            type="button"
                            className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border-default px-2 text-xs text-text-primary hover:bg-subtle"
                            title="Copy image URL"
                            onClick={() => void copyImageUrl(asset)}
                          >
                            <Copy className="size-3" />
                            {copiedId === asset.id ? "Copied" : "Copy"}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-7 items-center rounded-md border border-border-default px-2 text-xs text-text-caption hover:bg-subtle"
                            title="Archive"
                            onClick={() => void onArchive(asset)}
                          >
                            <Archive className="size-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-default pt-4">
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={page <= 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-text-caption">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={page >= totalPages - 1 || loading}
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}

      {pendingUpload ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Add image to gallery
                </h2>
                <p className="mt-1 text-sm text-text-caption">
                  Describe the image so your team can find it later. You can
                  skip this and upload without a description.
                </p>
              </div>
              <button
                type="button"
                className="text-text-caption hover:text-text-primary"
                onClick={closePendingUpload}
                disabled={uploadBusy}
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
            <div className="mb-4 overflow-hidden rounded-lg border border-border-default bg-neutral-100">
              <img
                src={pendingUpload.previewUrl}
                alt=""
                className="max-h-48 w-full object-contain"
              />
            </div>
            <label className="block text-xs font-medium text-text-caption">
              Description (optional)
              <textarea
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="e.g. Summer sale hero, product on white background…"
                rows={3}
                maxLength={500}
                className="mt-1 block w-full resize-none rounded-lg border border-border-default bg-canvas px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
              />
            </label>
            <p className="mt-1 text-xs text-text-caption">
              {uploadDescription.length}/500
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={uploadBusy}
                onClick={closePendingUpload}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="brand"
                disabled={uploadBusy}
                className="gap-1.5"
                onClick={() => void confirmUpload()}
              >
                {uploadBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" strokeWidth={1.75} />
                )}
                {uploadBusy ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {detail && !isPick ? (
        <div className="rounded-xl border border-border-default bg-canvas px-4 py-3 text-xs text-text-secondary">
          <div className="flex flex-col gap-3 sm:flex-row">
            {normalizeTemplateMediaUrl(detail.image_url) ? (
              <img
                src={normalizeTemplateMediaUrl(detail.image_url)}
                alt=""
                className="h-32 w-full shrink-0 rounded-lg object-cover sm:h-28 sm:w-40"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text-primary">
                    {detail.short_description || "Image details"}
                  </p>
                  <p className="mt-1 text-text-caption">
                    Source: {detail.source.replace("_", " ")}
                    {detail.channel ? ` · ${detail.channel}` : ""}
                  </p>
                  {detail.generation_prompt ? (
                    <p className="mt-2 line-clamp-3 text-text-caption">
                      {detail.generation_prompt}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="text-text-caption hover:text-text-primary"
                  onClick={() => setDetail(null)}
                >
                  Close
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 gap-1.5 px-3 text-xs"
                  onClick={() => void copyImageUrl(detail)}
                >
                  <Copy className="size-3" />
                  {copiedId === detail.id ? "Copied" : "Copy image link"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs text-text-danger"
                  onClick={() => void onArchive(detail)}
                >
                  Archive
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
