import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { EventsTrackingPane } from "@/components/campaigns/EventsTrackingPane";
import { CreateEventKindMenu } from "@/components/events/CreateEventKindMenu";
import {
  DEFAULT_EVENT_DESCRIPTIONS,
  DEFAULT_EVENT_TITLES,
} from "@/components/events/create-event-defaults";
import { useAgentNavigation } from "@/hooks/use-agent-navigation";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import {
  handoffJoinPayload,
  handoffSourceLabel,
  readChatHandoff,
  type HandoffMessage,
} from "@/lib/chat-handoff";
import {
  createOpportunityEvent,
  listDraftEvents,
  listLaunchedEvents,
  opportunityKindLabel,
  type OpportunityEvent,
  type OpportunityKind,
} from "@/lib/opportunity-events-store";
import { buildEventsSnapshot } from "@/lib/events-snapshot";
import { appendAgentWork } from "@/lib/agent-work-log-store";
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
import { getCampaignProfile } from "@/lib/industry-packs";

const AGENT_MODULE = "events_report";
const SESSION_KEY = "worktual.events.tracking.session";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type LocationState = {
  initialMessage?: string;
  skipWelcome?: boolean;
};

function toLocalMessages(
  rows: Array<{ id?: string; role?: string; text?: string }>,
): ChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role as "user" | "assistant",
      text: m.text || "",
    }));
}

function mintSessionId(): string {
  return crypto.randomUUID();
}

function persistSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}

function clearStoredSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Events tracking — events co-worker + launched events list/detail.
 */
export function EventsTrackingWorkspace({
  sessionId,
  initialEventId = null,
}: {
  sessionId: string;
  initialEventId?: string | null;
}) {
  const handoffRef = useRef(readChatHandoff(AGENT_MODULE));
  const carried = handoffRef.current;
  const location = useLocation();
  const navigate = useNavigate();
  const navState = (location.state || {}) as LocationState;
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
    return [moduleStaticWelcomeMessage("events")];
  });
  const messagesRef = useRef<HandoffMessage[]>([]);
  messagesRef.current = messages;

  useAgentNavigation({
    sessionId: activeSessionId,
    module: AGENT_MODULE,
    getMessages: () => messagesRef.current,
  });

  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(Boolean(initialMessage));
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  sendingRef.current = sending;
  typingRef.current = typing;
  const [socketError, setSocketError] = useState<string | null>(null);
  const [chatReady, setChatReady] = useState(false);
  // Events list is local/REST-backed; don't block embed READY or right pane on agent socket.
  useEmbedPageReady(true);
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
          "Co-worker connection timed out. You can still browse events.",
      );
    }, 12_000);

    const sameSession = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!payload.session_id || payload.session_id !== activeSessionId) return false;
      if (
        payload.module &&
        payload.module.toLowerCase() !== AGENT_MODULE.toLowerCase()
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
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      const text = payload.text || "";
      if (!text) return;
      setMessages((prev) => appendAssistantDeduped(prev, text));
      setTyping(false);
      setSending(false);
      const clip = text.replace(/\s+/g, " ").trim().slice(0, 140);
      if (clip) {
        appendAgentWork({
          agentId: "forms",
          action: "event_answered",
          summary: clip,
          href: "/events",
          sourceKey: `events-${activeSessionId}-${Date.now()}`,
        });
      }
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
      const events_snapshot = await buildEventsSnapshot();
      joinPayload = {
        session_id: activeSessionId,
        token,
        module: AGENT_MODULE,
        skip_welcome: true,
        seed_user_message: initialMessage || undefined,
        events_snapshot,
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
      emitLeaveSession(socket, activeSessionId, AGENT_MODULE);
    };
  }, [activeSessionId, initialMessage, skipWelcome, carried]);

  const busy = sending || typing;

  const sendRef = useRef<(text: string) => void>(() => {});

  const send = useCallback(
    (text: string) => {
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
      void buildEventsSnapshot().then((events_snapshot) => {
        getAgentsSocket().emit("user_message", {
          session_id: activeSessionId,
          token,
          module: AGENT_MODULE,
          text: trimmed,
          events_snapshot,
        });
      });
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [activeSessionId, busy],
  );
  sendRef.current = send;

  const onCreateEvent = useCallback(
    (kind: OpportunityKind) => {
      const created = createOpportunityEvent({
        kind,
        title: DEFAULT_EVENT_TITLES[kind],
        description: DEFAULT_EVENT_DESCRIPTIONS[kind],
        status: "draft",
      }, { deferPersist: true });
      navigate(`/events/create/${created.id}`);
    },
    [navigate],
  );

  const onFocusEvent = useCallback((event: OpportunityEvent) => {
    setFocusedEventId(event.id);
    const kind = event.kind === "form" ? "form" : opportunityKindLabel(event.kind);
    sendRef.current(
      `Tell me about “${event.title}” (${kind}, id ${event.id}) — status, submissions, opens, and public link if available.`,
    );
  }, []);

  const onOpenDraft = useCallback(
    (eventId: string) => {
      navigate(`/events/create/${eventId}`);
    },
    [navigate],
  );

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
      module: AGENT_MODULE,
    });
    clearStoredSessionId();
    const nextId = mintSessionId();
    persistSessionId(nextId);
    setActiveSessionId(nextId);
    setMessages([]);
    setInput("");
    setTyping(false);
    setSending(false);
    setSocketError(null);
    setChatReady(false);
    seededRef.current = false;
  };

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
            <div className="rounded-xl border border-dashed border-border-default bg-subtle/60 px-4 py-5 text-sm text-text-caption">
              Ask about launched events, submissions, opens, status, and public
              links — or say you want to create a form or event.
            </div>
          ) : null}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={chatBubbleClass(m.role)}>{m.text}</div>
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
        placeholder="Ask about events…"
        className="w-full"
        maxWidthClass=""
      />
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleSplitWorkspace
        leftTitle="Events co-worker"
        rightTitle="Events"
        rightHeaderActions={
          <CreateEventKindMenu onCreate={onCreateEvent} />
        }
        leftFr={50}
        rightFr={50}
        left={chatPane}
        leftFooter={chatFooter}
        right={
          <EventsTrackingPane
            initialEventId={initialEventId}
            focusedEventId={focusedEventId}
            onFocusEvent={onFocusEvent}
            onOpenDraft={onOpenDraft}
            onCreateEvent={onCreateEvent}
          />
        }
        onRestart={restartChat}
      />
    </div>
  );
}
