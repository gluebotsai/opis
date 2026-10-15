import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  File as FileIcon,
  ImageIcon,
  Mic,
  Plus,
} from "lucide-react";
import { AgentChatComposer, type ComposerPendingImage } from "@/components/chat/AgentChatComposer";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { sanitizeAssistantChatText } from "@/lib/chat-user-facing";
import {
} from "@/lib/template-preview-images";
import { CampaignGuidedPreview } from "@/components/campaigns/CampaignGuidedPreview";
import { CreateCampaignChatSkeleton } from "@/components/campaigns/CreateCampaignChatSkeleton";
import { TemplateCardsBatch } from "@/components/campaigns/TemplateCardsBatch";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { useAgentNavigation } from "@/hooks/use-agent-navigation";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { looksLikeChatHtml } from "@/lib/chat-html";
import { parseContactsCsv } from "@/lib/parse-contacts-csv";
import { getCampaignProfile } from "@/lib/industry-packs";
import {
  isModuleWelcomeText,
  pickModuleWelcome,
} from "@/lib/module-welcomes";
import {
  inferNextKeyFromAssistantQuestion,
  snapshotFromCampaignState,
} from "@/lib/campaign-guided-fields";
import {
  deleteCampaignDraftAsync,
  displayDraftName,
  ensureAgentSessionShell,
  ensureDraftOnServer,
  getCampaignDraft,
  getCampaignDraftAsync,
  isDraftCommittable,
  isPlaceholderDraftName,
  markDraftLaunched,
  autoSaveDraftIfNeeded,
  sessionRowsToChatMessages,
  dedupeConsecutiveUserMessages,
  mergeMessagesServerWinsPendingLocal,
  upsertCampaignDraft,
  persistInFlightProgress,
  patchTimelineCardFields,
  persistTemplateEditToDraftAndSession,
  type CampaignChatDraft,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import {
  clearCreateCampaignAwaiting,
  ensureCreateCampaignBridge,
  getCreateCampaignBridgeSnapshot,
  markCreateCampaignAwaiting,
  markCreateCampaignServerBusy,
  releaseCreateCampaignBridge,
  subscribeCreateCampaignBridge,
} from "@/lib/create-campaign-chat-bridge";
import {
  abandonStaleCreateResume,
  clearActiveCreateSession,
  isCampaignSessionAccessDenied,
  markCreateDraftActive,
  markCreateHubActive,
} from "@/lib/create-campaign-active-session";
import {
  claimCreateCampaignSocketSession,
  isAgentsUnableToConnectError,
  releaseCreateCampaignSocketSession,
  withClientTimezone,
} from "@/lib/agents-join";
import {
  isAgentBusyError,
  isHydrationSessionReady,
} from "@/lib/agents-chat-runtime";
import {
  finalizeCreateCampaignMessages,
  hasCreateNonStaticAssistantReply,
  isCreateStaticWelcomeMessage,
  mergeCreateCampaignChatMessages,
} from "@/lib/create-campaign-transcript";
import { peekHubSessionId, resetHubSessionForUser } from "@/lib/create-campaign-hub-session";
import { isEmbedMode } from "@/lib/embed-auth";
import {
  CAMPAIGN_CHANNELS,
  VISIBLE_CAMPAIGN_CHANNELS,
  agentChannelToUiId,
  configChannelToUiId,
  isChannelParked,
  normalizeChannelsToAgentIds,
} from "@/lib/campaign-channels";
import { getToken } from "@/services/api";
import { fetchConfigChannels } from "@/services/configuration.service";
import {
  deferAgentsConnectError,
  getAgentsSocket,
  type CampaignAgentState,
  type TemplateCard,
} from "@/services/agents.socket";
import { getCampaignTemplate, loadCampaignTemplates } from "@/lib/campaign-templates";
import { buildSelectedGalleryImagesPayload } from "@/lib/selected-gallery-images";
import {
  resolvePendingChatImageUpload,
  uploadTemplateImageAsset,
} from "@/services/media.api";
import { ChatBubbleImageStrip } from "@/components/chat/ChatImageTiles";
import {
  chatImagesFromPending,
  chatImagesFromUploads,
  resolveCreateChatBubbleImages,
} from "@/lib/chat-message-images";
import {
  clearUsedLibraryTemplatesFromSelection,
  listSelectedTemplates,
} from "@/lib/selected-campaign-templates";
import { listRecommendations } from "@/lib/campaign-recommendations-store";
import { appendAgentWork } from "@/lib/agent-work-log-store";
import { launchOpportunityEvent } from "@/lib/opportunity-events-store";
import {
  chatPathForDraft,
  CREATE_CAMPAIGN_DRAFTS_HREF,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import {
  handoffJoinPayload,
  readChatHandoff,
} from "@/lib/chat-handoff";
import {
  hydrateTimelineFieldsFromDb,
  reconcileTimelineFromSessionIfNeeded,
  recoverTimelineFromDbIfEmpty,
  runTemplatesReadySync,
} from "@/lib/append-session-channel-templates";
import { mergeTimelinesPreserveLocal } from "@/lib/campaign-timeline-merge";
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
  normalizeChatTimeline,
  flattenTimelineCards,
  unplacedTimelineMoments,
  isChannelTemplatesReadyEvent,
  isNewTemplateGenerationBatch,
  reconcileLibraryTimelineIds,
  resolveEditorTemplateCard,
  shouldShowTemplateLoadProgress,
  shouldShowTemplateProgressUpdate,
  templatesReadyDedupeKey,
} from "@/lib/campaign-template-timeline";
import { fetchSessionChannelTemplates } from "@/services/channelTemplates.api";
import { scrollChatToBottom, isChatStuckToBottom } from "@/lib/chat-stick-bottom";
import {
  formatChannelTemplateSummary,
  formatLaunchPlanByChannel,
  templateCountsByChannelFromTimeline,
  totalTimelineTemplateCount,
} from "@/lib/campaign-channel-template-count";

type TemplateProgress = TemplateGenerationProgressModel;

import {
  composerBusy,
  deriveCreateCampaignChatPhase,
  templateProgressBlocksInput,
} from "@/lib/create-campaign-chat-phase";

/**
 * Starters / handoffs may seed a local user bubble without emitting user_message.
 * Track message ids we already dispatched so join/remount does not double-send.
 */
const dispatchedOrphanUserIds = new Set<string>();

/** Randomized opener — shown immediately; agent skips remote welcome. */
function withStaticWelcomeIfNeeded(draft: CampaignChatDraft): CampaignChatDraft {
  if ((draft.messages || []).length > 0) return draft;
  const welcome: ChatMessage = {
    id: `static-welcome-${draft.id}`,
    role: "assistant",
    text: pickModuleWelcome("create_campaign"),
    createdAt: new Date().toISOString(),
  };
  const next = { ...draft, messages: [welcome] };
  upsertCampaignDraft(next);
  return next;
}

function isStaticWelcomeMessage(m: ChatMessage): boolean {
  return isCreateStaticWelcomeMessage(m);
}

function hasNonStaticAssistantReply(messages: ChatMessage[]): boolean {
  return hasCreateNonStaticAssistantReply(messages);
}

/** True when the latest user turn has no real assistant reply yet. */
function draftHasPendingUserTurn(messages: ChatMessage[]): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return false;
  return !messages
    .slice(lastUserIdx + 1)
    .some((m) => m.role === "assistant" && !isStaticWelcomeMessage(m));
}

/** Emit one user_message for a local-only user ask that never reached the agent. */
function flushOrphanUserAsk(options: {
  draftId: string;
  token: string;
  remoteMessages: ChatMessage[];
  agentBusy?: boolean;
  /** Re-send even if we already tried (seed join may have failed). */
  force?: boolean;
}): boolean {
  const { draftId, token, remoteMessages, agentBusy, force } = options;
  if (agentBusy) return false;
  const local = getCampaignDraft(draftId)?.messages || [];
  const last = local.at(-1);
  if (!last || last.role !== "user") return false;
  const text = last.text.trim();
  if (!text) return false;
  // Match by content — never by index. Extra remote welcomes must not block resend.
  const remoteHasSameUser = remoteMessages.some(
    (m) => m.role === "user" && m.text.trim() === text,
  );
  let lastUserIdx = -1;
  for (let i = local.length - 1; i >= 0; i -= 1) {
    if (local[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const assistantAfterLastUser =
    lastUserIdx >= 0 &&
    local
      .slice(lastUserIdx + 1)
      .some((m) => m.role === "assistant" && !isStaticWelcomeMessage(m));
  if (remoteHasSameUser || assistantAfterLastUser) {
    dispatchedOrphanUserIds.add(last.id);
    return false;
  }
  if (dispatchedOrphanUserIds.has(last.id) && !force) return false;
  dispatchedOrphanUserIds.add(last.id);
  rememberGenerateUserPin(draftId, local);
  markCreateCampaignAwaiting(draftId);
  const socket = getAgentsSocket();
  if (!socket.connected) socket.connect();
  socket.emit("user_message", {
    session_id: draftId,
    token,
    text,
    ...createCampaignSocketPayload({}, draftId),
  });
  return true;
}

const CREATE_CAMPAIGN_MODULE = "create_campaign" as const;
const LIBRARY_RUN_MODULE = "library_run" as const;

function createCampaignSocketPayload(
  extra: Record<string, unknown> = {},
  draftId?: string,
) {
  const draft = draftId ? getCampaignDraft(draftId) : null;
  const libraryRun = Boolean(
    extra.library_run ??
      extra.libraryRun ??
      draft?.libraryRun ??
      draft?.usedLibraryTemplateIds?.length,
  );
  const { libraryRun: _lr, library_run: _lr2, ...rest } = extra as Record<
    string,
    unknown
  > & { libraryRun?: boolean; library_run?: boolean };
  return {
    module: libraryRun ? LIBRARY_RUN_MODULE : CREATE_CAMPAIGN_MODULE,
    hub_mode: false,
    recommendations_snapshot: buildRecommendationsSnapshot(),
    ...(libraryRun ? { library_run: true } : {}),
    ...rest,
  };
}

/** Optional context cards for the create-campaign agent (suggest only if relevant). */
function buildRecommendationsSnapshot() {
  return listRecommendations()
    .filter((r) => r.status === "active" || r.status === "creating")
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      title: r.title,
      goal: r.goal,
      objective: r.objective,
      channels: r.channels,
      audience: r.audience,
      matched_count: r.matchedCount,
      audience_filters: r.audienceFilters,
      why_created: r.whyCreated,
      intended_use: r.intendedUse,
      confidence: r.confidence,
      timing_label: r.timingLabel,
    }));
}

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

function applyAgentStateToDraft(
  draft: CampaignChatDraft,
  state: CampaignAgentState,
  messages?: ChatMessage[],
): CampaignChatDraft {
  const campaign = state.campaign || {};
  const audience = state.audience || {};
  const channels = (state.channels || []).map(
    (c) => c.charAt(0).toUpperCase() + c.slice(1),
  );
  const schedule =
    state.channel_plans?.[0]?.suggested_launch_at || draft.schedule;
  const audienceLabel =
    audience.matched_count && audience.matched_count > 0
      ? `${audience.matched_count} contacts` +
        (audience.filters && Object.keys(audience.filters).length
          ? ` (${Object.entries(audience.filters)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")})`
          : "")
      : draft.audience;

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
    schedule: schedule || draft.schedule,
    status: draft.status === "empty" ? "drafting" : draft.status,
    dirty: draft.status === "draft_saved" ? false : true,
    // Viewing / agent state sync must not bump list time or reorder drafts.
    updatedAt: draft.updatedAt,
    messages: messages ?? draft.messages,
  };

  if (state.launch_confirmed && draft.status !== "scheduled" && draft.status !== "live") {
    const mode = String(state.launch_plan?.schedule_mode || "").toLowerCase();
    const as =
      mode === "now" || String(state.stage || "").toLowerCase() === "live"
        ? "live"
        : "scheduled";
    next = markDraftLaunched(next, as);
    clearUsedLibraryTemplatesFromSelection(next.usedLibraryTemplateIds);
    appendAgentWork({
      agentId: "create_campaign",
      action: "campaign_launched",
      summary:
        as === "live"
          ? `Launched campaign “${displayDraftName(next, state)}”`
          : `Scheduled campaign “${displayDraftName(next, state)}”`,
      eventTitle: displayDraftName(next, state) || null,
      href: `/campaigns/create/${next.id}`,
      sourceKey: `campaign-launch-${next.id}`,
    });
    if (next.formEventId) {
      const launchedForm = launchOpportunityEvent(next.formEventId);
      if (launchedForm) {
        appendAgentWork({
          agentId: "forms",
          action: "event_launched",
          summary: `Form “${launchedForm.title}” is live in Events tracking`,
          eventId: launchedForm.id,
          eventTitle: launchedForm.title,
          href: `/events/${launchedForm.id}`,
          sourceKey: `event-launch-${launchedForm.id}`,
        });
      }
    }
  }

  return next;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const displayText =
    msg.role === "assistant"
      ? sanitizeAssistantChatText(msg.text)
      : msg.text;
  const images = resolveCreateChatBubbleImages(msg);
  const hasImage = images.length > 0;
  if (!displayText?.trim() && !hasImage) return null;
  const html =
    msg.role === "assistant" && looksLikeChatHtml(displayText);
  return (
    <div
      className={
        msg.role === "user" ? "flex justify-end" : "flex justify-start"
      }
    >
      <div className={chatBubbleClass(msg.role, undefined, { html })}>
        {hasImage ? (
          <ChatBubbleImageStrip images={images} variant="create" />
        ) : null}
        {displayText?.trim() ? (
          <ChatBubbleText text={displayText} role={msg.role} />
        ) : null}
      </div>
    </div>
  );
}

export function CreateCampaignChatWorkspace({
  draftId,
  listHref = CREATE_CAMPAIGN_DRAFTS_HREF,
}: {
  draftId: string;
  listHref?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const backHref =
    (location.state as { listHref?: string } | null)?.listHref || listHref;
  const [draft, setDraft] = useState<CampaignChatDraft | null>(null);
  useEmbedPageReady(Boolean(draft));
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [agentState, setAgentState] = useState<CampaignAgentState | null>(null);
  /** Flat list for overview / openTemplateView — derived from timelineTemplates. */
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [typing, setTyping] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState<string | null>(null);
  const [templateProgress, setTemplateProgress] =
    useState<TemplateProgress | null>(null);
  const [templatesPulling, setTemplatesPulling] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  /** Transport up (shared with hub) — not the same as draft session_ready. */
  const [agentsTransportConnected, setAgentsTransportConnected] = useState(
    () => getAgentsSocket().connected,
  );
  const [socketError, setSocketError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<ComposerPendingImage[]>(
    [],
  );
  /** Warm-upload per preview blob — awaited on send (edit-space parity). */
  const pendingUploadsRef = useRef<
    Map<
      string,
      Promise<{
        url: string;
        media_id: string;
      }>
    >
  >(new Map());
  /** Ready map for overview chips (locked when false / missing). */
  const [channelReadyById, setChannelReadyById] = useState<
    Record<string, boolean>
  >({});
  const [availableAgentChannels, setAvailableAgentChannels] = useState<
    string[]
  >([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<CampaignChatDraft | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const templateProgressRef = useRef<TemplateProgress | null>(null);
  const templatesReadyHandledRef = useRef<Set<string>>(new Set());
  const availableAgentRef = useRef<string[]>([]);
  const handoffRef = useRef(readChatHandoff("create_campaign"));
  const joinIssuedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const joinDraftRef = useRef<(() => void) | null>(null);
  const pendingSendAfterReadyRef = useRef<{
    caption: string;
    pending: ComposerPendingImage[];
  } | null>(null);
  const resendWhenReadyRef = useRef(false);
  const forceSendQueueRef = useRef<{
    caption: string;
    pending: ComposerPendingImage[];
  } | null>(null);
  const handleSendRef = useRef<(event?: FormEvent) => void>(() => {});
  const joinRecoverTimerRef = useRef<number | null>(null);
  const reconcileTimerRef = useRef<number | null>(null);
  const templateEditOpenRef = useRef(false);
  templateEditOpenRef.current = location.pathname.includes(
    `/campaigns/create/${draftId}/templates/`,
  );
  const agentStateRef = useRef<CampaignAgentState | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    markCreateDraftActive(draftId);
  }, [draftId]);

  useEffect(() => {
    void loadCampaignTemplates();
  }, []);

  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  useAgentNavigation({
    sessionId: draftId,
    module: CREATE_CAMPAIGN_MODULE,
    getMessages: () =>
      (draftRef.current?.messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
        ...(m.imageUrls?.length ? { image_urls: m.imageUrls } : {}),
        ...(m.imageUrl ? { image_url: m.imageUrl } : {}),
        ...(m.imageFilename ? { image_filename: m.imageFilename } : {}),
      })),
  });

  const restartChat = useCallback(() => {
    const next = startCreateCampaignChat({ useLibrarySelection: false });
    markCreateDraftActive(next.id);
    navigate(chatPathForDraft(next.id), {
      state: { listHref: CREATE_CAMPAIGN_DRAFTS_HREF },
    });
  }, [navigate]);

  useEffect(() => {
    availableAgentRef.current = availableAgentChannels;
  }, [availableAgentChannels]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchConfigChannels();
        if (cancelled) return;
        const agentIds: string[] = [];
        const readyMap: Record<string, boolean> = {};
        for (const row of rows) {
          const uiId = configChannelToUiId(row.channel);
          if (!uiId || isChannelParked(uiId)) continue;
          const meta = CAMPAIGN_CHANNELS.find((c) => c.id === uiId);
          if (!meta) continue;
          const isReady = row.status === "ready";
          readyMap[uiId] = Boolean(readyMap[uiId]) || isReady;
          const agent = normalizeChannelsToAgentIds([uiId]);
          for (const a of agent) {
            if (!agentIds.includes(a)) agentIds.push(a);
          }
        }

        // Always offer visible create channels to the agent (config-ready is send-time only).
        for (const ch of VISIBLE_CAMPAIGN_CHANNELS) {
          for (const a of normalizeChannelsToAgentIds([ch.id])) {
            if (!agentIds.includes(a)) agentIds.push(a);
          }
        }
        readyMap.whatsapp = true;

        setChannelReadyById(readyMap);
        setAvailableAgentChannels(agentIds);
      } catch {
        if (!cancelled) {
          const fallbackAgent = VISIBLE_CAMPAIGN_CHANNELS.flatMap((c) =>
            normalizeChannelsToAgentIds([c.id]),
          );
          setChannelReadyById(
            Object.fromEntries(
              VISIBLE_CAMPAIGN_CHANNELS.map((c) => [c.id, c.id === "whatsapp"]),
            ),
          );
          setAvailableAgentChannels(fallbackAgent);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    templateProgressRef.current = templateProgress;
  }, [templateProgress]);

  useEffect(() => {
    if (draft) hydrateGeneratePinsFromDraft(draft);
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    void ensureAgentSessionShell(draftId)
      .catch(() => {
        /* agents join will retry get-or-create */
      })
      .then(() => getCampaignDraftAsync(draftId))
      .then(async (existing) => {
      if (cancelled) return;
      const fallback = existing ?? getCampaignDraft(draftId);
      if (!fallback) {
        navigate(backHref);
        return;
      }
      const seeded = withStaticWelcomeIfNeeded(fallback);
      setDraft(seeded);
      setTemplates(flattenTimelineCards(seeded.timelineTemplates));
      // Prefer DB fields over any stale generate still in local draft.
      const hydrated = await hydrateTimelineFieldsFromDb(draftId);
      if (cancelled) return;
      const recovered = await recoverTimelineFromDbIfEmpty(draftId);
      if (cancelled) return;
      const withTimeline = recovered ?? hydrated ?? seeded;
      setDraft(withTimeline);
      setTemplates(flattenTimelineCards(withTimeline.timelineTemplates));
      if (
        withTimeline !== hydrated &&
        isDraftCommittable(withTimeline)
      ) {
        void ensureDraftOnServer(withTimeline).catch(() => {
          upsertCampaignDraft(withTimeline);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [draftId, backHref, navigate]);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [draftId]);

  useEffect(() => {
    const socket = getAgentsSocket();
    const syncTransport = () => setAgentsTransportConnected(socket.connected);
    syncTransport();
    socket.on("connect", syncTransport);
    socket.on("disconnect", syncTransport);
    return () => {
      socket.off("connect", syncTransport);
      socket.off("disconnect", syncTransport);
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
    typing,
    sending,
    templates.length,
    thinkingLabel,
  ]);

  useEffect(() => {
    setSessionReady(false);
    sessionReadyRef.current = false;
    setTemplateProgress(null);
    setTemplatesPulling(false);
    joinIssuedRef.current = false;
    const existing = getCampaignDraft(draftId);
    if (existing) {
      hydrateGeneratePinsFromDraft(existing);
      const seeded = withStaticWelcomeIfNeeded(existing);
      setDraft(seeded);
      setTemplates(flattenTimelineCards(seeded.timelineTemplates));
      const inflight = existing.inFlightProgress;
      if (
        inflight &&
        (inflight.status === "started" ||
          inflight.status === "generating" ||
          inflight.status === "failed")
      ) {
        setTemplateProgress(inflight);
        templateProgressRef.current = inflight;
      }
    } else {
      setDraft(null);
      setTemplates(flattenTimelineCards(undefined));
    }
  }, [draftId]);

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

  const persist = useCallback((next: CampaignChatDraft) => {
    const messages = finalizeCreateCampaignMessages(
      next.id,
      next.messages || [],
    );
    const saved = { ...next, messages };
    upsertCampaignDraft(saved);
    setDraft(saved);
    setTemplates(flattenTimelineCards(saved.timelineTemplates));
  }, []);

  // Create-campaign agent socket (session_id = draftId)
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for campaign agent.");
      return;
    }

    const socket = getAgentsSocket();
    setSocketError(null);
    claimCreateCampaignSocketSession(draftId);
    const leftoverHub = peekHubSessionId();
    if (leftoverHub && leftoverHub !== draftId) {
      try {
        socket.emit("leave_session", { session_id: leftoverHub });
      } catch {
        /* best-effort */
      }
    }
    ensureCreateCampaignBridge(draftId);

    const syncBusyFromBridge = () => {
      const snap = getCreateCampaignBridgeSnapshot(draftId);
      setThinkingLabel(snap.thinkingLabel);
      if (
        !snap.awaitingAgentReply &&
        !snap.serverAgentBusy &&
        !snap.typing &&
        !snap.sending
      ) {
        setSocketError((prev) =>
          prev === "Please wait for the current agent response." ? null : prev,
        );
      }
      // Keep typing indicator visible whenever the turn is in flight — even
      // while template progress chrome is also showing.
      const inFlight =
        snap.awaitingAgentReply ||
        snap.serverAgentBusy ||
        snap.typing ||
        snap.sending;
      setTyping(inFlight);
      setSending(snap.awaitingAgentReply || snap.sending || snap.serverAgentBusy);
    };

    const unsubBridge = subscribeCreateCampaignBridge(draftId, () => {
      const latest = getCampaignDraft(draftId);
      if (!latest) {
        syncBusyFromBridge();
        return;
      }
      setDraft((prev) => {
        if (!prev) return latest;
        const messages = mergeCreateCampaignChatMessages(
          draftId,
          prev.messages || [],
          latest.messages || [],
        );
        const merged = { ...prev, ...latest, messages };
        upsertCampaignDraft(merged);
        setTemplates(flattenTimelineCards(merged.timelineTemplates));
        return merged;
      });
      syncBusyFromBridge();
    });
    syncBusyFromBridge();

    const onReady = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
      agent_busy?: boolean;
      ready_phase?: string;
      messages?: Array<{
        id?: string;
        role?: string;
        text?: string;
        created_at?: string;
      }>;
    }) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      const msgs = toLocalMessages(payload.messages || []);
      const followUpReady = sessionReadyRef.current;
      sessionReadyRef.current = true;
      setSessionReady(true);
      if (joinRecoverTimerRef.current != null) {
        window.clearTimeout(joinRecoverTimerRef.current);
        joinRecoverTimerRef.current = null;
      }
      setAgentState(payload.state || null);
      const bridgeAtReady = getCreateCampaignBridgeSnapshot(draftId);
      const hydration = isHydrationSessionReady(payload);
      const turnBusy =
        bridgeAtReady.awaitingAgentReply ||
        bridgeAtReady.sending ||
        bridgeAtReady.serverAgentBusy;
      setDraft((prev) => {
        if (!prev) return prev;
        const localCached = getCampaignDraft(draftId)?.messages || prev.messages;
        const mergedMessages = mergeCreateCampaignChatMessages(
          draftId,
          localCached,
          msgs,
          {
            busy: turnBusy,
            followUpReady,
            hydration,
          },
        );
        const remoteTimeline = Array.isArray(
          (payload.state as { ui?: { timelineTemplates?: unknown } } | null | undefined)
            ?.ui?.timelineTemplates,
        )
          ? ((payload.state as { ui?: { timelineTemplates?: typeof prev.timelineTemplates } })
              .ui?.timelineTemplates as typeof prev.timelineTemplates)
          : undefined;
        const mergedTimeline = mergeTimelinesPreserveLocal(
          prev.timelineTemplates,
          remoteTimeline,
          prev.messages,
          mergedMessages,
          prev.generationPins,
        );
        const pinned = mergedTimeline;
        const next = applyAgentStateToDraft(
          { ...prev, timelineTemplates: pinned },
          payload.state || { session_id: draftId },
          mergedMessages,
        );
        setTemplates(flattenTimelineCards(next.timelineTemplates));
        upsertCampaignDraft(next);
        return next;
      });

      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
      }
      reconcileTimerRef.current = window.setTimeout(() => {
        reconcileTimerRef.current = null;
        const current = getCampaignDraft(draftId) ?? draftRef.current;
        if ((current?.timelineTemplates?.length ?? 0) > 0) return;
        void reconcileTimelineFromSessionIfNeeded(draftId).then((repaired) => {
          if (!repaired) return;
          draftRef.current = repaired;
          setDraft(repaired);
          setTemplates(flattenTimelineCards(repaired.timelineTemplates));
          if (isDraftCommittable(repaired, payload.state)) {
            void ensureDraftOnServer(repaired, payload.state ?? null).catch(() => {
              upsertCampaignDraft(repaired);
            });
          }
        });
      }, 450);

      const bridgeSnap = getCreateCampaignBridgeSnapshot(draftId);
      const lastMerged = (() => {
        const localCached = getCampaignDraft(draftId)?.messages || draftRef.current?.messages || [];
        if (msgs.length === 0) return localCached.at(-1);
        return mergeMessagesServerWinsPendingLocal(localCached, msgs).at(-1);
      })();
      const staleSessionBusy =
        Boolean(payload.agent_busy) &&
        !bridgeSnap.typing &&
        !bridgeSnap.sending &&
        lastMerged?.role === "assistant";
      const serverBusy = staleSessionBusy ? false : Boolean(payload.agent_busy);
      markCreateCampaignServerBusy(draftId, serverBusy);
      const flushed =
        followUpReady ||
        bridgeSnap.awaitingAgentReply ||
        bridgeSnap.sending
          ? false
          : flushOrphanUserAsk({
              draftId,
              token,
              remoteMessages: msgs,
              agentBusy: serverBusy,
            });
      const mergedForPending =
        getCampaignDraft(draftId)?.messages ||
        draftRef.current?.messages ||
        [];
      const pendingUserTurn = draftHasPendingUserTurn(mergedForPending);
      const waiting =
        serverBusy ||
        bridgeSnap.typing ||
        bridgeSnap.sending ||
        bridgeSnap.awaitingAgentReply ||
        flushed ||
        pendingUserTurn;
      if (waiting) {
        markCreateCampaignAwaiting(draftId);
        const bridgeSnapAfter = getCreateCampaignBridgeSnapshot(draftId);
        setThinkingLabel(bridgeSnapAfter.thinkingLabel);
        setTyping(true);
        setSending(true);
      } else {
        clearCreateCampaignAwaiting(draftId);
        const bridgeSnapDone = getCreateCampaignBridgeSnapshot(draftId);
        setThinkingLabel(bridgeSnapDone.thinkingLabel);
        setTyping(false);
        setSending(false);
      }

      // Only recover cards when both server ui timeline and local pins are empty.
      // Never re-append after launch onto the wrong turn (looks like cards "reappear").
      const localDraft = getCampaignDraft(draftId) ?? draftRef.current;
      const localCards = flattenTimelineCards(localDraft?.timelineTemplates);
      const remoteUiTimeline = Array.isArray(
        (payload.state as { ui?: { timelineTemplates?: unknown } } | null | undefined)
          ?.ui?.timelineTemplates,
      )
        ? ((
            payload.state as {
              ui?: { timelineTemplates?: NonNullable<typeof localDraft>["timelineTemplates"] };
            }
          ).ui!.timelineTemplates as NonNullable<
            NonNullable<typeof localDraft>["timelineTemplates"]
          >)
        : undefined;
      const remoteUiCards = flattenTimelineCards(remoteUiTimeline);
      if (
        localCards.length === 0 &&
        remoteUiCards.length === 0 &&
        localDraft &&
        !payload.state?.launch_confirmed
      ) {
        setTemplatesPulling(true);
        void recoverTimelineFromDbIfEmpty(draftId)
          .then((result) => {
            if (!result) return;
            draftRef.current = result;
            setDraft(result);
            setTemplates(flattenTimelineCards(result.timelineTemplates));
            if (
              flattenTimelineCards(result.timelineTemplates).length > 0 &&
              isDraftCommittable(result, payload.state)
            ) {
              void ensureDraftOnServer(result, payload.state).catch(() => {
                upsertCampaignDraft(result);
              });
            }
          })
          .finally(() => setTemplatesPulling(false));
      }
    };

    const onState = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
      chat_context?: string;
    }) => {
      if (payload.chat_context === "edit") return;
      if (payload.session_id && payload.session_id !== draftId) return;
      if (!payload.state) return;
      setAgentState(payload.state);
      setDraft((prev) => {
        if (!prev) return prev;
        const next = applyAgentStateToDraft(prev, payload.state!);
        setTemplates(flattenTimelineCards(next.timelineTemplates));
        upsertCampaignDraft(next);
        if (isDraftCommittable(next, payload.state)) {
          void ensureDraftOnServer(next, payload.state).catch(() => {
            upsertCampaignDraft(next);
          });
        }
        return next;
      });
    };

    const applySavedTemplate = (templateId: string, fields: Record<string, unknown>) => {
      void persistTemplateEditToDraftAndSession(draftId, templateId, fields).then(
        (next) => {
          if (!next) return;
          draftRef.current = next;
          setDraft(next);
          setTemplates(flattenTimelineCards(next.timelineTemplates));
        },
      );
    };

    const onTemplateUpdated = (payload: {
      session_id?: string;
      template_id?: string;
      template?: { template_id?: string; fields?: Record<string, unknown> };
    }) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      const tid = String(
        payload.template_id || payload.template?.template_id || "",
      ).trim();
      const fields = payload.template?.fields;
      if (!tid || !fields || typeof fields !== "object") return;
      applySavedTemplate(tid, fields);
    };

    const onUi = (payload: {
      session_id?: string;
      type?: string;
      chat_context?: string;
      payload?: TemplateCard[] | TemplateProgress | Record<string, unknown>;
    }) => {
      if (payload.chat_context === "edit") return;
      if (payload.session_id && payload.session_id !== draftId) return;
      if (isChannelTemplatesReadyEvent(payload.type)) {
        const eventBody =
          payload.payload && !Array.isArray(payload.payload)
            ? (payload.payload as Record<string, unknown>)
            : null;
        const dedupeKey = templatesReadyDedupeKey(eventBody);
        if (templatesReadyHandledRef.current.has(dedupeKey)) {
          void runTemplatesReadySync(draftId, eventBody).then((result) => {
            if (!result.draft) return;
            draftRef.current = result.draft;
            setDraft(result.draft);
            setTemplates(flattenTimelineCards(result.draft.timelineTemplates));
          });
          return;
        }
        templatesReadyHandledRef.current.add(dedupeKey);

        const current = draftRef.current ?? getCampaignDraft(draftId);
        const willShowLoadProgress = shouldShowTemplateLoadProgress(
          current,
          eventBody,
        );

        if (willShowLoadProgress) {
          setTemplatesPulling(true);
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
        // Do not clear the turn lock here — turn_complete / finishAgentTurn
        // ends typing after the assistant reply. Clearing early hid the indicator
        // while launch/tools were still running.
        const bridgeSnapReady = getCreateCampaignBridgeSnapshot(draftId);
        const stillBusy =
          bridgeSnapReady.awaitingAgentReply ||
          bridgeSnapReady.serverAgentBusy ||
          bridgeSnapReady.typing ||
          bridgeSnapReady.sending;
        setTyping(stillBusy);
        setSending(stillBusy);

        if (!current) {
          setTemplatesPulling(false);
          setTemplateProgress(null);
          templateProgressRef.current = null;
          return;
        }

        void runTemplatesReadySync(draftId, eventBody)
          .then((result) => {
            if (!result.draft) return;
            draftRef.current = result.draft;
            setDraft(result.draft);
            setTemplates(flattenTimelineCards(result.draft.timelineTemplates));
            if (isDraftCommittable(result.draft, agentStateRef.current)) {
              void ensureDraftOnServer(result.draft, agentStateRef.current).catch(
                () => {
                  upsertCampaignDraft(result.draft!);
                },
              );
            }
            if (!result.added.length) return;
            const channels = [
              ...new Set(
                result.added
                  .map((c) => String(c.channel || "").toLowerCase())
                  .filter(Boolean),
              ),
            ];
            appendAgentWork({
              agentId: "create_campaign",
              action: "templates_created",
              summary: `Created ${result.added.length} template card${result.added.length === 1 ? "" : "s"}${
                channels.length ? ` (${channels.join(", ")})` : ""
              }`,
              eventTitle: displayDraftName(result.draft, agentStateRef.current) || null,
              href: `/campaigns/create/${result.draft.id}`,
              sourceKey: `templates-${result.draft.id}-${result.added.map((c) => c.template_id).join(",")}`,
            });
          })
          .finally(() => {
            setTemplatesPulling(false);
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
        const current = draftRef.current ?? getCampaignDraft(draftId);
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
          const newGenerationBatch =
            Boolean(incomingBatch) &&
            Boolean(prevBatch) &&
            incomingBatch !== prevBatch;
          const base = newGenerationBatch ? null : prev;
          const nextPercent = Math.max(
            base?.percent ?? 0,
            progress.percent ?? 0,
          );
          const nextStatus =
            base &&
            (base.percent ?? 0) > (progress.percent ?? 0) &&
            progress.status === "started"
              ? base.status
              : progress.status;
          const merged: TemplateProgress = {
            ...base,
            ...progress,
            status: nextStatus,
            percent: nextPercent,
            channels: Array.isArray(progress.channels)
              ? progress.channels
              : prev?.channels || [],
            completed_channels: Array.isArray(progress.completed_channels)
              ? progress.completed_channels
              : prev?.completed_channels || [],
            failed_channels: Array.isArray(progress.failed_channels)
              ? progress.failed_channels
              : prev?.failed_channels || [],
          };
          templateProgressRef.current = merged;
          return merged;
        });
        const stored = templateProgressRef.current;
        persistInFlightProgress(
          draftId,
          stored && stored.status !== "completed" ? stored : null,
        );
        if (progress.status !== "completed") {
          // Progress chrome is visible — still keep the chat busy/typing lock.
          setTyping(true);
          setSending(true);
        } else {
          const bridgeSnap = getCreateCampaignBridgeSnapshot(draftId);
          const stillBusy =
            bridgeSnap.awaitingAgentReply ||
            bridgeSnap.serverAgentBusy ||
            bridgeSnap.typing ||
            bridgeSnap.sending;
          setTyping(stillBusy);
          setSending(stillBusy);
          window.setTimeout(() => {
            setTemplateProgress(null);
            templateProgressRef.current = null;
            persistInFlightProgress(draftId, null);
          }, 400);
        }
      }
    };

    const onPaused = (payload: { session_id?: string; paused?: boolean }) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      if (payload.paused) {
        clearCreateCampaignAwaiting(draftId);
        setTyping(false);
        setSending(false);
        setThinkingLabel(null);
      }
    };

    const onStopped = (payload: { session_id?: string }) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      clearCreateCampaignAwaiting(draftId);
      setTyping(false);
      setSending(false);
    };

    const onError = (
      payload:
        | { session_id?: string; message?: string; code?: string }
        | string,
    ) => {
      const message =
        typeof payload === "string"
          ? payload
          : payload?.message || "Agent error";
      if (typeof payload !== "string" && isAgentBusyError(payload)) {
        setSocketError(
          "Still working on your last message — wait for the reply, then send again.",
        );
        return;
      }
      if (
        isAgentsUnableToConnectError(payload) ||
        isAgentsUnableToConnectError(message)
      ) {
        joinIssuedRef.current = false;
        sessionReadyRef.current = false;
        setSessionReady(false);
        clearCreateCampaignAwaiting(draftId);
        setTyping(false);
        setSending(false);
        setThinkingLabel(null);
        setSocketError("Co-worker connection dropped — reconnecting…");
        if (socket.connected) {
          joinDraftRef.current?.();
        } else {
          socket.connect();
        }
        return;
      }
      if (
        typeof payload !== "string" &&
        payload?.session_id &&
        payload.session_id !== draftId
      ) {
        return;
      }
      clearCreateCampaignAwaiting(draftId);
      setTyping(false);
      setSending(false);

      // Soft-nav may resume another user's draft id from shared browser storage.
      if (isCampaignSessionAccessDenied(message)) {
        abandonStaleCreateResume();
        resetHubSessionForUser();
        releaseCreateCampaignBridge(draftId);
        const hubPath = isEmbedMode()
          ? "/campaigns/create?embed=1"
          : "/campaigns/create";
        navigate(hubPath, { replace: true });
        return;
      }
      setSocketError(message);
    };

    let cancelConnectErrorReport: (() => void) | null = null;
    let joinAfterErrorTimer: number | null = null;
    const onConnectError = (err: Error) => {
      joinIssuedRef.current = false;
      sessionReadyRef.current = false;
      setSessionReady(false);
      cancelConnectErrorReport?.();
      if (isAgentsUnableToConnectError(err)) {
        clearCreateCampaignAwaiting(draftId);
        setTyping(false);
        setSending(false);
        setThinkingLabel(null);
        setSocketError("Co-worker connection dropped — reconnecting…");
      }
      cancelConnectErrorReport = deferAgentsConnectError(socket, err, setSocketError);
      if (joinAfterErrorTimer != null) window.clearTimeout(joinAfterErrorTimer);
      if (socket.connected) {
        joinAfterErrorTimer = window.setTimeout(() => {
          joinAfterErrorTimer = null;
          joinDraftRef.current?.();
        }, 400);
      }
    };

    const onDisconnect = (reason: string) => {
      if (reason === "io client disconnect") {
        // JWT refresh — transport drops briefly; keep draft ready so send is not blocked.
        return;
      }
      joinIssuedRef.current = false;
      sessionReadyRef.current = false;
      setSessionReady(false);
      setSocketError("Disconnected from agents — reconnecting…");
    };

    const onConnect = () => {
      setSocketError(null);
      if (sessionReadyRef.current) return;
      joinIssuedRef.current = false;
      join();
    };

    socket.on("session_ready", onReady);
    socket.on("state_update", onState);
    socket.on("template_updated", onTemplateUpdated);
    socket.on("ui_event", onUi);
    socket.on("chat_paused", onPaused);
    socket.on("generation_stopped", onStopped);
    socket.on("error", onError);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);

    const join = () => {
      claimCreateCampaignSocketSession(draftId);
      if (joinIssuedRef.current) return;
      joinIssuedRef.current = true;

      const carried = handoffRef.current;
      const existing = draftRef.current ?? getCampaignDraft(draftId);
      const fromDraft = (existing?.usedLibraryTemplateIds || [])
        .map((id) => getCampaignTemplate(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t));
      const selectedSource =
        fromDraft.length > 0 ? fromDraft : listSelectedTemplates();
      const selected = selectedSource.map((t) => ({
        id: t.id,
        template_id: t.id,
        channel:
          normalizeChannelsToAgentIds([t.primaryChannel])[0] || t.primaryChannel,
        name: t.name,
        description: t.description,
        body_preview: t.bodyPreview,
        format_notes: t.flowSteps?.join(" → ") || "",
        fields: t.fields || undefined,
      }));
      const seededTemplates = (existing?.timelineTemplates || []).flatMap(
        (batch) => batch.cards || [],
      );
      const isLibraryRun = Boolean(
        existing?.libraryRun || existing?.usedLibraryTemplateIds?.length,
      );
      const isClone = Boolean(
        !isLibraryRun &&
          (existing?.cloneSourceName || seededTemplates.length),
      );
      const localMsgs = existing?.messages || [];
      const lastUser = [...localMsgs].reverse().find((m) => m.role === "user");
      const hasAssistant = hasCreateNonStaticAssistantReply(localMsgs);
      const seedUserMessage = (
        existing?.seedUserOnJoin ||
        carried?.query ||
        (!hasAssistant && lastUser ? lastUser.text.trim() : "")
      ).trim();
      const skipSeedBecauseAlreadySent =
        Boolean(lastUser) &&
        (dispatchedOrphanUserIds.has(lastUser!.id) ||
          getCreateCampaignBridgeSnapshot(draftId).awaitingAgentReply);
      const effectiveSeed = skipSeedBecauseAlreadySent ? "" : seedUserMessage;
      if (
        lastUser &&
        effectiveSeed &&
        lastUser.text.trim() === effectiveSeed
      ) {
        dispatchedOrphanUserIds.add(lastUser.id);
      }
      const skipWelcome = Boolean(
        localMsgs.length ||
          existing?.usedLibraryTemplateIds?.length ||
          isClone ||
          isLibraryRun ||
          effectiveSeed ||
          seedUserMessage,
      );
      const normalizedChannels = normalizeChannelsToAgentIds(
        existing?.channels || [],
      );
      const available =
        availableAgentRef.current.length > 0
          ? availableAgentRef.current
          : normalizedChannels;
      if (effectiveSeed) {
        markCreateCampaignAwaiting(draftId);
        setTyping(true);
        setSending(true);
      }
      socket.emit(
        "join_session",
        withClientTimezone({
          session_id: draftId,
          token,
          clear_edit_scope: !templateEditOpenRef.current,
          ...createCampaignSocketPayload({
            library_run: isLibraryRun,
            skip_welcome: skipWelcome,
            selected_library_templates: selected,
            selected_gallery_images: buildSelectedGalleryImagesPayload(),
            channels: normalizedChannels,
            available_channels: available,
            campaign_profile: getCampaignProfile(),
            ...handoffJoinPayload(carried),
            ...(effectiveSeed ? { seed_user_message: effectiveSeed } : {}),
            ...(existing?.formEventId
              ? {
                  form_launch: {
                    event_id: existing.formEventId,
                    title: existing.formTitle || "",
                    public_url: existing.formPublicUrl || "",
                  },
                }
              : {}),
          ...(isLibraryRun
            ? {
                campaign: {
                  name: existing?.name || "",
                  goal: existing?.goal || "",
                  objective: existing?.objective || "",
                },
                seeded_templates: seededTemplates.map((card) => ({
                  ...card,
                  channel:
                    normalizeChannelsToAgentIds([card.channel])[0] ||
                    card.channel,
                })),
                skip_welcome: true,
              }
            : {}),
          ...(isClone
            ? {
                clone_mode: true,
                clone_source_name: existing?.cloneSourceName || "",
                campaign: {
                  name: existing?.name || "",
                  goal: existing?.goal || "",
                  objective: existing?.objective || "",
                },
                seeded_templates: seededTemplates.map((card) => ({
                  ...card,
                  channel:
                    normalizeChannelsToAgentIds([card.channel])[0] ||
                    card.channel,
                })),
                skip_welcome: true,
              }
            : {}),
        }),
        }),
      );
      if (existing?.seedUserOnJoin) {
        upsertCampaignDraft({ ...existing, seedUserOnJoin: undefined });
      }
    };
    joinDraftRef.current = () => {
      joinIssuedRef.current = false;
      join();
    };
    // Always listen for reconnect — if we only join when already connected, a later
    // io client disconnect never re-runs join_session (stuck sessionReady).
    socket.on("connect", onConnect);
    if (socket.connected) onConnect();

    // If reply was in-flight during template View, re-join once for history.
    // Also force-flush a seeded user ask if the agent never answered.
    if (joinRecoverTimerRef.current != null) {
      window.clearTimeout(joinRecoverTimerRef.current);
    }
    joinRecoverTimerRef.current = window.setTimeout(() => {
      joinRecoverTimerRef.current = null;
      if (sessionReadyRef.current) return;
      if (socket.connected) {
        joinIssuedRef.current = false;
        join();
      }
      const current = draftRef.current ?? getCampaignDraft(draftId);
      const msgs = current?.messages || [];
      const last = msgs.at(-1);
      if (last?.role !== "user" || hasNonStaticAssistantReply(msgs)) return;
      if (dispatchedOrphanUserIds.has(last.id)) return;
      const bridgeSnap = getCreateCampaignBridgeSnapshot(draftId);
      if (
        bridgeSnap.typing ||
        bridgeSnap.sending ||
        bridgeSnap.serverAgentBusy ||
        bridgeSnap.awaitingAgentReply
      ) {
        return;
      }
      const flushed = flushOrphanUserAsk({
        draftId,
        token,
        remoteMessages: [],
      });
      if (flushed) {
        setTyping(true);
        setSending(true);
      }
    }, 3500);

    return () => {
      cancelConnectErrorReport?.();
      if (joinAfterErrorTimer != null) {
        window.clearTimeout(joinAfterErrorTimer);
        joinAfterErrorTimer = null;
      }
      if (joinRecoverTimerRef.current != null) {
        window.clearTimeout(joinRecoverTimerRef.current);
        joinRecoverTimerRef.current = null;
      }
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
      joinIssuedRef.current = false;
      joinDraftRef.current = null;
      releaseCreateCampaignSocketSession(draftId);
      unsubBridge();
      socket.off("session_ready", onReady);
      socket.off("state_update", onState);
      socket.off("template_updated", onTemplateUpdated);
      socket.off("ui_event", onUi);
      socket.off("chat_paused", onPaused);
      socket.off("generation_stopped", onStopped);
      socket.off("error", onError);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
      // Keep bridge listeners alive across template View (do not release here).
    };
    // availableAgentChannels updates via availableAgentRef — do not re-bind socket here
    // or join_session is skipped while session_ready listeners were removed (stuck load).
  }, [draftId, navigate]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const leaveClean = useCallback(
    (href: string) => {
      const current = draftRef.current;
      const agentSnap = agentStateRef.current;
      if (current && !isDraftCommittable(current, agentSnap)) {
        // Keep early chats that already have messages (soft-nav resume).
        const hasChat = (current.messages || []).some(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            String(m.text || "").trim(),
        );
        if (!hasChat) {
          void deleteCampaignDraftAsync(current.id);
          clearActiveCreateSession();
        } else {
          upsertCampaignDraft(current);
          markCreateDraftActive(current.id);
        }
      } else if (current && isDraftCommittable(current, agentSnap)) {
        const saved = autoSaveDraftIfNeeded(current);
        clearUsedLibraryTemplatesFromSelection(saved.usedLibraryTemplateIds);
        void ensureDraftOnServer(saved, agentSnap).catch(() => {
          upsertCampaignDraft(saved);
        });
        markCreateDraftActive(saved.id);
      }
      releaseCreateCampaignBridge(draftId);
      if (href.startsWith("/campaigns/create") && !href.includes(`/${draftId}`)) {
        markCreateHubActive();
      }
      navigate(href);
    },
    [navigate, draftId],
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      if (
        href === `/marketing/create/${draftId}` ||
        href === `/campaigns/create/${draftId}` ||
        href.startsWith(`/campaigns/create/${draftId}/`) ||
        href.startsWith(`/marketing/create/${draftId}/`)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      leaveClean(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [draftId, leaveClean]);

  useEffect(() => {
    if (!sessionReady || !resendWhenReadyRef.current) return;
    resendWhenReadyRef.current = false;
    const q = pendingSendAfterReadyRef.current;
    if (!q) return;
    pendingSendAfterReadyRef.current = null;
    forceSendQueueRef.current = q;
    handleSendRef.current();
  }, [sessionReady]);

  const handleSend = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft) return;
    const bridgeBeforeSend = getCreateCampaignBridgeSnapshot(draftId);
    if (
      sending ||
      typing ||
      bridgeBeforeSend.awaitingAgentReply ||
      bridgeBeforeSend.serverAgentBusy
    ) {
      if (
        bridgeBeforeSend.awaitingAgentReply ||
        bridgeBeforeSend.serverAgentBusy
      ) {
        setSocketError("Please wait for the current agent response.");
      }
      return;
    }
    const queued = forceSendQueueRef.current;
    const caption = queued ? queued.caption : input.trim();
    const pending = queued ? [...queued.pending] : [...pendingImages];
    if (queued) {
      forceSendQueueRef.current = null;
      setInput("");
      setPendingImages([]);
    }
    if (!caption && !pending.length) return;
    if (templateProgressBlocksInput(templateProgress)) return;
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required.");
      return;
    }

    const socket = getAgentsSocket();
    if (!socket.connected) {
      pendingSendAfterReadyRef.current = { caption, pending };
      resendWhenReadyRef.current = true;
      socket.connect();
      setSocketError("Co-worker reconnecting — your message will send when connected.");
      return;
    }
    if (!sessionReady) {
      joinDraftRef.current?.();
    }
    pendingSendAfterReadyRef.current = null;
    resendWhenReadyRef.current = false;
    setSocketError(null);

    const text = caption.trim();
    const first = pending[0];
    const filename = first?.filename || "image";
    const previewBlobs = pending
      .map((p) => (p.previewUrl?.startsWith("blob:") ? p.previewUrl : ""))
      .filter(Boolean);
    const uploadMap = pendingUploadsRef.current;
    const optimisticImages = chatImagesFromPending(pending);
    if (!text && !optimisticImages.length) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: new Date().toISOString(),
      ...(optimisticImages.length
        ? {
            imageUrls: optimisticImages,
            imageUrl: optimisticImages[0].url,
            imageFilename: optimisticImages[0].filename || filename,
          }
        : {}),
    };
    dispatchedOrphanUserIds.add(userMsg.id);

    const next: CampaignChatDraft = {
      ...draft,
      status: draft.status === "empty" ? "drafting" : draft.status,
      dirty: draft.status === "draft_saved" ? false : true,
      updatedAt: new Date().toISOString(),
      messages: [...draft.messages, userMsg],
    };
    const generationInFlight =
      templateProgress?.status === "started" ||
      templateProgress?.status === "generating";
    const pin = generationInFlight
      ? draft.pendingGeneratePin
      : rememberGenerateUserPin(draftId, next.messages);
    const saved = autoSaveDraftIfNeeded({
      ...next,
      pendingGeneratePin: pin ?? draft.pendingGeneratePin,
    });
    persist(saved);
    stickToBottomRef.current = true;
    markCreateCampaignAwaiting(draftId);
    setInput("");
    setPendingImages([]);
    pendingUploadsRef.current = new Map();
    if (templateProgress?.status === "failed") {
      setTemplateProgress(null);
      templateProgressRef.current = null;
      persistInFlightProgress(draftId, null);
    }
    setSending(true);
    setTyping(true);
    setThinkingLabel(pending.length ? "Uploading image…" : "Sending…");
    setSocketError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);

    void (async () => {
      const uploads: Array<{
        image_url: string;
        media_id?: string;
        filename?: string;
        source?: string;
      }> = [];
      try {
        for (const item of pending) {
          const resolved = await resolvePendingChatImageUpload({
            imageUrl: item.imageUrl,
            mediaId: item.mediaId,
            previewUrl: item.previewUrl,
            filename: item.filename || "image",
            uploadPromise: uploadMap.get(item.previewUrl),
          });
          uploads.push({
            image_url: resolved.url,
            media_id: resolved.media_id || undefined,
            filename: item.filename || "image",
            source: "chat_upload",
          });
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Image upload failed");
        clearCreateCampaignAwaiting(draftId);
        setSending(false);
        setTyping(false);
        setThinkingLabel(null);
        for (const blob of previewBlobs) URL.revokeObjectURL(blob);
        return;
      }

      const resolvedImages = chatImagesFromUploads(uploads);
      const firstUrl = resolvedImages[0]?.url || "";
      if (resolvedImages.length && firstUrl) {
        const cur = draftRef.current;
        if (cur) {
          const patched: CampaignChatDraft = {
            ...cur,
            messages: cur.messages.map((m) =>
              m.id === userMsg.id
                ? {
                    ...m,
                    imageUrls: resolvedImages,
                    imageUrl: firstUrl,
                    imageFilename:
                      resolvedImages[0]?.filename || filename,
                  }
                : m,
            ),
            updatedAt: new Date().toISOString(),
          };
          persist(patched);
        }
      }
      for (const blob of previewBlobs) URL.revokeObjectURL(blob);

      if (!text && !uploads.length) {
        clearCreateCampaignAwaiting(draftId);
        setSending(false);
        setTyping(false);
        setThinkingLabel(null);
        return;
      }

      setThinkingLabel("Sending…");
      socket.emit("user_message", {
        session_id: draftId,
        token,
        text,
        ...(uploads.length ? { chat_image_uploads: uploads } : {}),
        ...createCampaignSocketPayload({}, draftId),
      });
    })();
  };
  handleSendRef.current = handleSend;

  const stopGeneration = () => {
    const socket = getAgentsSocket();
    socket.emit("stop_generation", {
      session_id: draftId,
      chat_context: "create",
    });
    clearCreateCampaignAwaiting(draftId);
    setTyping(false);
    setSending(false);
    setThinkingLabel(null);
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
      showToast("Mic ready — voice capture coming next");
    } catch {
      showToast("Microphone permission needed");
    }
    inputRef.current?.focus();
  };

  const onFilesSelected = (files: FileList | null, kind: "image" | "file") => {
    if (!files?.length) return;
    const file = files[0];
    const names = Array.from(files)
      .map((f) => f.name)
      .join(", ");

    if (kind === "file") {
      const lower = file.name.toLowerCase();
      const isCsv =
        lower.endsWith(".csv") ||
        file.type === "text/csv" ||
        file.type === "application/vnd.ms-excel";
      if (!isCsv) {
        showToast(
          "For temporary campaign contacts, upload a CSV (.csv). XLSX support comes next.",
        );
        return;
      }
      if (sending || typing) {
        showToast("Wait for the current reply, then upload the sheet.");
        return;
      }
      const token = getToken();
      if (!token || !draft) {
        setSocketError("Sign in required.");
        return;
      }
      void file.text().then((text) => {
        const rows = parseContactsCsv(text);
        if (!rows.length) {
          showToast(
            "No contact rows found. Use headers like firstName, email, phone.",
          );
          return;
        }
        if (rows.length > 2000) {
          showToast("Temporary upload is limited to 2000 rows.");
          return;
        }
        const socket = getAgentsSocket();
        if (!socket.connected) {
          socket.connect();
          setSocketError("Co-worker reconnecting — try upload again.");
          return;
        }
        const msgText = `Uploaded temporary contact sheet “${file.name}” (${rows.length} rows) for this campaign only.`;
        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text: msgText,
          createdAt: new Date().toISOString(),
        };
        dispatchedOrphanUserIds.add(userMsg.id);
        const next: CampaignChatDraft = {
          ...draft,
          status: draft.status === "empty" ? "drafting" : draft.status,
          dirty: draft.status === "draft_saved" ? false : true,
          updatedAt: new Date().toISOString(),
          messages: [...draft.messages, userMsg],
        };
        persist(autoSaveDraftIfNeeded(next));
        markCreateCampaignAwaiting(draftId);
        setSending(true);
        setTyping(true);
        setSocketError(null);
        socket.emit("user_message", {
          session_id: draftId,
          token,
          text: msgText,
          temporary_contact_rows: rows,
          ...createCampaignSocketPayload({}, draftId),
        });
        showToast(`Uploading ${rows.length} temporary contacts…`);
        inputRef.current?.focus();
      });
      return;
    }

    // Image attach → stay in composer until Enter (ChatGPT-style; multiple files OK).
    if (kind === "image") {
      if (sending || typing) {
        showToast("Wait for the current reply, then upload the image.");
        return;
      }
      const imageFiles = Array.from(files);
      for (const imageFile of imageFiles) {
        const previewUrl = URL.createObjectURL(imageFile);
        setPendingImages((cur) => [
          ...cur,
          { previewUrl, filename: imageFile.name },
        ]);
        const uploadPromise = uploadTemplateImageAsset(imageFile);
        pendingUploadsRef.current.set(previewUrl, uploadPromise);
        void uploadPromise
          .then((uploaded) => {
            setPendingImages((cur) =>
              cur.map((row) =>
                row.previewUrl === previewUrl
                  ? {
                      ...row,
                      imageUrl: uploaded.url,
                      mediaId: uploaded.media_id,
                    }
                  : row,
              ),
            );
          })
          .catch(() => {
            /* resolvePendingChatImageUpload retries from blob on send */
          });
      }
      inputRef.current?.focus();
      return;
    }

    showToast(`File selected: ${names}`);
    inputRef.current?.focus();
  };

  const openTemplateView = (card: TemplateCard) => {
    void (async () => {
      const token = getToken();
      const socket = getAgentsSocket();
      const existing = draftRef.current ?? getCampaignDraft(draftId);
      // Prefer the latest draft/timeline fields over a stale card prop.
      let latest =
        flattenTimelineCards(existing?.timelineTemplates).find(
          (c) => c.template_id === card.template_id,
        ) || card;
      let sessionRows: TemplateCard[] = [];
      try {
        sessionRows = await fetchSessionChannelTemplates(draftId);
      } catch {
        sessionRows = [];
      }
      latest = resolveEditorTemplateCard(
        latest,
        sessionRows,
        existing?.usedLibraryTemplateIds,
      );
      if (existing && sessionRows.length) {
        const reconciled = reconcileLibraryTimelineIds(existing, sessionRows);
        if (reconciled !== existing) {
          upsertCampaignDraft(reconciled);
          draftRef.current = reconciled;
          setDraft(reconciled);
        }
      }
      ensureCreateCampaignBridge(draftId);
      socket.emit("open_template_editor", {
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
            fields: latest.fields,
          },
          templates: flattenTimelineCards(
            draftRef.current?.timelineTemplates ?? existing?.timelineTemplates,
          ).map((c) => ({
            template_id: c.template_id,
            channel: c.channel,
            generation_batch_id: c.generation_batch_id,
          })),
          campaign: {
            name: agentState?.campaign?.name || draft?.name || "",
            goal: agentState?.campaign?.goal || draft?.goal || "",
            objective: agentState?.campaign?.objective || "",
          },
          listHref: `/campaigns/create/${draftId}`,
        },
      });
    })();
  };

  if (!draft) {
    return <CreateCampaignChatSkeleton />;
  }

  const chatPhase = deriveCreateCampaignChatPhase({
    typing,
    sending,
    templateProgress,
    templatesPulling,
  });
  const bridgeSnap = getCreateCampaignBridgeSnapshot(draftId);
  const showTyping =
    bridgeSnap.awaitingAgentReply ||
    bridgeSnap.serverAgentBusy ||
    bridgeSnap.typing ||
    typing ||
    sending;
  const busy =
    composerBusy(chatPhase, templateProgress) ||
    bridgeSnap.awaitingAgentReply ||
    bridgeSnap.serverAgentBusy ||
    showTyping;
  const moments = normalizeChatTimeline(
    draft.timelineTemplates,
    draft.messages,
  );

  const toolbar =
    toast || socketError ? (
      <>
        {toast ? (
          <p
            className="rounded-xl border border-border-default bg-violet-0 px-4 py-2 text-sm text-violet-700"
            role="status"
          >
            {toast}
          </p>
        ) : null}
        {socketError ? (
          <p
            className={`rounded-xl border border-border-default bg-red-50 px-4 py-2 text-sm text-red-700 ${
              toast ? "mt-2" : ""
            }`}
          >
            {socketError}
          </p>
        ) : null}
      </>
    ) : undefined;

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
          {!agentsTransportConnected ? (
            <AgentThinkingIndicator label="Connecting to co-worker…" />
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
                    <TemplateGenerationProgress
                      progress={templateProgress}
                      pulling={templatesPulling}
                    />
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
                <TemplateGenerationProgress
                  progress={templateProgress}
                  pulling={templatesPulling}
                />
              ) : null}

          {showTyping ? (
            <AgentThinkingIndicator label={thinkingLabel} />
          ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );

  const chatFooter = (
      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={() => handleSend()}
        busy={busy}
        onStop={stopGeneration}
        inputRef={inputRef}
        placeholder="Ask your question"
        className="w-full"
        maxWidthClass=""
        pendingImages={pendingImages}
        onRemovePendingImage={(index) => {
          const row = pendingImages[index];
          if (row?.previewUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(row.previewUrl);
          }
          if (row?.previewUrl) {
            pendingUploadsRef.current.delete(row.previewUrl);
          }
          setPendingImages((cur) => cur.filter((_, i) => i !== index));
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
                  Upload contact CSV
                </button>
              </div>
            ) : null}
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "image");
                e.target.value = "";
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
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
  );

  const selectedChannelIds = [
    ...new Set(
      [
        ...(draft.channels || []),
        ...(agentState?.channels || []),
      ]
        .map((c) => agentChannelToUiId(String(c)))
        .filter(Boolean) as string[],
    ),
  ];
  const selectedChannelLabels = selectedChannelIds.map((id) => {
    const meta = CAMPAIGN_CHANNELS.find((c) => c.id === id);
    return meta?.label || id;
  });

  const timelineTemplateCounts = templateCountsByChannelFromTimeline(
    draft.timelineTemplates,
  );
  const templatesLabel = formatChannelTemplateSummary(
    timelineTemplateCounts,
    selectedChannelIds,
  );
  const launchPlan = agentState?.launch_plan;
  const launchChannelIds = (
    (launchPlan?.launch_channels as string[] | undefined) || selectedChannelIds
  )
    .map((c) => agentChannelToUiId(String(c)))
    .filter(Boolean);

  const guidedSnap = snapshotFromCampaignState({
    agentState,
    draftName: (() => {
      const fromAgent = String(agentState?.campaign?.name || "").trim();
      if (fromAgent && !isPlaceholderDraftName(fromAgent)) return fromAgent;
      const fromDraft = String(draft.name || "").trim();
      if (fromDraft && !isPlaceholderDraftName(fromDraft)) return fromDraft;
      return "";
    })(),
    draftGoal: draft.goal,
    draftObjective: draft.objective,
    templateCount: totalTimelineTemplateCount(draft.timelineTemplates),
    templatesLabel: templatesLabel || undefined,
    sendTimeLabelOverride: formatLaunchPlanByChannel({
      launchConfirmed: Boolean(agentState?.launch_confirmed),
      scheduleMode: String(launchPlan?.schedule_mode || ""),
      launchChannels: launchChannelIds,
      launchLocalDate: String(launchPlan?.launch_local_date || ""),
      launchLocalTime: String(launchPlan?.launch_local_time || ""),
      timezone: String(launchPlan?.timezone || ""),
    }),
    selectedChannelLabels,
  });

  const lastAssistant = [...(draft.messages || [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.text.trim());
  const nextQuestion =
    lastAssistant &&
    !isModuleWelcomeText("create_campaign", lastAssistant.text) &&
    lastAssistant.text.includes("?") &&
    !/appropriate tool|restore any previously|via tools|update_campaign_meta/i.test(
      lastAssistant.text,
    )
      ? lastAssistant.text
      : null;
  const nextKeyOverride = nextQuestion
    ? inferNextKeyFromAssistantQuestion(nextQuestion)
    : null;

  const overviewPane = (
    <CampaignGuidedPreview
      snap={guidedSnap}
      nextQuestion={nextQuestion}
      nextKeyOverride={nextKeyOverride}
      channelReadyById={channelReadyById}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ModuleSplitWorkspace
        toolbar={toolbar}
        leftTitle={displayDraftName(draft, agentState)}
        rightTitle="Campaign overview"
        left={chatPane}
        leftFooter={chatFooter}
        right={overviewPane}
        onRestart={restartChat}
      />
    </div>
  );
}
