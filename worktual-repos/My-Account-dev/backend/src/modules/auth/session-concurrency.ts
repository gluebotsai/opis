/** Shared concurrent-session guard for all login surfaces. */
export const SESSION_ALREADY_ACTIVE_CODE = "session_already_active";

export const SESSION_ALREADY_ACTIVE_MESSAGE =
  "This account is already logged in on another device. Sign out there, wait for idle timeout, or ask an admin to Force logout.";

export function createSessionAlreadyActiveError() {
  const error = new Error(SESSION_ALREADY_ACTIVE_MESSAGE);
  (error as any).code = SESSION_ALREADY_ACTIVE_CODE;
  return error;
}

export function isSessionAlreadyActiveError(error: any) {
  return Boolean(error && error.code === SESSION_ALREADY_ACTIVE_CODE);
}
