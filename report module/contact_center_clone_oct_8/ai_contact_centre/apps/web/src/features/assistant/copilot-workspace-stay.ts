/** Workspace routes where the co-worker must update in place. */
export function isWorkspaceCopilotPath(path: string): boolean {
  const pathname = (path.split("?")[0] ?? "").replace(/\/$/, "");
  return pathname === "/agent/workspace" || pathname === "/admin/workspace"
    || pathname.startsWith("/agent/workspace/")
    || pathname.startsWith("/admin/workspace/");
}

export function workspaceConversationIdFromPath(path: string): string | null {
  if (!isWorkspaceCopilotPath(path)) return null;
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  const id = new URLSearchParams(query).get("conversationId")?.trim();
  return id || null;
}
