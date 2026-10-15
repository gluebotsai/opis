import { useCallback } from "react";
import { useSearchParams } from "react-router";

import { useAuth } from "@/hooks/use-auth";

import { InternalChatPanels } from "@/components/internal-chat/internal-chat-panels";
import { InternalChatPanelsSkeleton } from "@/components/internal-chat/internal-chat-panels-skeleton";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { InternalChatSendPayload as ApiInternalChatSendPayload } from "@/features/internal-chat/api";
import { useInternalChat } from "@/features/internal-chat/use-internal-chat";
import { useInternalChatMock } from "@/features/internal-chat/use-internal-chat-mock";
import type { InternalChatSendPayload as MockInternalChatSendPayload } from "@/features/internal-chat/use-internal-chat-mock";

const useMockInternalChat = import.meta.env.VITE_INTERNAL_CHAT_MOCK === "1";

type InternalChatSendPayload = ApiInternalChatSendPayload | MockInternalChatSendPayload;

export default function TeamChatPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const dmUserId = searchParams.get("dm");
  const isAdmin = user?.role === "admin";
  const realChat = useInternalChat(user);
  const mockChat = useInternalChatMock(user);
  const chat = useMockInternalChat ? mockChat : realChat;
  const { state, selectRoom, sendMessage, createGroup, startDm, updateGroup, loading, error } = chat;

  const clearDmParam = useCallback(() => {
    if (!searchParams.has("dm")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("dm");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!user) return null;

  if (!useMockInternalChat && loading && !state) {
    return (
      <WorkspaceShell title="Internal Chat">
        <InternalChatPanelsSkeleton />
      </WorkspaceShell>
    );
  }

  if (!useMockInternalChat && error && !state) {
    return (
      <WorkspaceShell title="Internal Chat">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-600">
          <p>{error}</p>
        </div>
      </WorkspaceShell>
    );
  }

  if (!state) return null;

  const handleSendMessage = (roomId: string, payload: InternalChatSendPayload) =>
    sendMessage(roomId, payload as never);

  return (
    <WorkspaceShell title="Internal Chat">
      <InternalChatPanels
        state={state}
        isAdmin={isAdmin}
        initialDmUserId={dmUserId}
        onInitialDmHandled={clearDmParam}
        onSelectRoom={selectRoom}
        onSendMessage={handleSendMessage}
        onCreateGroup={createGroup}
        onStartDm={startDm}
        onUpdateGroup={updateGroup}
      />
    </WorkspaceShell>
  );
}
