import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ListFilter,
  Mail,
  Megaphone,
  MessageCircle,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Bell,
  TabletSmartphone,
  Upload,
  Images,
  FileStack,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import {
  CAMPAIGN_CHANNELS,
  isChannelParked,
  type CampaignChannelId,
} from "@/lib/campaign-channels";
import {
  deleteCampaignTemplate,
  listCampaignTemplates,
  loadCampaignTemplates,
  PHONE_VIEW_CHANNELS,
  saveCampaignTemplate,
  subscribeCampaignTemplates,
  SYSTEM_VIEW_CHANNELS,
  type CampaignTemplate,
} from "@/lib/campaign-templates";
import { normalizeTemplateMediaUrl } from "@/lib/template-preview-images";
import {
  LibraryTemplatePreview,
  GalleryEmailPhonePreview,
  templateHasVisual,
  type LibraryDisplayMode,
} from "@/components/campaigns/LibraryTemplatePreview";
import {
  GalleryWebPushPhonePreview,
  GalleryWebPushSystemPreview,
} from "@/components/campaigns/WebPushGalleryPreview";
import {
  ChannelTemplatePreview,
  type TemplateFields,
} from "@/components/campaigns/ChannelTemplatePreview";
import {
  deselectTemplate,
  listSelectedTemplates,
  readSelectedTemplateIds,
  selectTemplateForChannel,
  writeSelectedTemplateIds,
  type SelectedTemplateMap,
} from "@/lib/selected-campaign-templates";
import {
  chatPathForDraft,
  CREATE_CAMPAIGN_DRAFTS_HREF,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  subscribeActivePack,
} from "@/lib/industry-packs";
import { uploadTemplateImage } from "@/services/media.api";
import {
  fetchGalleryStatus,
  postGalleryBootstrap,
  type GalleryStatusDto,
} from "@/services/gallery.api";
import { ContentFadeIn } from "@/components/skeleton";
import { TemplateLibrarySkeleton } from "@/components/campaigns/TemplateLibrarySkeleton";
import { CampaignModuleSelectionBar } from "@/components/campaigns/CampaignModuleSelectionBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ImageGalleryView } from "@/components/campaigns/ImageGalleryView";
import { ImageGalleryPickerModal } from "@/components/campaigns/ImageGalleryPickerModal";
import {
  deselectGalleryImage,
  readSelectedGalleryImages,
  toggleSelectedGalleryImage,
  type SelectedGalleryImage,
} from "@/lib/selected-gallery-images";
import { registerImageGalleryAsset } from "@/services/imageGallery.api";

type MediaFilter = "all" | "image" | "text";
type SortKey = "newest" | "oldest" | "used" | "name";

const CHANNEL_ICON: Record<CampaignChannelId, typeof Mail> = {
  email: Mail,
  sms: Smartphone,
  whatsapp: MessageCircle,
  web_push: Bell,
  app_push: TabletSmartphone,
  ppc: Megaphone,
};

const CHANNEL_BADGE: Record<CampaignChannelId, string> = {
  email: "bg-sky-100 text-sky-800",
  sms: "bg-emerald-100 text-emerald-800",
  whatsapp: "bg-green-100 text-green-800",
  web_push: "bg-violet-100 text-violet-800",
  app_push: "bg-orange-100 text-orange-800",
  ppc: "bg-amber-100 text-amber-900",
};

const CHANNEL_SECTION: Record<
  CampaignChannelId,
  { title: string; bar: string }
> = {
  email: { title: "Email Templates", bar: "bg-sky-500" },
  sms: { title: "SMS Templates", bar: "bg-emerald-500" },
  web_push: { title: "Web Push Templates", bar: "bg-violet-500" },
  app_push: { title: "App Push Templates", bar: "bg-orange-500" },
  whatsapp: { title: "WhatsApp Templates", bar: "bg-green-600" },
  ppc: { title: "PPC Templates", bar: "bg-amber-500" },
};

/** Responsive template card grid — full page vs embedded picker. */
const TEMPLATE_GRID_CLASS = (embedded: boolean) =>
  embedded
    ? "grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 xl:grid-cols-3"
    : "grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function CreateCampaignTemplateLibraryPage({
  embedded = false,
  onSelectionChange,
}: {
  embedded?: boolean;
  onSelectionChange?: () => void;
}) {
  const navigate = useNavigate();
  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );
  const templates = useSyncExternalStore(
    subscribeCampaignTemplates,
    listCampaignTemplates,
    listCampaignTemplates,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<SelectedTemplateMap>(() =>
    readSelectedTemplateIds(),
  );
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>("phone");
  const [channelFilter, setChannelFilter] = useState<CampaignChannelId | "all">(
    "all",
  );
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<CampaignTemplate | null>(
    null,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadForm, setUploadForm] = useState({
    name: "",
    primaryChannel: "email" as CampaignChannelId,
    description: "",
    styleNotes: "",
    contentBody: "",
    goal: "Engagement",
    audience: "All contacts",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [galleryPreviewUrl, setGalleryPreviewUrl] = useState<string | null>(
    null,
  );
  const [moduleTab, setModuleTab] = useState<"templates" | "images">(
    "templates",
  );
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<
    SelectedGalleryImage[]
  >(() => readSelectedGalleryImages());
  const [galleryStatus, setGalleryStatus] = useState<GalleryStatusDto | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const status = await fetchGalleryStatus();
      if (cancelled || !status) return;
      setGalleryStatus(status);
      const building =
        status.job?.status === "running" ||
        status.job?.status === "queued" ||
        (!status.galleryComplete &&
          status.missingTemplates != null &&
          status.missingTemplates > 0);
      if (!status.galleryComplete || status.templateCount === 0) {
        void postGalleryBootstrap();
      }
      if (building || status.templateCount === 0) {
        await loadCampaignTemplates({ force: true }).catch(() => undefined);
      }
    };

    void postGalleryBootstrap();
    void poll();
    timer = setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [packId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void loadCampaignTemplates({ force: true })
      .then((rows) => {
        if (cancelled) return;
        const map = readSelectedTemplateIds();
        const valid = new Set(rows.map((t) => t.id));
        let changed = false;
        const next: SelectedTemplateMap = { ...map };
        for (const [channel, id] of Object.entries(next)) {
          if (id && !valid.has(id)) {
            delete next[channel as CampaignChannelId];
            changed = true;
          }
        }
        if (changed) writeSelectedTemplateIds(next);
        setSelectedMap(changed ? next : map);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load templates",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [packId]);

  const viewChannels = useMemo(
    () =>
      (displayMode === "system" ? SYSTEM_VIEW_CHANNELS : PHONE_VIEW_CHANNELS).filter(
        (id) => !isChannelParked(id),
      ),
    [displayMode],
  );

  const selectedTemplates = useMemo(() => {
    return listSelectedTemplates().filter((t) =>
      Object.values(selectedMap).includes(t.id),
    );
  }, [selectedMap]);

  const refresh = async () => {
    await loadCampaignTemplates();
    setSelectedMap(readSelectedTemplateIds());
  };

  const closeUploadModal = () => {
    if (uploading) return;
    setUploadOpen(false);
    setGalleryPreviewUrl(null);
    setUploadFile(null);
    setUploadError(null);
  };

  const submitUpload = async () => {
    const name = uploadForm.name.trim();
    const content = uploadForm.contentBody.trim();
    if (!name || !content) {
      setUploadError("Name and content are required");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      let previewImage: string | null = galleryPreviewUrl;
      if (uploadFile) {
        previewImage = await uploadTemplateImage(uploadFile);
        try {
          await registerImageGalleryAsset({
            image_url: previewImage,
            source: "uploaded",
            short_description: name,
          });
        } catch {
          /* gallery register is best-effort */
        }
      }
      await saveCampaignTemplate({
        name,
        primaryChannel: uploadForm.primaryChannel,
        description: uploadForm.description.trim(),
        styleNotes: uploadForm.styleNotes.trim(),
        contentBody: content,
        bodyPreview: content.slice(0, 280),
        goal: uploadForm.goal.trim() || "Engagement",
        audience: uploadForm.audience.trim() || "All contacts",
        approvalStatus: "approved",
        previewImage,
        metadata: { uploaded: true },
      });
      setUploadOpen(false);
      setGalleryPreviewUrl(null);
      setUploadFile(null);
      setUploadForm({
        name: "",
        primaryChannel: "email",
        description: "",
        styleNotes: "",
        contentBody: "",
        goal: "Engagement",
        audience: "All contacts",
      });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Could not upload template",
      );
    } finally {
      setUploading(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = templates.filter(
      (t) =>
        viewChannels.includes(t.primaryChannel) &&
        (t.source === "user" ||
          t.metadata?.uploaded === true ||
          Boolean(t.metadata?.campaignIdeaKey)),
    );
    if (channelFilter !== "all") {
      if (!viewChannels.includes(channelFilter)) {
        rows = [];
      } else {
        rows = rows.filter((t) => t.primaryChannel === channelFilter);
      }
    }
    if (mediaFilter === "image") {
      rows = rows.filter((t) => templateHasVisual(t));
    } else if (mediaFilter === "text") {
      rows = rows.filter((t) => !templateHasVisual(t));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.bodyPreview.toLowerCase().includes(q) ||
          (t.preview?.headline || "").toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => {
      if (sortBy === "used") return (b.usedCount || 0) - (a.usedCount || 0);
      if (sortBy === "oldest") {
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }
      if (sortBy === "newest") {
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      }
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [templates, viewChannels, channelFilter, mediaFilter, query, sortBy]);

  const ideaGroups = useMemo(() => {
    const groups = new Map<
      string,
      { title: string; items: CampaignTemplate[] }
    >();
    for (const t of filtered) {
      const meta = t.metadata || {};
      const title = String(
        meta.campaignIdeaTitle || meta.campaignIdeaKey || "Campaign templates",
      );
      const key = String(meta.campaignIdeaKey || title);
      const bucket = groups.get(key) || { title, items: [] };
      bucket.items.push(t);
      groups.set(key, bucket);
    }
    return [...groups.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [filtered]);

  const galleryGenerating =
    galleryStatus?.job?.status === "running" ||
    galleryStatus?.job?.status === "queued";
  const galleryPartial =
    galleryStatus?.job?.status === "completed" &&
    galleryStatus?.job?.progress?.phase === "completed_partial";
  const galleryComplete =
    galleryStatus?.galleryComplete === true &&
    !galleryGenerating &&
    galleryStatus?.job?.status !== "failed";
  const readyChannelLabels = (galleryStatus?.readyChannels || [])
    .map(
      (id) => CAMPAIGN_CHANNELS.find((c) => c.id === id)?.label || id,
    )
    .join(", ");

  // Reset channel filter if current selection is hidden in this view
  const setDisplayModeSafe = (mode: LibraryDisplayMode) => {
    setDisplayMode(mode);
    const allowed =
      mode === "system" ? SYSTEM_VIEW_CHANNELS : PHONE_VIEW_CHANNELS;
    if (channelFilter !== "all" && !allowed.includes(channelFilter)) {
      setChannelFilter("all");
    }
  };

  const onCardClick = (template: CampaignTemplate) => {
    const already = selectedMap[template.primaryChannel] === template.id;
    if (already) {
      setSelectedMap(deselectTemplate(template.id));
      onSelectionChange?.();
      return;
    }
    setConfirmTarget(template);
  };

  const confirmSelect = () => {
    if (!confirmTarget) return;
    setSelectedMap(selectTemplateForChannel(confirmTarget));
    setConfirmTarget(null);
    onSelectionChange?.();
  };

  const handleDelete = async (template: CampaignTemplate) => {
    await deleteCampaignTemplate(template.id);
    deselectTemplate(template.id);
    setSelectedMap(readSelectedTemplateIds());
    return { ok: true as const };
  };

  const channelLabel =
    channelFilter === "all"
      ? "All channels"
      : CAMPAIGN_CHANNELS.find((c) => c.id === channelFilter)?.label || "All";

  const continueWithSelection = () => {
    const draft = startCreateCampaignChat({
      chatBasePath: "/campaigns/create",
    });
    navigate(chatPathForDraft(draft.id, "/campaigns/create"), {
      state: { listHref: CREATE_CAMPAIGN_DRAFTS_HREF },
    });
  };

  return (
    <div
      className={
        embedded
          ? "px-4 py-4"
          : "mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8"
      }
    >
      {embedded ? null : (
        <button
          type="button"
          onClick={() => navigate("/campaigns/create")}
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-caption hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          Create campaign
        </button>
      )}

      <CampaignModuleSelectionBar
        templates={selectedTemplates}
        images={selectedGalleryImages}
        onRemoveTemplate={(id) => {
          setSelectedMap(deselectTemplate(id));
          onSelectionChange?.();
        }}
        onRemoveImage={(id) => {
          setSelectedGalleryImages(deselectGalleryImage(id));
        }}
        onContinue={continueWithSelection}
      />

      <div className="mb-5">
        <div className="inline-flex rounded-lg border border-border-default bg-surface p-0.5">
          <button
            type="button"
            onClick={() => setModuleTab("templates")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
              moduleTab === "templates"
                ? "bg-brand text-white"
                : "text-text-secondary hover:bg-subtle"
            }`}
          >
            <FileStack className="size-3.5" strokeWidth={1.75} />
            Template library
          </button>
          <button
            type="button"
            onClick={() => setModuleTab("images")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
              moduleTab === "images"
                ? "bg-brand text-white"
                : "text-text-secondary hover:bg-subtle"
            }`}
          >
            <Images className="size-3.5" strokeWidth={1.75} />
            Image gallery
          </button>
        </div>

        {embedded ? null : (
          <h1 className="mt-3 text-xl font-semibold text-text-primary">
            Template Gallery
          </h1>
        )}

        <p className="mt-2 text-sm text-text-caption">
          {moduleTab === "templates"
            ? "AI-generated campaign ideas and channel templates for your industry and configured channels. Pick one template per channel, or upload your own."
            : "Reusable images for templates and campaigns. New uploads and AI-generated images appear here automatically."}
        </p>

        {moduleTab === "templates" && galleryComplete && !galleryGenerating ? (
          <div className="mt-3 rounded-2xl border border-[#bfbfbf] bg-white px-4 py-3 text-sm text-[#171717]">
            <p className="font-medium">
              {galleryStatus?.ideaCount ?? 0} campaign ideas ·{" "}
              {galleryStatus?.templateCount ?? 0} templates
              {readyChannelLabels ? ` · ${readyChannelLabels}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-text-caption">
              Your gallery is ready. Select one template per channel to start a
              campaign — new templates are added only when you configure a new
              channel in Setup.
            </p>
          </div>
        ) : null}

        {moduleTab === "templates" &&
        (galleryGenerating ||
          galleryPartial ||
          galleryStatus?.job?.status === "failed") ? (
          <div
            className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
              galleryStatus?.job?.status === "failed"
                ? "border-red-200 bg-red-50 text-red-900"
                : galleryPartial
                  ? "border-amber-200 bg-amber-50 text-amber-950"
                  : "border-sky-200 bg-sky-50 text-sky-950"
            }`}
          >
            {galleryStatus?.job?.status === "failed" ? (
              <p>
                Gallery generation paused:{" "}
                {galleryStatus.job.errorMessage || "Unknown error"}. Templates
                already generated are still available. Refresh the page to retry.
              </p>
            ) : galleryPartial ? (
              <p>
                Gallery partially built — some template variants could not be
                generated. {galleryStatus?.templateCount ?? 0} templates are
                available to use.
              </p>
            ) : (
              <p>
                Building your Template Gallery…{" "}
                {galleryStatus?.ideaCount != null
                  ? `${galleryStatus.ideaCount}/${galleryStatus.minIdeas} ideas`
                  : null}
                {galleryStatus?.job?.progress?.templatesDone != null
                  ? galleryStatus?.job?.progress?.templatesTarget
                    ? ` · ${galleryStatus.job.progress.templatesDone}/${galleryStatus.job.progress.templatesTarget} templates`
                    : ` · ${galleryStatus.job.progress.templatesDone} templates`
                  : null}
              </p>
            )}
          </div>
        ) : null}

        {moduleTab === "templates" ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-border-default bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setDisplayModeSafe("system")}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
                    displayMode === "system"
                      ? "bg-brand text-white"
                      : "text-text-secondary hover:bg-subtle"
                  }`}
                >
                  <Monitor className="size-3.5" strokeWidth={1.75} />
                  System view
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayModeSafe("phone")}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
                    displayMode === "phone"
                      ? "bg-brand text-white"
                      : "text-text-secondary hover:bg-subtle"
                  }`}
                >
                  <Smartphone className="size-3.5" strokeWidth={1.75} />
                  Phone view
                </button>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-9 gap-1.5"
                onClick={() => {
                  setUploadError(null);
                  setUploadOpen(true);
                }}
              >
                <Upload className="size-3.5" strokeWidth={1.75} />
                Upload template
              </Button>
            </div>
            {loadError ? (
              <p className="mt-2 text-xs text-text-danger">{loadError}</p>
            ) : null}
            <p className="mt-2 text-xs text-text-caption">
              {displayMode === "system"
                ? "System view shows Email and Web Push."
                : "Phone view shows Email, App Push, Web Push, and WhatsApp."}
            </p>
          </>
        ) : null}
      </div>

      <ErrorBoundary label="Templates and images">
      {moduleTab === "images" ? (
        <ImageGalleryView
          active
          selectedForCampaignIds={selectedGalleryImages.map((r) => r.id)}
          onToggleCampaignSelect={(asset) => {
            setSelectedGalleryImages(toggleSelectedGalleryImage(asset));
          }}
        />
      ) : loading ? (
        <TemplateLibrarySkeleton embedded={embedded} />
      ) : (
      <ContentFadeIn>
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface p-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setChannelMenuOpen((v) => !v)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-default px-3 text-sm text-text-primary hover:bg-subtle"
              >
                <ListFilter
                  className="size-4 text-text-caption"
                  strokeWidth={1.75}
                />
                {channelLabel}
              </button>
              {channelMenuOpen ? (
                <div className="absolute z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border-default bg-surface shadow-lg">
                  <button
                    type="button"
                    className={`flex w-full px-3 py-2 text-left text-sm hover:bg-subtle ${channelFilter === "all" ? "bg-subtle font-medium" : ""}`}
                    onClick={() => {
                      setChannelFilter("all");
                      setChannelMenuOpen(false);
                    }}
                  >
                    All channels
                  </button>
                  {viewChannels.map((id) => {
                    const ch = CAMPAIGN_CHANNELS.find((c) => c.id === id);
                    if (!ch) return null;
                    const Icon = CHANNEL_ICON[ch.id];
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-subtle ${channelFilter === ch.id ? "bg-subtle font-medium" : ""}`}
                        onClick={() => {
                          setChannelFilter(ch.id);
                          setChannelMenuOpen(false);
                        }}
                      >
                        <Icon className="size-3.5" strokeWidth={1.75} />
                        {ch.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <select
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value as MediaFilter)}
              className="h-9 rounded-lg border border-border-default bg-canvas px-2 text-sm text-text-primary outline-none"
            >
              <option value="all">All media</option>
              <option value="image">With images</option>
              <option value="text">Text only</option>
            </select>

            <div className="relative min-w-[200px] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-caption"
                strokeWidth={1.75}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates..."
                className="h-9 w-full rounded-lg border border-border-default bg-canvas pr-3 pl-9 text-sm text-text-primary outline-none focus:border-brand"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="h-9 rounded-lg border border-border-default bg-canvas px-2 text-sm text-text-primary outline-none"
            >
              <option value="name">Sort: Name</option>
              <option value="newest">Sort: Newest</option>
              <option value="oldest">Sort: Oldest</option>
              <option value="used">Sort: Most used</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default px-6 py-16 text-center">
              <p className="text-sm font-medium text-text-primary">
                {galleryGenerating
                  ? "Your Template Gallery is being generated"
                  : "No templates yet"}
              </p>
              <p className="mt-1 text-sm text-text-caption">
                {galleryGenerating
                  ? "Campaign ideas and channel templates appear here automatically for your industry and ready channels."
                  : "Try clearing filters, configure a channel in Setup, or upload your own template."}
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              {ideaGroups.map((group) => {
                const summary = group.items[0]?.description?.trim();
                return (
                <section
                  key={group.title}
                  className="overflow-hidden rounded-2xl border border-[#bfbfbf] bg-white"
                >
                  <div className="border-b border-[#bfbfbf] p-4">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-[#171717]">
                        {group.title}
                      </h2>
                      {summary ? (
                        <p className="mt-1 line-clamp-2 text-sm text-text-caption">
                          {summary}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-text-caption">
                        {group.items.length} template
                        {group.items.length === 1 ? "" : "s"} across ready
                        channels
                      </p>
                    </div>
                  </div>
                  {(() => {
                    const channelSections = viewChannels
                      .map((ch) => ({
                        channel: ch,
                        items: group.items.filter(
                          (t) => t.primaryChannel === ch,
                        ),
                      }))
                      .filter((s) => s.items.length > 0);
                    return (
                  <div className="grid grid-cols-1 gap-6 p-4 pt-6 md:grid-cols-2">
                    {channelSections.map((section) => {
                        const meta = CHANNEL_SECTION[section.channel];
                        return (
                          <div
                            key={`${group.title}-${section.channel}`}
                            className={`min-w-0${
                              channelSections.length === 1
                                ? " md:col-span-2"
                                : ""
                            }`}
                          >
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                              <span
                                className={`h-5 w-1 shrink-0 rounded-full ${meta.bar}`}
                              />
                              <h3 className="text-sm font-semibold text-text-primary">
                                {meta.title}
                              </h3>
                              <span className="text-xs text-text-caption">
                                {section.items.length}
                              </span>
                            </div>
                            <div
                              className={
                                section.items.length > 1
                                  ? TEMPLATE_GRID_CLASS(embedded)
                                  : "grid grid-cols-1 gap-4"
                              }
                            >
                              {section.items.map((t, i) => (
                                <TemplateCard
                                  key={t.id}
                                  index={i + 1}
                                  template={t}
                                  displayMode={displayMode}
                                  selected={
                                    selectedMap[t.primaryChannel] === t.id
                                  }
                                  onClick={() => onCardClick(t)}
                                  onDeleted={refresh}
                                  onDelete={() => handleDelete(t)}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                    );
                  })()}
                </section>
              );
              })}
            </div>
          )}

          {embedded ? (
            <p className="mt-6 text-xs text-text-caption">
              Showing {filtered.length} templates in {displayMode} view.
            </p>
          ) : (
          <p className="mt-6 text-xs text-text-caption">
            Showing {filtered.length} templates in {displayMode} view.{" "}
            <Link
              to="/campaigns/create"
              className="text-text-link hover:underline"
            >
              Back to Create campaign
            </Link>
          </p>
          )}
      </ContentFadeIn>
      )}
      </ErrorBoundary>

      {moduleTab === "templates" && confirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-xl">
            <h2 className="text-base font-semibold text-text-primary">
              Select this template?
            </h2>
            <p className="mt-2 text-sm text-text-caption">
              Mark{" "}
              <span className="font-medium text-text-primary">
                {confirmTarget.name}
              </span>{" "}
              as the selected {confirmTarget.channels[0]} template. Any previous{" "}
              {confirmTarget.channels[0]} selection will be replaced.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmTarget(null)}
              >
                Cancel
              </Button>
              <Button type="button" variant="brand" onClick={confirmSelect}>
                Select template
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Upload template
                </h2>
                <p className="mt-1 text-sm text-text-caption">
                  Saved for this organization with style and content metadata.
                </p>
              </div>
              <button
                type="button"
                className="text-text-caption hover:text-text-primary"
                onClick={closeUploadModal}
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-text-caption">
                Name
                <input
                  value={uploadForm.name}
                  onChange={(e) =>
                    setUploadForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-border-default bg-canvas px-3 text-sm text-text-primary outline-none focus:border-brand"
                />
              </label>
              <label className="block text-xs font-medium text-text-caption">
                Channel
                <select
                  value={uploadForm.primaryChannel}
                  onChange={(e) =>
                    setUploadForm((f) => ({
                      ...f,
                      primaryChannel: e.target.value as CampaignChannelId,
                    }))
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-border-default bg-canvas px-2 text-sm text-text-primary outline-none"
                >
                  {CAMPAIGN_CHANNELS.filter((c) => !isChannelParked(c.id)).map(
                    (c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="block text-xs font-medium text-text-caption">
                Description
                <textarea
                  value={uploadForm.description}
                  onChange={(e) =>
                    setUploadForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-border-default bg-canvas px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
                />
              </label>
              <label className="block text-xs font-medium text-text-caption">
                Style notes
                <textarea
                  value={uploadForm.styleNotes}
                  onChange={(e) =>
                    setUploadForm((f) => ({
                      ...f,
                      styleNotes: e.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Tone, layout, brand cues…"
                  className="mt-1 w-full rounded-lg border border-border-default bg-canvas px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
                />
              </label>
              <label className="block text-xs font-medium text-text-caption">
                Content
                <textarea
                  value={uploadForm.contentBody}
                  onChange={(e) =>
                    setUploadForm((f) => ({
                      ...f,
                      contentBody: e.target.value,
                    }))
                  }
                  rows={5}
                  placeholder="Full message / HTML / copy"
                  className="mt-1 w-full rounded-lg border border-border-default bg-canvas px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-text-caption">
                  Goal
                  <input
                    value={uploadForm.goal}
                    onChange={(e) =>
                      setUploadForm((f) => ({ ...f, goal: e.target.value }))
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-border-default bg-canvas px-3 text-sm text-text-primary outline-none focus:border-brand"
                  />
                </label>
                <label className="block text-xs font-medium text-text-caption">
                  Audience
                  <input
                    value={uploadForm.audience}
                    onChange={(e) =>
                      setUploadForm((f) => ({
                        ...f,
                        audience: e.target.value,
                      }))
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-border-default bg-canvas px-3 text-sm text-text-primary outline-none focus:border-brand"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-text-caption">
                Preview image (optional)
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 text-xs"
                    onClick={() => setGalleryPickerOpen(true)}
                  >
                    Choose from gallery
                  </Button>
                </div>
                {galleryPreviewUrl ? (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-border-default bg-canvas p-2">
                    <img
                      src={normalizeTemplateMediaUrl(galleryPreviewUrl)}
                      alt=""
                      className="h-14 w-20 rounded object-cover"
                    />
                    <span className="flex-1 truncate text-xs text-text-caption">
                      From image gallery
                    </span>
                    <button
                      type="button"
                      className="text-xs text-text-caption hover:text-text-primary"
                      onClick={() => setGalleryPreviewUrl(null)}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="mt-1 block w-full text-sm text-text-primary"
                  onChange={(e) => {
                    setUploadFile(e.target.files?.[0] ?? null);
                    if (e.target.files?.[0]) setGalleryPreviewUrl(null);
                  }}
                />
              </label>
              {uploadError ? (
                <p className="text-xs text-text-danger">{uploadError}</p>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={uploading}
                onClick={closeUploadModal}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="brand"
                disabled={uploading}
                className="gap-1.5"
                onClick={() => void submitUpload()}
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
                {uploading ? "Saving…" : "Save template"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ImageGalleryPickerModal
        open={galleryPickerOpen}
        onClose={() => setGalleryPickerOpen(false)}
        onPick={(url) => {
          setGalleryPreviewUrl(url);
          setUploadFile(null);
        }}
      />
    </div>
  );
}

function galleryPreviewChannel(primary: CampaignChannelId): string {
  if (primary === "web_push") return "web";
  if (primary === "app_push") return "push";
  return primary;
}

function templateHasStructuredFields(
  template: CampaignTemplate,
): template is CampaignTemplate & { fields: TemplateFields } {
  return (
    Boolean(template.fields) &&
    typeof template.fields === "object" &&
    !Array.isArray(template.fields) &&
    Object.keys(template.fields).length > 0
  );
}

function TemplateCard({
  template,
  index,
  selected,
  displayMode,
  onClick,
  onDelete,
  onDeleted,
}: {
  template: CampaignTemplate;
  index: number;
  selected: boolean;
  displayMode: LibraryDisplayMode;
  onClick: () => void;
  onDelete: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onDeleted: () => void;
}) {
  const Icon = CHANNEL_ICON[template.primaryChannel];
  const title = template.preview?.headline?.trim() || template.name;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {index}. {title}
        </p>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${CHANNEL_BADGE[template.primaryChannel]}`}
        >
          <Icon className="size-3" strokeWidth={2} />
          {template.channels[0]}
        </span>
      </div>

      <div
        className={`group relative overflow-hidden rounded-2xl border bg-white transition-shadow hover:shadow-sm ${
          selected
            ? "border-brand ring-2 ring-brand/30"
            : "border-[#bfbfbf]"
        }`}
      >
        <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ConfirmDeleteButton
            name={template.name}
            entityLabel="template"
            compact
            consequence="This permanently removes the template from your library."
            onConfirm={onDelete}
            onSuccess={onDeleted}
          />
        </div>

        <button type="button" onClick={onClick} className="block w-full text-left">
          <div
            className={
              displayMode === "phone"
                ? "relative mx-auto aspect-[9/19] w-[min(100%,13.5rem)] overflow-hidden sm:w-[min(100%,15rem)] md:w-[min(100%,16.5rem)]"
                : "relative mx-auto h-[min(70vh,28rem)] w-full max-w-md overflow-hidden sm:max-w-lg"
            }
          >
            {selected ? (
              <span className="absolute top-2 left-2 z-[1] inline-flex size-6 items-center justify-center rounded-full bg-brand text-text-on-dark shadow">
                <Check className="size-3.5" strokeWidth={2.5} />
              </span>
            ) : null}
            {template.primaryChannel === "email" &&
            templateHasStructuredFields(template) ? (
              displayMode === "phone" ? (
                <GalleryEmailPhonePreview fields={template.fields} />
              ) : (
                <div className="gallery-preview-scroll h-full min-h-0 overflow-y-auto overflow-x-hidden bg-white p-3">
                  <div className="w-full min-w-0">
                    <ChannelTemplatePreview
                      channel="email"
                      fields={template.fields}
                    />
                  </div>
                </div>
              )
            ) : template.primaryChannel === "web_push" &&
              templateHasStructuredFields(template) ? (
              displayMode === "phone" ? (
                <GalleryWebPushPhonePreview
                  fields={template.fields}
                  template={template}
                />
              ) : (
                <GalleryWebPushSystemPreview
                  fields={template.fields}
                  template={template}
                />
              )
            ) : templateHasStructuredFields(template) ? (
              <div
                className={`gallery-preview-scroll h-full overflow-auto ${
                  displayMode === "phone"
                    ? "bg-neutral-100 p-2"
                    : "bg-white p-3"
                }`}
              >
                <ChannelTemplatePreview
                  channel={galleryPreviewChannel(template.primaryChannel)}
                  fields={template.fields}
                />
              </div>
            ) : template.source === "generated" ? (
              <div className="flex h-full items-center justify-center bg-[#f3f4f6] p-4 text-center text-xs text-text-caption">
                Gallery preview loading… refresh in a moment.
              </div>
            ) : (
              <LibraryTemplatePreview
                template={template}
                displayMode={displayMode}
              />
            )}
          </div>
        </button>
      </div>
    </div>
  );
}
