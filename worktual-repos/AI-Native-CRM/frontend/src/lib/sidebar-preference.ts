const SIDEBAR_COLLAPSED_KEY = "worktual.sidebar.collapsed";

export function readSidebarCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // Ignore quota and privacy-mode failures.
  }
}
