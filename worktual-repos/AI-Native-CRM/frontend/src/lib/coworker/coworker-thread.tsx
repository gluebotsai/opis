import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { CoworkerMessage } from "@/components/coworker/types";
import {
  coworkerThreadStorageKey,
  discardLegacyCoworkerThread,
} from "@/lib/coworker/coworker-client-storage";
import { useAppSelector } from "@/store";

const MAX_MESSAGES = 80;

type CoworkerThreadValue = {
  messages: CoworkerMessage[];
  setMessages: Dispatch<SetStateAction<CoworkerMessage[]>>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
};

const CoworkerThreadContext = createContext<CoworkerThreadValue | null>(null);

function readThread(storageKey: string): { messages: CoworkerMessage[]; input: string } {
  if (typeof sessionStorage === "undefined") {
    return { messages: [], input: "" };
  }
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { messages: [], input: "" };
    const parsed = JSON.parse(raw) as {
      messages?: CoworkerMessage[];
      input?: string;
    };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const input = typeof parsed.input === "string" ? parsed.input : "";
    return { messages: messages.slice(-MAX_MESSAGES), input };
  } catch {
    return { messages: [], input: "" };
  }
}

function CoworkerThreadProviderInner({
  children,
  organizationId,
  userId,
}: {
  children: ReactNode;
  organizationId: string;
  userId: string;
}) {
  const storageKey = coworkerThreadStorageKey(organizationId, userId);

  const [messages, setMessages] = useState<CoworkerMessage[]>(() => {
    discardLegacyCoworkerThread();
    return readThread(storageKey).messages;
  });
  const [input, setInput] = useState(() => readThread(storageKey).input);

  useEffect(() => {
    discardLegacyCoworkerThread();
    const next = readThread(storageKey);
    setMessages(next.messages);
    setInput(next.input);
  }, [storageKey]);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          messages: messages.slice(-MAX_MESSAGES),
          input,
        }),
      );
    } catch {
      /* storage full or private mode — the in-memory thread still lives */
    }
  }, [messages, input, storageKey]);

  const value = useMemo(
    () => ({ messages, setMessages, input, setInput }),
    [messages, input],
  );

  return (
    <CoworkerThreadContext.Provider value={value}>
      {children}
    </CoworkerThreadContext.Provider>
  );
}

/**
 * One coworker transcript per signed-in user in this tab. Module routes swap the
 * workspace; this thread stays mounted above the outlet.
 */
export function CoworkerThreadProvider({ children }: { children: ReactNode }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user) {
    return <>{children}</>;
  }
  return (
    <CoworkerThreadProviderInner
      organizationId={user.organizationId}
      userId={user.id}
    >
      {children}
    </CoworkerThreadProviderInner>
  );
}

export function useCoworkerThread(): CoworkerThreadValue {
  const ctx = useContext(CoworkerThreadContext);
  if (!ctx) {
    throw new Error("useCoworkerThread must be used inside CoworkerThreadProvider");
  }
  return ctx;
}

/** True once the user has spoken, or the agent has replied past the greeting. */
export function threadIsLive(messages: CoworkerMessage[]): boolean {
  return messages.some(
    (m) =>
      (m.role === "user" && !m.hidden) ||
      (m.role === "assistant" && m.id !== "welcome"),
  );
}

/**
 * Show a module greeting only while the thread is still empty.
 * A live conversation is left as-is when the workspace changes.
 */
export function withModuleWelcome(
  prev: CoworkerMessage[],
  welcome: string,
): CoworkerMessage[] {
  if (threadIsLive(prev)) return prev;
  if (
    prev.length === 1 &&
    prev[0]?.id === "welcome" &&
    prev[0].text === welcome
  ) {
    return prev;
  }
  return [{ id: "welcome", role: "assistant", text: welcome }];
}

/** User lines typed after this page mounted. Earlier modules do not mark the draft dirty. */
export function useCoworkerChatDirty(): boolean {
  const { messages } = useCoworkerThread();
  const start = useRef<number | null>(null);
  if (start.current === null) start.current = messages.length;
  return messages
    .slice(start.current)
    .some((m) => m.role === "user" && !m.hidden);
}

export function nextThreadWithUser(
  messages: CoworkerMessage[],
  visible: string,
  id: string,
): CoworkerMessage[] {
  const text = visible.trim();
  if (!text) return messages;
  return [...messages, { id, role: "user", text }];
}
