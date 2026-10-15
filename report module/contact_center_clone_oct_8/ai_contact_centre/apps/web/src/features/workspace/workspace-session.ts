import type { WorkspaceInboxTab } from "./types";

const WORKSPACE_TAB_KEY = "cc2-workspace-inbox-tab";
const WORKSPACE_TAB_USER_SET_KEY = "cc2-workspace-inbox-tab-user-set";
const WORKSPACE_SELECTED_ID_KEY = "cc2-workspace-selected-id";

export function readPersistedWorkspaceTab(): WorkspaceInboxTab | null {
  const value = sessionStorage.getItem(WORKSPACE_TAB_KEY);
  if (value === "open" || value === "transferred" || value === "closed") {
    return value;
  }
  return null;
}

export function readPersistedWorkspaceSelection(): string | null {
  const value = sessionStorage.getItem(WORKSPACE_SELECTED_ID_KEY);
  return value && value.length > 0 ? value : null;
}

export function isWorkspaceTabUserSet(): boolean {
  return sessionStorage.getItem(WORKSPACE_TAB_USER_SET_KEY) === "1";
}

export function persistWorkspaceTab(tab: WorkspaceInboxTab, userInitiated = true) {
  sessionStorage.setItem(WORKSPACE_TAB_KEY, tab);
  if (userInitiated) {
    sessionStorage.setItem(WORKSPACE_TAB_USER_SET_KEY, "1");
  }
}

export function persistWorkspaceSelection(conversationId: string) {
  if (conversationId) {
    sessionStorage.setItem(WORKSPACE_SELECTED_ID_KEY, conversationId);
  } else {
    sessionStorage.removeItem(WORKSPACE_SELECTED_ID_KEY);
  }
}
