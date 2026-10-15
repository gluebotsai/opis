import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, UserPlus, X } from "lucide-react";
import axios from "axios";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { Button } from "@/components/ui/Button";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { CreateContactChatSkeleton } from "@/components/contacts/CreateContactChatSkeleton";
import { createContact } from "@/services/contacts.service";
import {
  applyUserPromptToContactDraft,
  deleteContactDraft,
  getContactDraft,
  isContactDraftReady,
  upsertContactDraft,
  wantsCreateIntent,
  type ContactChatDraft,
} from "@/lib/contact-chat-drafts";

export function CreateContactChatWorkspace({
  draftId,
  listHref = "/audience",
}: {
  draftId: string;
  listHref?: string;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ContactChatDraft | null>(null);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toastTimerRef = useRef<number | null>(null);

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
    const existing = getContactDraft(draftId);
    if (!existing) {
      navigate(listHref, { replace: true });
      return;
    }
    setDraft(existing);
  }, [draftId, listHref, navigate]);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [draftId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [draft?.messages.length]);

  const persist = useCallback((next: ContactChatDraft) => {
    upsertContactDraft(next);
    setDraft(next);
  }, []);

  const submitContact = useCallback(
    async (current: ContactChatDraft) => {
      if (!isContactDraftReady(current.fields)) {
        showToast("First name and an email or phone are required.");
        return;
      }
      if (current.createdContactId) {
        showToast("This contact was already created.");
        return;
      }

      setCreating(true);
      try {
        const result = await createContact({
          firstName: current.fields.firstName.trim(),
          lastName: current.fields.lastName.trim() || undefined,
          email: current.fields.email.trim() || undefined,
          phone: current.fields.phone.trim() || undefined,
          companyName: current.fields.companyName.trim() || undefined,
        });
        const next: ContactChatDraft = {
          ...current,
          createdContactId: result.contact.id,
          dirty: false,
          updatedAt: new Date().toISOString(),
          messages: [
            ...current.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: `${result.message}\nSaved to audience. You can go back to Audience.`,
              createdAt: new Date().toISOString(),
            },
          ],
        };
        persist(next);
        showToast(result.message || "Contact insert successfully");
        window.setTimeout(() => {
          deleteContactDraft(current.id);
          navigate(listHref);
        }, 1200);
      } catch (err) {
        const msg = axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string })?.message ??
            "Failed to create contact.")
          : "Failed to create contact.";
        showToast(msg);
      } finally {
        setCreating(false);
      }
    },
    [listHref, navigate, persist, showToast],
  );

  const handleSend = async () => {
    if (!draft || !input.trim() || creating) return;
    const text = input.trim();
    const next = applyUserPromptToContactDraft(draft, text);
    persist(next);
    setInput("");
    inputRef.current?.focus();

    if (wantsCreateIntent(text) && isContactDraftReady(next.fields)) {
      await submitContact(next);
    }
  };

  if (!draft) {
    return <CreateContactChatSkeleton />;
  }

  const ready = isContactDraftReady(draft.fields);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-subtle">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-icon-on-light hover:bg-state-hover"
            onClick={() => navigate(listHref)}
            aria-label="Back to contacts"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text-primary">
              {draft.title}
            </p>
            <p className="truncate text-xs text-text-caption">
              Chat-based contact create
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="brand"
          className="h-9 shrink-0 px-3"
          disabled={!ready || creating || Boolean(draft.createdContactId)}
          onClick={() => void submitContact(draft)}
        >
          <UserPlus className="size-4" strokeWidth={1.75} />
          {creating ? "Creating…" : "Create contact"}
        </Button>
      </header>

      {toast ? (
        <div
          className="fixed top-4 right-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-white shadow-lg"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Success</p>
            <p className="mt-0.5 text-sm text-neutral-300">{toast}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}

      <div className="border-b border-border-default bg-surface px-4 py-3 sm:px-6">
        <div className="mx-auto grid max-w-3xl gap-2 rounded-xl border border-border-default bg-subtle p-3 text-xs sm:grid-cols-2">
          <p>
            <span className="text-text-caption">Name: </span>
            <span className="font-medium text-text-primary">
              {[draft.fields.firstName, draft.fields.lastName]
                .filter(Boolean)
                .join(" ") || "—"}
            </span>
            {!draft.fields.firstName ? (
              <span className="ml-1 text-text-danger">*</span>
            ) : null}
          </p>
          <p>
            <span className="text-text-caption">Email: </span>
            <span className="font-medium text-text-primary">
              {draft.fields.email || "—"}
            </span>
            {!draft.fields.email ? (
              <span className="ml-1 text-text-danger">*</span>
            ) : null}
          </p>
          <p>
            <span className="text-text-caption">Phone: </span>
            <span className="font-medium text-text-primary">
              {draft.fields.phone || "—"}
            </span>
          </p>
          <p>
            <span className="text-text-caption">Company: </span>
            <span className="font-medium text-text-primary">
              {draft.fields.companyName || "—"}
            </span>
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="dashboard-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {draft.messages.map((msg) => (
            <div
              key={msg.id}
              className={
                msg.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div className={chatBubbleClass(msg.role)}>
                {msg.role === "user" ? (
                  msg.text
                ) : (
                  <ChatBubbleText text={msg.text} role={msg.role} />
                )}
              </div>
            </div>
          ))}
          {creating ? <AgentThinkingIndicator label="Creating contact…" /> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] bg-white px-4 py-2.5">
        <AgentChatComposer
          value={input}
          onChange={setInput}
          onSend={() => void handleSend()}
          busy={creating}
          inputRef={inputRef}
          placeholder="Describe the contact…"
          busyPlaceholder="Creating contact…"
          className="w-full"
          maxWidthClass=""
        />
      </div>
    </div>
  );
}
