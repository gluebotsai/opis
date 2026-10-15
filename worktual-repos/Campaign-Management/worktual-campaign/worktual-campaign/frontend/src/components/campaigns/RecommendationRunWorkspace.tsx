import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { File as FileIcon, ImageIcon, Mic, Plus } from "lucide-react";
import { AgentChatComposer, type ComposerPendingImage } from "@/components/chat/AgentChatComposer";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { sanitizeAssistantChatText } from "@/lib/chat-user-facing";
import {
  resolvePendingChatImageUpload,
  uploadTemplateImageAsset,
} from "@/services/media.api";
import {
  chatMediaPreviewFallbackSrc,
  chatMediaPreviewSrc,
} from "@/lib/template-preview-images";
import { CampaignGuidedPreview } from "@/components/campaigns/CampaignGuidedPreview";
import { RecommendationWorkspaceSkeleton } from "@/components/campaigns/RecommendationWorkspaceSkeleton";
import { TemplateCardsBatch } from "@/components/campaigns/TemplateCardsBatch";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { looksLikeChatHtml } from "@/lib/chat-html";
import {
  inferNextKeyFromAssistantQuestion,
  snapshotFromCampaignState,
} from "@/lib/campaign-guided-fields";
import {
  CAMPAIGN_CHANNELS,
  VISIBLE_CAMPAIGN_CHANNELS,
  agentChannelToUiId,
  configChannelToUiId,
  isChannelParked,
  normalizeChannelsToAgentIds,
} from "@/lib/campaign-channels";
import {
  ensureDraftOnServer,
  getCampaignDraft,
  isDraftCommittable,
  isPlaceholderDraftName,
  markDraftLaunched,
  patchTimelineCardFields,
  persistTemplateEditToDraftAndSession,
  remapTimelinePins,
  mergeMessagesServerWinsPendingLocal,
  sessionRowsToChatMessages,
  persistInFlightProgress,
  upsertCampaignDraft,
  type CampaignChatDraft,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import { withClientTimezone } from "@/lib/agents-join";
import { getCampaignProfile } from "@/lib/industry-packs";
import {
  ensureRecommendationRunDraft,
  REC_RUN_WELCOME,
} from "@/lib/recommendation-run-draft";
import {
  markRecommendationUsed,
  type CampaignRecommendation,
} from "@/lib/campaign-recommendations-store";
import { runTemplatesReadySync } from "@/lib/append-session-channel-templates";
import {
  bindGeneratePinToBatch,
  captureGeneratePinForNewBatch,
  hydrateGeneratePinsFromDraft,
  rememberGenerateUserPin,
} from "@/lib/campaign-generate-pin";
import {
  blocksAfterUserTurn,
  blocksForChatMessage,
  inFlightProgressForTurn,
} from "@/lib/campaign-generation-blocks";
import { TemplateGenerationProgress } from "@/components/campaigns/TemplateGenerationProgress";
import type { TemplateGenerationProgressModel } from "@/components/campaigns/TemplateGenerationProgress";
import {
  flattenTimelineCards,
  unplacedTimelineMoments,
  isChannelTemplatesReadyEvent,
  isNewTemplateGenerationBatch,
  normalizeChatTimeline,
  shouldShowTemplateLoadProgress,
  shouldShowTemplateProgressUpdate,
  templatesReadyDedupeKey,
} from "@/lib/campaign-template-timeline";
import { scrollChatToBottom, isChatStuckToBottom } from "@/lib/chat-stick-bottom";
import { fetchConfigChannels } from "@/services/configuration.service";
import { getToken } from "@/services/api";
import {
  getAgentsSocket,
  type CampaignAgentState,
  type TemplateCard,
} from "@/services/agents.socket";
import {
  composerBusy,
  deriveCreateCampaignChatPhase,
  showTypingIndicator,
  templateProgressBlocksInput,
} from "@/lib/create-campaign-chat-phase";

type TemplateProgress = TemplateGenerationProgressModel;

function toLocalMessages(
  rows: Array<{
    id?: string;
    role?: string;
    text?: string;
    created_at?: string;
    createdAt?: string;
    image_url?: string;
    imageUrl?: string;
    image_filename?: string;
    imageFilename?: string;
  }>,
): ChatMessage[] {
  return sessionRowsToChatMessages(rows);
}

function applyStateToDraft(
  draft: CampaignChatDraft,
  state: CampaignAgentState,
  messages?: ChatMessage[],
): CampaignChatDraft {
  const campaign = state.campaign || {};
  const audience = state.audience || {};
  const channels = (state.channels || []).map(
    (c) => c.charAt(0).toUpperCase() + c.slice(1),
  );
  const audienceLabel =
    audience.matched_count && audience.matched_count > 0
      ? `${audience.matched_count} contacts`
      : audience.description?.trim() || draft.audience;
  let next: CampaignChatDraft = {
    ...draft,
    name: campaign.name?.trim()
      ? campaign.name.trim()
      : isPlaceholderDraftName(draft.name)
        ? ""
        : draft.name,
    goal: campaign.goal?.trim() || draft.goal,
    objective: campaign.objective?.trim() || draft.objective,
    channels: channels.length ? channels : draft.channels,
    audience: audienceLabel,
    schedule:
      state.launch_plan?.scheduled_at ||
      state.channel_plans?.[0]?.suggested_launch_at ||
      draft.schedule,
    status: draft.status === "empty" ? "drafting" : draft.status,
    messages: messages ?? draft.messages,
    updatedAt: draft.updatedAt,
  };
  if (
    state.launch_confirmed &&
    draft.status !== "scheduled" &&
    draft.status !== "live"
  ) {
    const mode = String(state.launch_plan?.schedule_mode || "").toLowerCase();
    const as =
      mode === "now" || String(state.stage || "").toLowerCase() === "live"
        ? "live"
        : "scheduled";
    next = markDraftLaunched(next, as);
  }
  return next;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const displayText =
    msg.role === "assistant"
      ? sanitizeAssistantChatText(msg.text)
      : msg.text;
  const hasImage = Boolean(msg.imageUrl?.trim());
  if (!displayText?.trim() && !hasImage) return null;
  const html = msg.role === "assistant" && looksLikeChatHtml(displayText);
  const imageSrc = chatMediaPreviewSrc(msg.imageUrl);
  const imageFallback = chatMediaPreviewFallbackSrc(msg.imageUrl);
  return (
    <div
      className={
        msg.role === "user" ? "flex justify-end" : "flex justify-start"
      }
    >
      <div className={chatBubbleClass(msg.role, undefined, { html })}>
        {hasImage && imageSrc ? (
          <img
            src={imageSrc}
            alt={msg.imageFilename || "Uploaded image"}
            className="mb-2 max-h-40 max-w-[14rem] rounded-lg object-cover"
            onError={(e) => {
              const el = e.currentTarget;
              if (imageFallback && el.src !== imageFallback) {
                el.src = imageFallback;
              }
            }}
          />
        ) : null}
        {displayText?.trim() ? (
          <ChatBubbleText text={displayText} role={msg.role} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Clicked recommendation: create-campaign tools, setup panel on the right.
 */
export function RecommendationRunWorkspace({
  card,
}: {
  card: CampaignRecommendation;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<CampaignChatDraft | null>(null);
  const [agentState, setAgentState] = useState<CampaignAgentState | null>(null);
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<ComposerPendingImage | null>(
    null,
  );
  const pendingImageUploadRef = useRef<Promise<{
    url: string;
    media_id: string;
  }> | null>(null);
  const [templateProgress, setTemplateProgress] =
    useState<TemplateProgress | null>(null);
  const [channelReadyById, setChannelReadyById] = useState<
    Record<string, boolean>
  >({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftIdRef = useRef<string>("");
  const templateProgressRef = useRef<TemplateProgress | null>(null);
  const templatesReadyHandledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const next = ensureRecommendationRunDraft(card);
    draftIdRef.current = next.id;
    hydrateGeneratePinsFromDraft(next);
    setDraft(next);
    setTemplates(flattenTimelineCards(next.timelineTemplates));
    const inflight = next.inFlightProgress;
    if (
      inflight &&
      (inflight.status === "started" ||
        inflight.status === "generating" ||
        inflight.status === "failed")
    ) {
      setTemplateProgress(inflight);
      templateProgressRef.current = inflight;
    }
  }, [card.id]);

  useEffect(() => {
    let cancelled = false;
    void fetchConfigChannels()
      .then((rows) => {
        if (cancelled) return;
        const readyMap: Record<string, boolean> = {};
        for (const row of rows) {
          const uiId = configChannelToUiId(row.channel);
          if (!uiId || isChannelParked(uiId)) continue;
          readyMap[uiId] = Boolean(readyMap[uiId]) || row.status === "ready";
        }
        readyMap.whatsapp = true;
        setChannelReadyById(readyMap);
      })
      .catch(() => {
        /* overview still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const timelineLen = draft?.timelineTemplates?.length ?? 0;
  useEffect(() => {
    scrollChatToBottom(
      chatScrollRef.current,
      bottomRef.current,
      stickToBottomRef.current,
    );
  }, [
    draft?.messages.length,
    timelineLen,
    sending,
    typing,
    templates.length,
  ]);

  useEffect(() => {
    if (!attachOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!attachMenuRef.current?.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    templateProgressRef.current = templateProgress;
  }, [templateProgress]);

  useEffect(() => {
    if (draft) hydrateGeneratePinsFromDraft(draft);
  }, [draft]);

  useEffect(() => {
    if (!draft) return;
    const draftId = draft.id;
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required to run this recommendation.");
      return;
    }
    const socket = getAgentsSocket();
    setSocketError(null);

    const sameSession = (payload: { session_id?: string }) =>
      !payload.session_id || payload.session_id === draftId;

    const onReady = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
      messages?: Array<{
        id?: string;
        role?: string;
        text?: string;
        created_at?: string;
      }>;
    }) => {
      if (!sameSession(payload)) return;
      setSessionReady(true);
      if (payload.state) setAgentState(payload.state);
      const remote = toLocalMessages(payload.messages || []);
      setDraft((prev) => {
        if (!prev) return prev;
        const local = prev.messages || [];
        const messages =
          remote.length > 0
            ? mergeMessagesServerWinsPendingLocal(local, remote)
            : local;
        const pinned = remapTimelinePins(
          prev.timelineTemplates,
          prev.messages,
          messages,
        );
        const withPins = { ...prev, timelineTemplates: pinned };
        const next = payload.state
          ? applyStateToDraft(withPins, payload.state, messages)
          : { ...withPins, messages };
        setTemplates(flattenTimelineCards(next.timelineTemplates));
        upsertCampaignDraft(next);
        return next;
      });
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
    }) => {
      if (!sameSession(payload)) return;
      const text = (payload.text || "").trim();
      if (!text) return;
      setDraft((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text,
              createdAt: new Date().toISOString(),
            },
          ],
        };
        upsertCampaignDraft(next);
        return next;
      });
      setSending(false);
      setTyping(false);
    };

    const onState = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
    }) => {
      if (!sameSession(payload) || !payload.state) return;
      setAgentState(payload.state);
      setDraft((prev) => {
        if (!prev) return prev;
        const next = applyStateToDraft(prev, payload.state!);
        setTemplates(flattenTimelineCards(next.timelineTemplates));
        upsertCampaignDraft(next);
        if (payload.state!.launch_confirmed) {
          markRecommendationUsed(card.id);
        }
        if (isDraftCommittable(next, payload.state)) {
          void ensureDraftOnServer(next, payload.state).catch(() => {
            upsertCampaignDraft(next);
          });
        }
        return next;
      });
    };

    const onUi = (payload: {
      session_id?: string;
      type?: string;
      payload?: TemplateCard[] | TemplateProgress | Record<string, unknown>;
    }) => {
      if (!sameSession(payload)) return;
      if (isChannelTemplatesReadyEvent(payload.type)) {
        const eventBody =
          payload.payload && !Array.isArray(payload.payload)
            ? (payload.payload as Record<string, unknown>)
            : null;
        const dedupeKey = templatesReadyDedupeKey(eventBody);
        if (templatesReadyHandledRef.current.has(dedupeKey)) {
          void runTemplatesReadySync(draftId, eventBody).then((result) => {
            if (!result.draft) return;
            setDraft(result.draft);
            setTemplates(flattenTimelineCards(result.draft.timelineTemplates));
          });
          return;
        }
        templatesReadyHandledRef.current.add(dedupeKey);

        const current = getCampaignDraft(draftId);
        if (shouldShowTemplateLoadProgress(current, eventBody)) {
          setTemplateProgress((prev) =>
            prev?.status === "started" || prev?.status === "generating"
              ? {
                  ...prev,
                  status: "completed",
                  label: prev.label || "Loading template cards…",
                  percent: 100,
                }
              : {
                  status: "completed",
                  label: "Loading template cards…",
                  channels: [],
                  completed_channels: [],
                  percent: 100,
                },
          );
        }
        setTyping(false);
        setSending(false);
        if (!current) {
          setTemplateProgress(null);
          templateProgressRef.current = null;
          return;
        }
        void runTemplatesReadySync(draftId, eventBody)
          .then((result) => {
            if (!result.draft) return;
            setDraft(result.draft);
            setTemplates(flattenTimelineCards(result.draft.timelineTemplates));
          })
          .finally(() => {
            setTemplateProgress(null);
            templateProgressRef.current = null;
            persistInFlightProgress(draftId, null);
          });
      }
      if (
        payload.type === "template_progress" &&
        payload.payload &&
        !Array.isArray(payload.payload)
      ) {
        const progress = payload.payload as TemplateProgress;
        const current = getCampaignDraft(draftId);
        const incomingBatch = String(progress.generation_batch_id || "").trim();
        if (
          incomingBatch &&
          current &&
          isNewTemplateGenerationBatch(current, incomingBatch)
        ) {
          captureGeneratePinForNewBatch(
            draftId,
            current.messages,
            incomingBatch,
          );
        } else {
          bindGeneratePinToBatch(draftId, progress.generation_batch_id);
        }
        if (!shouldShowTemplateProgressUpdate(current, progress)) {
          return;
        }
        setTemplateProgress((prev) => {
          const incomingBatch = String(progress.generation_batch_id || "").trim();
          const prevBatch = String(prev?.generation_batch_id || "").trim();
          const base =
            incomingBatch && prevBatch && incomingBatch !== prevBatch
              ? null
              : prev;
          const merged: TemplateProgress = {
            ...base,
            ...progress,
            channels: Array.isArray(progress.channels)
              ? progress.channels
              : base?.channels || [],
            completed_channels: Array.isArray(progress.completed_channels)
              ? progress.completed_channels
              : base?.completed_channels || [],
            failed_channels: Array.isArray(progress.failed_channels)
              ? progress.failed_channels
              : base?.failed_channels || [],
            percent: Math.max(base?.percent ?? 0, progress.percent ?? 0),
          };
          templateProgressRef.current = merged;
          return merged;
        });
        {
          const stored = templateProgressRef.current;
          persistInFlightProgress(
            draftId,
            stored && stored.status !== "completed" ? stored : null,
          );
        }
        setTyping(false);
        if (progress.status === "completed") {
          window.setTimeout(() => {
            setTemplateProgress(null);
            templateProgressRef.current = null;
            persistInFlightProgress(draftId, null);
          }, 400);
        }
      }
    };

    const onTyping = (payload: { session_id?: string; typing?: boolean }) => {
      if (!sameSession(payload)) return;
      if (templateProgressRef.current) {
        setTyping(false);
        return;
      }
      setTyping(Boolean(payload.typing));
    };

    const onError = (payload: { message?: string; session_id?: string }) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      setSocketError(payload.message || "Recommendation run agent error");
      setTyping(false);
      setSending(false);
    };

    const onTemplateUpdated = (payload: {
      session_id?: string;
      template_id?: string;
      template?: { template_id?: string; fields?: Record<string, unknown> };
    }) => {
      if (!sameSession(payload)) return;
      const tid = String(
        payload.template_id || payload.template?.template_id || "",
      ).trim();
      const fields = payload.template?.fields;
      if (!tid || !fields || typeof fields !== "object") return;
      setDraft((prev) => {
        if (!prev) return prev;
        const next = patchTimelineCardFields(prev, tid, fields);
        if (next === prev) return prev;
        setTemplates(flattenTimelineCards(next.timelineTemplates));
        upsertCampaignDraft(next);
        return next;
      });
      void persistTemplateEditToDraftAndSession(draftId, tid, fields);
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("state_update", onState);
    socket.on("ui_event", onUi);
    socket.on("agent_typing", onTyping);
    socket.on("template_updated", onTemplateUpdated);
    socket.on("error", onError);

    const channels = normalizeChannelsToAgentIds(draft.channels || []);
    const join = () => {
      socket.emit(
        "join_session",
        withClientTimezone({
          session_id: draftId,
          token,
          module: "recommendation_run",
          hub_mode: false,
          skip_welcome: (draft.messages || []).length > 0,
          recommendation_run: true,
          recommendation_id: card.id,
          recommendation_why: card.whyCreated,
          audience_hint: card.audience,
          timing_label: card.timingLabel,
          suggested_launch_at: card.suggestedLaunchAt,
          campaign: {
            name: draft.name || card.title,
            goal: draft.goal || card.goal,
            objective: draft.objective || card.objective,
          },
          channels,
          available_channels: VISIBLE_CAMPAIGN_CHANNELS.map((c) => c.id),
          campaign_profile: getCampaignProfile(),
          carry_messages: (draft.messages || [])
            .filter((m) => {
              const text = String(m.text || "").trim();
              const imageUrl = String(m.imageUrl || "").trim();
              return Boolean(text || imageUrl);
            })
            .slice(-40)
            .map((m) => ({
              id: m.id,
              role: m.role,
              text: String(m.text || "").trim(),
              createdAt: m.createdAt,
              ...(m.imageUrl?.trim()
                ? { image_url: m.imageUrl.trim() }
                : {}),
              ...(m.imageFilename?.trim()
                ? { image_filename: m.imageFilename.trim() }
                : {}),
            })),
        }),
      );
    };
    if (socket.connected) join();
    else socket.on("connect", join);

    return () => {
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("state_update", onState);
      socket.off("ui_event", onUi);
      socket.off("agent_typing", onTyping);
      socket.off("template_updated", onTemplateUpdated);
      socket.off("error", onError);
      socket.off("connect", join);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per draft
  }, [draft?.id, card.id]);

  const send = (textRaw?: string) => {
    const caption = (textRaw ?? input).trim();
    const draftId = draftIdRef.current;
    const pending = pendingImage;
    if (
      (!caption && !pending) ||
      sending ||
      typing ||
      templateProgressBlocksInput(templateProgress) ||
      !sessionReady ||
      !draftId
    )
      return;
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required");
      return;
    }

    const text = caption.trim();
    const filename = pending?.filename || "image";
    const warmUpload = pendingImageUploadRef.current;
    const previewBlob = pending?.previewUrl?.startsWith("blob:")
      ? pending.previewUrl
      : "";
    const optimisticImageSrc =
      pending?.imageUrl?.trim() || pending?.previewUrl?.trim() || "";
    if (!text && !optimisticImageSrc) return;

    stickToBottomRef.current = true;
    setInput("");
    setPendingImage(null);
    pendingImageUploadRef.current = null;
    if (templateProgress?.status === "failed") {
      setTemplateProgress(null);
      templateProgressRef.current = null;
    }
    setSending(true);
    setTyping(true);
    const userMsgId = crypto.randomUUID();
    setDraft((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: userMsgId,
            role: "user" as const,
            text,
            createdAt: new Date().toISOString(),
            ...(optimisticImageSrc
              ? { imageUrl: optimisticImageSrc, imageFilename: filename }
              : {}),
          },
        ],
      };
      const generationInFlight =
        templateProgressRef.current?.status === "started" ||
        templateProgressRef.current?.status === "generating";
      const pin = generationInFlight
        ? next.pendingGeneratePin
        : rememberGenerateUserPin(draftId, next.messages);
      const withPin = {
        ...next,
        pendingGeneratePin: pin ?? next.pendingGeneratePin,
      };
      upsertCampaignDraft(withPin);
      return withPin;
    });

    void (async () => {
      let imageUrl = pending?.imageUrl?.trim() || "";
      let mediaId = pending?.mediaId?.trim() || "";
      if (pending && !imageUrl) {
        try {
          const resolved = await resolvePendingChatImageUpload({
            imageUrl: pending.imageUrl,
            mediaId: pending.mediaId,
            previewUrl: pending.previewUrl,
            filename,
            uploadPromise: warmUpload,
          });
          imageUrl = resolved.url;
          mediaId = resolved.media_id;
        } catch (err) {
          setToast(err instanceof Error ? err.message : "Image upload failed");
          setSending(false);
          setTyping(false);
          if (previewBlob) URL.revokeObjectURL(previewBlob);
          return;
        }
      }

      if (imageUrl && imageUrl !== optimisticImageSrc) {
        setDraft((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === userMsgId
                ? { ...m, imageUrl, imageFilename: filename }
                : m,
            ),
          };
          upsertCampaignDraft(next);
          return next;
        });
      }
      if (previewBlob) URL.revokeObjectURL(previewBlob);

      if (!text && !imageUrl) {
        setSending(false);
        setTyping(false);
        return;
      }

      getAgentsSocket().emit("user_message", {
        session_id: draftId,
        token,
        text,
        module: "recommendation_run",
        hub_mode: false,
        recommendation_run: true,
        ...(imageUrl
          ? {
              chat_image_uploads: [
                {
                  image_url: imageUrl,
                  media_id: mediaId || undefined,
                  filename,
                  source: "chat_upload",
                },
              ],
            }
          : {}),
      });
    })();
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", {
      session_id: draftIdRef.current,
    });
    setTyping(false);
    setSending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onPickImage = () => {
    setAttachOpen(false);
    imageRef.current?.click();
  };

  const onPickFile = () => {
    setAttachOpen(false);
    fileRef.current?.click();
  };

  const onMic = async () => {
    setAttachOpen(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setToast("Mic ready — voice capture coming next");
    } catch {
      setToast("Microphone permission needed");
    }
    inputRef.current?.focus();
  };

  const onFilesSelected = (files: FileList | null, kind: "image" | "file") => {
    if (!files?.length) return;
    const file = files[0];
    if (kind === "image") {
      if (sending || typing) {
        setToast("Wait for the current reply, then upload the image.");
        return;
      }
      if (pendingImage?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(pendingImage.previewUrl);
      }
      const previewUrl = URL.createObjectURL(file);
      setPendingImage({
        previewUrl,
        filename: file.name,
      });
      const uploadPromise = uploadTemplateImageAsset(file);
      pendingImageUploadRef.current = uploadPromise;
      void uploadPromise
        .then((uploaded) => {
          setPendingImage((cur) =>
            cur && cur.previewUrl === previewUrl
              ? {
                  ...cur,
                  imageUrl: uploaded.url,
                  mediaId: uploaded.media_id,
                }
              : cur,
          );
        })
        .catch(() => {
          /* retry from blob on send */
        });
      inputRef.current?.focus();
      return;
    }
    const names = Array.from(files)
      .map((f) => f.name)
      .join(", ");
    setToast(`File selected: ${names}`);
    inputRef.current?.focus();
  };

  const openTemplateView = (tpl: TemplateCard) => {
    const draftId = draftIdRef.current;
    if (!draftId) return;
    const token = getToken();
    const latest =
      flattenTimelineCards(draft?.timelineTemplates).find(
        (c) => c.template_id === tpl.template_id,
      ) || tpl;
    getAgentsSocket().emit("open_template_editor", {
      session_id: draftId,
      token,
      channel: latest.channel,
      template_id: latest.template_id,
      fields: latest.fields,
    });
    navigate(`/campaigns/create/${draftId}/templates/${latest.template_id}`, {
      state: {
        template: {
          template_id: latest.template_id,
          channel: latest.channel,
          generation_batch_id: latest.generation_batch_id,
        },
        templates: flattenTimelineCards(draft?.timelineTemplates).map((c) => ({
          template_id: c.template_id,
          channel: c.channel,
          generation_batch_id: c.generation_batch_id,
        })),
        campaign: {
          name: agentState?.campaign?.name || draft?.name || card.title,
          goal: agentState?.campaign?.goal || draft?.goal || card.goal,
          objective: agentState?.campaign?.objective || card.objective,
        },
        listHref: `/campaigns/create/recommendations/${card.id}`,
      },
    });
  };

  const selectedChannelLabels = useMemo(() => {
    const selectedIds = [
      ...new Set(
        [...(draft?.channels || []), ...(agentState?.channels || [])]
          .map((c) => agentChannelToUiId(String(c)))
          .filter(Boolean) as string[],
      ),
    ];
    return selectedIds.map((id) => {
      const meta = CAMPAIGN_CHANNELS.find((c) => c.id === id);
      return meta?.label || id;
    });
  }, [draft?.channels, agentState?.channels]);

  const seedState: CampaignAgentState = agentState || {
    session_id: draft?.id || card.id,
    campaign: {
      name: draft?.name || card.title,
      goal: draft?.goal || card.goal,
      objective: draft?.objective || card.objective,
    },
    audience: {
      description: card.audience,
      matched_count: 0,
    },
    channels: normalizeChannelsToAgentIds(card.channels),
  };

  const guidedSnap = snapshotFromCampaignState({
    agentState: seedState,
    draftName: draft?.name || card.title,
    draftGoal: draft?.goal || card.goal,
    draftObjective: draft?.objective || card.objective,
    templateCount: Math.max(
      templates.length,
      agentState?.templates?.length ?? 0,
    ),
    selectedChannelLabels:
      selectedChannelLabels.length > 0
        ? selectedChannelLabels
        : card.channels.filter((ch) => !isChannelParked(ch)),
  });

  const lastAssistant = [...(draft?.messages || [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.text.trim());
  const nextQuestion =
    lastAssistant &&
    lastAssistant.text !== REC_RUN_WELCOME &&
    lastAssistant.text.includes("?")
      ? lastAssistant.text
      : null;
  const nextKeyOverride = nextQuestion
    ? inferNextKeyFromAssistantQuestion(nextQuestion)
    : null;

  if (!draft) {
    return <RecommendationWorkspaceSkeleton />;
  }

  const chatPhase = deriveCreateCampaignChatPhase({
    typing,
    sending,
    templateProgress,
    templatesPulling: false,
  });
  const busy = composerBusy(chatPhase, templateProgress);
  const showTyping = showTypingIndicator(chatPhase);
  const moments = normalizeChatTimeline(
    draft.timelineTemplates,
    draft.messages,
  );

  const leftover = unplacedTimelineMoments(moments, draft.messages);
  const progressAnchored = draft.messages.some((msg) => {
    if (msg.role !== "user") return false;
    const turnBlocks = blocksAfterUserTurn(moments, msg, draft.messages);
    return inFlightProgressForTurn({
      draft,
      msg,
      messages: draft.messages,
      progress: templateProgress,
      blocks: turnBlocks,
    });
  });

  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={chatScrollRef}
        className="dashboard-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        onScroll={() => {
          stickToBottomRef.current = isChatStuckToBottom(chatScrollRef.current);
        }}
      >
          {!sessionReady &&
          moments.length === 0 &&
          draft.messages.length === 0 ? (
            <RecommendationWorkspaceSkeleton />
          ) : null}
            {leftover.atStart.map((moment) => (
              <div key={moment.id} className="py-1">
                <TemplateCardsBatch
                  cards={moment.cards}
                  onView={openTemplateView}
                />
              </div>
            ))}
            {draft.messages.map((msg) => {
              const turnBlocks =
                msg.role === "user"
                  ? blocksAfterUserTurn(moments, msg, draft.messages)
                  : [];
              const blocks = blocksForChatMessage(
                moments,
                msg,
                draft.messages,
              );
              const showProgress = inFlightProgressForTurn({
                draft,
                msg,
                messages: draft.messages,
                progress: templateProgress,
                blocks: turnBlocks,
              });
              return (
              <Fragment key={msg.id}>
                <MessageBubble msg={msg} />
                {showProgress && templateProgress ? (
                  <TemplateGenerationProgress progress={templateProgress} />
                ) : null}
                {blocks.map((block) => (
                  <div key={block.id} className="py-1">
                    <TemplateCardsBatch
                      cards={block.cards}
                      onView={openTemplateView}
                    />
                  </div>
                ))}
              </Fragment>
              );
            })}
            {leftover.orphaned.map((moment) => (
              <div key={moment.id} className="py-1">
                <TemplateCardsBatch
                  cards={moment.cards}
                  onView={openTemplateView}
                />
              </div>
            ))}
            {templateProgress && !progressAnchored ? (
              <TemplateGenerationProgress progress={templateProgress} />
            ) : null}

          {showTyping ? (
            <AgentThinkingIndicator label="The agent is analysing" />
          ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );

  const chatFooter = (
    <>
      {toast ? (
        <p className="mb-1 text-xs text-text-caption" role="status">
          {toast}
        </p>
      ) : null}
      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={() => send()}
        busy={busy}
        onStop={stopGeneration}
        inputRef={inputRef}
        placeholder="Ask your question"
        className="w-full"
        maxWidthClass=""
        pendingImage={pendingImage}
        onClearPendingImage={() => {
          if (pendingImage?.previewUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(pendingImage.previewUrl);
          }
          setPendingImage(null);
          pendingImageUploadRef.current = null;
        }}
        leading={
          <div className="relative shrink-0" ref={attachMenuRef}>
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="inline-flex size-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Add attachment"
              aria-expanded={attachOpen}
            >
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
            {attachOpen ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg">
                <button
                  type="button"
                  onClick={onPickImage}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <ImageIcon className="size-4" strokeWidth={1.75} />
                  Upload image
                </button>
                <button
                  type="button"
                  onClick={onPickFile}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <FileIcon className="size-4" strokeWidth={1.75} />
                  Upload file
                </button>
              </div>
            ) : null}
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "image");
                e.target.value = "";
              }}
            />
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "file");
                e.target.value = "";
              }}
            />
          </div>
        }
        trailing={
          <button
            type="button"
            onClick={() => void onMic()}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
            aria-label="Voice input"
            title="Voice"
          >
            <Mic className="size-4" strokeWidth={1.75} />
          </button>
        }
      />
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {socketError ? (
        <p className="border-b border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}
      <ModuleSplitWorkspace
        className="!h-auto min-h-0 flex-1"
        leftTitle="Campaign chat"
        rightTitle="Campaign overview"
        left={chatPane}
        leftFooter={chatFooter}
        right={
          <CampaignGuidedPreview
            snap={guidedSnap}
            nextQuestion={nextQuestion}
            nextKeyOverride={nextKeyOverride}
            extras={
              card.whyCreated ? (
                <p className="text-xs text-neutral-500">{card.whyCreated}</p>
              ) : null
            }
            channelReadyById={channelReadyById}
            hiddenKeys={["templates"]}
          />
        }
      />
    </div>
  );
}
