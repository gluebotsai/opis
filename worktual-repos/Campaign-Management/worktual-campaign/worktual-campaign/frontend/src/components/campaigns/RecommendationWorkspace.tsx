import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { Button } from "@/components/ui/Button";
import { RecommendationRunWorkspace } from "@/components/campaigns/RecommendationRunWorkspace";
import { RecommendationWorkspaceSkeleton } from "@/components/campaigns/RecommendationWorkspaceSkeleton";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  getCampaignProfile,
  subscribeActivePack,
} from "@/lib/industry-packs";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Calendar,
  ChevronDown,
  Gift,
  Grid2X2,
  LayoutList,
  ListFilter,
  Loader2,
  Mail,
  Megaphone,
  MessageCircle,
  Search,
  ShoppingBag,
  Smartphone,
  Sparkles,
  TabletSmartphone,
  Trash2,
} from "lucide-react";
import {
  appendRecommendationEditLog,
  ensureRecommendationCardSeeds,
  deleteRecommendation,
  dismissRecommendation,
  getRecommendation,
  hydrateRecommendationsFromServer,
  listExpiryCandidates,
  listRecommendations,
  saveRecommendationCardChat,
  syncFromAgentCards,
  type CampaignRecommendation,
} from "@/lib/campaign-recommendations-store";
import {
  ensureRecommendationChatSeeds,
  loadRecommendationChat,
  mergeRecommendationChats,
  RECOMMENDATIONS_MAIN_SESSION,
  saveRecommendationChat,
  type RecommendationChatMessage,
} from "@/lib/recommendation-chats-store";
import { syncNotificationsFromRecommendations } from "@/lib/notifications-store";
import { isChannelParked } from "@/lib/campaign-channels";
import { currentAuthUserId } from "@/lib/jwt-user";
import { emitJoinSessionNow } from "@/lib/agents-join";
import {
  appendAssistantDeduped,
  isAgentBusyError,
  isHydrationSessionReady,
  shouldPreserveLocalTranscriptOnReady,
} from "@/lib/agents-chat-runtime";
import { getToken } from "@/services/api";
import { deferAgentsConnectError, getAgentsSocket } from "@/services/agents.socket";

type ChatMessage = RecommendationChatMessage;

type ViewMode = "grid" | "list";
type SortMode = "relevance" | "soonest" | "newest";
type WorkspaceMode = "browse" | "main_chat" | "detail";

type CardTheme = {
  wrap: string;
  iconBg: string;
  previewBg: string;
};

const CARD_THEMES: CardTheme[] = [
  {
    wrap: "border-violet-100 bg-[#f4f0ff]",
    iconBg: "bg-violet-600 text-white",
    previewBg: "bg-white/85",
  },
  {
    wrap: "border-emerald-100 bg-[#eefbf4]",
    iconBg: "bg-emerald-600 text-white",
    previewBg: "bg-white/85",
  },
  {
    wrap: "border-amber-100 bg-[#fff8e8]",
    iconBg: "bg-amber-500 text-white",
    previewBg: "bg-white/85",
  },
  {
    wrap: "border-rose-100 bg-[#fff0f3]",
    iconBg: "bg-rose-500 text-white",
    previewBg: "bg-white/85",
  },
  {
    wrap: "border-sky-100 bg-[#eef6ff]",
    iconBg: "bg-sky-600 text-white",
    previewBg: "bg-white/85",
  },
  {
    wrap: "border-indigo-100 bg-[#eef0ff]",
    iconBg: "bg-indigo-600 text-white",
    previewBg: "bg-white/85",
  },
];

const THEME_BY_ID: Record<string, number> = {
  "seed-festive": 0,
  "seed-restock": 1,
  "seed-midweek": 2,
  "seed-webinar": 3,
  "seed-crosssell": 4,
  "seed-loyalty": 5,
  "seed-card-upgrade": 0,
  "seed-savings-offer": 5,
  "seed-festive-finance": 1,
  "seed-referral-invite": 2,
  "seed-fd-cross-sell": 3,
};

function themeForCard(id: string): CardTheme {
  const mapped = THEME_BY_ID[id];
  const i =
    mapped ??
    [...id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % CARD_THEMES.length;
  return CARD_THEMES[i];
}

function visibleChannels(channels: string[]): string[] {
  return channels.filter((ch) => !isChannelParked(ch));
}

function channelIcon(label: string): LucideIcon {
  const n = label.toLowerCase().replace(/[\s-]+/g, "_");
  if (n.includes("whatsapp")) return MessageCircle;
  if (n.includes("sms")) return Smartphone;
  if (n.includes("web")) return Bell;
  if (n.includes("app") || n.includes("push")) return TabletSmartphone;
  if (n.includes("ppc") || n.includes("ads")) return Megaphone;
  return Mail;
}

function cardHeroIcon(card: CampaignRecommendation): LucideIcon {
  const t = card.title.toLowerCase();
  if (t.includes("restock") || t.includes("alert")) return Bell;
  if (t.includes("loyalty") || t.includes("reward")) return Gift;
  if (t.includes("webinar") || t.includes("invite")) return Calendar;
  if (t.includes("cross")) return ShoppingBag;
  if (t.includes("emi") || t.includes("kyc")) return Bell;
  if (t.includes("saving")) return Gift;
  if (t.includes("festival") || t.includes("sale") || t.includes("blast")) {
    return Sparkles;
  }
  const first = visibleChannels(card.channels)[0];
  return first ? channelIcon(first) : Sparkles;
}

function daysUntilSort(card: CampaignRecommendation): number {
  const d = card.evidence?.daysUntil;
  if (typeof d === "number") return d;
  const m = String(card.timingLabel || "").match(/(\d+)\s*day/i);
  if (m) return Number(m[1]);
  if (/monday|next/i.test(card.timingLabel || "")) return 7;
  return 99;
}

function previewForChannel(
  card: CampaignRecommendation,
  channel: string,
): string {
  const hit = card.templates.find(
    (t) => t.channel.toLowerCase() === channel.toLowerCase(),
  );
  return hit?.preview || card.intendedUse;
}

const REC_BOOTSTRAP_TEXT =
  "Generate campaign recommendations from past performance, or from knowledge if there are no past campaigns.";

const REC_JOIN_TIMEOUT_MS = 12_000;
const REC_BOARD_TIMEOUT_MS = 22_000;

function recMainSessionId(): string {
  const uid = currentAuthUserId() || "anon";
  return `${RECOMMENDATIONS_MAIN_SESSION}-${uid}`;
}

function recBootstrapStorageKey(packId: string) {
  return `wc.rec.autoGenerate.v1:${packId}`;
}

function hasActiveRecommendationCards(): boolean {
  return listRecommendations().some(
    (c) => c.status === "active" || c.status === "creating",
  );
}

function recBootstrapRecentlyStarted(packId: string, windowMs = 120_000): boolean {
  try {
    const t = Number(sessionStorage.getItem(recBootstrapStorageKey(packId)) || 0);
    return Number.isFinite(t) && t > 0 && Date.now() - t < windowMs;
  } catch {
    return false;
  }
}

function markRecBootstrapStarted(packId: string) {
  try {
    sessionStorage.setItem(recBootstrapStorageKey(packId), String(Date.now()));
  } catch {
    /* private mode */
  }
}

function clearRecBootstrapMark(packId: string) {
  try {
    sessionStorage.removeItem(recBootstrapStorageKey(packId));
  } catch {
    /* ignore */
  }
}

function recViewFromLocation(
  pathname: string,
  search: string,
): { mode: WorkspaceMode; recId: string | null } {
  const rest = pathname
    .replace(/^\/campaigns\/create\/recommendations\/?/, "")
    .replace(/\/$/, "");
  const chat = new URLSearchParams(search).get("chat") === "1";
  if (rest) return { mode: "detail", recId: rest };
  if (chat) return { mode: "main_chat", recId: null };
  return { mode: "browse", recId: null };
}

function toLocalMessages(
  rows: Array<{
    id?: string;
    role?: string;
    text?: string;
    createdAt?: string;
    created_at?: string;
  }>,
): ChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role as "user" | "assistant",
      text: m.text || "",
      createdAt:
        m.createdAt || m.created_at || new Date().toISOString(),
    }));
}

/**
 * Recommendations space: Template Library–like browse (adaptive cards),
 * main manager chat, and per-card left-chat / right-fields detail.
 */
export function RecommendationWorkspace({
  listHref = "/campaigns/create",
}: {
  listHref?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );
  const initialView = recViewFromLocation(location.pathname, location.search);
  const [mode, setMode] = useState<WorkspaceMode>(initialView.mode);
  const [cards, setCards] = useState<CampaignRecommendation[]>(() =>
    listRecommendations().filter((c) => c.status !== "dismissed"),
  );
  const [activeId, setActiveId] = useState<string | null>(initialView.recId);
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortMode>("relevance");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const sessionReadyRef = useRef(false);
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  sendingRef.current = sending;
  typingRef.current = typing;
  const [sessionReady, setSessionReady] = useState(false);
  const [boardGenerating, setBoardGenerating] = useState(false);
  const [boardHydrated, setBoardHydrated] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [expiryPrompt, setExpiryPrompt] = useState<CampaignRecommendation[]>(
    [],
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const boundSessionRef = useRef<string | null>(null);
  const boundCardIdRef = useRef<string | null>(null);

  const active = activeId ? getRecommendation(activeId) : null;
  const activeSessionId =
    mode === "detail" && activeId
      ? `recommendations-card-${activeId}`
      : recMainSessionId();

  const persistChat = (sessionKey: string, cardId: string | null, rows: ChatMessage[]) => {
    if (!rows.length) return;
    saveRecommendationChat(sessionKey, rows);
    if (cardId) {
      saveRecommendationCardChat(cardId, rows);
    }
  };

  const flushBoundChat = () => {
    const key = boundSessionRef.current;
    const rows = messagesRef.current;
    if (key && rows.length > 0) {
      persistChat(key, boundCardIdRef.current, rows);
    }
  };

  const setMessagesBoth = (
    next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => {
    setMessages((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      messagesRef.current = resolved;
      if (boundSessionRef.current && resolved.length > 0) {
        persistChat(
          boundSessionRef.current,
          boundCardIdRef.current,
          resolved,
        );
      }
      return resolved;
    });
  };

  const refreshCards = () => {
    ensureRecommendationCardSeeds();
    setCards(
      listRecommendations().filter(
        (c) => c.status === "active" || c.status === "creating",
      ),
    );
    setExpiryPrompt(listExpiryCandidates());
    syncNotificationsFromRecommendations();
  };

  const loadChatForSession = (sessionKey: string, cardId: string | null) => {
    ensureRecommendationChatSeeds();
    const fromStore = loadRecommendationChat(sessionKey);
    if (cardId) {
      const card = getRecommendation(cardId);
      const fromCard = (card?.chatMessages || []) as ChatMessage[];
      if (fromCard.length >= fromStore.length) return fromCard;
      if (fromStore.length > 0) {
        saveRecommendationCardChat(cardId, fromStore);
        return fromStore;
      }
      return fromCard;
    }
    return fromStore;
  };

  useEffect(() => {
    let cancelled = false;
    setBoardHydrated(false);
    ensureRecommendationChatSeeds();
    ensureRecommendationCardSeeds();
    refreshCards();
    void (async () => {
      if (getToken()) {
        try {
          await hydrateRecommendationsFromServer();
        } catch {
          /* local cache */
        }
      }
      if (cancelled) return;
      refreshCards();
      setBoardHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [packId]);

  useEffect(() => {
    const onHide = () => flushBoundChat();
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      onHide();
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing, mode, activeId]);

  useEffect(() => {
    if (!boardHydrated) return;
    if (mode === "detail") {
      flushBoundChat();
      return;
    }
    // Browse also joins the main recommendations session so the board can fill
    // without opening Manager Chat.
    flushBoundChat();

    const cardId = mode === "detail" ? activeId : null;
    const stored = loadChatForSession(activeSessionId, cardId);
    boundSessionRef.current = activeSessionId;
    boundCardIdRef.current = cardId;
    messagesRef.current = stored;
    setMessages(stored);
    setSessionReady(true);

    const token = getToken();
    if (!token) {
      setBoardGenerating(false);
      setSocketError(
        "Sign in required to talk to the live agent (local history still shown).",
      );
      return;
    }
    sessionReadyRef.current = false;
    const socket = getAgentsSocket();
    setSocketError(null);
    const needsBootstrap =
      mode !== "detail" &&
      !hasActiveRecommendationCards() &&
      !recBootstrapRecentlyStarted(packId);
    if (needsBootstrap) {
      setBoardGenerating(true);
    }

    const sameSession = (payload: { session_id?: string }) =>
      !payload.session_id || payload.session_id === activeSessionId;

    const stopBoardWait = (err?: string | null) => {
      setBoardGenerating(false);
      setTyping(false);
      setSending(false);
      if (err) setSocketError(err);
    };

    const readyRef = { current: false };
    let joinTimeout: number | undefined = window.setTimeout(() => {
      if (readyRef.current) return;
      stopBoardWait(
        "Co-worker connection timed out. You can still browse recommendations.",
      );
      setSessionReady(true);
    }, REC_JOIN_TIMEOUT_MS);

    let boardTimeout: number | undefined;
    const armBoardTimeout = () => {
      if (boardTimeout) window.clearTimeout(boardTimeout);
      boardTimeout = window.setTimeout(() => {
        if (hasActiveRecommendationCards()) {
          setBoardGenerating(false);
          return;
        }
        clearRecBootstrapMark(packId);
        stopBoardWait(null);
      }, REC_BOARD_TIMEOUT_MS);
    };
    if (needsBootstrap) armBoardTimeout();

    const onReady = (payload: {
      session_id?: string;
      ready_phase?: string;
      state?: { recommendations?: Array<Record<string, unknown>> };
      messages?: Array<{
        id?: string;
        role?: string;
        text?: string;
        created_at?: string;
      }>;
    }) => {
      if (!sameSession(payload)) return;
      readyRef.current = true;
      if (joinTimeout) window.clearTimeout(joinTimeout);
      setSessionReady(true);
      const remote = toLocalMessages(payload.messages || []);
      const local = loadChatForSession(activeSessionId, cardId);
      const followUpReady = sessionReadyRef.current;
      sessionReadyRef.current = true;
      const hydration = isHydrationSessionReady(payload);
      const busy = sendingRef.current || typingRef.current;
      let merged: ChatMessage[];
      if (
        shouldPreserveLocalTranscriptOnReady({
          prev: local,
          remote,
          busy,
          followUpReady,
          hydration,
        })
      ) {
        merged = local;
      } else {
        // Prefer local history so agent welcome never drops the opening conversation.
        merged =
          local.length >= remote.length
            ? local.length > 0
              ? local
              : remote
            : remote.length === 1 && local.length > 0
              ? local
              : mergeRecommendationChats(local, remote);
      }
      messagesRef.current = merged;
      setMessages(merged);
      if (merged.length > 0) {
        persistChat(activeSessionId, cardId, merged);
      }
      if (payload.state?.recommendations) {
        const recs = payload.state.recommendations;
        if (Array.isArray(recs) && recs.length > 0) {
          syncFromAgentCards(recs, { replaceActive: true });
          refreshCards();
          setBoardGenerating(false);
          if (boardTimeout) window.clearTimeout(boardTimeout);
        }
      }
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
    }) => {
      if (!sameSession(payload)) return;
      const text = (payload.text || "").trim();
      if (!text) return;
      setMessagesBoth((prev) => {
        const next = appendAssistantDeduped(prev, text);
        if (next.length === prev.length) return prev;
        const last = next[next.length - 1]!;
        return [
          ...next.slice(0, -1),
          { ...last, createdAt: new Date().toISOString() },
        ];
      });
      setSending(false);
      setTyping(false);
      setBoardGenerating(false);
      if (boardTimeout) window.clearTimeout(boardTimeout);
    };

    const onState = (payload: {
      session_id?: string;
      state?: { recommendations?: Array<Record<string, unknown>> };
    }) => {
      if (!sameSession(payload)) return;
      if (!Array.isArray(payload.state?.recommendations)) return;
      if (payload.state!.recommendations!.length > 0) {
        syncFromAgentCards(payload.state!.recommendations!, { replaceActive: true });
        refreshCards();
      }
      setBoardGenerating(false);
      setTyping(false);
      setSending(false);
      if (boardTimeout) window.clearTimeout(boardTimeout);
    };

    const onUi = (payload: {
      session_id?: string;
      type?: string;
      payload?: Array<Record<string, unknown>>;
      replace_active?: boolean;
    }) => {
      if (!sameSession(payload)) return;
      if (payload.type === "recommendation_cards" && Array.isArray(payload.payload)) {
        if (payload.payload.length > 0) {
          syncFromAgentCards(payload.payload, {
            replaceActive: payload.replace_active !== false,
          });
          refreshCards();
        }
        setBoardGenerating(false);
        setTyping(false);
        setSending(false);
        if (boardTimeout) window.clearTimeout(boardTimeout);
      }
    };

    const onTyping = (payload: { session_id?: string; typing?: boolean }) => {
      if (!sameSession(payload)) return;
      setTyping(Boolean(payload.typing));
    };

    const onError = (payload: {
      message?: string;
      session_id?: string;
      code?: string;
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      if (isAgentBusyError(payload)) {
        setSocketError(
          "Still working on your last message — wait for the reply, then send again.",
        );
        return;
      }
      stopBoardWait(payload.message || "Recommendation agent error");
      clearRecBootstrapMark(packId);
      if (joinTimeout) window.clearTimeout(joinTimeout);
      if (boardTimeout) window.clearTimeout(boardTimeout);
    };

    let cancelConnectErrorReport: (() => void) | null = null;
    const onConnectError = (err: Error) => {
      setSessionReady(true);
      if (joinTimeout) window.clearTimeout(joinTimeout);
      if (boardTimeout) window.clearTimeout(boardTimeout);
      cancelConnectErrorReport?.();
      cancelConnectErrorReport = deferAgentsConnectError(socket, err, (msg) =>
        stopBoardWait(msg),
      );
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("state_update", onState);
    socket.on("ui_event", onUi);
    socket.on("agent_typing", onTyping);
    socket.on("error", onError);
    socket.on("agent_error", onError);
    socket.on("connect_error", onConnectError);

    const skipWelcome =
      stored.length > 0 ||
      (mode !== "detail" && !hasActiveRecommendationCards());
    const joinPayload = {
      session_id: activeSessionId,
      token,
      module: "recommendations" as const,
      skip_welcome: skipWelcome,
      campaign_profile: getCampaignProfile(),
      ...(needsBootstrap ? { seed_user_message: REC_BOOTSTRAP_TEXT } : {}),
    };
    if (needsBootstrap) markRecBootstrapStarted(packId);

    const retryTimers: number[] = [];
    const join = () => emitJoinSessionNow(socket, joinPayload);
    join();
    retryTimers.push(
      window.setTimeout(() => {
        if (!readyRef.current) join();
      }, 1500),
    );
    retryTimers.push(
      window.setTimeout(() => {
        if (!readyRef.current) join();
      }, 4000),
    );

    return () => {
      cancelConnectErrorReport?.();
      flushBoundChat();
      if (joinTimeout) window.clearTimeout(joinTimeout);
      if (boardTimeout) window.clearTimeout(boardTimeout);
      retryTimers.forEach((t) => window.clearTimeout(t));
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("state_update", onState);
      socket.off("ui_event", onUi);
      socket.off("agent_typing", onTyping);
      socket.off("error", onError);
      socket.off("agent_error", onError);
      socket.off("connect_error", onConnectError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind on mode/session/pack after DB hydrate
  }, [boardHydrated, mode, activeSessionId, packId, retryTick]);

  const openDetail = (id: string) => {
    flushBoundChat();
    appendRecommendationEditLog(id, "Opened to edit or run this recommendation");
    setActiveId(id);
    setMode("detail");
    navigate(`/campaigns/create/recommendations/${id}`);
  };

  const openMainChat = () => {
    flushBoundChat();
    setActiveId(null);
    setMode("main_chat");
    navigate("/campaigns/create/recommendations?chat=1");
  };

  const backToBrowse = () => {
    flushBoundChat();
    boundSessionRef.current = null;
    boundCardIdRef.current = null;
    setMode("browse");
    setActiveId(null);
    refreshCards();
    navigate("/campaigns/create/recommendations");
  };

  useEffect(() => {
    const v = recViewFromLocation(location.pathname, location.search);
    if (v.mode === "detail" && v.recId) {
      if (mode !== "detail" || activeId !== v.recId) {
        flushBoundChat();
        setActiveId(v.recId);
        setMode("detail");
      }
      return;
    }
    if (v.mode === "main_chat") {
      if (mode !== "main_chat") {
        flushBoundChat();
        setActiveId(null);
        setMode("main_chat");
      }
      return;
    }
    if (mode !== "browse") {
      flushBoundChat();
      boundSessionRef.current = null;
      boundCardIdRef.current = null;
      setMode("browse");
      setActiveId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL is source of truth
  }, [location.pathname, location.search]);

  const channelsInCards = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) {
      for (const ch of c.channels) {
        if (!isChannelParked(ch)) set.add(ch);
      }
    }
    return [...set].sort();
  }, [cards]);

  const filtered = useMemo(() => {
    let rows = cards.filter(
      (c) =>
        c.channels.length === 0 || visibleChannels(c.channels).length > 0,
    );
    if (channelFilter !== "all") {
      rows = rows.filter((c) =>
        visibleChannels(c.channels).includes(channelFilter),
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.goal.toLowerCase().includes(q) ||
          c.objective.toLowerCase().includes(q) ||
          c.whyCreated.toLowerCase().includes(q) ||
          c.intendedUse.toLowerCase().includes(q) ||
          c.audience.toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => {
      if (sortBy === "newest") {
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      }
      if (sortBy === "soonest") {
        return daysUntilSort(a) - daysUntilSort(b);
      }
      const conf = (b.confidence || 0) - (a.confidence || 0);
      if (conf !== 0) return conf;
      return daysUntilSort(a) - daysUntilSort(b);
    });
    return rows;
  }, [cards, channelFilter, query, sortBy]);

  const send = (textRaw?: string) => {
    const text = (textRaw ?? input).trim();
    if (!text || sending || !sessionReady) return;
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required");
      return;
    }
    setInput("");
    setSending(true);
    setMessagesBoth((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        text,
        createdAt: new Date().toISOString(),
      },
    ]);
    if (mode === "detail" && activeId) {
      appendRecommendationEditLog(
        activeId,
        `Chat edit: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`,
      );
    }
    getAgentsSocket().emit("user_message", {
      session_id: activeSessionId,
      token,
      text,
      module: "recommendations",
    });
  };

  const consentDeleteExpired = (id: string) => {
    deleteRecommendation(id);
    refreshCards();
  };

  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {!sessionReady && messages.length === 0 ? (
            <RecommendationWorkspaceSkeleton />
          ) : null}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={chatBubbleClass(msg.role)}>
                {msg.text}
              </div>
            </div>
          ))}
          {typing || sending ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border-default bg-surface px-3 py-2 text-xs text-text-caption">
                <Loader2 className="size-3.5 animate-spin" />
                Working — this can take a while…
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="border-t border-border-default px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <AgentChatComposer
            value={input}
            onChange={setInput}
            onSend={() => send()}
            busy={sending || typing}
            onStop={() => {
              getAgentsSocket().emit("stop_generation", {
                session_id: activeSessionId,
              });
              setTyping(false);
              setSending(false);
            }}
            disabled={!sessionReady}
            placeholder={
              mode === "main_chat"
                ? "Ask what agents have done, why a card exists, or request new ideas…"
                : "Ask about this recommendation…"
            }
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mode === "browse" ? (
        <PageHeader
          description="Suggestions from past campaign performance, or from knowledge if you have not sent yet."
          meta={
            filtered.length > 0
              ? `${filtered.length} suggestion${filtered.length === 1 ? "" : "s"}`
              : "No suggestions yet"
          }
        />
      ) : null}

      {socketError && mode !== "detail" ? (
        <p className="border-b border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}

      {expiryPrompt.length > 0 && mode === "browse" ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
          <p className="text-sm font-medium text-amber-950">
            {expiryPrompt.length} recommendation
            {expiryPrompt.length === 1 ? "" : "s"} older than ~2 months —
            manager suggests review & delete with consent.
          </p>
          <ul className="mt-2 space-y-2">
            {expiryPrompt.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-sm"
              >
                <span className="text-text-primary">{c.title}</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 text-xs"
                    onClick={() => openDetail(c.id)}
                  >
                    Review
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 text-xs text-text-danger"
                    onClick={() => consentDeleteExpired(c.id)}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    Consent delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode === "browse" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-default bg-surface px-4 py-2.5 sm:px-6">
            <div className="relative">
              <button
                type="button"
                onClick={() => setChannelMenuOpen((v) => !v)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-default bg-canvas px-3 text-sm text-text-primary hover:bg-subtle"
              >
                <ListFilter className="size-4 text-text-caption" strokeWidth={1.75} />
                {channelFilter === "all" ? "All Channels" : channelFilter}
              </button>
              {channelMenuOpen ? (
                <div className="absolute z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border-default bg-surface shadow-lg">
                  <button
                    type="button"
                    className="flex w-full px-3 py-2 text-left text-sm hover:bg-subtle"
                    onClick={() => {
                      setChannelFilter("all");
                      setChannelMenuOpen(false);
                    }}
                  >
                    All Channels
                  </button>
                  {channelsInCards.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      className="flex w-full px-3 py-2 text-left text-sm hover:bg-subtle"
                      onClick={() => {
                        setChannelFilter(ch);
                        setChannelMenuOpen(false);
                      }}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="relative min-w-[200px] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-caption"
                strokeWidth={1.75}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="h-9 w-full rounded-lg border border-border-default bg-canvas pr-3 pl-9 text-sm outline-none focus:border-brand"
              />
            </div>
            <label className="relative inline-flex h-9 items-center">
              <span className="sr-only">Sort recommendations</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortMode)}
                className="h-9 appearance-none rounded-lg border border-border-default bg-canvas py-0 pr-8 pl-3 text-sm text-text-primary outline-none focus:border-brand"
              >
                <option value="relevance">Sort by: Relevance</option>
                <option value="soonest">Sort by: Soonest</option>
                <option value="newest">Sort by: Newest</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-text-caption" />
            </label>
            <div className="inline-flex rounded-lg border border-border-default p-0.5">
              <button
                type="button"
                aria-label="Grid view"
                onClick={() => setViewMode("grid")}
                className={`rounded-md p-1.5 ${viewMode === "grid" ? "bg-subtle text-text-primary" : "text-text-caption"}`}
              >
                <Grid2X2 className="size-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label="List view"
                onClick={() => setViewMode("list")}
                className={`rounded-md p-1.5 ${viewMode === "list" ? "bg-subtle text-text-primary" : "text-text-caption"}`}
              >
                <LayoutList className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-default px-6 py-16 text-center">
                {boardGenerating ||
                sending ||
                typing ||
                (!boardHydrated && filtered.length === 0) ? (
                  <>
                    <Loader2 className="mx-auto size-6 animate-spin text-violet-600" />
                    <p className="mt-3 text-sm font-medium text-text-primary">
                      Building recommendations
                    </p>
                    <p className="mt-1 text-sm text-text-caption">
                      Using past campaign results when you have them, or knowledge
                      if nothing has been sent yet.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-text-primary">
                      No suggestions yet
                    </p>
                    <p className="mt-1 text-sm text-text-caption">
                      Ideas appear from past performance, or from knowledge if you
                      have not sent a campaign. Unused cards drop off after their
                      suggested send time.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button
                        type="button"
                        variant="brand"
                        onClick={() => {
                          clearRecBootstrapMark(packId);
                          setSocketError(null);
                          setRetryTick((n) => n + 1);
                        }}
                      >
                        Try again
                      </Button>
                      <Button type="button" variant="secondary" onClick={openMainChat}>
                        Manager Chat
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((card) => (
                  <AdaptiveCard
                    key={card.id}
                    card={card}
                    onOpen={() => openDetail(card.id)}
                    onDismiss={() => {
                      dismissRecommendation(card.id);
                      refreshCards();
                    }}
                  />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface">
                {filtered.map((card) => {
                  const Icon = cardHeroIcon(card);
                  const editing = Boolean(
                    card.lastEditedAt || (card.editLog && card.editLog.length),
                  );
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => openDetail(card.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-subtle"
                      >
                        <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${themeForCard(card.id).iconBg}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary">
                            {card.title}
                            {card.status === "creating" ? (
                              <span className="ml-2 text-xs text-text-caption">
                                Generating…
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-text-caption">
                            {card.goal || card.whyCreated}
                          </p>
                          {card.objective ? (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-text-secondary">
                              {card.objective}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-text-secondary">
                            {visibleChannels(card.channels).join(" · ") ||
                              "No channels"}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                            {card.timingLabel}
                          </span>
                          {editing ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Editing draft
                            </span>
                          ) : (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                              AI
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {mode === "main_chat" ? (
        <ModuleSplitWorkspace
          className="!h-auto min-h-0 flex-1"
          leftTitle="Manager chat"
          rightTitle="System overview"
          left={chatPane}
          right={
            <div className="p-4">
              <p className="text-xs text-text-caption">
                Ask about create-campaign, monitoring, contacts, templates, and
                what this manager has recommended.
              </p>
              <ul className="mt-4 space-y-2 text-xs text-text-secondary">
                <li>
                  Active cards:{" "}
                  {cards.filter((c) => c.status === "active").length}
                </li>
                <li>
                  Creating:{" "}
                  {cards.filter((c) => c.status === "creating").length}
                </li>
                <li>Expiry candidates: {expiryPrompt.length}</li>
              </ul>
              <Button
                type="button"
                variant="secondary"
                className="mt-4 h-9 w-full text-xs"
                onClick={backToBrowse}
              >
                Back to cards
              </Button>
            </div>
          }
        />
      ) : null}

      {mode === "detail" && active ? (
        <RecommendationRunWorkspace card={active} onBack={backToBrowse} />
      ) : null}
    </div>
  );
}

function AdaptiveCard({
  card,
  onOpen,
  onDismiss,
}: {
  card: CampaignRecommendation;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const theme = themeForCard(card.id);
  const Icon = cardHeroIcon(card);
  const channels = visibleChannels(card.channels);
  const editing = Boolean(
    card.lastEditedAt || (card.editLog && card.editLog.length),
  );

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border p-4 shadow-sm ${theme.wrap}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${theme.iconBg}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-text-secondary shadow-sm">
            {card.timingLabel || "Suggested soon"}
          </span>
          {card.status === "creating" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] text-text-caption shadow-sm">
              <Loader2 className="size-3 animate-spin" />
              Creating…
            </span>
          ) : editing ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              Editing draft
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
              <Sparkles className="h-3 w-3" />
              AI
            </span>
          )}
        </div>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold text-text-primary">
        {card.title}
      </h3>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
        {card.goal || card.whyCreated}
      </p>
      {card.objective ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
          {card.objective}
        </p>
      ) : null}

      <dl className="mt-3 space-y-1 text-xs">
        <div>
          <dt className="inline font-semibold text-text-primary">Use: </dt>
          <dd className="inline text-text-secondary">{card.intendedUse}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-text-primary">Audience: </dt>
          <dd className="inline text-text-secondary">{card.audience}</dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        {channels.map((ch) => {
          const ChIcon = channelIcon(ch);
          return (
            <div
              key={ch}
              className={`rounded-lg border border-white/70 px-2.5 py-2 ${theme.previewBg}`}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-text-primary">
                <ChIcon className="h-3.5 w-3.5 text-text-secondary" />
                {ch}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-text-secondary">
                {previewForChannel(card, ch)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <button
          type="button"
          className="h-9 flex-1 rounded-lg bg-violet-600 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          disabled={card.status === "creating"}
          onClick={onOpen}
        >
          Open
        </button>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-caption hover:bg-white/80 hover:text-text-danger"
          aria-label={`Dismiss ${card.title}`}
          onClick={onDismiss}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
