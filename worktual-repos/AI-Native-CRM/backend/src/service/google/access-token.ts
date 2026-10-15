import {
  isGoogleConfigured,
  refreshGoogleAccessToken,
} from "@/service/google/calendar";
import {
  getCalendarConnection,
  updateCalendarTokens,
} from "@/dao/calendar/token-repository";

/** Fresh Google access token for the user, refreshing when needed. */
export async function getValidGoogleAccessToken(
  userId: string,
): Promise<string | null> {
  const conn = await getCalendarConnection(userId, "google");
  if (!conn) return null;

  const expiresAt = conn.tokenExpiresAt?.getTime() ?? 0;
  const stillValid = expiresAt > Date.now() + 60_000;
  if (stillValid) return conn.accessToken;

  if (!conn.refreshToken) return conn.accessToken;

  const refreshed = await refreshGoogleAccessToken(conn.refreshToken);
  const tokenExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null;
  await updateCalendarTokens(userId, "google", {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? null,
    tokenExpiresAt,
  });
  return refreshed.access_token;
}

export function googleHasGmailSendScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return (
    scope.includes("gmail.send") ||
    scope.includes("gmail.compose") ||
    scope.includes("mail.google.com")
  );
}

export function googleHasGmailReadScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return (
    scope.includes("gmail.readonly") ||
    scope.includes("gmail.modify") ||
    scope.includes("mail.google.com")
  );
}

/** Needed to trash/untrash Gmail messages (e.g. CRM "Delete forever"). */
export function googleHasGmailModifyScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.includes("gmail.modify") || scope.includes("mail.google.com");
}

export function googleHasCalendarScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return (
    scope.includes("calendar.events") ||
    scope.includes("calendar") ||
    scope.includes("calendar.readonly")
  );
}

export function googleHasMeetMediaScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return (
    scope.includes("meetings.conference.media.readonly") ||
    scope.includes("meetings.conference.media.audio.readonly")
  ) && scope.includes("meetings.space.readonly");
}

export { isGoogleConfigured };
