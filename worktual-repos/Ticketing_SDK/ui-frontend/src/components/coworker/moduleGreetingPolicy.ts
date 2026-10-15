/**
 * One initial co-worker greeting for the whole app — not per-module.
 * Pure helpers so refresh/navigation behavior can be unit-tested offline.
 */
export type ModuleGreetingDecision =
  | 'greet'
  | 'skip'
  /** History restored without greeting meta — mark done, do not fetch again. */
  | 'skip_and_mark';

export type GreetingChatMessage = { role: 'user' | 'assistant'; text: string };

/** Prompt for the single session greeting that covers every module. */
export const UNIVERSAL_COWORKER_GREETING_INTENT =
  'Greet as the Worktual co-worker in 1–2 short sentences. ' +
  'Say you can help across tickets, teams, customers, KB, and settings. ' +
  'Ask how you can help.';

/** Last-resort service error after phrase retries — never treat as a real greeting. */
export const LLM_UNAVAILABLE_CHAT =
  'Co-worker LLM is unavailable right now. Try again in a moment.';

/**
 * Deduplicate auto-greeting agent-turns across Strict Mode remounts and
 * pageLabel-driven effect re-runs for the same chat session.
 */
const greetingInflightBySession = new Map<string, Promise<string | null>>();

export function clearSessionGreetingCache(sessionKey: string): void {
  const key = String(sessionKey || '').trim();
  if (key) greetingInflightBySession.delete(key);
}

/**
 * Share one greeting fetch per session id. Callers still decide whether to paint.
 * Failed fetches are cleared so a later retry can run; success is kept for the session.
 */
export function sharedSessionGreeting(
  sessionKey: string,
  fetchGreeting: () => Promise<string | null | undefined>
): Promise<string | null> {
  const key = String(sessionKey || '').trim() || 'local';
  const existing = greetingInflightBySession.get(key);
  if (existing) return existing;

  const pending = (async (): Promise<string | null> => {
    try {
      const text = String((await fetchGreeting()) || '').trim();
      if (!text) {
        greetingInflightBySession.delete(key);
        return null;
      }
      return text;
    } catch {
      greetingInflightBySession.delete(key);
      return null;
    }
  })();

  greetingInflightBySession.set(key, pending);
  return pending;
}

export function isTransientAssistantFailure(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  return (
    t.includes('co-worker llm is unavailable') ||
    t.includes('service temporarily unavailable')
  );
}

/** True when chat is empty or only a failed greeting — fetch a real LLM hello. */
export function shouldRetryGreeting(
  messages: GreetingChatMessage[] | null | undefined
): boolean {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return true;
  if (list.some((m) => m.role === 'user')) return false;
  return list.every(
    (m) => m.role === 'assistant' && isTransientAssistantFailure(m.text)
  );
}

/**
 * Only the empty transcript (or restart) gets a greeting.
 * Module switches reuse that same initial greeting already in the chat — no new intro.
 */
export function decideModuleGreeting(input: {
  messageCount: number;
  hasInitialGreeting?: boolean;
  /** @deprecated — any prior greeted page means the initial greeting already ran */
  greetedPages?: string[] | null;
  lastGreetedPage?: string | null;
  pageLabel?: string;
}): ModuleGreetingDecision {
  if (input.messageCount <= 0) return 'greet';

  const greeted =
    input.hasInitialGreeting === true ||
    (Array.isArray(input.greetedPages) && input.greetedPages.some((p) => !!String(p || '').trim())) ||
    !!(input.lastGreetedPage && String(input.lastGreetedPage).trim());

  if (greeted) return 'skip';

  // Legacy sessionStorage: messages exist but greeting flag missing.
  return 'skip_and_mark';
}

/**
 * If the transcript is only stacked assistant intros (refresh / old per-module bug),
 * keep the latest one. Never drops a turn once the user has spoken.
 */
export function compactStackedAssistantIntros<T extends GreetingChatMessage>(messages: T[]): T[] {
  if (messages.length <= 1) return messages;
  if (messages.some((m) => m.role === 'user')) return messages;
  if (!messages.every((m) => m.role === 'assistant')) return messages;
  return [messages[messages.length - 1]];
}
