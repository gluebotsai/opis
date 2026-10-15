import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import {
  loadFormEventChat,
  mergeFormEventChats,
  saveFormEventChatBackground,
  type FormChatMessage,
} from "@/lib/form-event-chats-store";
import {
  applyFormDesignPayload,
  persistOpportunityEvent,
  type OpportunityEvent,
} from "@/lib/opportunity-events-store";
import { appendAgentWork } from "@/lib/agent-work-log-store";
import { getCampaignProfile } from "@/lib/industry-packs";
import { getToken } from "@/services/api";
import { getAgentsSocket } from "@/services/agents.socket";
import { useAgentNavigation } from "@/hooks/use-agent-navigation";
import type { HandoffMessage } from "@/lib/chat-handoff";

export function formSessionId(eventId: string) {
  return `forms-event-${eventId}`;
}

export function formSnapshotFromEvent(event: OpportunityEvent) {
  return {
    title: event.title,
    description: event.description,
    thank_you_message: event.thankYouMessage,
    thankYouMessage: event.thankYouMessage,
    fields: event.formFields,
    formFields: event.formFields,
    theme: event.theme,
  };
}

type FormDesignAgentPanelProps = {
  eventId: string;
  /** Always-current event for snapshots + apply refresh. */
  eventRef: MutableRefObject<OpportunityEvent | null>;
  /** Called before applying agent design (e.g. push undo). */
  onBeforeDesignApply?: () => void;
  onDesignApplied: (summary?: string) => void;
};

/**
 * Forms design agent chat — join module "forms", apply form_design ui_events.
 */
export function FormDesignAgentPanel({
  eventId,
  eventRef,
  onBeforeDesignApply,
  onDesignApplied,
}: FormDesignAgentPanelProps) {
  const sessionId = formSessionId(eventId);
  const [messages, setMessages] = useState<FormChatMessage[]>(() =>
    loadFormEventChat(sessionId),
  );
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useAgentNavigation({
    sessionId,
    module: "forms",
    getMessages: () => messagesRef.current as HandoffMessage[],
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing]);

  useEffect(() => {
    saveFormEventChatBackground(sessionId, messages);
  }, [sessionId, messages]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for the form design agent.");
      return;
    }
    const socket = getAgentsSocket();
    setSocketError(null);

    const sameSession = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!payload.session_id || payload.session_id !== sessionId) return false;
      if (payload.module && payload.module !== "forms") return false;
      return true;
    };

    const onReady = (payload: {
      session_id?: string;
      module?: string;
      messages?: Array<{ id?: string; role?: string; text?: string }>;
    }) => {
      if (!sameSession(payload)) return;
      const remote = (payload.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id || crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          text: m.text || "",
          createdAt: new Date().toISOString(),
        }));
      setMessages((local) => mergeFormEventChats(local, remote));
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      const text = (payload.text || "").trim();
      if (!text) return;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text,
          createdAt: new Date().toISOString(),
        },
      ]);
      setSending(false);
      setTyping(false);
    };

    const onTyping = (payload: { session_id?: string; typing?: boolean }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) setSending(false);
    };

    const onUiEvent = (payload: {
      session_id?: string;
      type?: string;
      payload?: Record<string, unknown>;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      if (payload.type !== "form_design") return;
      const body = payload.payload || {};
      onBeforeDesignApply?.();
      const updated = applyFormDesignPayload(eventId, body);
      if (updated) {
        eventRef.current = updated;
        const summary =
          typeof body.change_summary === "string" && body.change_summary.trim()
            ? body.change_summary.trim()
            : "Updated form design";
        appendAgentWork({
          agentId: "forms",
          action: "form_designed",
          summary,
          eventId,
          eventTitle: updated.title,
          href: updated.launchedAt
            ? `/events/${eventId}`
            : `/events/create/${eventId}`,
          sourceKey: `forms-design-${eventId}-${Date.now()}`,
        });
        onDesignApplied(summary);
      }
    };

    const onStopped = (payload: { session_id?: string }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(false);
      setSending(false);
    };

    const onError = (payload: { message?: string }) => {
      setSocketError(payload.message || "Form agent error");
      setSending(false);
      setTyping(false);
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("ui_event", onUiEvent);
    socket.on("generation_stopped", onStopped);
    socket.on("error", onError);
    socket.on("agent_error", onError);

    const join = () => {
      const ev = eventRef.current;
      socket.emit("join_session", {
        session_id: sessionId,
        token,
        module: "forms",
        form_event_id: eventId,
        form_snapshot: ev ? formSnapshotFromEvent(ev) : undefined,
        skip_welcome: messagesRef.current.length > 0,
        campaign_profile: getCampaignProfile(),
      });
    };
    if (socket.connected) join();
    else socket.on("connect", join);

    return () => {
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("ui_event", onUiEvent);
      socket.off("generation_stopped", onStopped);
      socket.off("error", onError);
      socket.off("agent_error", onError);
      socket.off("connect", join);
      socket.emit("leave_session", {
        session_id: sessionId,
        token,
        module: "forms",
      });
    };
  }, [sessionId, eventId, eventRef, onBeforeDesignApply, onDesignApplied]);

  const busy = sending || typing;

  const send = (text: string) => {
    const token = getToken();
    const trimmed = text.trim();
    if (!token || !trimmed || busy) return;
    persistOpportunityEvent(eventId);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setSending(true);
    setTyping(true);
    setSocketError(null);
    const ev = eventRef.current;
    getAgentsSocket().emit("user_message", {
      session_id: sessionId,
      token,
      module: "forms",
      text: trimmed,
      form_event_id: eventId,
      form_snapshot: ev ? formSnapshotFromEvent(ev) : undefined,
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", { session_id: sessionId });
    setTyping(false);
    setSending(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {socketError ? (
        <p className="shrink-0 border-b border-border-default bg-red-50 px-3 py-2 text-xs text-red-700">
          {socketError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {messages.length === 0 && !busy ? (
          <p className="text-xs text-text-caption">
            Ask the agent to add fields, change colors, or redesign this form.
            Preview updates on the right.
          </p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <div className={chatBubbleClass(m.role)}>{m.text}</div>
          </div>
        ))}
        {busy ? <AgentThinkingIndicator label="Designing…" /> : null}
        <div ref={bottomRef} />
      </div>
      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 sm:px-4">
        <AgentChatComposer
          value={input}
          onChange={setInput}
          onSend={() => send(input)}
          busy={busy}
          onStop={stopGeneration}
          placeholder="e.g. Move full name to top, make email required…"
          inputRef={inputRef}
          className="w-full"
          maxWidthClass=""
        />
      </div>
    </div>
  );
}
