import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Expand,
  File,
  ImageIcon,
  Mic,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CoworkerChatFab } from "@/components/coworker/CoworkerChatFab";
import { CoworkerChatShell } from "@/components/coworker/CoworkerChatShell";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";
import { CoworkerWorkspace } from "@/components/coworker/CoworkerWorkspace";
import { CoworkerDraftPanel } from "@/components/coworker/CoworkerCreateShell";
import type {
  CoworkerMessage,
  PanelExpand,
} from "@/components/coworker/types";
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
  listHref = "/marketing/create",
}: {
  draftId: string;
  listHref?: string;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<CampaignChatDraft | null>(null);
  const [input, setInput] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [expand, setExpand] = useState<PanelExpand>("default");
  const [mobileTab, setMobileTab] = useState<"chat" | "draft">("chat");
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<CampaignChatDraft | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const existing = getCampaignDraft(draftId);
    if (!existing) {
      navigate(listHref);
      return;
    }
    setDraft(existing);
  }, [draftId, listHref, navigate]);

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
      if (current && current.messages.length === 0) {
        deleteCampaignDraft(current.id);
      }
      navigate(href);
    },
    [navigate],
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

  const handleSend = () => {
    if (!draft || !input.trim()) return;
    const next = applyUserPromptToDraft(draft, input.trim());
    persist(next);
    setInput("");
    setMobileTab("draft");
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
    navigate(href);
  };

  const discardAndLeave = () => {
    const current = draftRef.current;
    if (current) deleteCampaignDraft(current.id);
    const href = pendingHref ?? listHref;
    setLeaveOpen(false);
    setPendingHref(null);
    navigate(href);
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
  };
  const onFilesSelected = (files: FileList | null, kind: "image" | "file") => {
    if (!files?.length) return;
    const names = Array.from(files)
      .map((f) => f.name)
      .join(", ");
    showToast(
      kind === "image" ? `Image selected: ${names}` : `File selected: ${names}`,
    );
  };

  const coworkerMessages: CoworkerMessage[] = useMemo(() => {
    if (!draft) return [];
    if (draft.messages.length === 0) {
      return [
        {
          id: "welcome",
          role: "assistant",
          text: "I'm your **Worktual co-worker**. On **Campaigns**, describe audience, channels, and timing — the draft summary stays on the right.",
        },
      ];
    }
    return draft.messages.map((m) => ({
      id: m.id,
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      text: m.text,
    }));
  }, [draft]);

  if (!draft) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-sm text-text-caption">
        Loading chat…
      </div>
    );
  }

  const readyBits = [
    draft.messages.length > 0,
    draft.channels.length > 0,
    Boolean(draft.name?.trim()),
  ];
  const filled = readyBits.filter(Boolean).length;

  const toggleExpand = (side: "chat" | "draft") => {
    setExpand((prev) => {
      if (side === "chat") return prev === "chat" ? "default" : "chat";
      return prev === "draft" ? "default" : "draft";
    });
    if (side === "draft") {
      setMobileTab((tab) => (expand === "draft" ? tab : "draft"));
    }
  };
  const pageFull = expand === "draft";

  const draftPanel = (
    <CoworkerDraftPanel
      title="Campaign draft"
      progressLabel={`${filled}/3 ready`}
      progressRatio={filled / 3}
      footer={
        <>
          <Button
            type="button"
            variant="primary"
            disabled={draft.messages.length === 0}
            onClick={() => saveDraft()}
          >
            Save draft
          </Button>
          <div className="relative" ref={attachMenuRef}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAttachOpen((v) => !v)}
            >
              <Plus className="size-4" />
              Attach
            </Button>
            {attachOpen ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg">
                <button
                  type="button"
                  onClick={onPickImage}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-subtle"
                >
                  <ImageIcon className="size-4" /> Upload image
                </button>
                <button
                  type="button"
                  onClick={onPickFile}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-subtle"
                >
                  <File className="size-4" /> Upload file
                </button>
                <button
                  type="button"
                  onClick={() => void onMic()}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-subtle"
                >
                  <Mic className="size-4" /> Voice (mic)
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
        </>
      }
    >
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-caption">
          Name
        </p>
        <p className="mt-1 text-sm font-medium text-text-primary">
          {draft.name || "Untitled campaign"}
        </p>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-caption">
          Status
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {statusLabel(draft.status)}
        </p>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-caption">
          Channels
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {draft.channels.length ? draft.channels.join(", ") : "None yet"}
        </p>
      </div>
      {draft.flowSteps?.length ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-caption">
            Flow
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-text-secondary">
            {draft.flowSteps.slice(0, 6).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </CoworkerDraftPanel>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-subtle">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border-default/80 px-3 sm:px-5">
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
              {draft.name || "New campaign"}
            </p>
            <p className="truncate text-xs text-text-caption">
              Co-worker + campaign draft
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

      <div
        className={
          pageFull
            ? "min-h-0 flex-1 p-0"
            : "min-h-0 flex-1 p-3 sm:p-4 lg:p-5"
        }
      >
        <CoworkerWorkspace
          expand={expand}
          balance="agent"
          mobileTab={mobileTab}
          onMobileTab={setMobileTab}
          draftTabLabel="Workspace"
          workspaceFullCollapse
          collapsedChat={
            <CoworkerChatFab
              onExpand={() => {
                setExpand("default");
                setMobileTab("chat");
              }}
            />
          }
          chat={
            <div className="h-full w-full min-h-0">
              <CoworkerChatShell
                title="co-worker"
                messages={coworkerMessages}
                input={input}
                onInputChange={setInput}
                onSend={handleSend}
                onExpand={() => toggleExpand("chat")}
                expanded={expand === "chat"}
                expandLabel={
                  expand === "chat" ? "Restore layout" : "Expand chat"
                }
                widePanel={expand === "chat"}
                onMinimize={() => {
                  setExpand("draft");
                  setMobileTab("draft");
                }}
                placeholder="e.g. Email nurture for new leads over 2 weeks"
                footerHint="Enter to send · Shift+Enter for a new line. Save draft when ready."
              />
            </div>
          }
          draft={
            pageFull ? (
              <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
                <div className="scrollbar-hover min-h-0 flex-1 overflow-auto">
                  {draftPanel}
                </div>
              </div>
            ) : (
              <div className="relative h-full min-h-0 w-full">
                <button
                  type="button"
                  onClick={() => toggleExpand("draft")}
                  className="absolute right-3 top-3 z-10 hidden size-8 items-center justify-center rounded-lg border border-border-default bg-surface text-icon-on-light hover:bg-state-hover lg:inline-flex"
                  aria-label="Expand workspace"
                  title="Expand workspace"
                >
                  <Expand className="size-3.5" strokeWidth={1.75} />
                </button>
                <div className={COWORKER_WORKSPACE_SCROLL}>{draftPanel}</div>
              </div>
            )
          }
        />
      </div>

      {leaveOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
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
              <Button type="button" variant="secondary" onClick={discardAndLeave}>
                Leave without saving
              </Button>
              <Button type="button" variant="primary" onClick={confirmSaveAndLeave}>
                Save draft
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
