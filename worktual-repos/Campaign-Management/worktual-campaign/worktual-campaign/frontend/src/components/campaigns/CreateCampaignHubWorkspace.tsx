import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  FileStack,
  FileText,
  Lightbulb,
  Loader2,
  ListFilter,
  MessageCircle,
  MessageSquarePlus,
  Pin,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CreateCampaignTemplateLibraryPage } from "@/components/campaigns/CreateCampaignTemplateLibraryPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { CampaignDraftDeleteControl } from "@/components/campaigns/CampaignDraftDeleteControl";
import { Skeleton } from "@/components/skeleton";
import { looksLikeChatHtml } from "@/lib/chat-html";
import {
  campaignCannotDeleteMessage,
  deleteCampaignDraftAsync,
  displayDraftName,
  formatDraftListTime,
  getCampaignDraft,
  isCampaignDeleteLocked,
  CAMPAIGN_DRAFT_PAGE_SIZE,
  listCampaignDrafts,
  listCampaignDraftsPageAsync,
  sortCampaignDraftsForList,
  statusLabel,
  upsertCampaignDraft,
  type CampaignChatDraft,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import {
  clearHubMessages,
  clearHubSessionId,
  createFreshHubSessionId,
  getOrCreateHubSessionId,
  readHubMessages,
  resetHubSessionForUser,
  writeHubMessages,
} from "@/lib/create-campaign-hub-session";
import {
  isCampaignSessionAccessDenied,
  markCreateDraftActive,
  markCreateHubActive,
} from "@/lib/create-campaign-active-session";
import { applyAgentNavigate, writeChatHandoff } from "@/lib/chat-handoff";
import { pinAgentSession } from "@/services/agent-sessions.service";
import type { DraftListBucket } from "@/services/agent-sessions.service";
import { listRecommendations } from "@/lib/campaign-recommendations-store";
import { listCampaignTemplates, loadCampaignTemplates } from "@/lib/campaign-templates";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import { buildSelectedGalleryImagesPayload } from "@/lib/selected-gallery-images";
import { listSelectedTemplates } from "@/lib/selected-campaign-templates";
import {
  chatPathForDraft,
  CREATE_CAMPAIGN_DRAFTS_HREF,
  CREATE_CAMPAIGN_WHATSAPP_HREF,
  draftOpenPath,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  getCampaignProfile,
  subscribeActivePack,
} from "@/lib/industry-packs";
import { getToken } from "@/services/api";
import {
  canJoinCreateCampaignSocketSession,
  claimCreateCampaignSocketSession,
  releaseCreateCampaignSocketSession,
  withClientTimezone,
} from "@/lib/agents-join";
import { deferAgentsConnectError, getAgentsSocket } from "@/services/agents.socket";
import {
  appendAssistantDeduped,
  isHydrationSessionReady,
  shouldPreserveLocalTranscriptOnReady,
} from "@/lib/agents-chat-runtime";
import { cn } from "@/utils/cn";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";

type HubTool = "hub" | "templates" | "drafts";

function localDraftListSeed(
  bucket: DraftListBucket,
  page: number,
): { drafts: CampaignChatDraft[]; total: number } | null {
  if (bucket !== "all" || page !== 0) return null;
  const all = sortCampaignDraftsForList(listCampaignDrafts());
  if (!all.length) return null;
  return {
    drafts: all.slice(0, CAMPAIGN_DRAFT_PAGE_SIZE),
    total: all.length,
  };
}

function toolFromSearch(params: URLSearchParams): HubTool {
  const tool = params.get("tool");
  if (tool === "templates" || tool === "drafts") return tool;
  return "hub";
}

type LocalChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

function draftSnippet(draft: CampaignChatDraft): string {
  const user = [...draft.messages]
    .reverse()
    .find((m) => m.role === "user" && m.text.trim());
  if (user?.text) return user.text;
  const last = draft.messages[draft.messages.length - 1];
  return last?.text?.trim() || "No messages yet";
}

function buildHubAgentContext(options: {
  drafts: CampaignChatDraft[];
}) {
  const recs = listRecommendations()
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
      why_created: r.whyCreated,
      intended_use: r.intendedUse,
      confidence: r.confidence,
      timing_label: r.timingLabel,
    }));

  const templates = listCampaignTemplates()
    .slice(0, 40)
    .map((t) => ({
      id: t.id,
      name: t.name,
      channel: t.primaryChannel,
      approval_status: t.approvalStatus,
      used_count: t.usedCount,
    }));

  const selected = listSelectedTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    channel: t.primaryChannel,
  }));

  const drafts = options.drafts.slice(0, 20).map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    updated_at: d.updatedAt,
  }));

  return {
    hub_mode: true,
    recommendations_snapshot: recs,
    templates_snapshot: templates,
    selected_library_templates: selected,
    selected_gallery_images: buildSelectedGalleryImagesPayload(),
    drafts_snapshot: drafts,
    campaign_profile: getCampaignProfile(),
  };
}

/**
 * Create campaign home — live hub agent + shortcuts.
 * Agent confirms + routes via ui_event; chips open tools immediately.
 */
export function CreateCampaignHubWorkspace({
  chatBasePath = "/campaigns/create",
}: {
  chatBasePath?: string;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tool = toolFromSearch(searchParams);
  const setTool = useCallback(
    (next: HubTool) => {
      if (next === "hub") setSearchParams({}, { replace: true });
      else setSearchParams({ tool: next }, { replace: true });
    },
    [setSearchParams],
  );

  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );

  const hubSessionIdRef = useRef(getOrCreateHubSessionId());
  /** Set when routing into a draft so late hub socket events cannot refill chat. */
  const handedOffRef = useRef(false);
  /** Detach hub `connect` → join immediately on draft nav (do not wait for unmount). */
  const hubUnbindJoinRef = useRef<(() => void) | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>(() =>
    readHubMessages().map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      createdAt: m.createdAt || new Date().toISOString(),
    })),
  );
  const messagesRef = useRef<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const sessionReadyRef = useRef(false);
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  sendingRef.current = sending;
  typingRef.current = typing;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(inputRef, input);
  // Soft-nav (CRM embed): announce READY as soon as hub UI mounts.
  useEmbedPageReady(true);

  useEffect(() => {
    if (tool === "hub") markCreateHubActive();
  }, [tool]);

  const threadRef = useRef<HTMLDivElement>(null);

  const focusComposer = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    focusComposer();
  }, [focusComposer]);

  const [drafts, setDrafts] = useState<CampaignChatDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsFetching, setDraftsFetching] = useState(false);
  const [draftPage, setDraftPage] = useState(0);
  const [draftTotal, setDraftTotal] = useState(0);
  const [draftBucket, setDraftBucket] = useState<DraftListBucket>("all");
  const [draftFilterOpen, setDraftFilterOpen] = useState(false);
  const [draftPinError, setDraftPinError] = useState<string | null>(null);
  const draftFilterRef = useRef<HTMLDivElement>(null);
  const draftPageRef = useRef(0);
  const skipDraftPageEffectRef = useRef(false);
  const draftListCacheRef = useRef(
    new Map<string, { drafts: CampaignChatDraft[]; total: number }>(),
  );
  const draftLoadGenRef = useRef(0);
  draftPageRef.current = draftPage;

  /** Load one Drafts page; clamp to last valid page when offset is past the end. */
  const loadDraftPage = useCallback(async (page: number, opts?: { quiet?: boolean }) => {
    const targetPage = Math.max(0, page);
    const cacheKey = `${draftBucket}:${targetPage}`;
    const cached = draftListCacheRef.current.get(cacheKey);
    const localSeed = !cached ? localDraftListSeed(draftBucket, targetPage) : null;
    const hasVisible = Boolean(cached?.drafts.length || localSeed?.drafts.length);
    const quiet = opts?.quiet === true || hasVisible;

    if (cached) {
      setDrafts(cached.drafts);
      setDraftTotal(cached.total);
    } else if (localSeed) {
      setDrafts(localSeed.drafts);
      setDraftTotal(localSeed.total);
    }

    const gen = ++draftLoadGenRef.current;
    if (!quiet) setDraftsLoading(true);
    else setDraftsFetching(true);
    try {
      let target = targetPage;
      let result = await listCampaignDraftsPageAsync({
        limit: CAMPAIGN_DRAFT_PAGE_SIZE,
        offset: target * CAMPAIGN_DRAFT_PAGE_SIZE,
        bucket: draftBucket,
      });
      if (gen !== draftLoadGenRef.current) return;
      const lastPage = Math.max(
        0,
        Math.ceil(result.total / CAMPAIGN_DRAFT_PAGE_SIZE) - 1,
      );
      // Past end of list, or empty page while earlier pages still have drafts.
      if (
        result.total > 0 &&
        (target > lastPage || (result.drafts.length === 0 && target > 0))
      ) {
        target = lastPage;
        result = await listCampaignDraftsPageAsync({
          limit: CAMPAIGN_DRAFT_PAGE_SIZE,
          offset: target * CAMPAIGN_DRAFT_PAGE_SIZE,
          bucket: draftBucket,
        });
        if (gen !== draftLoadGenRef.current) return;
      }
      if (target !== draftPageRef.current) {
        setDraftPage(target);
      }
      const sorted = sortCampaignDraftsForList(result.drafts);
      draftListCacheRef.current.set(`${draftBucket}:${target}`, {
        drafts: sorted,
        total: result.total,
      });
      setDrafts(sorted);
      setDraftTotal(result.total);
    } catch {
      if (gen !== draftLoadGenRef.current) return;
      if (!hasVisible) {
        setDrafts([]);
        setDraftTotal(0);
      }
    } finally {
      if (gen !== draftLoadGenRef.current) return;
      if (!quiet) setDraftsLoading(false);
      setDraftsFetching(false);
    }
  }, [draftBucket]);

  const refreshDraftList = useCallback(() => {
    void loadDraftPage(draftPageRef.current, { quiet: true });
  }, [loadDraftPage]);

  useEffect(() => {
    if (tool !== "drafts") return;
    if (skipDraftPageEffectRef.current) {
      skipDraftPageEffectRef.current = false;
      return;
    }
    void loadDraftPage(draftPage);
  }, [tool, draftPage, loadDraftPage]);

  useEffect(() => {
    if (!draftFilterOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        draftFilterRef.current &&
        !draftFilterRef.current.contains(e.target as Node)
      ) {
        setDraftFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [draftFilterOpen]);

  useEffect(() => {
    void loadCampaignTemplates();
  }, [packId]);

  useEffect(() => {
    messagesRef.current = messages;
    writeHubMessages(
      messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
      })),
    );
  }, [messages]);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, sending, typing]);

  /** Stop hub join_session before the draft page mounts (shared socket). */
  const detachHubJoinForNav = useCallback(() => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    hubUnbindJoinRef.current?.();
    hubUnbindJoinRef.current = null;
    const oldSessionId = hubSessionIdRef.current;
    try {
      getAgentsSocket().emit("leave_session", { session_id: oldSessionId });
    } catch {
      /* best-effort */
    }
    releaseCreateCampaignSocketSession(oldSessionId);
  }, []);

  const openNewChat = useCallback(
    (seed?: Partial<CampaignChatDraft>) => {
      detachHubJoinForNav();
      const draft = startCreateCampaignChat({
        chatBasePath,
        seed,
      });
      markCreateDraftActive(draft.id);
      navigate(chatPathForDraft(draft.id, chatBasePath), {
        state: {
          listHref: CREATE_CAMPAIGN_DRAFTS_HREF,
          campaignName: draft.name,
        },
      });
    },
    [chatBasePath, detachHubJoinForNav, navigate],
  );

  /** Leave hub thread behind after routing into a draft chat. */
  const resetHubAfterHandoff = useCallback(() => {
    detachHubJoinForNav();
    clearHubMessages();
    clearHubSessionId();
    hubSessionIdRef.current = createFreshHubSessionId();
    setMessages([]);
    setTyping(false);
    setSending(false);
    setSocketError(null);
  }, [detachHubJoinForNav]);

  /**
   * Optimistic handoff: navigate to create draft immediately with a light UI
   * seed; full hub transcript goes via writeChatHandoff for the create agent.
   * Hub chat is cleared so returning to the main page starts fresh.
   */
  const openCreateWithHistory = useCallback(() => {
    const history: ChatMessage[] = messagesRef.current.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      createdAt: m.createdAt,
    }));
    const lastUser = [...history]
      .reverse()
      .find((m) => m.role === "user")
      ?.text.trim();

    writeChatHandoff({
      fromModule: "create_campaign",
      toModule: "create_campaign",
      messages: history.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
      })),
      query: lastUser || "",
    });

    resetHubAfterHandoff();

    const now = new Date().toISOString();
    openNewChat(
      lastUser
        ? {
            messages: [
              {
                id: crypto.randomUUID(),
                role: "assistant",
                text: "Continuing from the hub — working on your campaign request now.",
                createdAt: now,
              },
              {
                id: crypto.randomUUID(),
                role: "user",
                text: lastUser,
                createdAt: now,
              },
            ],
            status: "drafting",
            dirty: true,
            seedUserOnJoin: lastUser,
          }
        : undefined,
    );
  }, [openNewChat, resetHubAfterHandoff]);

  const openRecommendations = () => {
    navigate(`${chatBasePath}/recommendations`);
  };

  const openTemplateLibrary = () => {
    setTool("templates");
  };

  const openDraftsPanel = () => {
    setTool("drafts");
  };

  const openWhatsAppApprovals = () => {
    navigate(CREATE_CAMPAIGN_WHATSAPP_HREF);
  };

  const handleDeleteDraft = async (id: string) => {
    const row =
      drafts.find((d) => d.id === id) ?? getCampaignDraft(id) ?? null;
    if (row && isCampaignDeleteLocked(row.status)) {
      throw new Error(campaignCannotDeleteMessage(row.status));
    }
    await deleteCampaignDraftAsync(id);
    draftListCacheRef.current.clear();
    // Refetch same page so the next page fills the gap; clamp if this page is gone.
    await loadDraftPage(draftPageRef.current, { quiet: true });
  };

  const handlePinDraft = async (id: string, pinned: boolean) => {
    const previous = drafts.find((d) => d.id === id);
    const previousPinned = Boolean(previous?.pinned);
    setDraftPinError(null);
    // Optimistic fill + reorder on the current page while the API runs.
    setDrafts((prev) =>
      sortCampaignDraftsForList(
        prev.map((d) => (d.id === id ? { ...d, pinned } : d)),
      ),
    );
    try {
      await pinAgentSession(id, pinned);
      const cached = getCampaignDraft(id);
      if (cached) {
        upsertCampaignDraft({ ...cached, pinned });
      } else if (previous) {
        upsertCampaignDraft({ ...previous, pinned });
      }
      if (pinned) {
        // Server sorts pinned first across all drafts — land on page 1 top.
        if (draftPageRef.current !== 0) {
          skipDraftPageEffectRef.current = true;
          setDraftPage(0);
        }
        await loadDraftPage(0, { quiet: true });
      } else {
        // Unpin: restore date order (may leave this page).
        await loadDraftPage(draftPageRef.current, { quiet: true });
      }
    } catch {
      setDrafts((prev) =>
        sortCampaignDraftsForList(
          prev.map((d) =>
            d.id === id ? { ...d, pinned: previousPinned } : d,
          ),
        ),
      );
      setDraftPinError(
        pinned ? "Could not pin this draft." : "Could not unpin this draft.",
      );
    }
  };

  const applyHubNavigate = useCallback(
    (payload: Record<string, unknown>) => {
      const destination = String(payload.destination || "").trim();
      const path = String(payload.path || "").trim();
      const draftId = String(payload.draft_id || "").trim();

      if (destination === "create_space") {
        openCreateWithHistory();
        return;
      }
      if (destination === "open_draft" && draftId) {
        resetHubAfterHandoff();
        markCreateDraftActive(draftId);
        const row = getCampaignDraft(draftId);
        navigate(
          draftOpenPath(row || { id: draftId }, chatBasePath),
          {
            state: { listHref: CREATE_CAMPAIGN_DRAFTS_HREF },
          },
        );
        return;
      }
      if (destination === "templates" || path.includes("tool=templates")) {
        setTool("templates");
        return;
      }
      if (destination === "drafts" || path.includes("tool=drafts")) {
        setTool("drafts");
        return;
      }
      if (
        destination === "whatsapp_approvals" ||
        path.includes("/campaigns/create/whatsapp")
      ) {
        if (path.includes("/approved/") || path.includes("/rejected/")) {
          navigate(path);
          return;
        }
        navigate(CREATE_CAMPAIGN_WHATSAPP_HREF);
        return;
      }
      if (destination === "recommendations" || path.includes("/recommendations")) {
        navigate(`${chatBasePath}/recommendations`);
        return;
      }
      if (destination === "events" || path.startsWith("/events")) {
        navigate("/events");
        return;
      }
      if (destination === "reports" || path.startsWith("/reports")) {
        applyAgentNavigate(
          {
            session_id: hubSessionIdRef.current,
            type: "navigate",
            payload: { module: "reports", path: "/dashboard", ...payload },
          },
          {
            sessionId: hubSessionIdRef.current,
            module: "create_campaign",
            navigate,
            getMessages: () =>
              messagesRef.current.map((m) => ({
                role: m.role,
                text: m.text,
                id: m.id,
                createdAt: m.createdAt,
              })),
          },
        );
        return;
      }
      if (path) {
        applyAgentNavigate(
          {
            session_id: hubSessionIdRef.current,
            type: "navigate",
            payload: { ...payload, path },
          },
          {
            sessionId: hubSessionIdRef.current,
            module: "create_campaign",
            navigate,
            getMessages: () =>
              messagesRef.current.map((m) => ({
                role: m.role,
                text: m.text,
                id: m.id,
                createdAt: m.createdAt,
              })),
          },
        );
      }
    },
    [chatBasePath, navigate, openCreateWithHistory, resetHubAfterHandoff, setTool],
  );

  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // Live hub agent (ephemeral hub-* session — not a draft)
  useEffect(() => {
    if (tool !== "hub") return;
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required to chat.");
      return;
    }
    const sessionId = hubSessionIdRef.current;
    sessionReadyRef.current = false;
    const socket = getAgentsSocket();
    setSocketError(null);

    const onReady = (payload: {
      session_id?: string;
      ready_phase?: string;
      messages?: Array<{ id?: string; role?: string; text?: string }>;
    }) => {
      if (handedOffRef.current) return;
      if (payload.session_id && payload.session_id !== sessionId) return;
      const rows = (payload.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id || crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          text: String(m.text || ""),
          createdAt: new Date().toISOString(),
        }))
        .filter((m) => m.text.trim());
      const followUpReady = sessionReadyRef.current;
      sessionReadyRef.current = true;
      const hydration = isHydrationSessionReady(payload);
      if (rows.length) {
        setMessages((prev) => {
          if (
            shouldPreserveLocalTranscriptOnReady({
              prev,
              remote: rows,
              busy: sendingRef.current || typingRef.current,
              followUpReady,
              hydration,
            })
          ) {
            return prev;
          }
          return prev.length ? prev : rows;
        });
      }
      setTyping(false);
      setSending(false);
      focusComposer();
    };
    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
      message?: { text?: string };
    }) => {
      if (handedOffRef.current) return;
      if (payload.session_id && payload.session_id !== sessionId) return;
      const text = (payload.text || payload.message?.text || "").trim();
      setTyping(false);
      setSending(false);
      if (text) {
        setMessages((prev) => {
          const next = appendAssistantDeduped(prev, text);
          if (next.length === prev.length) return prev;
          const last = next[next.length - 1]!;
          return [
            ...next.slice(0, -1),
            { ...last, createdAt: new Date().toISOString() },
          ];
        });
      }
      focusComposer();
    };
    const onTyping = (payload: {
      session_id?: string;
      typing?: boolean;
    }) => {
      if (handedOffRef.current) return;
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) {
        setSending(false);
        focusComposer();
      }
    };
    const onUi = (payload: {
      session_id?: string;
      type?: string;
      payload?: Record<string, unknown>;
    }) => {
      if (handedOffRef.current) return;
      if (payload.session_id && payload.session_id !== sessionId) return;
      if (payload.type !== "navigate" || !payload.payload) return;
      applyHubNavigate(payload.payload);
    };
    const onError = (payload: { message?: string; session_id?: string }) => {
      if (
        payload.session_id &&
        payload.session_id !== hubSessionIdRef.current
      ) {
        return;
      }
      if (isCampaignSessionAccessDenied(payload.message)) {
        if (handedOffRef.current) return;
        const previousId = hubSessionIdRef.current;
        resetHubSessionForUser();
        hubSessionIdRef.current = createFreshHubSessionId();
        releaseCreateCampaignSocketSession(previousId);
        setMessages([]);
        setTyping(false);
        setSending(false);
        setSocketError(null);
        const token = getToken();
        const nextHubId = hubSessionIdRef.current;
        if (token && canJoinCreateCampaignSocketSession(nextHubId)) {
          claimCreateCampaignSocketSession(nextHubId);
          const ctx = buildHubAgentContext({
            drafts: draftsRef.current,
          });
          socket.emit(
            "join_session",
            withClientTimezone({
              session_id: nextHubId,
              token,
              module: "create_campaign",
              skip_welcome: true,
              hub_mode: true,
              ...ctx,
            }),
          );
        }
        return;
      }
      setSocketError(payload.message || "Agent error");
      setTyping(false);
      setSending(false);
      focusComposer();
    };
    let cancelConnectErrorReport: (() => void) | null = null;
    const onConnectError = (err: Error) => {
      setTyping(false);
      setSending(false);
      cancelConnectErrorReport?.();
      cancelConnectErrorReport = deferAgentsConnectError(socket, err, setSocketError);
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("ui_event", onUi);
    socket.on("agent_error", onError);
    socket.on("error", onError);
    socket.on("connect_error", onConnectError);

    const join = () => {
      if (handedOffRef.current) return;
      if (!canJoinCreateCampaignSocketSession(sessionId)) return;
      claimCreateCampaignSocketSession(sessionId);
      const ctx = buildHubAgentContext({
        drafts: draftsRef.current,
      });
      const carry = messagesRef.current
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          createdAt: m.createdAt,
        }));
      socket.emit(
        "join_session",
        withClientTimezone({
          session_id: sessionId,
          token,
          module: "create_campaign",
          skip_welcome: true,
          hub_mode: true,
          ...(carry.length ? { carry_messages: carry } : {}),
          ...ctx,
        }),
      );
    };
    socket.on("connect", join);
    hubUnbindJoinRef.current = () => {
      socket.off("connect", join);
    };
    if (socket.connected) join();

    return () => {
      hubUnbindJoinRef.current = null;
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("ui_event", onUi);
      socket.off("agent_error", onError);
      socket.off("error", onError);
      cancelConnectErrorReport?.();
      socket.off("connect_error", onConnectError);
      socket.off("connect", join);
      // Soft-nav: leave socket room but keep session id + transcript in sessionStorage.
      // After draft handoff we already left — a second leave can wipe the draft binding.
      if (handedOffRef.current) return;
      socket.emit("leave_session", { session_id: sessionId });
      releaseCreateCampaignSocketSession(sessionId);
    };
  }, [tool, applyHubNavigate, focusComposer]);

  const sendToAgent = (text: string) => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required to chat.");
      return;
    }
    setSending(true);
    setTyping(true);
    setSocketError(null);
    const ctx = buildHubAgentContext({
      drafts: draftsRef.current,
    });
    getAgentsSocket().emit("user_message", {
      session_id: hubSessionIdRef.current,
      token,
      module: "create_campaign",
      text,
      hub_mode: true,
      ...ctx,
    });
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || sending || typing) return;

    const userMsg: LocalChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    sendToAgent(text);
    focusComposer();
  };

  const busy = sending || typing;

  if (tool === "templates" || tool === "drafts") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f4f6] p-4 sm:p-5">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm">
          {tool === "drafts" ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 bg-white px-4 py-3">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-neutral-900">
                <span>
                  Drafts
                  {!draftsLoading || draftTotal > 0 ? ` (${draftTotal})` : ""}
                </span>
                {draftsFetching ? (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-neutral-400"
                    aria-hidden
                  />
                ) : null}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <div className="relative" ref={draftFilterRef}>
                  <button
                    type="button"
                    aria-label="Filter drafts"
                    aria-expanded={draftFilterOpen}
                    onClick={() => setDraftFilterOpen((v) => !v)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 hover:bg-neutral-50"
                  >
                    <ListFilter
                      className="size-3.5 text-neutral-500"
                      strokeWidth={1.75}
                    />
                    {
                      (
                        {
                          all: "All",
                          live: "Live",
                          scheduled: "Scheduled",
                          completed: "Completed",
                          in_progress: "In progress",
                        } as const
                      )[draftBucket]
                    }
                  </button>
                  {draftFilterOpen ? (
                    <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
                      {(
                        [
                          ["all", "All"],
                          ["live", "Live"],
                          ["scheduled", "Scheduled"],
                          ["completed", "Completed"],
                          ["in_progress", "In progress"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`flex w-full px-3 py-2 text-left text-xs hover:bg-neutral-50 ${
                            draftBucket === value
                              ? "bg-neutral-50 font-medium text-neutral-900"
                              : "text-neutral-700"
                          }`}
                          onClick={() => {
                            setDraftBucket(value);
                            setDraftPage(0);
                            setDraftFilterOpen(false);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setTool("hub")}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}
          {tool === "drafts" && draftPinError ? (
            <p className="shrink-0 border-b border-neutral-100 bg-white px-4 py-2 text-xs text-red-600">
              {draftPinError}
            </p>
          ) : null}
          <div
            className={
              tool === "drafts"
                ? "drafts-scroll min-h-0 flex-1 overflow-y-auto"
                : "min-h-0 flex-1 overflow-y-auto"
            }
          >
            {tool === "drafts" ? (
              <DraftsPanel
                loading={draftsLoading}
                refreshing={draftsFetching && drafts.length > 0}
                drafts={drafts}
                page={draftPage}
                total={draftTotal}
                pageSize={CAMPAIGN_DRAFT_PAGE_SIZE}
                bucket={draftBucket}
                onPageChange={setDraftPage}
                onOpen={(id) => {
                  const draft = drafts.find((d) => d.id === id);
                  detachHubJoinForNav();
                  markCreateDraftActive(id);
                  navigate(
                    draftOpenPath(draft || { id }, chatBasePath),
                    {
                      state: {
                        listHref: CREATE_CAMPAIGN_DRAFTS_HREF,
                        campaignName: draft?.name,
                      },
                    },
                  );
                }}
                onDelete={handleDeleteDraft}
                onPin={handlePinDraft}
              />
            ) : (
              <ErrorBoundary label="Template library">
                <CreateCampaignTemplateLibraryPage
                  embedded
                  onSelectionChange={refreshDraftList}
                />
              </ErrorBoundary>
            )}
          </div>
        </div>
      </div>
    );
  }

  const chips: Array<{ label: string; icon: LucideIcon; onClick: () => void }> =
    [
      {
        label: "Recommendations",
        icon: Lightbulb,
        onClick: openRecommendations,
      },
      {
        label: "Templates",
        icon: FileStack,
        onClick: openTemplateLibrary,
      },
      {
        label: "WhatsApp approvals",
        icon: MessageCircle,
        onClick: openWhatsAppApprovals,
      },
      {
        label: "Drafts",
        icon: FileText,
        onClick: openDraftsPanel,
      },
    ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f4f6]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-5">
        {/* Centered hero + composer */}
        <section className="chat-scroll-xs relative flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-1 py-4 sm:py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-[30px] sm:leading-tight">
              Your AI Campaign Co-worker
            </h1>

            {socketError ? (
              <p className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left text-xs text-red-700">
                {socketError}
              </p>
            ) : null}

            {messages.length > 0 || busy ? (
              <div
                ref={threadRef}
                className="chat-scroll-xs mt-5 w-full max-h-[min(60vh,28rem)] space-y-2.5 overflow-y-auto rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-left shadow-sm"
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "text-sm leading-relaxed",
                      m.role === "user"
                        ? "text-right text-neutral-800"
                        : "text-left text-neutral-600",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block max-w-[92%] rounded-2xl px-3 py-2 text-left",
                        m.role === "user"
                          ? "bg-neutral-900 text-white whitespace-pre-wrap"
                          : looksLikeChatHtml(m.text)
                            ? "bg-neutral-100 text-neutral-700 whitespace-normal"
                            : "bg-neutral-100 text-neutral-700 whitespace-pre-wrap",
                      )}
                    >
                      <ChatBubbleText text={m.text} role={m.role} />
                    </span>
                  </div>
                ))}
                {busy ? (
                  <AgentThinkingIndicator />
                ) : null}
              </div>
            ) : null}

            <form
              className="mt-5 w-full"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <div className="rounded-2xl bg-white px-4 pt-4 pb-3 shadow-xl transition focus-within:ring-2 focus-within:ring-neutral-200/80">
                <div className="flex items-start gap-3">
                  <Search
                    className="mt-0.5 size-[18px] shrink-0 text-neutral-400"
                    strokeWidth={1.75}
                  />
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!busy) send(input);
                      }
                    }}
                    disabled={busy}
                    autoFocus
                    placeholder="Ask about recommendations, templates — or start a campaign…"
                    className="min-h-[52px] w-full resize-none overflow-hidden bg-transparent text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-neutral-100 pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openCreateWithHistory()}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
                  >
                    <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
                    Create campaign
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                    aria-label="Send"
                  >
                    <ArrowRight className="size-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </form>

            <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
              {chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={busy}
                  onClick={c.onClick}
                  className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-60"
                >
                  <c.icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function DraftsPanel({
  loading,
  refreshing,
  drafts,
  page,
  total,
  pageSize,
  bucket,
  onPageChange,
  onOpen,
  onDelete,
  onPin,
}: {
  loading?: boolean;
  /** Background fetch while prior rows stay visible. */
  refreshing?: boolean;
  drafts: CampaignChatDraft[];
  page: number;
  total: number;
  pageSize: number;
  bucket: DraftListBucket;
  onPageChange: (page: number) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd =
    total === 0 || drafts.length === 0
      ? 0
      : Math.min(rangeStart + drafts.length - 1, total);
  if (loading && drafts.length === 0) {
    return (
      <ul
        className="divide-y divide-neutral-100 px-4 py-2"
        aria-busy="true"
        aria-label="Loading drafts"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <Skeleton width={8} height={8} borderRadius={99} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton width="42%" height={12} borderRadius={6} />
              <Skeleton width="70%" height={10} borderRadius={6} />
            </div>
            <Skeleton width={40} height={10} borderRadius={6} />
          </li>
        ))}
      </ul>
    );
  }

  const pager =
    totalPages > 1 ? (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3">
        <span className="text-xs text-neutral-500">
          {total === 0
            ? "0 drafts"
            : drafts.length === 0
              ? `0 of ${total}`
              : `${rangeStart}–${rangeEnd} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 0 || (loading && drafts.length === 0)}
            onClick={() => onPageChange(Math.max(0, page - 1))}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-neutral-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1 || (loading && drafts.length === 0)}
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    ) : null;

  if (drafts.length === 0) {
    return (
      <>
        <p className="px-4 py-10 text-center text-sm text-neutral-500">
          {total > 0
            ? "No drafts on this page."
            : bucket === "all"
              ? "No drafts yet. Use Create campaign to start one."
              : "No drafts in this filter."}
        </p>
        {pager}
      </>
    );
  }

  return (
    <>
      <ul
        className={`divide-y divide-neutral-100 transition-opacity ${
          refreshing ? "opacity-70" : ""
        }`}
        aria-busy={refreshing ? true : undefined}
      >
        {drafts.map((draft) => (
          <li key={draft.id} className="flex items-stretch gap-1 px-2 py-1 sm:px-3">
            <button
              type="button"
              onClick={() => onOpen(draft.id)}
              className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-neutral-50"
            >
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-neutral-900" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {displayDraftName(draft)}
                  </p>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    {statusLabel(draft.status)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                  {draftSnippet(draft)}
                </p>
              </div>
              <span className="shrink-0 text-xs text-neutral-400">
                {formatDraftListTime(draft)}
              </span>
            </button>
            <div
              className="mr-1 flex shrink-0 items-center gap-0.5 self-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label={draft.pinned ? "Unpin draft" : "Pin draft"}
                title={draft.pinned ? "Unpin" : "Pin"}
                onClick={() => void onPin(draft.id, !draft.pinned)}
                className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
              >
                <Pin
                  className={`size-3.5 ${
                    draft.pinned
                      ? "fill-neutral-500 text-neutral-500"
                      : "fill-none text-neutral-400"
                  }`}
                  strokeWidth={1.75}
                />
              </button>
              <CampaignDraftDeleteControl
                name={draft.name}
                status={draft.status}
                onConfirm={async () => {
                  try {
                    await onDelete(draft.id);
                    return { ok: true };
                  } catch (err) {
                    const msg =
                      err instanceof Error ? err.message : "";
                    return {
                      ok: false,
                      error:
                        msg && isCampaignDeleteLocked(draft.status)
                          ? msg
                          : "Could not delete this draft. Try again.",
                    };
                  }
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {pager}
    </>
  );
}
