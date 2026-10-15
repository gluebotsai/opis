import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Download,
  Expand,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  RotateCcw,
  Shrink,
  FileText,
  X,
} from "lucide-react";
import { CoworkerMessageList } from "./CoworkerMessageList";
import { CoworkerProgressPill } from "./CoworkerProgressPill";
import {
  COWORKER_AVATAR_CLASS,
  COWORKER_CHAT_READING_COLUMN,
  COWORKER_HEADER_ACTIONS_CLASS,
  COWORKER_ICON_BTN_CLASS,
  COWORKER_ICON_BTN_COMPOSER_CLASS,
  COWORKER_PANEL_HEADER_CLASS,
} from "./coworker-layout";
import {
  WORKTUAL_SEND_BUTTON,
  WORKTUAL_WORKSPACE_PANEL,
} from "@/lib/worktual-control-tokens";
import type { CoworkerAttachment, CoworkerMessage } from "./types";

export function CoworkerChatShell({
  title = "co-worker",
  messages,
  input,
  onInputChange,
  onSend,
  onRestart,
  onMinimize,
  onExpand,
  expanded = false,
  expandLabel = "Expand chat",
  widePanel = false,
  onDownloadChat,
  sending = false,
  placeholder = "Ask your CRM agent…",
  headerActions,
  footerHint,
  allowCsvAttach = false,
  fileAttach,
  fileAttachOpenRef,
  sendingStatus,
  onSendEmailNow,
  sendingEmailId,
}: {
  title?: string;
  messages: CoworkerMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: (
    text?: string,
    opts?: {
      hideUser?: boolean;
      displayText?: string;
      attachment?: CoworkerAttachment;
    },
  ) => void;
  onRestart?: () => void;
  /** Hide chat / collapse to fab (CCaaS PanelLeftClose). */
  onMinimize?: () => void;
  onExpand?: () => void;
  /** When true, expand control shows Shrink (CCaaS). */
  expanded?: boolean;
  expandLabel?: string;
  /**
   * Chat is the wide panel (expanded or the only pane). Caps and centers
   * messages and the composer. Off when this panel is the narrow column.
   */
  widePanel?: boolean;
  onDownloadChat?: () => void;
  sending?: boolean;
  placeholder?: string;
  headerActions?: ReactNode;
  footerHint?: string;
  allowCsvAttach?: boolean;
  /** Generic file attach (PDF sample, logo, etc.) — shows clip icon in composer. */
  fileAttach?: {
    accept: string;
    onFile: (file: File | null) => void;
    ariaLabel?: string;
    title?: string;
    disabled?: boolean;
    pending?: { name: string; size: number } | null;
    onClearPending?: () => void;
  };
  /** Parent can call .current() to open the file picker. */
  fileAttachOpenRef?: MutableRefObject<(() => void) | null>;
  /** Replaces the default “Thinking…” line while a turn is in flight. */
  sendingStatus?: ReactNode;
  onSendEmailNow?: (messageId: string) => void;
  sendingEmailId?: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  const focusInput = () => {
    const el = inputRef.current;
    if (!el || el.disabled) return;
    el.focus({ preventScroll: true });
  };

  useEffect(() => {
    const t = window.setTimeout(focusInput, 60);
    return () => window.clearTimeout(t);
  }, []);

  // Re-focus after each turn — disabling during send blurs the field.
  useEffect(() => {
    if (sending) return;
    const t = window.setTimeout(focusInput, 0);
    return () => window.clearTimeout(t);
  }, [sending, messages.length]);

  const openedAtBottom = useRef(false);
  const seenMessageCount = useRef(messages.length);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const previousCount = seenMessageCount.current;
    seenMessageCount.current = messages.length;

    if (!openedAtBottom.current) {
      openedAtBottom.current = true;
      root.scrollTop = root.scrollHeight;
      return;
    }

    if (messages.length < previousCount || previousCount === 0) {
      root.scrollTop = root.scrollHeight;
      return;
    }
    if (messages.length === previousCount) return;

    const addedUser = [...messages.slice(previousCount)]
      .reverse()
      .find((message) => message.role === "user" && !message.hidden);
    if (!addedUser) return;

    const node = root.querySelector(
      `[data-message-id="${CSS.escape(addedUser.id)}"]`,
    );
    if (!(node instanceof HTMLElement)) return;
    const top =
      node.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop;
    root.scrollTop = Math.max(0, top);
  }, [messages]);

  useEffect(() => {
    if (!fileAttachOpenRef) return;
    fileAttachOpenRef.current = () => {
      if (sending || fileAttach?.disabled) return;
      fileAttachRef.current?.click();
    };
    return () => {
      fileAttachOpenRef.current = null;
    };
  }, [fileAttach, fileAttachOpenRef, sending]);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(event.target as Node)
      ) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [downloadMenuOpen]);

  const downloadTranscript = () => {
    if (onDownloadChat) {
      onDownloadChat();
      return;
    }
    const lines = messages
      .filter((m) => m.text.trim() || m.attachment)
      .map((m) => {
        const who = m.role === "user" ? "You" : "co-worker";
        const body = m.text.trim() || (m.attachment ? `[file: ${m.attachment.name}]` : "");
        return `${who}: ${body}`;
      });
    if (!lines.length) return;
    const blob = new Blob([lines.join("\n\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coworker-chat.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (sending) return;
    if (!input.trim() && !fileAttach?.pending) return;
    onSend();
    window.setTimeout(focusInput, 0);
  };

  const onCsvFile = (file: File | null) => {
    if (!file || sending) return;
    const reader = new FileReader();
    reader.onload = () => {
      const body = String(reader.result ?? "").trim();
      if (!body) return;
      const name = file.name.trim() || "contacts.csv";
      onSend(`Import attached CSV (${name})\n\n${body}`, {
        displayText: "",
        attachment: { name, size: file.size, kind: "csv" },
      });
    };
    reader.readAsText(file);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const readingColumn = widePanel
    ? COWORKER_CHAT_READING_COLUMN
    : "w-full max-lg:mx-auto max-lg:max-w-[798px]";

  return (
    <div className={WORKTUAL_WORKSPACE_PANEL}>
      <header className={`${COWORKER_PANEL_HEADER_CLASS} justify-between`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={COWORKER_AVATAR_CLASS} aria-hidden>
            AI
          </span>
          <p className="truncate text-[18px] font-semibold text-neutral-900">
            {title}
          </p>
        </div>
        <div className={COWORKER_HEADER_ACTIONS_CLASS}>
          {headerActions}
          {onRestart ? (
            <button
              type="button"
              onClick={onRestart}
              className={COWORKER_ICON_BTN_CLASS}
              aria-label="Restart conversation"
              title="Restart conversation"
            >
              <RotateCcw className="size-[18px]" strokeWidth={1.75} />
            </button>
          ) : null}
          {onMinimize ? (
            <button
              type="button"
              onClick={onMinimize}
              className={`${COWORKER_ICON_BTN_CLASS} hidden lg:inline-flex`}
              aria-label="Minimize co-worker"
              title="Minimize co-worker"
            >
              <PanelLeftClose className="size-[18px]" strokeWidth={1.75} />
            </button>
          ) : null}
          {onExpand ? (
            <button
              type="button"
              onClick={onExpand}
              className={`${COWORKER_ICON_BTN_CLASS} hidden lg:inline-flex`}
              aria-label={expandLabel}
              title={expandLabel}
            >
              {expanded ? (
                <Shrink className="size-[18px]" strokeWidth={1.75} />
              ) : (
                <Expand className="size-[18px]" strokeWidth={1.75} />
              )}
            </button>
          ) : null}
          <div className="relative" ref={downloadMenuRef}>
            <button
              type="button"
              onClick={() => setDownloadMenuOpen((v) => !v)}
              className={COWORKER_ICON_BTN_CLASS}
              aria-label="More options"
              aria-expanded={downloadMenuOpen}
              title="More options"
            >
              <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
            </button>
            {downloadMenuOpen ? (
              <div className="absolute top-full right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setDownloadMenuOpen(false);
                    downloadTranscript();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <Download className="size-4 shrink-0 text-neutral-900" />
                  Download chat
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="scrollbar-hover min-h-0 w-full flex-1 overflow-y-auto"
      >
        <div className={readingColumn}>
          <CoworkerMessageList
            messages={messages}
            bottomRef={bottomRef}
            onSendEmailNow={onSendEmailNow}
            sendingEmailId={sendingEmailId}
          />
          {sending ? sendingStatus ?? <CoworkerProgressPill /> : null}
        </div>
      </div>

      <form
        onSubmit={submit}
        className="w-full shrink-0 border-t border-neutral-200/80 p-3 sm:p-4"
      >
        <div className={readingColumn}>
        <div className="flex flex-col gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-1.5 focus-within:border-neutral-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-200">
          {fileAttach?.pending ? (
            <div className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
                <FileText className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-neutral-900">
                  {fileAttach.pending.name}
                </p>
                <p className="text-[10px] text-neutral-500">
                  {fileAttach.pending.size < 1024
                    ? `${fileAttach.pending.size} bytes`
                    : `${Math.round(fileAttach.pending.size / 1024)} KB`}
                </p>
              </div>
              <button
                type="button"
                disabled={sending}
                onClick={() => fileAttach.onClearPending?.()}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                aria-label="Remove attachment"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
          {allowCsvAttach ? (
            <>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  onCsvFile(file);
                }}
              />
              <button
                type="button"
                disabled={sending}
                onClick={() => csvFileRef.current?.click()}
                className={`mb-0.5 ${COWORKER_ICON_BTN_COMPOSER_CLASS}`}
                aria-label="Attach CSV"
                title="Attach CSV"
              >
                <Paperclip className="size-[18px]" strokeWidth={1.75} />
              </button>
            </>
          ) : null}
          {fileAttach ? (
            <>
              <input
                ref={fileAttachRef}
                type="file"
                accept={fileAttach.accept}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  fileAttach.onFile(file);
                }}
              />
              <button
                type="button"
                disabled={sending || fileAttach.disabled}
                onClick={() => fileAttachRef.current?.click()}
                className={`mb-0.5 ${COWORKER_ICON_BTN_COMPOSER_CLASS}`}
                aria-label={fileAttach.ariaLabel ?? "Attach file"}
                title={fileAttach.title ?? fileAttach.ariaLabel ?? "Attach file"}
              >
                <Paperclip className="size-[18px]" strokeWidth={1.75} />
              </button>
            </>
          ) : null}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            readOnly={sending}
            aria-busy={sending}
            className="max-h-28 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 read-only:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && !fileAttach?.pending)}
            className={`mb-0.5 ${WORKTUAL_SEND_BUTTON}`}
            aria-label="Send"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2.25} />
          </button>
          </div>
        </div>
        {footerHint ? (
          <p className="mt-2 text-[11px] text-neutral-500">{footerHint}</p>
        ) : null}
        </div>
      </form>
    </div>
  );
}
