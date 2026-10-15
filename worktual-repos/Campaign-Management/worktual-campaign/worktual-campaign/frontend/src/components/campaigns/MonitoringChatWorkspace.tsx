import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import {
  appendAssistantDeduped,
  applySessionReadyChatMessages,
  isHydrationSessionReady,
  moduleStaticWelcomeMessage,
} from "@/lib/agents-chat-runtime";
import { bindJoinOnConnect } from "@/lib/agents-join";
import { getCampaignProfile } from "@/lib/industry-packs";
import { getToken } from "@/services/api";
import { getAgentsSocket } from "@/services/agents.socket";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { sanitizeAssistantChatText } from "@/lib/chat-user-facing";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type MonitoringChatLocationState = {
  initialMessage?: string;
  listHref?: string;
  skipWelcome?: boolean;
  focusCampaignId?: string;
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

/**
 * Full-page monitoring agent chat (list-level or focused campaign).
 */
export function MonitoringChatWorkspace({
  sessionId,
  listHref = "/campaigns",
}: {
  sessionId: string;
  listHref?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state || {}) as MonitoringChatLocationState;
  const initialMessage = (navState.initialMessage || "").trim();
  const skipWelcome = Boolean(navState.skipWelcome || initialMessage);
  const backHref = navState.listHref || listHref;
  const focusCampaignId = (navState.focusCampaignId || "").trim();

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessage
      ? [{ id: crypto.randomUUID(), role: "user", text: initialMessage }]
      : [moduleStaticWelcomeMessage("monitoring")],
  );
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(Boolean(initialMessage));
  const [socketError, setSocketError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seededRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  sendingRef.current = sending;
  typingRef.current = typing;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for monitoring chat.");
      return;
    }
    sessionReadyRef.current = false;
    const socket = getAgentsSocket();
    setSocketError(null);

    const sameSession = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!payload.session_id || payload.session_id !== sessionId) return false;
      if (payload.module && payload.module !== "monitoring") return false;
      return true;
    };

    const onReady = (payload: {
      session_id?: string;
      module?: string;
      ready_phase?: string;
      messages?: Array<{ id?: string; role?: string; text?: string }>;
    }) => {
      if (!sameSession(payload)) return;
      const followUpReady = sessionReadyRef.current;
      sessionReadyRef.current = true;
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
      // Seed may finish before/during remount. Only show busy if the last
      // message is still the user turn (reply not in history yet).
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
      if (payload.session_id && payload.session_id !== sessionId) return;
      const text = payload.text || "";
      if (!text) return;
      setMessages((prev) => appendAssistantDeduped(prev, text));
      setSending(false);
      setTyping(false);
    };

    const onTyping = (payload: { session_id?: string; typing?: boolean }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) setSending(false);
    };

    const onStopped = (payload: { session_id?: string }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(false);
      setSending(false);
    };

    const onError = (payload: { message?: string }) => {
      setSocketError(payload.message || "Monitoring agent error");
      setSending(false);
      setTyping(false);
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("generation_stopped", onStopped);
    socket.on("error", onError);

    const join = () => {
      socket.emit("join_session", {
        session_id: sessionId,
        token,
        module: "monitoring",
        focus_campaign_id: focusCampaignId || undefined,
        skip_welcome: true,
        seed_user_message: initialMessage || undefined,
        campaign_profile: getCampaignProfile(),
      });
    };
    bindJoinOnConnect(socket, join);

    // If seed reply was lost during a remount, pull latest messages once more.
    const recoverTimer = window.setTimeout(() => {
      if (!initialMessage) return;
      setSending((s) => {
        if (!s) return s;
        // Still marked busy after 2s with no typing pulse — re-join for history.
        join();
        return s;
      });
    }, 2500);

    return () => {
      window.clearTimeout(recoverTimer);
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("generation_stopped", onStopped);
      socket.off("error", onError);
      socket.off("connect", join);
      // Ephemeral monitoring chat — drop in-memory session on leave.
      socket.emit("leave_session", {
        session_id: sessionId,
        token,
        module: "monitoring",
      });
    };
  }, [sessionId, initialMessage, skipWelcome, focusCampaignId]);

  const busy = sending || typing;

  const send = (text: string) => {
    const token = getToken();
    if (!token || !text.trim() || busy) return;
    const trimmed = text.trim();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: trimmed },
    ]);
    setInput("");
    setSending(true);
    setTyping(true);
    getAgentsSocket().emit("user_message", {
      session_id: sessionId,
      token,
      module: "monitoring",
      text: trimmed,
    });
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", { session_id: sessionId });
    setTyping(false);
    setSending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-subtle">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-3 sm:px-4">
        <button
          type="button"
          onClick={() => navigate(backHref)}
          className="inline-flex size-9 items-center justify-center rounded-lg text-icon-on-light hover:bg-state-hover"
          aria-label="Back to monitoring"
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text-primary">
            Campaign monitoring chat
          </p>
          <p className="truncate text-xs text-text-caption">
            List campaigns, reports, stop/resume channels
          </p>
        </div>
      </header>

      {socketError ? (
        <p className="border-b border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}

      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={chatBubbleClass(m.role)}>
                {m.role === "assistant"
                  ? sanitizeAssistantChatText(m.text)
                  : m.text}
              </div>
            </div>
          ))}
          {busy ? <AgentThinkingIndicator /> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] bg-white px-4 py-2.5">
        <AgentChatComposer
          value={input}
          onChange={setInput}
          onSend={() => send(input)}
          busy={busy}
          onStop={stopGeneration}
          inputRef={inputRef}
          placeholder="Ask about campaigns…"
          className="w-full"
          maxWidthClass=""
        />
      </div>
    </div>
  );
}
