import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity, Loader2, Radar } from "lucide-react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { AnalyticsVisual, type StructuredAnalytics } from "@/components/analytics/AnalyticsVisual";
import { ReportsWorkspaceSkeleton } from "@/components/campaigns/ReportsWorkspaceSkeleton";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { useAgentNavigation } from "@/hooks/use-agent-navigation";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import {
  handoffJoinPayload,
  handoffSourceLabel,
  readChatHandoff,
  type HandoffMessage,
} from "@/lib/chat-handoff";
import { ReportsCampaignMonitoringPane } from "@/components/campaigns/ReportsCampaignMonitoringPane";
import { buildEventsSnapshot } from "@/lib/events-snapshot";
import { getCampaignProfile } from "@/lib/industry-packs";
import { getToken } from "@/services/api";
import { deferAgentsConnectError, getAgentsSocket } from "@/services/agents.socket";
import {
  appendAssistantDeduped,
  applySessionReadyChatMessages,
  isHydrationSessionReady,
  moduleStaticWelcomeMessage,
} from "@/lib/agents-chat-runtime";
import {
  emitJoinSession,
  emitJoinSessionNow,
  emitLeaveSession,
  type JoinSessionPayload,
} from "@/lib/agents-join";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  analytics?: StructuredAnalytics | null;
  suggestions?: string[];
};

type ReportsLocationState = {
  initialMessage?: string;
  skipWelcome?: boolean;
};

function toLocalMessages(
  rows: Array<{
    id?: string;
    role?: string;
    text?: string;
    meta?: { analytics?: StructuredAnalytics; suggestions?: string[] };
    analytics?: StructuredAnalytics;
    suggestions?: string[];
  }>,
): ChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const analytics =
        m.analytics ||
        (m.meta && typeof m.meta === "object" ? m.meta.analytics : undefined);
      const suggestions =
        m.suggestions ||
        (m.meta && typeof m.meta === "object" ? m.meta.suggestions : undefined);
      return {
        id: m.id || crypto.randomUUID(),
        role: m.role as "user" | "assistant",
        text: m.text || "",
        analytics: analytics || null,
        suggestions: Array.isArray(suggestions) ? suggestions : undefined,
      };
    });
}

const SAMPLE_QUESTIONS = [
  "How many campaigns launched today?",
  "How are my live campaigns doing?",
  "Which past campaign had the best open rate?",
  "List scheduled campaigns",
  "How many events are active?",
  "Which event has the most submissions?",
];

type WorkspaceVariant = "reports" | "monitoring";

const SESSION_KEYS: Record<WorkspaceVariant, string> = {
  reports: "worktual.reports.agent.session",
  monitoring: "worktual.campaign.monitoring.session.v2",
};

function mintSessionId(): string {
  return crypto.randomUUID();
}

function persistSessionId(variant: WorkspaceVariant, id: string): void {
  try {
    sessionStorage.setItem(SESSION_KEYS[variant], id);
  } catch {
    /* ignore */
  }
}

function clearStoredSessionId(variant: WorkspaceVariant): void {
  try {
    sessionStorage.removeItem(SESSION_KEYS[variant]);
  } catch {
    /* ignore */
  }
}

/**
 * Reports (`variant="reports"`): co-worker + shortcuts (campaigns & events).
 * Campaign monitoring (`variant="monitoring"`): co-worker + campaign list.
 */
export function ReportsAgentWorkspace({
  sessionId,
  variant = "reports",
}: {
  sessionId: string;
  variant?: WorkspaceVariant;
}) {
  const monitoringOnly = variant === "monitoring";
  const agentModule = monitoringOnly ? "monitoring" : "reports";
  const handoffRef = useRef(readChatHandoff(agentModule));
  const carried = handoffRef.current;
  const location = useLocation();
  const navState = (location.state || {}) as ReportsLocationState;
  const initialMessage = (navState.initialMessage || "").trim();
  const skipWelcome = Boolean(navState.skipWelcome || initialMessage);

  const [activeSessionId, setActiveSessionId] = useState(sessionId);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (initialMessage) {
      return [{ id: crypto.randomUUID(), role: "user", text: initialMessage }];
    }
    if (carried?.messages?.length) {
      return carried.messages.map((m) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        text: m.text,
      }));
    }
    return [
      moduleStaticWelcomeMessage(monitoringOnly ? "monitoring" : "reports"),
    ];
  });
  const messagesRef = useRef<HandoffMessage[]>([]);
  messagesRef.current = messages;
  useAgentNavigation({
    sessionId: activeSessionId,
    module: agentModule,
    getMessages: () => messagesRef.current,
  });
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(Boolean(initialMessage));
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  sendingRef.current = sending;
  typingRef.current = typing;
  const [socketError, setSocketError] = useState<string | null>(null);
  const [chatReady, setChatReady] = useState(false);
  // Monitoring list is REST-backed; don't block embed or the right pane on agent socket.
  useEmbedPageReady(monitoringOnly || chatReady);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing]);

  useEffect(() => {
    setChatReady(false);
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for your Worktual co-worker.");
      setChatReady(true);
      return;
    }
    const socket = getAgentsSocket();
    setSocketError(null);
    const readyRef = { current: false };
    let disposeJoin = () => {};

    let joinTimeout: number | undefined = window.setTimeout(() => {
      if (readyRef.current) return;
      setChatReady(true);
      setSocketError((prev) =>
        prev ??
          "Co-worker connection timed out. You can still browse campaigns.",
      );
    }, 12_000);

    const sameSession = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!payload.session_id || payload.session_id !== activeSessionId) return false;
      if (
        payload.module &&
        payload.module.toLowerCase() !== agentModule.toLowerCase()
      ) {
        return false;
      }
      return true;
    };

    const onReady = (payload: {
      session_id?: string;
      module?: string;
      ready_phase?: string;
      messages?: Array<{ id?: string; role?: string; text?: string }>;
    }) => {
      if (!sameSession(payload)) return;
      const followUpReady = readyRef.current;
      readyRef.current = true;
      if (joinTimeout) window.clearTimeout(joinTimeout);
      setChatReady(true);
      setSocketError(null);
      const rows = toLocalMessages(payload.messages || []);
      const hydration = isHydrationSessionReady(payload);
      const busy = sendingRef.current || typingRef.current;
      if (rows.length) {
        setMessages((prev) =>
          applySessionReadyChatMessages(prev, rows, {
            busy,
            followUpReady,
            hydration,
          }),
        );
      } else if (initialMessage && !seededRef.current) {
        setMessages([
          { id: crypto.randomUUID(), role: "user", text: initialMessage },
        ]);
      }
      if (initialMessage) {
        seededRef.current = true;
        const last = rows.length ? rows[rows.length - 1] : null;
        const waitingForReply = !last || last.role === "user";
        setSending(waitingForReply);
        setTyping(waitingForReply);
      }
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
      analytics?: StructuredAnalytics;
      suggestions?: string[];
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      const text = payload.text || "";
      if (!text && !payload.analytics) return;
      setMessages((prev) => {
        const next = appendAssistantDeduped(prev, text);
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return next;
        return [
          ...next.slice(0, -1),
          {
            ...last,
            analytics: payload.analytics || null,
            suggestions: Array.isArray(payload.suggestions)
              ? payload.suggestions
              : undefined,
          },
        ];
      });
      setTyping(false);
      setSending(false);
    };

    const onTyping = (payload: {
      session_id?: string;
      typing?: boolean;
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      setTyping(Boolean(payload.typing));
    };

    const onError = (payload: { message?: string }) => {
      setSocketError(payload.message || "Co-worker error");
      setTyping(false);
      setSending(false);
      setChatReady(true);
      if (joinTimeout) window.clearTimeout(joinTimeout);
    };

    let cancelConnectErrorReport: (() => void) | null = null;
    const onConnectError = (err: Error) => {
      if (joinTimeout) window.clearTimeout(joinTimeout);
      setTyping(false);
      setSending(false);
      setChatReady(true);
      cancelConnectErrorReport?.();
      cancelConnectErrorReport = deferAgentsConnectError(socket, err, setSocketError);
    };

    const retryTimers: number[] = [];
    let joinPayload: Record<string, unknown> | null = null;
    const join = () => {
      if (joinPayload) emitJoinSessionNow(socket, joinPayload);
    };

    void (async () => {
      const events_snapshot = monitoringOnly
        ? undefined
        : await buildEventsSnapshot();
      joinPayload = {
        session_id: activeSessionId,
        token,
        module: agentModule,
        skip_welcome: true,
        seed_user_message: initialMessage || undefined,
        ...(events_snapshot ? { events_snapshot } : {}),
        campaign_profile: getCampaignProfile(),
        ...handoffJoinPayload(carried),
      };
      disposeJoin = emitJoinSession(socket, joinPayload as JoinSessionPayload);
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
    })();

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("agent_error", onError);
    socket.on("error", onError);
    socket.on("connect_error", onConnectError);

    return () => {
      disposeJoin();
      cancelConnectErrorReport?.();
      if (joinTimeout) window.clearTimeout(joinTimeout);
      for (const t of retryTimers) window.clearTimeout(t);
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("agent_error", onError);
      socket.off("error", onError);
      socket.off("connect_error", onConnectError);
      emitLeaveSession(socket, activeSessionId, agentModule);
    };
  }, [
    activeSessionId,
    initialMessage,
    skipWelcome,
    monitoringOnly,
    agentModule,
    carried,
  ]);

  const busy = sending || typing;

  const send = (text: string) => {
    const trimmed = text.trim();
    const token = getToken();
    if (!trimmed || !token || busy) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: trimmed },
    ]);
    setInput("");
    setSending(true);
    setTyping(true);
    setSocketError(null);
    void (async () => {
      const events_snapshot = monitoringOnly
        ? undefined
        : await buildEventsSnapshot();
      getAgentsSocket().emit("user_message", {
        session_id: activeSessionId,
        token,
        module: agentModule,
        text: trimmed,
        ...(events_snapshot ? { events_snapshot } : {}),
      });
    })();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", { session_id: activeSessionId });
    setTyping(false);
    setSending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const restartChat = () => {
    const token = getToken();
    if (!token) return;
    getAgentsSocket().emit("leave_session", {
      session_id: activeSessionId,
      token,
      module: agentModule,
    });
    clearStoredSessionId(variant);
    const nextId = mintSessionId();
    persistSessionId(variant, nextId);
    setActiveSessionId(nextId);
    setMessages([]);
    setInput("");
    setTyping(false);
    setSending(false);
    setSocketError(null);
    seededRef.current = false;
    setChatReady(false);
  };

  if (!chatReady && !monitoringOnly) {
    return <ReportsWorkspaceSkeleton />;
  }

  const chatPane = !chatReady ? (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-4 text-sm text-text-caption">
      <Loader2 className="size-6 animate-spin text-brand" />
      Connecting co-worker…
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      {socketError ? (
        <p className="border-b border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {carried?.fromModule ? (
            <p className="text-center text-[11px] text-text-caption">
              Earlier in {handoffSourceLabel(carried.fromModule)}
            </p>
          ) : null}
          {messages.length === 0 && !busy ? (
            <div className="rounded-xl border border-dashed border-border-default bg-subtle/60 px-4 py-6 text-sm text-text-caption">
              {monitoringOnly
                ? "Ask about campaign performance (live, scheduled, past, drafts — opens, clicks, sent, failed, launched today). I pull real numbers and answer directly."
                : "Ask about campaigns (live, scheduled, past, drafts — opens, clicks, sent, failed) or events tracking (submissions, opens, status)."}
            </div>
          ) : null}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={chatBubbleClass(m.role)}>
                {m.text}
                {m.role === "assistant" && m.analytics?.visual ? (
                  <AnalyticsVisual analytics={m.analytics} />
                ) : null}
                {m.role === "assistant" && m.suggestions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy}
                        onClick={() => send(s)}
                        className="rounded-full border border-border-default bg-white px-2.5 py-1 text-[11px] text-neutral-700 hover:bg-subtle disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {busy ? <AgentThinkingIndicator /> : null}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );

  const chatFooter = chatReady ? (
      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        busy={busy}
        onStop={stopGeneration}
        inputRef={inputRef}
        placeholder={
          monitoringOnly
            ? "Ask about campaigns…"
            : "Ask about campaigns or events…"
        }
        className="w-full"
        maxWidthClass=""
      />
  ) : undefined;

  const shortcutsPane = (
    <div className="space-y-5 p-4 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
          Open related
        </p>
        <ul className="mt-2 space-y-2">
          <li>
            <Link
              to="/campaigns"
              className="flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 hover:bg-subtle"
            >
              <Activity className="size-4 text-brand" strokeWidth={1.75} />
              <span className="font-medium text-text-primary">
                Campaign monitoring
              </span>
            </Link>
          </li>
          <li>
            <Link
              to="/events"
              className="flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 hover:bg-subtle"
            >
              <Radar className="size-4 text-brand" strokeWidth={1.75} />
              <span className="font-medium text-text-primary">
                Events tracking
              </span>
            </Link>
          </li>
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
          Try asking
        </p>
        <ul className="mt-2 space-y-2">
          {SAMPLE_QUESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                disabled={busy}
                onClick={() => send(q)}
                className="w-full rounded-lg border border-border-default px-3 py-2 text-left text-text-secondary hover:bg-subtle disabled:opacity-50"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const overviewPane = monitoringOnly ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ReportsCampaignMonitoringPane />
    </div>
  ) : (
    shortcutsPane
  );

  const rightTitle = monitoringOnly ? "Campaign monitoring" : "Shortcuts";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleSplitWorkspace
        leftTitle="Your Worktual co-worker"
        rightTitle={rightTitle}
        leftFr={50}
        rightFr={50}
        left={chatPane}
        leftFooter={chatFooter}
        right={overviewPane}
        onRestart={restartChat}
      />
    </div>
  );
}
