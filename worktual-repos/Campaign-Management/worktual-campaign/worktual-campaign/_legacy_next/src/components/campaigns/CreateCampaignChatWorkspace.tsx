"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  File,
  ImageIcon,
  Mic,
  Plus,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  applyUserPromptToDraft,
  deleteCampaignDraft,
  getCampaignDraft,
  markDraftSaved,
  shouldPromptSaveOnLeave,
  statusLabel,
  upsertCampaignDraft,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";

export function CreateCampaignChatWorkspace({
  draftId,
  listHref = "/campaigns/create",
}: {
  draftId: string;
  listHref?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CampaignChatDraft | null>(null);
  const [input, setInput] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<CampaignChatDraft | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const existing = getCampaignDraft(draftId);
    if (!existing) {
      router.replace(listHref);
      return;
    }
    setDraft(existing);
  }, [draftId, listHref, router]);

  useEffect(() => {
    // Auto-focus typing bar when chat opens
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [draftId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [draft?.messages.length]);

  useEffect(() => {
    if (!attachOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!attachMenuRef.current?.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachOpen]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const persist = useCallback((next: CampaignChatDraft) => {
    upsertCampaignDraft(next);
    setDraft(next);
  }, []);

  const leaveClean = useCallback(
    (href: string) => {
      const current = draftRef.current;
      // Empty chat shells should not remain in the draft list
      if (current && current.messages.length === 0) {
        deleteCampaignDraft(current.id);
      }
      router.push(href);
    },
    [router],
  );

  const requestLeave = useCallback(
    (href: string) => {
      const current = draftRef.current;
      if (!current || !shouldPromptSaveOnLeave(current)) {
        leaveClean(href);
        return;
      }
      setPendingHref(href);
      setLeaveOpen(true);
    },
    [leaveClean],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const current = draftRef.current;
      if (current && shouldPromptSaveOnLeave(current)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      if (
        href === `/marketing/create/${draftId}` ||
        href === `/campaigns/create/${draftId}`
      ) {
        return;
      }
      const current = draftRef.current;
      if (!current || !shouldPromptSaveOnLeave(current)) {
        if (current && current.messages.length === 0) {
          e.preventDefault();
          e.stopPropagation();
          leaveClean(href);
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
      setLeaveOpen(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [draftId, leaveClean]);

  const handleSend = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft || !input.trim()) return;
    const next = applyUserPromptToDraft(draft, input.trim());
    persist(next);
    setInput("");
    inputRef.current?.focus();
  };

  const saveDraft = () => {
    if (!draft) return;
    if (draft.messages.length === 0) {
      showToast("Send a message before saving");
      return;
    }
    const next = markDraftSaved(draft);
    persist(next);
    showToast("Saved as draft");
    return next;
  };

  const confirmSaveAndLeave = () => {
    saveDraft();
    const href = pendingHref ?? listHref;
    setLeaveOpen(false);
    setPendingHref(null);
    router.push(href);
  };

  const discardAndLeave = () => {
    const current = draftRef.current;
    if (current) {
      // Leave without saving = remove this draft completely
      deleteCampaignDraft(current.id);
    }
    const href = pendingHref ?? listHref;
    setLeaveOpen(false);
    setPendingHref(null);
    router.push(href);
  };

  const onPickImage = () => {
    setAttachOpen(false);
    imageRef.current?.click();
  };

  const onPickFile = () => {
    setAttachOpen(false);
    fileRef.current?.click();
  };

  const onMic = async () => {
    setAttachOpen(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      showToast("Mic ready — voice capture coming next");
    } catch {
      showToast("Microphone permission needed");
    }
    inputRef.current?.focus();
  };

  const onFilesSelected = (files: FileList | null, kind: "image" | "file") => {
    if (!files?.length) return;
    const names = Array.from(files)
      .map((f) => f.name)
      .join(", ");
    showToast(
      kind === "image"
        ? `Image selected: ${names}`
        : `File selected: ${names}`,
    );
    inputRef.current?.focus();
  };

  if (!draft) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-sm text-text-caption">
        Loading chat…
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-subtle">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => requestLeave(listHref)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-icon-on-light hover:bg-state-hover"
            aria-label="Back to drafts"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {draft.name}
            </p>
            <p className="truncate text-xs text-text-caption">
              {statusLabel(draft.status)}
              {draft.channels.length > 0
                ? ` · ${draft.channels.join(", ")}`
                : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-9 px-3"
          onClick={() => saveDraft()}
          disabled={draft.messages.length === 0}
        >
          Save draft
        </Button>
      </header>

      {toast ? (
        <p
          className="border-b border-border-default bg-violet-0 px-4 py-2 text-sm text-violet-700"
          role="status"
        >
          {toast}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {draft.messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-text-primary">
                Start the conversation
              </p>
              <p className="mt-1 text-sm text-text-caption">
                Describe channels, audience, and timing. Empty chats are not
                saved to drafts.
              </p>
            </div>
          ) : (
            draft.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${
                    msg.role === "user"
                      ? "bg-brand text-text-on-dark"
                      : "border border-border-default bg-surface text-text-secondary"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className="shrink-0 border-t border-border-default bg-surface px-3 py-3 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="relative" ref={attachMenuRef}>
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-border-default text-icon-on-light hover:bg-subtle"
              aria-label="Add attachment"
              aria-expanded={attachOpen}
            >
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
            {attachOpen ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg">
                <button
                  type="button"
                  onClick={onPickImage}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <ImageIcon className="size-4" strokeWidth={1.75} />
                  Upload image
                </button>
                <button
                  type="button"
                  onClick={onPickFile}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <File className="size-4" strokeWidth={1.75} />
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => void onMic()}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <Mic className="size-4" strokeWidth={1.75} />
                  Voice (mic)
                </button>
              </div>
            ) : null}
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "image");
                e.target.value = "";
              }}
            />
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "file");
                e.target.value = "";
              }}
            />
          </div>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder="Create campaign"
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-placeholder focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            type="submit"
            variant="brand"
            className="h-auto shrink-0 self-end px-4"
            disabled={!input.trim()}
          >
            <Send className="size-4" strokeWidth={2} />
            Send
          </Button>
        </div>
      </form>

      {leaveOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-draft-title"
            className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-6 shadow-xl"
          >
            <h2
              id="save-draft-title"
              className="text-lg font-semibold text-text-primary"
            >
              Save this as a draft?
            </h2>
            <p className="mt-2 text-sm text-text-caption">
              You left mid-conversation. Save to resume later, or leave without
              saving to delete this draft.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLeaveOpen(false);
                  setPendingHref(null);
                }}
              >
                Keep chatting
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={discardAndLeave}
              >
                Leave without saving
              </Button>
              <Button
                type="button"
                variant="brand"
                onClick={confirmSaveAndLeave}
              >
                Save draft
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
