import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getAgentsSocket } from "@/services/agents.socket";
import {
  applyAgentNavigate,
  type AgentNavigateEvent,
  type HandoffMessage,
} from "@/lib/chat-handoff";

/** Listen for agent `ui_event` navigate and route with chat handoff. */
export function useAgentNavigation(opts: {
  sessionId: string;
  module: string;
  getMessages?: () => HandoffMessage[];
  enabled?: boolean;
}): void {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const getMessagesRef = useRef(opts.getMessages);
  getMessagesRef.current = opts.getMessages;

  useEffect(() => {
    if (opts.enabled === false) return;
    const socket = getAgentsSocket();
    const onUi = (payload: AgentNavigateEvent) => {
      applyAgentNavigate(payload, {
        sessionId: opts.sessionId,
        module: opts.module,
        navigate: (path, navOpts) => navigateRef.current(path, navOpts),
        getMessages: () => getMessagesRef.current?.() ?? [],
      });
    };
    socket.on("ui_event", onUi);
    return () => {
      socket.off("ui_event", onUi);
    };
  }, [opts.sessionId, opts.module, opts.enabled]);
}
