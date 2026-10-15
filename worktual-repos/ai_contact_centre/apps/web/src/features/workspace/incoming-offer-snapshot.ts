import type { WorkspaceConversation } from "./types";

export type IncomingOfferSnapshot = {
  id: string;
  generation: number;
  source: "sip" | "digital";
  conversation: WorkspaceConversation | null;
  showBanner: boolean;
  playLocalRing: boolean;
};

export type IncomingOfferAction =
  | { type: "sip"; active: boolean; id: string; generation: number }
  | { type: "digital"; conversation: WorkspaceConversation; generation: number }
  | { type: "hydrate"; conversation: WorkspaceConversation | null; generation: number }
  | { type: "clear"; id?: string; generation: number };

export function incomingOfferReducer(
  current: IncomingOfferSnapshot | null,
  action: IncomingOfferAction,
): IncomingOfferSnapshot | null {
  if (current && action.generation < current.generation) return current;
  if (action.type === "clear") {
    if (action.id && current?.id !== action.id) return current;
    return null;
  }
  if (action.type === "sip") {
    if (!action.active) {
      return current?.source === "sip" ? null : current;
    }
    return {
      id: action.id,
      generation: action.generation,
      source: "sip",
      conversation: null,
      showBanner: true,
      playLocalRing: true,
    };
  }
  const conversation = action.conversation;
  if (!conversation) return current?.source === "digital" ? null : current;
  return {
    id: conversation.id,
    generation: action.generation,
    source: "digital",
    conversation,
    showBanner: true,
    playLocalRing: true,
  };
}
