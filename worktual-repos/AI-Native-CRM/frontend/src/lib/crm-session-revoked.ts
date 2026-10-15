export const CRM_SESSION_REVOKED_EVENT = "crm-session-revoked";

export function notifyCrmSessionRevoked(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CRM_SESSION_REVOKED_EVENT));
}

export function isSessionRevokedElsewhere(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const code = (payload as { code?: string }).code;
  return code === "session_revoked_elsewhere";
}
