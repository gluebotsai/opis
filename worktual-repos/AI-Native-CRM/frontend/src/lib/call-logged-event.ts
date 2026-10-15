/**
 * A finished call writes its own activity server-side, so the pages showing
 * that contact have to be told to refetch. Without this they only pick the
 * call log up on the next reload.
 */
export const CALL_LOGGED_EVENT = "worktual:call-logged";

export type CallLoggedDetail = { activityId: string | null };

export function notifyCallLogged(activityId: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CallLoggedDetail>(CALL_LOGGED_EVENT, {
      detail: { activityId },
    }),
  );
}
