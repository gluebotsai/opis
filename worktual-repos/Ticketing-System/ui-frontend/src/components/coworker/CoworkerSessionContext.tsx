import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  reportCoworkerFocus,
  type FocusedEntity,
} from '../../config/coworker';

export type CoworkerMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  confirms?: Array<{
    name: string;
    args: Record<string, unknown>;
    risk?: string;
    auto?: boolean;
  }>;
};

type SendUserTextFn = (text: string) => Promise<void>;

type CoworkerSessionContextValue = {
  sessionId: string;
  messages: CoworkerMessage[];
  greetedPages: string[];
  focusedEntity: FocusedEntity | null;
  setFocusedEntity: (entity: FocusedEntity | null) => void;
  appendMessage: (msg: Omit<CoworkerMessage, 'id'> & { id?: string }) => void;
  setMessages: React.Dispatch<React.SetStateAction<CoworkerMessage[]>>;
  restartSession: (greeting: string, greetedPage?: string | null) => string;
  notePageChange: (pageLabel: string) => void;
  markGreetedPage: (pageLabel: string | null) => void;
  /** Form trash / confirm can inject the same utterance the user would type. */
  sendUserText: (text: string) => Promise<boolean>;
  registerSendUserText: (fn: SendUserTextFn | null) => void;
  /** Survives view remounts (optimistic create-ticket navigate, etc.). */
  turnBusy: boolean;
  thinkingLabel: string;
  setTurnBusy: (busy: boolean) => void;
  setThinkingLabel: (label: string) => void;
  isTurnBusy: () => boolean;
};

const CoworkerSessionContext = createContext<CoworkerSessionContextValue | null>(null);

const STORAGE_PREFIX = 'worktual_coworker_session:';

type StoredSession = {
  sessionId?: string;
  messages?: CoworkerMessage[];
  greetedPages?: string[];
  /** Legacy single-page field — migrated into greetedPages on load. */
  lastGreetedPage?: string | null;
};

function normalizeGreetedPages(
  pages: string[] | null | undefined,
  legacyLast?: string | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null | undefined) => {
    const t = (p || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (Array.isArray(pages)) pages.forEach(add);
  add(legacyLast || null);
  return out;
}

/** Clear stored co-worker chat for one user, or all users if userKey omitted. */
export function clearCoworkerSessionStorage(userKey?: string) {
  try {
    if (userKey) {
      sessionStorage.removeItem(STORAGE_PREFIX + userKey);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function newSessionId(userKey: string) {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `cw_${userKey}_${uuid}`;
}

function loadStored(
  userKey: string
): { sessionId: string; messages: CoworkerMessage[]; greetedPages: string[] } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + userKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.sessionId || !Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({
        id: String(m.id || `${m.role}-${Math.random().toString(36).slice(2, 7)}`),
        role: m.role as 'user' | 'assistant',
        text: String(m.text ?? ''),
      }))
      .filter(
        (m) =>
          !(m.role === 'assistant' && m.text.includes('Continuing this conversation'))
      );
    const onlyFailedGreeting =
      messages.length > 0 &&
      !messages.some((m) => m.role === 'user') &&
      messages.every((m) =>
        /co-worker llm is unavailable|service temporarily unavailable/i.test(m.text)
      );
    if (onlyFailedGreeting) {
      return {
        sessionId: parsed.sessionId,
        messages: [],
        greetedPages: [],
      };
    }
    return {
      sessionId: parsed.sessionId,
      messages,
      greetedPages: normalizeGreetedPages(parsed.greetedPages, parsed.lastGreetedPage),
    };
  } catch {
    return null;
  }
}

function persist(
  userKey: string,
  sessionId: string,
  messages: CoworkerMessage[],
  greetedPages: string[]
) {
  try {
    sessionStorage.setItem(
      STORAGE_PREFIX + userKey,
      JSON.stringify({ sessionId, messages, greetedPages })
    );
  } catch {
    /* ignore quota */
  }
}

type ProviderProps = {
  children: React.ReactNode;
  /** Stable user id (or email) — isolates sessions per customer/agent */
  userKey: string;
};

export function CoworkerSessionProvider({
  children,
  userKey,
}: ProviderProps) {
  const boot = useMemo(() => {
    const stored = loadStored(userKey);
    if (stored && stored.messages.length > 0) return stored;
    return {
      sessionId: newSessionId(userKey),
      messages: [] as CoworkerMessage[],
      greetedPages: [] as string[],
    };
  }, [userKey]);

  const [sessionId, setSessionId] = useState(boot.sessionId);
  const [messages, setMessages] = useState<CoworkerMessage[]>(boot.messages);
  const [greetedPages, setGreetedPages] = useState<string[]>(boot.greetedPages);
  const [focusedEntity, setFocusedEntityState] = useState<FocusedEntity | null>(null);
  const [turnBusy, setTurnBusyState] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState('Thinking…');
  const turnBusyRef = useRef(false);
  const setTurnBusy = useCallback((busy: boolean) => {
    turnBusyRef.current = busy;
    setTurnBusyState(busy);
    if (!busy) setThinkingLabel('Thinking…');
  }, []);
  const isTurnBusy = useCallback(() => turnBusyRef.current, []);
  const sendUserTextRef = useRef<SendUserTextFn | null>(null);
  const registerSendUserText = useCallback((fn: SendUserTextFn | null) => {
    sendUserTextRef.current = fn;
  }, []);
  const sendUserText = useCallback(async (text: string) => {
    const fn = sendUserTextRef.current;
    if (!fn) return false;
    await fn(text);
    return true;
  }, []);

  const setFocusedEntity = useCallback(
    (entity: FocusedEntity | null) => {
      setFocusedEntityState((prev) => {
        const same =
          (prev?.type || '') === (entity?.type || '') &&
          (prev?.id || '') === (entity?.id || '') &&
          (prev?.name || '') === (entity?.name || '');
        if (same) return prev;
        return entity;
      });
    },
    []
  );

  useEffect(() => {
    if (!focusedEntity) return;
    reportCoworkerFocus(sessionId, focusedEntity);
  }, [sessionId, focusedEntity]);

  useEffect(() => {
    persist(userKey, sessionId, messages, greetedPages);
  }, [userKey, sessionId, messages, greetedPages]);

  // When user identity changes (login as different customer), reload their session
  useEffect(() => {
    const stored = loadStored(userKey);
    if (stored && stored.messages.length > 0) {
      setSessionId(stored.sessionId);
      setMessages(stored.messages);
      setGreetedPages(stored.greetedPages);
      return;
    }
    if (stored?.sessionId) {
      setSessionId(stored.sessionId);
    }
    setMessages(stored?.messages || []);
    setGreetedPages(stored?.greetedPages || []);
  }, [userKey]);

  const appendMessage = useCallback(
    (msg: Omit<CoworkerMessage, 'id'> & { id?: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: msg.id || `${msg.role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: msg.role,
          text: msg.text,
        },
      ]);
    },
    []
  );

  const markGreetedPage = useCallback((pageLabel: string | null) => {
    const page = typeof pageLabel === 'string' ? pageLabel.trim() : '';
    if (!page) {
      setGreetedPages([]);
      return;
    }
    setGreetedPages((prev) => (prev.includes(page) ? prev : [...prev, page]));
  }, []);

  const restartSession = useCallback(
    (greeting: string, greetedPage?: string | null) => {
      const sid = newSessionId(userKey);
      const page =
        typeof greetedPage === 'string' && greetedPage.trim() ? greetedPage.trim() : null;
      const pages = page ? [page] : [];
      setSessionId(sid);
      const msgs = greeting.trim()
        ? [{ id: `greet-${Date.now()}`, role: 'assistant' as const, text: greeting }]
        : [];
      setMessages(msgs);
      setGreetedPages(pages);
      setFocusedEntityState(null);
      turnBusyRef.current = false;
      setTurnBusyState(false);
      setThinkingLabel('Thinking…');
      try {
        sessionStorage.setItem(
          STORAGE_PREFIX + userKey,
          JSON.stringify({
            sessionId: sid,
            messages: msgs,
            greetedPages: pages,
          })
        );
      } catch {
        /* ignore */
      }
      return sid;
    },
    [userKey]
  );

  const notePageChange = useCallback((_pageLabel: string) => {
    // Intentionally silent — session history transfers without chat noise.
  }, []);

  const value = useMemo(
    () => ({
      sessionId,
      messages,
      greetedPages,
      focusedEntity,
      setFocusedEntity,
      appendMessage,
      setMessages,
      restartSession,
      notePageChange,
      markGreetedPage,
      sendUserText,
      registerSendUserText,
      turnBusy,
      thinkingLabel,
      setTurnBusy,
      setThinkingLabel,
      isTurnBusy,
    }),
    [
      sessionId,
      messages,
      greetedPages,
      focusedEntity,
      setFocusedEntity,
      appendMessage,
      restartSession,
      notePageChange,
      markGreetedPage,
      sendUserText,
      registerSendUserText,
      turnBusy,
      thinkingLabel,
      setTurnBusy,
      isTurnBusy,
    ]
  );

  return (
    <CoworkerSessionContext.Provider value={value}>{children}</CoworkerSessionContext.Provider>
  );
}

export function useCoworkerSession() {
  const ctx = useContext(CoworkerSessionContext);
  if (!ctx) {
    throw new Error('useCoworkerSession must be used within CoworkerSessionProvider');
  }
  return ctx;
}

/** Optional hook when panel might render outside provider (fallback local). */
export function useCoworkerSessionOptional() {
  return useContext(CoworkerSessionContext);
}

/** Send a chat utterance from a form (delete confirm, etc.). */
export function useCoworkerSendUserText() {
  return useCoworkerSessionOptional()?.sendUserText;
}

export function useReportFocusedEntity(entity: FocusedEntity | null) {
  const session = useCoworkerSessionOptional();
  useLayoutEffect(() => {
    if (!entity?.id && !entity?.name) {
      session?.setFocusedEntity(null);
      return;
    }
    session?.setFocusedEntity(entity);
  }, [session, entity?.type, entity?.id, entity?.name]);
}
