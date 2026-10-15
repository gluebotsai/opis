import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Mail,
  MessageSquarePlus,
  Phone,
  X,
} from "lucide-react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { getCampaignProfile } from "@/lib/industry-packs";
import { contactsWelcomeMessage } from "@/lib/module-welcomes";
import { getToken } from "@/services/api";
import {
  getAgentsSocket,
  type CampaignAgentState,
  type ContactCandidate,
  type ContactDraftFields,
} from "@/services/agents.socket";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type ContactChatLocationState = {
  initialMessage?: string;
  focusContactId?: string;
  focusContactName?: string;
  focusContactEmail?: string;
  listHref?: string;
  skipWelcome?: boolean;
};

function toLocalMessages(
  rows: Array<{
    id?: string;
    role?: string;
    text?: string;
    created_at?: string;
    createdAt?: string;
  }>,
): ChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role as "user" | "assistant",
      text: m.text || "",
      createdAt: m.createdAt || m.created_at || new Date().toISOString(),
    }));
}

function candidateLabel(c: ContactCandidate) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || c.phone || c.id || "Contact";
}

const EMPTY_DRAFT: ContactDraftFields = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  company_name: "",
  city: "",
  app_push_token: "",
  app_push_platform: "",
  app_push_asked: "",
  web_push_endpoint: "",
  web_push_p256dh: "",
  web_push_auth: "",
  web_push_asked: "",
};

/** Randomized opener — agent skips remote welcome. */
function contactsStaticWelcomeMessage(): ChatMessage {
  return {
    ...contactsWelcomeMessage(false),
    createdAt: new Date().toISOString(),
  };
}

export function ContactChatWorkspace({
  sessionId,
  listHref = "/audience",
  focusContactId: focusProp,
  initialMessage: initialProp,
}: {
  sessionId: string;
  listHref?: string;
  focusContactId?: string;
  initialMessage?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state || {}) as ContactChatLocationState;
  const focusContactId = focusProp || navState.focusContactId;
  const initialMessage = (initialProp || navState.initialMessage || "").trim();
  // Always skip remote welcome — FE seeds a static opener (or a seeded user ask).
  const skipWelcome = true;
  const backHref = navState.listHref || listHref;
  const seededName = (navState.focusContactName || "").trim();
  const seededEmail = (navState.focusContactEmail || "").trim();

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessage ? [] : [contactsStaticWelcomeMessage()],
  );
  const [input, setInput] = useState("");
  const [agentState, setAgentState] = useState<CampaignAgentState | null>(null);
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const mutationNotifyRef = useRef(false);
  const mismatchRoutedRef = useRef(false);
  const lastCreatedIdRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing, sending]);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [sessionId]);

  const draft = agentState?.draft_contact || EMPTY_DRAFT;
  const candidates = agentState?.candidates || [];
  const focused = Boolean(focusContactId || agentState?.focus_contact_id);

  const headerName = useMemo(() => {
    const fromDraft = [draft.first_name, draft.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    return fromDraft || seededName || "";
  }, [draft.first_name, draft.last_name, seededName]);

  const headerEmail = useMemo(() => {
    return (draft.email || seededEmail || "").trim();
  }, [draft.email, seededEmail]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for Contact chat.");
      return;
    }

    const socket = getAgentsSocket();
    setSocketError(null);
    setReady(false);
    mismatchRoutedRef.current = false;

    if (initialMessage) {
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "user",
          text: initialMessage,
          createdAt: new Date().toISOString(),
        },
      ]);
      setSending(true);
    } else {
      setMessages([contactsStaticWelcomeMessage()]);
    }

    const onReady = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
      messages?: Array<{
        id?: string;
        role?: string;
        text?: string;
        created_at?: string;
      }>;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setAgentState(payload.state || null);
      const serverMsgs = toLocalMessages(payload.messages || []);
      if (serverMsgs.length) {
        setMessages(serverMsgs);
      } else if (!initialMessage) {
        setMessages([contactsStaticWelcomeMessage()]);
      }
      setReady(true);
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      const text = payload.text || "";
      if (!text) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.text === text) return prev;
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text,
            createdAt: new Date().toISOString(),
          },
        ];
      });
      setSending(false);
    };

    const onState = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      if (payload.state) setAgentState(payload.state);
    };

    const onUi = (payload: {
      session_id?: string;
      type?: string;
      payload?: {
        contact?: ContactCandidate;
        contact_id?: string;
        draft_contact?: ContactDraftFields;
        focus_contact_id?: string | null;
        candidates?: ContactCandidate[];
        user_query?: string;
        email?: string;
        phone?: string;
        clear_draft?: boolean;
        already_exists?: boolean;
      };
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      const type = payload.type;

      if (type === "contact_mismatch") {
        setAgentState((prev) =>
          prev
            ? {
                ...prev,
                focus_contact_id: null,
                draft_contact: EMPTY_DRAFT,
                candidates: [],
              }
            : prev,
        );
        if (!mismatchRoutedRef.current) {
          mismatchRoutedRef.current = true;
          const q =
            payload.payload?.user_query?.trim() ||
            [
              payload.payload?.email
                ? `email ${payload.payload.email}`
                : null,
              payload.payload?.phone
                ? `phone ${payload.payload.phone}`
                : null,
            ]
              .filter(Boolean)
              .join(", ") ||
            initialMessage ||
            "Continue with this contact";
          const nextId = crypto.randomUUID();
          navigate(`/audience/chat/${nextId}`, {
            replace: true,
            state: {
              initialMessage: q,
              skipWelcome: true,
              listHref: backHref,
            },
          });
        }
        return;
      }

      if (type === "draft_updated" && payload.payload) {
        setAgentState((prev) =>
          prev
            ? {
                ...prev,
                draft_contact:
                  payload.payload?.draft_contact || prev.draft_contact,
                focus_contact_id:
                  payload.payload?.focus_contact_id ?? prev.focus_contact_id,
                candidates: payload.payload?.candidates ?? prev.candidates,
              }
            : prev,
        );
        if (payload.payload?.already_exists) {
          showToast("Contact already exists");
        }
      }
      if (type === "contact_candidates" && payload.payload?.candidates) {
        const p = payload.payload;
        const duringCreate = Boolean(p.duplicate_during_create || p.mode === "create");
        setAgentState((prev) =>
          prev
            ? {
                ...prev,
                candidates: p.candidates || [],
                draft_contact:
                  p.draft_contact ??
                  (duringCreate
                    ? prev.draft_contact
                    : p.candidates && p.candidates.length !== 1
                      ? EMPTY_DRAFT
                      : prev.draft_contact),
                focus_contact_id:
                  duringCreate
                    ? null
                    : p.focus_contact_id !== undefined
                      ? p.focus_contact_id
                      : p.candidates && p.candidates.length !== 1
                        ? null
                        : prev.focus_contact_id,
              }
            : prev,
        );
      }
      if (type === "contact_created") {
        const createdId =
          payload.payload?.contact?.id || payload.payload?.contact_id;
        if (createdId && lastCreatedIdRef.current === createdId) {
          return;
        }
        if (createdId) lastCreatedIdRef.current = createdId;
        mutationNotifyRef.current = true;
        showToast("Contact created");
      }
      if (type === "contact_updated") {
        mutationNotifyRef.current = true;
        showToast("Contact updated");
        if (payload.payload?.contact) {
          setAgentState((prev) =>
            prev
              ? {
                  ...prev,
                  focus_contact_id: payload.payload?.contact?.id || null,
                  draft_contact: {
                    first_name: payload.payload?.contact?.first_name || "",
                    last_name: payload.payload?.contact?.last_name || "",
                    email: payload.payload?.contact?.email || "",
                    phone: payload.payload?.contact?.phone || "",
                    company_name: payload.payload?.contact?.company_name || "",
                    city: payload.payload?.contact?.city || "",
                  },
                }
              : prev,
          );
        }
      }
      if (type === "contact_deleted") {
        mutationNotifyRef.current = true;
        showToast("Contact deleted");
      }
    };

    const onTyping = (payload: {
      session_id?: string;
      typing?: boolean;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) setSending(false);
    };

    const onError = (payload: { message?: string }) => {
      setSocketError(payload.message || "Contact agent error");
      setSending(false);
      setTyping(false);
    };

    const onStopped = (payload: { session_id?: string }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      setTyping(false);
      setSending(false);
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("state_update", onState);
    socket.on("ui_event", onUi);
    socket.on("agent_typing", onTyping);
    socket.on("generation_stopped", onStopped);
    socket.on("error", onError);

    socket.emit("join_session", {
      session_id: sessionId,
      token,
      module: "contacts",
      focus_contact_id: focusContactId || undefined,
      skip_welcome: skipWelcome,
      seed_user_message: initialMessage || undefined,
      campaign_profile: getCampaignProfile(),
    });

    return () => {
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("state_update", onState);
      socket.off("ui_event", onUi);
      socket.off("agent_typing", onTyping);
      socket.off("generation_stopped", onStopped);
      socket.off("error", onError);
      socket.emit("leave_session", {
        session_id: sessionId,
        token,
        module: "contacts",
      });
    };
  }, [
    sessionId,
    focusContactId,
    initialMessage,
    skipWelcome,
    showToast,
    navigate,
    backHref,
  ]);

  const send = (text: string) => {
    const token = getToken();
    // Allow composing while busy; block only another send until current turn finishes.
    if (!token || !text.trim() || sending || typing) return;
    const trimmed = text.trim();
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setSending(true);
    getAgentsSocket().emit("user_message", {
      session_id: sessionId,
      token,
      module: "contacts",
      text: trimmed,
    });
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", { session_id: sessionId });
    setTyping(false);
    setSending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const goBack = () => {
    navigate(backHref, {
      replace: false,
      state: mutationNotifyRef.current ? { contactsRefresh: true } : undefined,
    });
  };

  const restartChat = () => {
    const token = getToken();
    if (!token) return;
    getAgentsSocket().emit("stop_generation", { session_id: sessionId });
    getAgentsSocket().emit("leave_session", {
      session_id: sessionId,
      token,
      module: "contacts",
    });
    const nextId = crypto.randomUUID();
    navigate(`/audience/chat/${nextId}`, {
      replace: true,
      state: {
        listHref: backHref,
        skipWelcome: false,
      },
    });
  };

  const busy = typing || sending;

  const toolbar = (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex size-9 items-center justify-center rounded-lg text-icon-on-light hover:bg-state-hover"
            aria-label="Back"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {headerName && headerEmail
                ? `Contact chat ${headerName} (${headerEmail})`
                : headerName
                  ? `Contact chat ${headerName}`
                  : headerEmail
                    ? `Contact chat (${headerEmail})`
                    : "Contact chat"}
            </p>
            <p className="truncate text-xs text-text-caption">
              {focused
                ? "Edit this contact or look up another"
                : "Ask — look up, create, or update contacts"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={restartChat}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-hover"
          aria-label="New chat"
          title="New chat"
        >
          <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
          New chat
        </button>
      </header>

      {socketError ? (
        <p className="mt-2 rounded-xl border border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}
    </>
  );

  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="dashboard-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div className={chatBubbleClass(m.role)}>
                {m.text}
              </div>
            </div>
          ))}
          {busy ? <AgentThinkingIndicator /> : null}
          <div ref={bottomRef} />
      </div>
    </div>
  );

  const chatFooter = (
      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        busy={busy}
        onStop={stopGeneration}
        inputRef={inputRef}
        placeholder="Ask your question"
        className="w-full"
        maxWidthClass=""
      />
  );

  const overviewRows = (
    [
      ["First name", draft.first_name],
      ["Last name", draft.last_name],
      ["Email", draft.email],
      ["Phone", draft.phone],
      ["Company", draft.company_name],
      ["City", draft.city],
    ] as const
  ).filter(([, value]) => Boolean(String(value || "").trim()));

  const overviewStatus = !String(draft.first_name || "").trim()
    ? "Need a first name."
    : !(draft.email || "").trim() && !(draft.phone || "").trim()
      ? "Need an email or a phone with country code."
      : "Ready — confirm in chat when you want to save.";

  const overviewPane = (
    <div className="p-5 text-sm">
      <p className="mb-4 text-xs leading-relaxed text-text-caption">
        {overviewStatus}
      </p>
      <dl className="space-y-4">
        {overviewRows.length ? (
          overviewRows.map(([label, value]) => {
            const FieldIcon =
              label === "Email" ? Mail : label === "Phone" ? Phone : null;
            return (
              <div key={label}>
                <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-caption">
                  {FieldIcon ? (
                    <FieldIcon
                      className="size-3.5 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ) : null}
                  {label}
                </dt>
                <dd className="mt-1 text-sm font-medium text-text-primary">
                  {value?.trim()}
                </dd>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-text-caption">No contact fields filled yet.</p>
        )}
      </dl>

      {candidates.length > 0 ? (
        <div className="mt-6">
          <p className="text-xs font-semibold tracking-wide text-text-caption uppercase">
            Matches
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((c, idx) => (
              <li
                key={c.id || `${idx}`}
                className="rounded-lg border border-border-default px-3 py-2 text-sm"
              >
                <p className="font-medium text-text-primary">
                  {idx + 1}. {candidateLabel(c)}
                </p>
                <p className="mt-0.5 text-xs text-text-caption">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <ModuleSplitWorkspace
        toolbar={toolbar}
        leftTitle="Your Worktual co-worker"
        rightTitle="Contact overview"
        left={chatPane}
        leftFooter={chatFooter}
        right={overviewPane}
      />

      {toast ? (
        <div
          className="fixed top-4 right-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-white shadow-lg"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Success</p>
            <p className="mt-0.5 text-sm text-neutral-300">{toast}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
