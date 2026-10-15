/**
 * Panel JWT for Meet / Zoom / Teams iframes (third-party cookies blocked).
 * Stored in sessionStorage; attached as x-meeting-assist-panel-token.
 */

const TOKEN_KEY = "worktual_meeting_assist_panel_token";

export function getMeetingAssistPanelToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setMeetingAssistPanelToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}

export function clearMeetingAssistPanelToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Sync token from ?token= on first load of a panel/host page. */
export function hydrateMeetingAssistPanelTokenFromUrl(
  search: string | URLSearchParams,
): string | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const token = params.get("token")?.trim() || null;
  if (token) setMeetingAssistPanelToken(token);
  return token || getMeetingAssistPanelToken();
}

export function meetingAssistPanelAuthHeaders(): Record<string, string> {
  const token = getMeetingAssistPanelToken();
  if (!token) return {};
  return {
    "x-meeting-assist-panel-token": token,
    "x-meet-addon-token": token,
  };
}
