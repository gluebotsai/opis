const VOICE_CALL_SESSION_KEY = "cc2-voice-call-session";

export type PersistedVoiceCallSession = {
  acdSessionId: string | null;
  conversationId: string | null;
  destination: string | null;
};

function isPersistedVoiceCallSession(value: unknown): value is PersistedVoiceCallSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.acdSessionId === null || typeof record.acdSessionId === "string") &&
    (record.conversationId === null || typeof record.conversationId === "string") &&
    (record.destination === null || typeof record.destination === "string")
  );
}

export function readPersistedVoiceCallSession(): PersistedVoiceCallSession | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(VOICE_CALL_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPersistedVoiceCallSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistVoiceCallSession(session: PersistedVoiceCallSession): void {
  if (typeof sessionStorage === "undefined") return;
  if (!session.acdSessionId && !session.conversationId) {
    sessionStorage.removeItem(VOICE_CALL_SESSION_KEY);
    return;
  }
  sessionStorage.setItem(VOICE_CALL_SESSION_KEY, JSON.stringify(session));
}

export function clearPersistedVoiceCallSession(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(VOICE_CALL_SESSION_KEY);
}
