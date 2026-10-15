import type { WorkspaceConversation } from "./types";

export function placeLoadedConversation(
  conversations: WorkspaceConversation[],
  loaded: WorkspaceConversation,
): WorkspaceConversation[] {
  const index = conversations.findIndex((item) => item.id === loaded.id);
  if (index === -1) return [loaded, ...conversations];
  const next = conversations.slice();
  next[index] = loaded;
  return next;
}
