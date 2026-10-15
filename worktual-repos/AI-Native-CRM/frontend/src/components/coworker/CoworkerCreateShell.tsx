import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Expand, Sparkles } from "lucide-react";
import { CoworkerChatFab } from "@/components/coworker/CoworkerChatFab";
import { CoworkerChatShell } from "@/components/coworker/CoworkerChatShell";
import {
  COWORKER_ICON_BTN_CLASS,
  COWORKER_WORKSPACE_SCROLL,
} from "@/components/coworker/coworker-layout";
import { CoworkerWorkspace } from "@/components/coworker/CoworkerWorkspace";
import type {
  CoworkerMessage,
  PanelExpand,
} from "@/components/coworker/types";
import { Button } from "@/components/ui/Button";

/**
 * Shared chrome for module create hybrid pages (Sales pattern).
 */
export function CoworkerCreateShell({
  title,
  subtitle = "Co-worker + live draft",
  backHref,
  formOnly,
  hybridHref,
  quickFormHref,
  welcomeLoading,
  emptyState,
  messages,
  input,
  onInputChange,
  onSend,
  onRestart,
  sending,
  draftPanel,
  dirty,
  composerPlaceholder,
  footerHint,
}: {
  title: string;
  subtitle?: string;
  backHref: string;
  formOnly: boolean;
  hybridHref: string;
  quickFormHref: string;
  welcomeLoading?: boolean;
  emptyState?: ReactNode;
  messages: CoworkerMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onRestart: () => void;
  sending: boolean;
  draftPanel: ReactNode;
  dirty: boolean;
  composerPlaceholder?: string;
  footerHint?: string;
}) {
  const navigate = useNavigate();
  const [expand, setExpand] = useState<PanelExpand>("default");
  const [mobileTab, setMobileTab] = useState<"chat" | "draft">("chat");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const requestLeave = (href: string) => {
    if (!dirty) {
      navigate(href);
      return;
    }
    setPendingHref(href);
    setLeaveOpen(true);
  };

  const toggleExpand = (side: "chat" | "draft") => {
    setExpand((prev) => {
      if (side === "chat") return prev === "chat" ? "default" : "chat";
      return prev === "draft" ? "default" : "draft";
    });
    if (side === "draft") {
      setMobileTab((tab) => (expand === "draft" ? tab : "draft"));
    }
  };

  const chatExpandLabel =
    expand === "chat" ? "Restore layout" : "Expand chat";
  const draftExpandLabel =
    expand === "draft" ? "Restore chat" : "Expand workspace";
  const pageFull = expand === "draft";

  if (welcomeLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-text-caption">
        Loading co-worker…
      </div>
    );
  }

  if (emptyState) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">{emptyState}</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f3f4f6]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-neutral-200/80 bg-[#f3f4f6] px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => requestLeave(backHref)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-neutral-800 hover:bg-neutral-100"
            aria-label="Back"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {title}
            </p>
            <p className="truncate text-xs text-neutral-500">
              {formOnly ? "Quick form" : subtitle}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {formOnly ? (
            <Link
              to={hybridHref}
              className="inline-flex items-center gap-1 font-medium text-neutral-500 hover:text-neutral-900"
            >
              <Sparkles className="size-3.5" strokeWidth={1.75} />
              Use co-worker
            </Link>
          ) : (
            <Link
              to={quickFormHref}
              className="font-medium text-neutral-400 hover:text-neutral-600"
            >
              Quick form
            </Link>
          )}
        </div>
      </header>

      <div
        className={
          pageFull && !formOnly
            ? "min-h-0 flex-1 p-0"
            : "min-h-0 flex-1 p-2"
        }
      >
        {formOnly ? (
          <div className="mx-auto h-full max-w-xl">{draftPanel}</div>
        ) : (
          <CoworkerWorkspace
            expand={expand}
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
                sending={sending}
              />
            }
            chat={
              <div className="h-full w-full min-h-0">
                <CoworkerChatShell
                  messages={messages}
                  input={input}
                  onInputChange={onInputChange}
                  onSend={onSend}
                  onRestart={onRestart}
                  onMinimize={() => {
                    setExpand("draft");
                    setMobileTab("draft");
                  }}
                  onExpand={() => toggleExpand("chat")}
                  expanded={expand === "chat"}
                  expandLabel={chatExpandLabel}
                  widePanel={expand === "chat"}
                  sending={sending}
                  placeholder={composerPlaceholder}
                  footerHint={footerHint}
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
                    className={`${COWORKER_ICON_BTN_CLASS} absolute right-3 top-3 z-10 hidden bg-white lg:inline-flex`}
                    aria-label={draftExpandLabel}
                    title={draftExpandLabel}
                  >
                    <Expand className="size-[18px]" strokeWidth={1.75} />
                  </button>
                  <div className={COWORKER_WORKSPACE_SCROLL}>{draftPanel}</div>
                </div>
              )
            }
          />
        )}
      </div>

      {leaveOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-text-primary">
              Leave without creating?
            </h3>
            <p className="mt-2 text-sm text-text-caption">
              Your draft and chat won’t be saved.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLeaveOpen(false);
                  setPendingHref(null);
                }}
              >
                Stay
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const href = pendingHref ?? backHref;
                  setLeaveOpen(false);
                  navigate(href);
                }}
              >
                Leave
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Outer padding wrapper so draft cards fill the shell workspace and pin the footer. */
export function DraftPanelFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col p-3 sm:p-4">{children}</div>
  );
}

export function CoworkerDraftPanel({
  title,
  progressLabel,
  progressRatio,
  children,
  footer,
}: {
  title: string;
  progressLabel: string;
  progressRatio: number;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#bfbfbf]/80 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[18px] font-semibold text-neutral-900">{title}</p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            {progressLabel}
          </p>
        </div>
      </header>
      <div className="h-1.5 w-full shrink-0 bg-neutral-100">
        <div
          className="h-full bg-black transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(progressRatio * 100)}%` }}
        />
      </div>
      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">{children}</div>
        <div className="mt-auto flex flex-wrap gap-2 border-t border-neutral-200/60 pt-3">
          {footer}
        </div>
      </div>
    </div>
  );
}
