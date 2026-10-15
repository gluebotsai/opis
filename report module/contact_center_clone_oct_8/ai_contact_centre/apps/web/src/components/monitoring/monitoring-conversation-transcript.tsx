import { useEffect, useRef, useState } from "react";

import {
  ConversationThreadSkeleton,
  WorkspaceChatView,
  WorkspaceEmailView,
} from "@/components/workspace/workspace-conversation-views";
import { workspaceApi } from "@/features/workspace/api";
import { getOrCreateWorkspaceSocket } from "@/features/workspace/workspace-socket-client";
import type { WorkspaceConversation } from "@/features/workspace/types";
import { isEmailChannel } from "@/features/workspace/workspace-utils";
import { readAuthFromStorage } from "@/services/http";

type MonitoringConversationTranscriptProps = {
  conversationId: string;
  contactId?: string | null;
};

const TRANSCRIPT_POLL_MS = 3_000;
const transcriptCache = new Map<string, WorkspaceConversation>();

function transcriptIsOpen(conversation: WorkspaceConversation): boolean {
  return conversation.status !== "resolved" && !conversation.endedAt && !conversation.resolvedAt;
}

export function MonitoringConversationTranscript({
  conversationId,
  contactId = null,
}: MonitoringConversationTranscriptProps) {
  const cached = transcriptCache.get(conversationId) ?? null;
  const [conversation, setConversation] = useState<WorkspaceConversation | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef(cached ? transcriptIsOpen(cached) : true);
  const conversationRef = useRef<WorkspaceConversation | null>(cached);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const showingThisConversation = conversationRef.current?.id === conversationId;
    if (!showingThisConversation) {
      const nextCached = transcriptCache.get(conversationId) ?? null;
      conversationRef.current = nextCached;
      openRef.current = nextCached ? transcriptIsOpen(nextCached) : true;
      setConversation(nextCached);
      setError(null);
      setLoading(!nextCached);
    }

    async function load() {
      const id = ++request;
      try {
        const loaded = await workspaceApi.getConversation(conversationId, true, { contactId });
        if (cancelled || id !== request) return;
        openRef.current = transcriptIsOpen(loaded);
        conversationRef.current = loaded;
        transcriptCache.set(conversationId, loaded);
        setConversation(loaded);
        setError(null);
        setLoading(false);
      } catch (reason) {
        if (cancelled || id !== request) return;
        if (!conversationRef.current) {
          setError(reason instanceof Error ? reason.message : "Failed to load transcript");
          setLoading(false);
        }
      }
    }

    void load();
    const poll = window.setInterval(() => {
      if (openRef.current) void load();
    }, TRANSCRIPT_POLL_MS);

    const auth = readAuthFromStorage();
    const socket = auth.token ? getOrCreateWorkspaceSocket(auth) : null;
    const onMessage = (payload: { conversationId?: string }) => {
      if (payload.conversationId === conversationId) void load();
    };
    socket?.on("message.created", onMessage);
    socket?.on("message.receipt.updated", onMessage);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      socket?.off("message.created", onMessage);
      socket?.off("message.receipt.updated", onMessage);
    };
  }, [contactId, conversationId]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <ConversationThreadSkeleton isEmail={false} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 text-center">
        <p className="text-sm text-neutral-600">No transcript available.</p>
      </div>
    );
  }

  const threadProps = {
    conversation,
    messagesLoading: false,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isEmailChannel(conversation.channel) ? (
        <WorkspaceEmailView {...threadProps} />
      ) : (
        <WorkspaceChatView {...threadProps} speakerLayout="monitor" />
      )}
    </div>
  );
}
