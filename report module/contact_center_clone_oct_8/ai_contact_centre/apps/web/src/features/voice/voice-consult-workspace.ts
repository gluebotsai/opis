import type { WorkspaceConversation } from "@/features/workspace/types";

export type PendingVoiceConsultWorkspace = {
  conversation: WorkspaceConversation;
  sessionId: string | null;
  receivedAt: number;
};

let pendingConsult: PendingVoiceConsultWorkspace | null = null;
let inboundTransferSessionId: string | null = null;

export function rememberVoiceConsultOffer(
  conversation: WorkspaceConversation,
): PendingVoiceConsultWorkspace {
  pendingConsult = {
    conversation,
    sessionId: inboundTransferSessionId,
    receivedAt: Date.now(),
  };
  return pendingConsult;
}

export function rememberInboundVoiceConsultSession(
  sessionId: string | null,
): PendingVoiceConsultWorkspace | null {
  inboundTransferSessionId = sessionId;
  if (pendingConsult) pendingConsult = { ...pendingConsult, sessionId };
  return pendingConsult;
}

export function getPendingVoiceConsultWorkspace(): PendingVoiceConsultWorkspace | null {
  return pendingConsult;
}

export function clearPendingVoiceConsultWorkspace(conversationId?: string): void {
  if (conversationId && pendingConsult?.conversation.id !== conversationId) return;
  pendingConsult = null;
  inboundTransferSessionId = null;
}
