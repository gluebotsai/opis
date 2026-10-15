import { Link, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  MoreVertical,
  Paperclip,
  Phone,
  PanelRightClose,
  PanelRightOpen,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Smile,
  StickyNote,
  Trash2,
  Type,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { WORKTUAL_HEADER_ICON_GROUP, WORKTUAL_ICON_BUTTON, WORKTUAL_SEGMENT_SHELL } from "@/lib/worktual-control-tokens";
import { EmailBodyContent } from "@/components/inbox/EmailBodyContent";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { ScheduleMeetingDialog } from "@/components/inbox/ScheduleMeetingDialog";
import {
  decodeHtmlEntities,
  escapeHtmlText,
  isHtmlEmailBody,
  htmlToPlainText,
  normalizeEmailDisplayText,
  normalizeEmailSubjectForCompose,
  plainTextToEmailHtml,
  readingPaneEmailParts,
  sanitizeEmailHtml,
  splitQuotedEmailHistory,
} from "@/lib/email-body";
import { validateOutboundEmailContent } from "@/lib/outbound-email-guard";
import { RecipientEmailField } from "@/components/email/RecipientEmailField";
import { ComposeAssistField } from "@/components/email/ComposeAssistField";
import { ComposeFormatToolbar } from "@/components/email/ComposeFormatToolbar";
import {
  EMPTY_RICH_TEXT_FORMAT,
  RichTextEditor,
  type RichTextEditorHandle,
  type RichTextFormatState,
} from "@/components/email/RichTextEditor";
import { RecipientPhoneField } from "@/components/email/RecipientPhoneField";
import type { ComposeContactOption } from "@/components/email/types";
import { formatContactType } from "@/components/contacts/contact-labels";
import {
  parseGuestsFromMeetingBody,
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
} from "@/lib/meeting-body";
import { meetingJoinLabel } from "@/lib/meeting-provider";
import {
  CHIP_BASE,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAppSelector } from "@/store";
import { createContactActivity } from "@/services/contacts";
import {
  composeInboxAssist,
  fetchReplyAllRecipients,
  purgeInboxTrash,
  resolveContactForEmail,
  resolveContactForPhone,
  saveInboxDraft,
  sendInboxEmail,
  syncInbox,
  fetchInboxThread,
  updateInboxFolder,
  type InboxContactOption,
  type InboxFolder,
  type InboxItem,
  type InboxThreadMessage,
} from "@/services/inbox";

type FolderTab = InboxFolder;
type ComposeKind = "email" | "call";

/** Matches backend `INBOX_DRAFT_UNASSIGNED_EMAIL` — drafts saved before To is filled. */
const DRAFT_UNASSIGNED_EMAIL = "unassigned@draft.local";

function isInboxDraftItem(item: {
  folder: string;
  folders?: string[] | null;
}): boolean {
  return (item.folders?.length ? item.folders : [item.folder]).includes("draft");
}

/** True when the conversation has sent/received mail besides the draft being edited. */
function threadHasVisibleHistory(
  item: InboxItem,
  editingDraftId: string | null,
): boolean {
  const msgs =
    item.messages?.length > 0
      ? item.messages
      : [{ id: item.id, folder: item.folder }];
  return msgs.some(
    (m) => m.folder !== "draft" && m.id !== editingDraftId,
  );
}

/** Resolve a conversation after list reload — head message id changes when a
 * new reply arrives, so match by threadId / any message id too. */
function findInboxItem(
  list: InboxItem[],
  key: string | null | undefined,
): InboxItem | null {
  if (!key) return null;
  return (
    list.find((i) => i.id === key) ??
    list.find((i) => i.threadId === key) ??
    list.find((i) => i.gmailThreadId === key) ??
    list.find((i) =>
      i.messages?.some(
        (m) =>
          m.id === key ||
          m.threadId === key ||
          m.gmailThreadId === key ||
          m.gmailMessageId === key,
      ),
    ) ??
    null
  );
}

const FOLDERS: { id: FolderTab; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "draft", label: "Draft" },
  { id: "trash", label: "Trash" },
];

function typeMeta(type: string): {
  label: string;
  icon: typeof Mail;
  iconWrap: string;
} {
  switch (type) {
    case "call":
      return { label: "Inbound Call", icon: Phone, iconWrap: "bg-violet-0 text-brand" };
    case "email":
      return { label: "Email", icon: Mail, iconWrap: "bg-[#FEF4EC] text-[#874400]" };
    case "meeting":
      return { label: "Meeting", icon: Video, iconWrap: "bg-[#e8f1fc] text-text-info" };
    case "sms":
      return { label: "SMS", icon: MessageSquare, iconWrap: "bg-[#F6FBF9] text-text-success" };
    default:
      return { label: "Note", icon: StickyNote, iconWrap: "bg-neutral-100 text-text-secondary" };
  }
}

function dayGroupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startMsg.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fullWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const DEFAULT_MEETING_MINUTES = 30;

function meetingTitle(subject: string): string {
  return subject.replace(/^Meeting:\s*/i, "").trim() || subject;
}

function meetingDescription(body: string | null | undefined, title: string): string {
  if (!body?.trim()) {
    return title ? `Meeting to discuss ${title}.` : "Scheduled meeting.";
  }
  const lines = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^Google Meet:/i.test(l) &&
        !/^Meeting link:/i.test(l) &&
        !/^Provider:/i.test(l) &&
        !/^Calendar:/i.test(l) &&
        !/^Google Event:/i.test(l) &&
        !/^Topic:/i.test(l) &&
        !/^When:/i.test(l) &&
        !/^Guests:/i.test(l) &&
        !/^Organizer:/i.test(l) &&
        !/^-\s+/.test(l) &&
        !/^Join Meet at the scheduled/i.test(l) &&
        !/^https?:\/\//i.test(l) &&
        !/^Scheduled for\s+/i.test(l),
    );
  if (lines[0]) return lines[0];
  return title ? `Meeting to discuss ${title}.` : "Scheduled meeting.";
}

function formatMeetingSchedule(
  dueAt: string | null,
  durationMinutes = DEFAULT_MEETING_MINUTES,
): string {
  const start = dueAt ? new Date(dueAt) : null;
  if (!start || Number.isNaN(start.getTime())) return "Time TBD";
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: true };
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const startT = start.toLocaleTimeString(undefined, timeOpts);
  const endT = end.toLocaleTimeString(undefined, timeOpts);
  const date = start.toLocaleDateString(undefined, dateOpts);
  return `${startT} - ${endT} - ${date}`;
}

function meetingStatus(
  dueAt: string | null,
  durationMinutes = DEFAULT_MEETING_MINUTES,
): "not_started" | "in_progress" | "completed" {
  if (!dueAt) return "not_started";
  const start = new Date(dueAt).getTime();
  if (Number.isNaN(start)) return "not_started";
  const end = start + durationMinutes * 60_000;
  const now = Date.now();
  if (now < start) return "not_started";
  if (now <= end) return "in_progress";
  return "completed";
}

function MeetingCard({
  msg,
  organizerName,
}: {
  msg: InboxThreadMessage;
  organizerName: string;
}) {
  const title = meetingTitle(msg.subject);
  const status = meetingStatus(msg.dueAt);
  const schedule = formatMeetingSchedule(msg.dueAt);
  const description = meetingDescription(msg.body, title);
  const meetLink = parseMeetingLinkFromBody(msg.body);
  const meetingProvider = parseProviderFromMeetingBody(msg.body);
  const joinLabel = meetingJoinLabel(meetingProvider);
  const guests = parseGuestsFromMeetingBody(msg.body);
  const statusStyles =
    status === "completed"
      ? `${CHIP_BASE} ${TONE_MUTED}`
      : status === "in_progress"
        ? `${CHIP_BASE} ${TONE_WARNING}`
        : `${CHIP_BASE} ${TONE_SUCCESS}`;

  return (
    <div className="flex gap-3 sm:gap-4">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#E8B84A] text-white">
        <Calendar className="size-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <span className={`shrink-0 ${statusStyles}`}>
              {status}
            </span>
          </div>
          <p className="shrink-0 text-xs font-semibold text-text-primary sm:text-sm">{schedule}</p>
        </div>
        <p className="mt-1.5 text-sm text-text-caption">{description}</p>
        {guests.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-semibold text-text-primary">Guests</p>
            <ul className="mt-1 space-y-0.5 text-xs text-text-caption">
              {guests.map((guest) => (
                <li key={guest}>{guest}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-primary sm:text-sm">
            <span className="font-semibold">From :</span> {organizerName}
          </p>
          {meetLink ? (
            <a
              href={meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border-default bg-surface px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-subtle"
            >
              {joinLabel}
            </a>
          ) : (
            <span className="inline-flex h-9 items-center justify-center rounded-lg border border-border-default px-4 text-sm font-semibold text-text-caption">
              {joinLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function cleanEmailBody(raw: string | null | undefined): {
  main: string;
  quoted: string | null;
} {
  return splitQuotedEmailHistory(raw);
}

/** Split user-written reply text from an embedded Gmail-style quote in a draft body. */
function splitDraftMessageAndQuote(draftBody: string): {
  message: string;
  quote: string;
} {
  const { main, quoted } = splitQuotedEmailHistory(draftBody);
  return { message: main, quote: quoted ?? "" };
}

/** True when the user actually wrote (or generated) a body — not empty / quote-only. */
function hasUserDraftContent(body: string | null | undefined): boolean {
  const { message } = splitDraftMessageAndQuote(body ?? "");
  return Boolean(htmlToPlainText(message).trim());
}

type ComposeAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
};

const COMPOSE_MAX_ATTACHMENTS = 5;
const COMPOSE_MAX_FILE_BYTES = 5 * 1024 * 1024;
const COMPOSE_EMOJIS = [
  "😀", "😃", "😄", "😁", "😊", "😍", "🤗", "🙂", "👋", "👍",
  "👎", "👏", "🙏", "🔥", "✨", "🎉", "✅", "❌", "💡", "📌",
  "❤️", "😂", "😮", "😢", "🤝", "💯", "⭐", "📅", "📎", "📝",
];

function formatComposeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function composeMessageLooksHtml(text: string): boolean {
  return isHtmlEmailBody(text) || /<(p|div|br|b|i|strong|em|ul|ol|li|u|a)\b/i.test(text);
}

function normDraftSubject(subject: string): string {
  return normalizeEmailSubjectForCompose(subject || "").toLowerCase();
}

/** Latest-message text only — never re-quote nested thread history in Reply. */
function extractLatestMessageForReply(body: string | null | undefined): string {
  const source = isHtmlEmailBody(body)
    ? htmlToPlainText(body ?? "")
    : normalizeEmailDisplayText(body ?? "");
  let { main } = cleanEmailBody(source);

  // Catch indented / soft-wrapped Gmail attributions the first pass missed.
  const attribution = main.search(
    /\n[ \t\u00A0\u202F]*>?\s*On[\s\S]{5,280}?wrote:|\n\s*From:\s.+\n\s*(?:Sent|Date):|\n-{2,}\s*Original Message/i,
  );
  if (attribution > 0) {
    main = main.slice(0, attribution).trim();
  }

  // Line-based fallback: cut at first "On … wrote:" even with leading spaces.
  const lines = main.split("\n");
  const attrLine = lines.findIndex((l) =>
    /^\s*>?\s*On\b.+\bwrote:\s*$/i.test(l.trimEnd()),
  );
  if (attrLine > 0) {
    main = lines.slice(0, attrLine).join("\n").trim();
  }

  // Drop trailing empty / quote-marker-only lines left after the cut.
  main = main
    .split("\n")
    .reduceRight<string[]>((acc, line) => {
      if (acc.length === 0 && /^\s*>?\s*$/.test(line)) return acc;
      acc.unshift(line);
      return acc;
    }, [])
    .join("\n")
    .trim();

  return main
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildReplyDraft(args: { body: string | null; when: string; author: string }): string {
  const main = extractLatestMessageForReply(args.body);
  const quoteLines = (main || "(No message body)")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${fullWhen(args.when)}, ${args.author} wrote:\n${quoteLines}`;
}

function EmailBody({ body, subject }: { body: string | null; subject?: string }) {
  const raw = body?.trim() ?? "";
  const [showQuoted, setShowQuoted] = useState(false);
  const { main, quoted } = readingPaneEmailParts(raw);

  return (
    <div className="mt-4 space-y-3 text-sm leading-6 text-text-secondary">
      {subject ? <p className="font-medium text-text-primary">{subject}</p> : null}
      <EmailBodyContent
        text={main || "No message body was logged for this activity."}
        subject={subject}
      />
      {quoted ? (
        <div>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md border border-border-default bg-subtle px-2 text-xs text-text-caption hover:bg-surface hover:text-text-primary"
            onClick={() => setShowQuoted((v) => !v)}
            title={showQuoted ? "Hide quoted text" : "Show quoted text"}
            aria-expanded={showQuoted}
          >
            ···
          </button>
          {showQuoted ? (
            <blockquote className="mt-3 border-l-2 border-border-default pl-3 text-xs leading-5 text-text-caption">
              <RichStructuredContent
                text={decodeHtmlEntities(quoted)}
                variant="muted"
              />
            </blockquote>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  wrap = "words",
}: {
  label: string;
  value: string | null | undefined;
  /** Emails have no spaces — use "all" so the full address wraps. */
  wrap?: "words" | "all";
}) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-b border-border-default/60 py-2.5 last:border-0 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-2 sm:items-start">
      <dt className="text-xs text-text-caption">{label}</dt>
      <dd
        className={`min-w-0 text-sm text-text-primary ${
          wrap === "all" ? "break-all" : "break-words"
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

export function InboxClient({
  items,
  contacts,
  syncHint = null,
  onReload,
}: {
  items: InboxItem[];
  contacts: InboxContactOption[];
  syncHint?: string | null;
  onReload: (opts?: { force?: boolean }) => Promise<void>;
}) {
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  const composeWrapRef = useRef<HTMLDivElement>(null);
  const isMdUp = useMediaQuery("(min-width: 768px)");
  const isXlUp = useMediaQuery("(min-width: 1280px)");
  const currentUser = useAppSelector((s) => s.auth.user);

  const [folder, setFolder] = useState<FolderTab>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [composeMenuOpen, setComposeMenuOpen] = useState(false);
  const [composeKind, setComposeKind] = useState<ComposeKind | null>(null);
  const [composeContact, setComposeContact] = useState<InboxContactOption | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composePhone, setComposePhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [replyContext, setReplyContext] = useState<{
    threadId: string;
    gmailThreadId: string | null;
    gmailMessageId: string | null;
    rfcMessageId: string | null;
    inboundBody: string;
    /** Collapsed Gmail/Outlook-style quote — not shown in the editor until expanded. */
    quotedHistory: string;
  } | null>(null);
  const [liveSyncHint, setLiveSyncHint] = useState<string | null>(syncHint);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const editingDraftIdRef = useRef<string | null>(null);
  const discardingComposeRef = useRef(false);
  const syncInFlightRef = useRef(false);
  /** Stable conversation key (prefer CRM threadId) so selection survives new replies. */
  const selectedKeyRef = useRef<string | null>(null);

  const composing = composeKind === "email" || composeKind === "call";
  const [pinnedThread, setPinnedThread] = useState<InboxItem | null>(null);
  const visibleItems = useMemo(() => {
    if (!pinnedThread) return items;
    if (
      findInboxItem(items, pinnedThread.id) ||
      findInboxItem(items, pinnedThread.threadId)
    ) {
      return items;
    }
    return [pinnedThread, ...items];
  }, [items, pinnedThread]);

  useEffect(() => {
    editingDraftIdRef.current = editingDraftId;
  }, [editingDraftId]);

  const folderItems = useMemo(
    () =>
      visibleItems.filter((i) => {
        const folders = i.folders?.length ? i.folders : [i.folder];
        if (!folders.includes(folder)) return false;
        if (folder === "draft" && !hasUserDraftContent(i.body)) return false;
        return true;
      }),
    [visibleItems, folder],
  );

  useEffect(() => {
    setLiveSyncHint(syncHint);
  }, [syncHint]);

  const selectConversation = useCallback((item: InboxItem | null) => {
    if (!item) {
      setSelectedId(null);
      selectedKeyRef.current = null;
      return;
    }
    setSelectedId(item.id);
    selectedKeyRef.current = item.threadId || item.id;
  }, []);

  const runSync = useCallback(async (opts?: { silent?: boolean }) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    if (!opts?.silent) setSyncing(true);
    try {
      const result = await syncInbox();
      if (!result.ok) {
        if (!opts?.silent) setLiveSyncHint(result.error);
        return;
      }
      if (result.needsReconnect && result.error) {
        setLiveSyncHint(result.error);
        return;
      }
      setLiveSyncHint(null);
      setLastSyncAt(new Date().toLocaleTimeString());
      // Force-apply so a concurrent list poll cannot drop the post-sync payload.
      await onReload({ force: true });
      // If Gmail just imported, give the list one more beat (DB commit / merge).
      if (result.imported > 0) {
        window.setTimeout(() => {
          void onReload({ force: true });
        }, 750);
      }
    } catch {
      // Never block Inbox on sync failures
    } finally {
      syncInFlightRef.current = false;
      if (!opts?.silent) setSyncing(false);
    }
  }, [onReload]);

  // Fast path: refresh CRM thread list often (cheap). Gmail sync is slower and
  // runs on a longer interval so inbound replies appear as soon as they land in CRM.
  useEffect(() => {
    const pollThreads = () => {
      if (document.visibilityState === "hidden") return;
      void onReload();
    };
    const threadId = window.setInterval(pollThreads, 4_000);

    void runSync({ silent: true });
    const syncId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void runSync({ silent: true });
    }, 8_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void onReload();
        void runSync({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(threadId);
      window.clearInterval(syncId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [runSync, onReload]);

  useEffect(() => {
    setPanelOpen(isXlUp);
  }, [isXlUp]);

  const deepLinkThread = searchParams.get("thread");
  const deepLinkFolder = searchParams.get("folder");
  const appliedDeepLink = useRef<string | null>(null);
  const deepLinkFetch = useRef<string | null>(null);
  useEffect(() => {
    if (
      deepLinkFolder === "inbox" ||
      deepLinkFolder === "sent" ||
      deepLinkFolder === "draft" ||
      deepLinkFolder === "trash"
    ) {
      setFolder(deepLinkFolder);
    }
  }, [deepLinkFolder]);
  useEffect(() => {
    if (!deepLinkThread || appliedDeepLink.current === deepLinkThread) return;
    const match = findInboxItem(visibleItems, deepLinkThread);
    if (match) {
      appliedDeepLink.current = deepLinkThread;
      const inInbox = (match.folders?.length ? match.folders : [match.folder]).includes(
        "inbox",
      );
      if (
        deepLinkFolder !== "inbox" &&
        deepLinkFolder !== "sent" &&
        deepLinkFolder !== "draft" &&
        deepLinkFolder !== "trash"
      ) {
        setFolder(inInbox ? "inbox" : match.folder);
      }
      selectConversation(match);
      return;
    }
    if (deepLinkFetch.current === deepLinkThread) return;
    deepLinkFetch.current = deepLinkThread;
    let cancelled = false;
    void fetchInboxThread(deepLinkThread).then((result) => {
      if (cancelled || appliedDeepLink.current === deepLinkThread) return;
      if (!result.ok || !result.item) return;
      appliedDeepLink.current = deepLinkThread;
      setPinnedThread(result.item);
      const item = result.item;
      const inInbox = (item.folders?.length ? item.folders : [item.folder]).includes(
        "inbox",
      );
      if (
        deepLinkFolder !== "inbox" &&
        deepLinkFolder !== "sent" &&
        deepLinkFolder !== "draft" &&
        deepLinkFolder !== "trash"
      ) {
        setFolder(inInbox ? "inbox" : item.folder);
      }
      selectConversation(item);
    });
    return () => {
      cancelled = true;
    };
  }, [deepLinkThread, deepLinkFolder, visibleItems, selectConversation]);

  // Rematch selection after reload — conversation head id changes when a reply arrives.
  useEffect(() => {
    if (folderItems.length === 0) {
      if (!composing) {
        setSelectedId(null);
        selectedKeyRef.current = null;
      }
      return;
    }
    const key = selectedKeyRef.current || selectedId;
    const match = findInboxItem(folderItems, key);
    if (match) {
      if (match.id !== selectedId) setSelectedId(match.id);
      selectedKeyRef.current = match.threadId || match.id;
      return;
    }
    // Stay blank until the user picks a conversation (or a ?thread= deep link).
    if (composing || composeKind) return;
    if (deepLinkThread && appliedDeepLink.current === deepLinkThread) return;
    selectConversation(null);
  }, [folderItems, selectedId, composing, composeKind, deepLinkThread, selectConversation]);

  const selected = findInboxItem(folderItems, selectedId || selectedKeyRef.current);

  const grouped = useMemo(() => {
    const map = new Map<string, InboxItem[]>();
    for (const item of folderItems) {
      const key = dayGroupLabel(item.createdAt);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [folderItems]);

  const draftCount = items.filter(
    (i) => isInboxDraftItem(i) && hasUserDraftContent(i.body),
  ).length;

  const sideContact = useMemo((): SideContact | null => {
    if (
      selected &&
      (!composeContact || composeContact.id === selected.contactId)
    ) {
      return sideContactFromInboxItem(selected);
    }
    if (composing && composeContact) {
      const base = sideContactFromComposeOption(composeContact);
      if (composeKind === "call" && composePhone.trim()) {
        return { ...base, contactPhone: composePhone.trim() };
      }
      return base;
    }
    return selected ? sideContactFromInboxItem(selected) : null;
  }, [selected, composing, composeKind, composeContact, composePhone]);

  function startCompose(kind: ComposeKind) {
    setComposeKind(kind);
    setComposeContact(null);
    setComposeTo("");
    setComposePhone("");
    setSubject("");
    setMessage("");
    setCc("");
    setShowCc(false);
    setComposeError(null);
    setEditingDraftId(null);
    setReplyContext(null);
    selectConversation(null);
    setComposeMenuOpen(false);
    setPanelOpen(true);
  }

  function selectComposeContact(contact: ComposeContactOption | null) {
    const opt: InboxContactOption | null = contact
      ? { id: contact.id, displayName: contact.displayName, email: contact.email, phone: contact.phone }
      : null;
    setComposeContact(opt);
    if (opt && composeKind === "email") setComposeTo(opt.email);
    if (opt && composeKind === "call" && opt.phone) setComposePhone(opt.phone);
  }

  function cancelCompose() {
    setComposeKind(null);
    setComposeContact(null);
    setComposeTo("");
    setComposePhone("");
    setComposeMenuOpen(false);
    setComposeError(null);
    setComposeNotice(null);
    setEditingDraftId(null);
    setReplyContext(null);
    setMessage("");
    setSubject("");
    setCc("");
    setShowCc(false);
  }

  async function clearEditingDraft() {
    if (!editingDraftIdRef.current) return;
    const draftId = editingDraftIdRef.current;
    setEditingDraftId(null);
    // Soft-trash then purge so a leftover draft does not reappear as a
    // second "Sent" bubble in the conversation (soft subject merge).
    await updateInboxFolder(draftId, "trash");
    await purgeInboxTrash(draftId);
  }

  async function startReply(
    item: InboxItem,
    mode: "reply" | "reply_all" = "reply",
  ) {
    if (!item.contactEmail) {
      setComposeError("This contact has no email address.");
      return;
    }
    const contact: InboxContactOption = {
      id: item.contactId,
      displayName: item.contactName,
      email: item.contactEmail,
      phone: item.contactPhone,
    };
    const latest = item.messages?.length > 0 ? item.messages[item.messages.length - 1] : item;
    // Prefer the latest inbound message that has Gmail ids (needed for threading).
    const replyParent =
      [...(item.messages ?? [])]
        .reverse()
        .find(
          (m) =>
            m.emailDirection === "inbound" &&
            (m.gmailMessageId || m.rfcMessageId || m.gmailThreadId),
        ) ?? latest;
    const rawSubject = normalizeEmailSubjectForCompose(
      replyParent.subject || latest.subject || "",
    );
    const reSubject = rawSubject.toLowerCase().startsWith("re:")
      ? rawSubject
      : `Re: ${rawSubject}`;
    const author =
      replyParent.emailDirection === "outbound" ? "you" : item.contactName;
    const quotedHistory = buildReplyDraft({
      body: replyParent.body,
      when: replyParent.createdAt,
      author,
    });
    const threadKey = item.threadId || item.id;
    const targetSubject = normDraftSubject(reSubject);

    let toEmail = contact.email;
    let ccList: string[] = [];
    if (mode === "reply_all") {
      setPending(true);
      const recipients = await fetchReplyAllRecipients(replyParent.id || item.id);
      setPending(false);
      if (!recipients.ok) {
        setComposeError(recipients.error);
        return;
      }
      toEmail = recipients.to || contact.email;
      ccList = recipients.cc ?? [];
      setComposeError(null);
      setComposeNotice(recipients.recipientNotice ?? null);
    }

    // Reuse an existing reply draft for this thread/contact instead of creating another.
    const matchingDrafts = items
      .filter(
        (i) =>
          isInboxDraftItem(i) &&
          i.type === "email" &&
          i.contactId === item.contactId &&
          (i.threadId === threadKey ||
            i.threadId === item.threadId ||
            normDraftSubject(i.subject) === targetSubject),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    const existingDraft =
      matchingDrafts.find((d) => hasUserDraftContent(d.body)) ?? null;
    // Drop empty / quote-only leftovers (Reply click, auto Re: subject).
    for (const dup of matchingDrafts) {
      if (dup.id === existingDraft?.id) continue;
      if (!hasUserDraftContent(dup.body)) {
        void updateInboxFolder(dup.id, "trash");
      }
    }

    const replyCtx = {
      threadId: threadKey,
      gmailThreadId:
        replyParent.gmailThreadId ??
        item.gmailThreadId ??
        item.messages?.find((m) => m.gmailThreadId)?.gmailThreadId ??
        null,
      gmailMessageId: replyParent.gmailMessageId ?? item.gmailMessageId,
      rfcMessageId: replyParent.rfcMessageId ?? item.rfcMessageId ?? null,
      inboundBody: extractLatestMessageForReply(replyParent.body),
      quotedHistory,
    };

    if (existingDraft) {
      const { message: messageOnly, quote: embeddedQuote } =
        splitDraftMessageAndQuote(existingDraft.body ?? "");
      setComposeKind("email");
      setComposeContact(contact);
      setComposeTo(toEmail);
      setComposeMenuOpen(false);
      setSubject(normalizeEmailSubjectForCompose(existingDraft.subject || reSubject));
      setMessage(messageOnly);
      setCc(ccList.join(", "));
      setShowCc(ccList.length > 0 || mode === "reply_all");
      if (mode !== "reply_all") {
        setComposeError(null);
        setComposeNotice(null);
      }
      setEditingDraftId(existingDraft.id);
      setReplyContext({
        ...replyCtx,
        quotedHistory: embeddedQuote || quotedHistory,
      });
      // Keep the thread visible — reply renders inline below it (Gmail-style
      // scroll), not as a separate full-panel screen.
      selectConversation(item);
      setPanelOpen(true);
      return;
    }

    setComposeKind("email");
    setComposeContact(contact);
    setComposeTo(toEmail);
    setComposeMenuOpen(false);
    setSubject(reSubject);
    // Gmail/Outlook style: compose starts blank; quote is collapsed behind "…".
    setMessage("");
    setCc(ccList.join(", "));
    setShowCc(ccList.length > 0 || mode === "reply_all");
    if (mode !== "reply_all") {
      setComposeError(null);
      setComposeNotice(null);
    }
    setEditingDraftId(null);
    setReplyContext(replyCtx);
    selectConversation(item);
    setPanelOpen(true);
  }

  function startComposeToSelected(kind: ComposeKind, item: InboxItem) {
    const contact: InboxContactOption = {
      id: item.contactId,
      displayName: item.contactName,
      email: item.contactEmail ?? "",
      phone: item.contactPhone,
    };
    setComposeKind(kind);
    setComposeContact(contact);
    if (kind === "email") setComposeTo(contact.email);
    else if (contact.phone) setComposePhone(contact.phone);
    setComposeMenuOpen(false);
    setSubject("");
    setMessage("");
    setCc("");
    setShowCc(false);
    setComposeError(null);
    setComposeNotice(null);
    setEditingDraftId(null);
    setReplyContext(null);
    selectConversation(item);
    setPanelOpen(true);
  }

  function continueDraft(item: InboxItem) {
    const contact: InboxContactOption = {
      id: item.contactId,
      displayName: item.contactName,
      email: item.contactEmail ?? "",
      phone: item.contactPhone,
    };
    const isUnassigned =
      (contact.email || "").trim().toLowerCase() === DRAFT_UNASSIGNED_EMAIL;
    const { message: messageOnly, quote: embeddedQuote } =
      splitDraftMessageAndQuote(item.body ?? "");

    setComposeKind(item.type === "call" ? "call" : "email");
    setComposeContact(isUnassigned ? null : contact);
    if (item.type !== "call") setComposeTo(isUnassigned ? "" : contact.email);
    else if (contact.phone) setComposePhone(contact.phone);
    setComposeMenuOpen(false);
    setSubject(normalizeEmailSubjectForCompose(item.subject || ""));
    setMessage(messageOnly);
    setCc("");
    setShowCc(false);
    setComposeError(null);
    setEditingDraftId(item.id);
    setReplyContext(
      embeddedQuote
        ? {
            threadId: item.threadId || item.id,
            gmailThreadId: item.gmailThreadId,
            gmailMessageId: item.gmailMessageId,
            rfcMessageId: item.rfcMessageId ?? null,
            inboundBody: "",
            quotedHistory: embeddedQuote.startsWith("\n")
              ? embeddedQuote
              : `\n\n${embeddedQuote}`,
          }
        : null,
    );
    selectConversation(item);
    setPanelOpen(true);
  }

  // Desktop auto-select and any draft selection must open ComposePanel (Edit/Send),
  // not read-only ThreadView (which mislabels drafts as "Sent").
  useEffect(() => {
    if (composing || composeKind) return;
    if (!selectedId) return;
    const item = findInboxItem(folderItems, selectedId);
    if (!item || !isInboxDraftItem(item)) return;
    continueDraft(item);
  }, [selectedId, folderItems, composing, composeKind]);

  async function resolveComposeContactId(): Promise<string | null> {
    if (composeContact) return composeContact.id;
    if (composeKind === "email" && composeTo.trim()) {
      const result = await resolveContactForEmail(composeTo);
      if (!result.ok) {
        setComposeError(result.error);
        return null;
      }
      return result.contactId;
    }
    if (composeKind === "call" && composePhone.trim()) {
      const result = await resolveContactForPhone(composePhone);
      if (!result.ok) {
        setComposeError(result.error);
        return null;
      }
      return result.contactId;
    }
    return null;
  }

  const persistDraft = useCallback(async (opts?: { discardEmpty?: boolean }): Promise<boolean> => {
    if (discardingComposeRef.current) return false;
    if (composeKind !== "email") return false;

    // Only persist user-written (or generated) body. Auto Re: / quote-only is not a draft.
    if (!hasUserDraftContent(message)) {
      if (opts?.discardEmpty && editingDraftIdRef.current) {
        const emptyId = editingDraftIdRef.current;
        editingDraftIdRef.current = null;
        setEditingDraftId(null);
        await updateInboxFolder(emptyId, "trash");
        await purgeInboxTrash(emptyId);
      }
      return false;
    }

    let contactId = composeContact?.id ?? null;
    if (!contactId && composeTo.trim()) {
      const result = await resolveContactForEmail(composeTo);
      if (!result.ok) return false;
      contactId = result.contactId;
    }

    if (discardingComposeRef.current) return false;

    const result = await saveInboxDraft({
      draftId: editingDraftIdRef.current,
      contactId: contactId ?? null,
      type: "email",
      subject: subject.trim() || "Draft email",
      body: message.trim() || null,
      threadId: replyContext?.threadId ?? null,
    });

    if (discardingComposeRef.current) return false;

    if (result.ok) {
      if (!editingDraftIdRef.current) {
        setEditingDraftId(result.id);
        editingDraftIdRef.current = result.id;
      }
      return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeKind, composeTo, subject, message, composeContact, replyContext?.threadId]);

  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  // Save only when leaving the tab/page or unmounting inbox — never while still composing.
  useEffect(() => {
    const saveIfWorthy = () => {
      void persistDraftRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveIfWorthy();
    };
    window.addEventListener("pagehide", saveIfWorthy);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", saveIfWorthy);
      document.removeEventListener("visibilitychange", onVisibility);
      void persistDraftRef.current({ discardEmpty: true });
    };
  }, []);

  async function closeCompose(opts?: { goToDrafts?: boolean }) {
    const saved = await persistDraft({ discardEmpty: true });
    cancelCompose();
    if (opts?.goToDrafts && saved) setFolder("draft");
    await onReload();
  }

  async function discardCompose() {
    discardingComposeRef.current = true;
    const draftId = editingDraftIdRef.current;
    editingDraftIdRef.current = null;
    cancelCompose();
    try {
      if (draftId) {
        const trashed = await updateInboxFolder(draftId, "trash");
        if (trashed.ok) {
          await purgeInboxTrash(draftId);
        }
      }
    } finally {
      discardingComposeRef.current = false;
      await onReload();
    }
  }

  function moveItem(itemId: string, next: InboxFolder) {
    setPending(true);
    void updateInboxFolder(itemId, next).then(async (result) => {
      setPending(false);
      if (!result.ok) {
        setComposeError(result.error);
        return;
      }
      selectConversation(null);
      await onReload();
    });
  }

  function purgeTrashItem(itemId: string) {
    const ok = window.confirm(
      "Delete this conversation forever? This cannot be undone.",
    );
    if (!ok) return;
    setPending(true);
    void purgeInboxTrash(itemId).then(async (result) => {
      setPending(false);
      if (!result.ok) {
        setComposeError(result.error);
        return;
      }
      selectConversation(null);
      await onReload();
    });
  }

  function onSend(opts?: { attachments?: ComposeAttachment[] }) {
    if (!composeKind || pending) return;
    setComposeError(null);
    const attachments = opts?.attachments ?? [];

    if (composeKind === "email") {
      if (!composeTo.trim()) {
        setComposeError("Enter a recipient email address.");
        return;
      }
      if (!htmlToPlainText(message).trim() && !subject.trim()) {
        setComposeError("Write a subject or message before sending.");
        return;
      }
    } else if (!composePhone.trim()) {
      setComposeError("Enter a phone number.");
      return;
    }

    setPending(true);
    void (async () => {
      const contactId = await resolveComposeContactId();
      if (!contactId) {
        setPending(false);
        return;
      }

      const recipientLabel =
        composeContact?.displayName ?? (composeKind === "email" ? composeTo.trim() : composePhone.trim());
      const subj =
        subject.trim() ||
        (composeKind === "email" ? `Message for ${recipientLabel}` : `Outbound call — ${recipientLabel}`);
      const bodyText =
        composeKind === "email"
          ? (() => {
              const writtenHtml = composeMessageLooksHtml(message)
                ? message.trim()
                : plainTextToEmailHtml(message);
              const quote = replyContext?.quotedHistory?.trim();
              const quoteHtml = quote
                ? `<blockquote>${escapeHtmlText(quote).replace(/\n/g, "<br>")}</blockquote>`
                : "";
              const combined = `${htmlToPlainText(writtenHtml).trim() ? writtenHtml : ""}${quoteHtml}`.trim();
              return sanitizeEmailHtml(combined || "<p>(No message body)</p>");
            })()
          : message.trim() || `Called ${recipientLabel}`;

      if (composeKind === "email") {
        const contentCheck = validateOutboundEmailContent({
          subject: subj,
          body: bodyText,
        });
        if (!contentCheck.ok) {
          setPending(false);
          setComposeError(contentCheck.error);
          return;
        }

        const toAddress = composeTo.trim();
        const sendResult = await sendInboxEmail({
          contactId,
          to: toAddress,
          subject: subj,
          body: bodyText,
          cc: cc.trim() || undefined,
          threadId: replyContext?.threadId ?? null,
          gmailThreadId: replyContext?.gmailThreadId ?? null,
          inReplyToRfcMessageId: replyContext?.rfcMessageId ?? null,
          inReplyToGmailMessageId: replyContext?.gmailMessageId ?? null,
          attachments: attachments.map((file) => ({
            filename: file.filename,
            contentType: file.contentType,
            content: file.contentBase64,
          })),
        });

        setPending(false);
        if (!sendResult.ok) {
          setComposeError(
            sendResult.needsConnect
              ? `${sendResult.error} Open Configuration → Email to connect or reconnect your account, then try again.`
              : sendResult.error,
          );
          return;
        }

        await clearEditingDraft();
        cancelCompose();
        setFolder("sent");
        await onReload();
        return;
      }

      const result = await createContactActivity(contactId, {
        type: "call",
        subject: subj,
        body: bodyText,
      });
      setPending(false);

      if (!result.ok) {
        setComposeError(result.error);
        return;
      }

      if (composeKind === "call" && composePhone.trim()) {
        window.location.href = `tel:${composePhone.trim().replace(/[^\d+]/g, "")}`;
      }

      await clearEditingDraft();
      cancelCompose();
      await onReload();
    })();
  }

  function backToList() {
    void closeCompose({ goToDrafts: true });
    selectConversation(null);
  }

  const showMobileDetail = composing || (selected !== null && composeKind === null);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-white">
      {liveSyncHint ? (
        <div className="shrink-0 border-b border-[#bfbfbf]/80 bg-[#FEF4EC] px-3 py-2 text-sm text-[#874400] sm:px-4">
          {liveSyncHint}{" "}
          <Link to="/configuration/email" className="font-medium underline underline-offset-2">
            Open Email settings
          </Link>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#bfbfbf]/80 bg-white px-3 py-2.5 sm:px-4">
        <div className={`${WORKTUAL_SEGMENT_SHELL} max-w-full overflow-x-auto`}>
          {FOLDERS.map((f) => {
            const active = folder === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  void (async () => {
                    if (composeKind) {
                      await closeCompose({ goToDrafts: f.id === "draft" });
                    }
                    setFolder(f.id);
                    if (!isMdUp) selectConversation(null);
                  })();
                }}
                className={`relative shrink-0 rounded-md px-3 text-sm font-medium transition-colors ${
                  active
                    ? "h-[34px] bg-neutral-900 text-white"
                    : "h-[34px] text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {f.label}
                {f.id === "draft" && draftCount > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-text-danger px-1.5 text-[10px] font-semibold text-white">
                    {draftCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 w-full flex-1">
        <aside
          className={`min-h-0 w-full shrink-0 flex-col border-r border-[#e5e5e5] bg-white md:w-[300px] lg:w-[320px] ${
            showMobileDetail ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#bfbfbf]/80 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[18px] font-semibold text-neutral-900">Conversations</p>
              <p className="truncate text-xs text-text-caption">
                {folderItems.length} {folderItems.length === 1 ? "item" : "items"}
                {lastSyncAt ? ` · synced ${lastSyncAt}` : ""}
              </p>
            </div>
            <div className={WORKTUAL_HEADER_ICON_GROUP}>
              <button
                type="button"
                className={`${WORKTUAL_ICON_BUTTON} disabled:opacity-50`}
                title="Sync mailbox now"
                disabled={syncing}
                onClick={() => void runSync()}
              >
                <RefreshCw className={`size-[18px] ${syncing ? "animate-spin" : ""}`} strokeWidth={2.25} />
              </button>
              <div
                className="relative"
                ref={composeWrapRef}
                onMouseEnter={() => {
                  if (!composeKind) setComposeMenuOpen(true);
                }}
                onMouseLeave={() => {
                  if (!composeKind) setComposeMenuOpen(false);
                }}
              >
                <button
                  type="button"
                  className={`${WORKTUAL_ICON_BUTTON} ${
                    composeMenuOpen || composeKind
                      ? "bg-neutral-100 text-neutral-900"
                      : ""
                  }`}
                  title="Compose"
                  onClick={() => {
                    if (composeKind) void closeCompose({ goToDrafts: true });
                  }}
                >
                  <PenSquare className="size-[18px]" strokeWidth={2.25} />
                </button>

                {composeMenuOpen && !composeKind ? (
                  <div className="absolute top-full right-0 z-30 pt-1 sm:left-0 sm:right-auto">
                    <div className="min-w-[148px] overflow-hidden rounded-xl border border-border-default bg-surface py-1 shadow-lg">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-subtle"
                        onClick={() => startCompose("email")}
                      >
                        <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#FEF4EC] text-[#874400]">
                          <Mail className="size-3.5" strokeWidth={1.75} />
                        </span>
                        Email
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-subtle"
                        onClick={() => startCompose("call")}
                      >
                        <span className="inline-flex size-7 items-center justify-center rounded-full bg-violet-0 text-brand">
                          <Phone className="size-3.5" strokeWidth={1.75} />
                        </span>
                        Call
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {folderItems.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-16 text-center">
                <InboxIcon className="size-8 text-text-caption" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium text-text-primary">
                  {folder === "inbox" ? "Inbox is empty" : `No ${folder} items`}
                </p>
                <p className="mt-1 text-xs text-text-caption">Use compose to email or call a contact.</p>
              </div>
            ) : (
              grouped.map(([label, list]) => (
                <div key={label} className="pb-2">
                  <p className="sticky top-0 z-10 bg-white/95 px-4 py-2 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase backdrop-blur">
                    {label}
                  </p>
                  <ul>
                    {list.map((item) => {
                      const meta = typeMeta(item.type);
                      const Icon = meta.icon;
                      const active =
                        item.id === selectedId && (!composing || Boolean(replyContext));
                      return (
                        <li key={item.threadId || item.id}>
                          <button
                            type="button"
                            onClick={() => {
                              void (async () => {
                                const isDraftItem = isInboxDraftItem(item);
                                if (composeKind && editingDraftId === item.id) return;
                                if (composeKind) await closeCompose();
                                if (isDraftItem) {
                                  continueDraft(item);
                                  return;
                                }
                                selectConversation(item);
                              })();
                            }}
                            className={`relative flex w-full items-start gap-3 border-b border-[#e5e5e5] px-4 py-3 text-left transition-colors last:border-0 ${
                              active ? "bg-neutral-50" : "hover:bg-neutral-50/80"
                            }`}
                          >
                            {active ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[#111111]" /> : null}
                            <span className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full ${meta.iconWrap}`}>
                              <Icon className="size-4" strokeWidth={1.75} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-semibold text-text-primary">
                                  {item.contactName}
                                  {item.emailDirection === "inbound" ||
                                  item.messages?.some((m) => m.emailDirection === "inbound") ? (
                                    <span className="ml-1.5 inline-flex align-middle rounded bg-[#FEF4EC] px-1.5 py-0.5 text-[10px] font-semibold text-[#874400]">
                                      Customer
                                    </span>
                                  ) : null}
                                </p>
                                <span className="shrink-0 text-[11px] text-text-caption">{timeLabel(item.createdAt)}</span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-text-caption">
                                {item.emailDirection === "inbound" ? "Received" : meta.label}
                                {item.subject ? ` · ${item.subject}` : ""}
                                {item.messageCount > 1 ? ` · ${item.messageCount} messages` : ""}
                              </p>
                              {item.needsManualResponse ? (
                                <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-border-default bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-text-danger">
                                  <AlertTriangle className="size-3" strokeWidth={2} />
                                  Manual response needed
                                </span>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className={`min-w-0 flex-1 flex-col bg-subtle/40 ${showMobileDetail ? "flex" : "hidden md:flex"}`}>
          {composeKind === "email" &&
          replyContext &&
          selected &&
          threadHasVisibleHistory(selected, editingDraftId) ? (
            <ThreadView
              selected={selected}
              organizerName={currentUser?.name?.trim() || "You"}
              expanded={expanded}
              setExpanded={setExpanded}
              showDetails={showDetails}
              setShowDetails={setShowDetails}
              panelOpen={panelOpen}
              setPanelOpen={setPanelOpen}
              onBack={backToList}
              onReply={() => void startReply(selected, "reply")}
              onReplyAll={() => void startReply(selected, "reply_all")}
              onEditDraft={() => continueDraft(selected)}
              onComposeEmail={() => startComposeToSelected("email", selected)}
              onCall={() => startComposeToSelected("call", selected)}
              inTrash={folder === "trash"}
              editingDraftId={editingDraftId}
              onTrash={() =>
                folder === "trash"
                  ? purgeTrashItem(selected.id)
                  : moveItem(selected.id, "trash")
              }
              onRestore={
                folder === "trash"
                  ? () => moveItem(selected.id, "inbox")
                  : undefined
              }
              replyComposer={
                <ComposePanel
                  variant="inline"
                  kind="email"
                  contact={composeContact}
                  companyName={selected?.companyName ?? null}
                  toEmail={composeTo}
                  setToEmail={setComposeTo}
                  onSelectContact={selectComposeContact}
                  contacts={contacts}
                  subject={subject}
                  setSubject={setSubject}
                  message={message}
                  setMessage={setMessage}
                  showCc={showCc}
                  setShowCc={setShowCc}
                  cc={cc}
                  setCc={setCc}
                  error={composeError}
                  notice={composeNotice}
                  pending={pending}
                  isDraft={editingDraftId !== null}
                  isReply={true}
                  inboundBody={replyContext?.inboundBody ?? ""}
                  quotedHistory={replyContext?.quotedHistory ?? ""}
                  onCancel={() => void discardCompose()}
                  onClose={() => void closeCompose({ goToDrafts: true })}
                  onSend={onSend}
                />
              }
            />
          ) : composeKind === "email" ? (
            <ComposePanel
              kind="email"
              contact={composeContact}
              companyName={selected?.companyName ?? null}
              toEmail={composeTo}
              setToEmail={setComposeTo}
              onSelectContact={selectComposeContact}
              contacts={contacts}
              subject={subject}
              setSubject={setSubject}
              message={message}
              setMessage={setMessage}
              showCc={showCc}
              setShowCc={setShowCc}
              cc={cc}
              setCc={setCc}
              error={composeError}
              notice={composeNotice}
              pending={pending}
              isDraft={editingDraftId !== null}
              isReply={Boolean(replyContext)}
              inboundBody={replyContext?.inboundBody ?? ""}
              quotedHistory={replyContext?.quotedHistory ?? ""}
              onCancel={() => void discardCompose()}
              onClose={() => void closeCompose({ goToDrafts: true })}
              onSend={onSend}
              onBack={backToList}
            />
          ) : composeKind === "call" ? (
            <ComposePanel
              kind="call"
              contact={composeContact}
              toPhone={composePhone}
              setToPhone={setComposePhone}
              onSelectContact={selectComposeContact}
              contacts={contacts}
              subject={subject}
              setSubject={setSubject}
              message={message}
              setMessage={setMessage}
              showCc={showCc}
              setShowCc={setShowCc}
              cc={cc}
              setCc={setCc}
              error={composeError}
              pending={pending}
              isDraft={editingDraftId !== null}
              isReply={false}
              onCancel={() => void discardCompose()}
              onClose={() => void closeCompose()}
              onSend={onSend}
              onBack={backToList}
            />
          ) : selected ? (
            <ThreadView
              selected={selected}
              organizerName={currentUser?.name?.trim() || "You"}
              expanded={expanded}
              setExpanded={setExpanded}
              showDetails={showDetails}
              setShowDetails={setShowDetails}
              panelOpen={panelOpen}
              setPanelOpen={setPanelOpen}
              onBack={backToList}
              onReply={() => void startReply(selected, "reply")}
              onReplyAll={() => void startReply(selected, "reply_all")}
              onEditDraft={() => continueDraft(selected)}
              onComposeEmail={() => startComposeToSelected("email", selected)}
              onCall={() => startComposeToSelected("call", selected)}
              inTrash={folder === "trash"}
              onTrash={() =>
                folder === "trash"
                  ? purgeTrashItem(selected.id)
                  : moveItem(selected.id, "trash")
              }
              onRestore={
                folder === "trash"
                  ? () => moveItem(selected.id, "inbox")
                  : undefined
              }
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <PenSquare className="size-10 text-text-caption" strokeWidth={1.4} />
              <p className="mt-3 text-sm font-medium text-text-primary">Select a conversation or compose</p>
              <p className="mt-1 max-w-sm text-sm text-text-caption">Click the compose icon to start an email or call.</p>
            </div>
          )}
        </section>

        {panelOpen && sideContact ? (
          <>
            <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border-default bg-surface xl:flex">
              <ContactPanel
                sideContact={sideContact}
                aboutOpen={aboutOpen}
                setAboutOpen={setAboutOpen}
                onClose={() => setPanelOpen(false)}
                onSchedule={() => setScheduleOpen(true)}
                onEmailContact={
                  selected
                    ? () => startReply(selected)
                    : sideContact.contactEmail
                      ? () => {
                          startCompose("email");
                          selectComposeContact({
                            id: sideContact.contactId,
                            displayName: sideContact.contactName,
                            email: sideContact.contactEmail ?? "",
                            phone: sideContact.contactPhone,
                          });
                        }
                      : undefined
                }
              />
            </aside>

            <div className="fixed inset-0 z-40 xl:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-black/55"
                aria-label="Close contact panel"
                onClick={() => setPanelOpen(false)}
              />
              <aside className="absolute inset-y-0 right-0 flex w-[min(320px,92vw)] flex-col bg-surface shadow-xl">
                <ContactPanel
                  sideContact={sideContact}
                  aboutOpen={aboutOpen}
                  setAboutOpen={setAboutOpen}
                  onClose={() => setPanelOpen(false)}
                  onSchedule={() => setScheduleOpen(true)}
                  onEmailContact={
                    selected
                      ? () => startReply(selected)
                      : sideContact.contactEmail
                        ? () => {
                            startCompose("email");
                            selectComposeContact({
                              id: sideContact.contactId,
                              displayName: sideContact.contactName,
                              email: sideContact.contactEmail ?? "",
                              phone: sideContact.contactPhone,
                            });
                          }
                        : undefined
                  }
                />
              </aside>
            </div>
          </>
        ) : null}
      </div>

      {scheduleOpen && sideContact?.contactEmail ? (
        <ScheduleMeetingDialog
          contactId={sideContact.contactId}
          displayName={sideContact.contactName}
          email={sideContact.contactEmail}
          onClose={() => setScheduleOpen(false)}
          onScheduled={() => void onReload()}
        />
      ) : null}
    </div>
  );
}

function ComposePanel({
  variant = "panel",
  kind,
  contact,
  companyName,
  toEmail,
  setToEmail,
  toPhone,
  setToPhone,
  onSelectContact,
  contacts,
  subject,
  setSubject,
  message,
  setMessage,
  showCc,
  setShowCc,
  cc,
  setCc,
  error,
  notice = null,
  pending,
  isDraft,
  isReply,
  inboundBody,
  quotedHistory,
  onCancel,
  onClose,
  onSend,
  onBack,
}: {
  /** "inline" renders a compact reply box embedded below the thread (Gmail-style
   * scroll), instead of swapping the whole panel like a fresh compose screen. */
  variant?: "panel" | "inline";
  kind: ComposeKind;
  contact?: InboxContactOption | null;
  companyName?: string | null;
  toEmail?: string;
  setToEmail?: (v: string) => void;
  toPhone?: string;
  setToPhone?: (v: string) => void;
  onSelectContact?: (contact: ComposeContactOption | null) => void;
  contacts: InboxContactOption[];
  subject: string;
  setSubject: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  showCc: boolean;
  setShowCc: (v: boolean | ((p: boolean) => boolean)) => void;
  cc: string;
  setCc: (v: string) => void;
  error: string | null;
  notice?: string | null;
  pending: boolean;
  isDraft: boolean;
  isReply: boolean;
  inboundBody?: string;
  /** Prior message quote — collapsed like Gmail/Outlook until expanded. */
  quotedHistory?: string;
  onCancel: () => void;
  onClose?: () => void;
  onSend: (opts?: { attachments?: ComposeAttachment[] }) => void;
  onBack?: () => void;
}) {
  const [assistPending, setAssistPending] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistPrompt, setAssistPrompt] = useState("");
  const [assistSource, setAssistSource] = useState<"ai" | "heuristic" | null>(
    null,
  );
  const [showQuotedHistory, setShowQuotedHistory] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [formatState, setFormatState] = useState<RichTextFormatState>(
    EMPTY_RICH_TEXT_FORMAT,
  );
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const hasQuotedHistory = Boolean(quotedHistory?.trim());
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);

  // Grow the editor to the full draft so the user does not scroll inside a tiny box.
  useEffect(() => {
    if (variant !== "inline" || kind === "email") return;
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 200)}px`;
  }, [message, variant, assistPending, kind]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!emojiMenuRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [emojiOpen]);

  useEffect(() => {
    if (!formatOpen || kind !== "email") return;
    const refresh = () => {
      setFormatState(editorRef.current?.getFormatState() ?? EMPTY_RICH_TEXT_FORMAT);
    };
    refresh();
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, [formatOpen, kind, message]);

  const titlePrefix =
    kind === "call"
      ? isDraft
        ? "Edit call draft"
        : "New call"
      : isDraft
        ? "Edit draft"
        : isReply
          ? "Reply"
          : "New email";

  function runComposeAssist(instruction: string) {
    const trimmed = instruction.trim();
    if (!trimmed || kind !== "email") return;
    setAssistError(null);
    setAssistPending(true);
    const draftText = htmlToPlainText(message).trim();
    void composeInboxAssist({
      instruction: trimmed,
      contactId: contact?.id,
      contactName: contact?.displayName || "there",
      companyName: companyName ?? null,
      subject,
      currentBody: draftText || undefined,
      inboundBody: inboundBody || undefined,
      isReply,
    }).then((result) => {
      setAssistPending(false);
      if (!result.ok) {
        setAssistError(result.error);
        return;
      }
      setSubject(result.subject);
      // Keep Gmail-style quote collapsed separately — only replace the new reply text.
      setMessage(plainTextToEmailHtml(result.body.trim()));
      setAssistPrompt("");
      setAssistSource(result.source);
    });
  }

  function insertEmoji(emoji: string) {
    if (kind === "email") {
      editorRef.current?.insertText(emoji);
      setEmojiOpen(false);
      return;
    }
    const el = bodyRef.current;
    if (!el) {
      setMessage(message + emoji);
      setEmojiOpen(false);
      return;
    }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const next = `${message.slice(0, start)}${emoji}${message.slice(end)}`;
    setMessage(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setAttachError(null);
    const next = [...attachments];
    for (const file of Array.from(fileList)) {
      if (next.length >= COMPOSE_MAX_ATTACHMENTS) {
        setAttachError(`You can attach up to ${COMPOSE_MAX_ATTACHMENTS} files.`);
        break;
      }
      if (file.size > COMPOSE_MAX_FILE_BYTES) {
        setAttachError(`“${file.name}” exceeds the 5 MB per-file limit.`);
        continue;
      }
      try {
        const contentBase64 = await readFileAsBase64(file);
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          contentBase64,
        });
      } catch {
        setAttachError(`Could not read “${file.name}”.`);
      }
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const quotedHistoryBlock =
    kind === "email" && hasQuotedHistory ? (
      <div className="shrink-0 px-4 pb-3 sm:px-5">
        <button
          type="button"
          className="inline-flex h-7 items-center rounded-md border border-border-default bg-subtle px-2.5 text-xs font-medium tracking-widest text-text-caption hover:bg-surface hover:text-text-primary"
          onClick={() => setShowQuotedHistory((v) => !v)}
          title={showQuotedHistory ? "Hide quoted text" : "Show quoted text"}
          aria-expanded={showQuotedHistory}
        >
          ···
        </button>
        {showQuotedHistory ? (
          <blockquote className="mt-2 max-h-48 overflow-y-auto border-l-2 border-border-default pl-3 text-xs leading-5 text-text-caption">
            <RichStructuredContent
              text={quotedHistory!.replace(/^\n+/, "")}
              variant="muted"
            />
          </blockquote>
        ) : null}
      </div>
    ) : null;

  const messageArea = (
    <div
      className={
        variant === "inline"
          ? "flex flex-col"
          : "flex min-h-0 flex-1 flex-col overflow-y-auto"
      }
    >
      {kind === "email" ? (
        <div
          className={
            variant === "inline"
              ? "px-2 pt-1 sm:px-3"
              : "min-h-0 flex-1 px-2 pt-2 sm:px-3"
          }
        >
          <RichTextEditor
            ref={editorRef}
            valueHtml={
              composeMessageLooksHtml(message)
                ? message
                : plainTextToEmailHtml(message)
            }
            onChange={setMessage}
            disabled={pending || assistPending}
            placeholder="Write a message"
            minHeightClass={
              variant === "inline"
                ? "min-h-[200px]"
                : "min-h-[200px] sm:min-h-[260px]"
            }
            maxHeightClass={variant === "inline" ? "max-h-none" : "max-h-[40dvh]"}
            showToolbar={false}
            bare
          />
        </div>
      ) : (
        <textarea
          ref={bodyRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (variant !== "inline") return;
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.max(el.scrollHeight, 200)}px`;
          }}
          placeholder="Add call notes (optional)"
          autoComplete="off"
          name="crm-compose-body"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          autoFocus={variant === "inline"}
          className={
            variant === "inline"
              ? "min-h-[200px] w-full resize-none overflow-hidden bg-surface px-4 py-3 text-sm leading-6 text-text-primary outline-none placeholder:text-text-placeholder sm:px-5"
              : "min-h-[200px] w-full flex-1 resize-none bg-surface px-4 py-4 text-sm leading-6 text-text-primary outline-none placeholder:text-text-placeholder sm:min-h-[260px] sm:px-5"
          }
        />
      )}
      {quotedHistoryBlock}
    </div>
  );

  const feedbackRow =
    error || assistError || attachError ? (
      <p className="px-4 pb-2 text-sm text-text-danger sm:px-5">
        {error || assistError || attachError}
      </p>
    ) : notice ? (
      <p className="px-4 pb-2 text-sm text-text-caption sm:px-5">{notice}</p>
    ) : assistSource ? (
      <p className="px-4 pb-2 text-xs text-text-caption sm:px-5">
        {assistSource === "ai"
          ? "Generated by AI — review before sending."
          : "Offline draft (AI unavailable) — edit before sending."}
      </p>
    ) : null;

  const attachmentRow =
    attachments.length > 0 ? (
      <ul className="flex flex-wrap gap-2 px-3 pb-2 sm:px-4">
        {attachments.map((file) => (
          <li
            key={file.id}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-default bg-subtle/70 px-2.5 py-1.5 text-xs text-text-secondary"
          >
            <Paperclip className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate font-medium text-text-primary">
              {file.filename}
            </span>
            <span className="shrink-0 text-text-caption">
              {formatComposeFileSize(file.size)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${file.filename}`}
              disabled={pending}
              className="rounded p-0.5 text-text-caption hover:bg-surface hover:text-text-primary"
              onClick={() =>
                setAttachments((prev) => prev.filter((item) => item.id !== file.id))
              }
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  const assistRow =
    kind === "email" ? (
      <div className="shrink-0 border-t border-border-default px-3 py-2.5 sm:px-4">
        <ComposeAssistField
          value={assistPrompt}
          onChange={setAssistPrompt}
          onSubmit={runComposeAssist}
          pending={assistPending}
          disabled={pending}
        />
      </div>
    ) : null;

  const formatToolbar =
    formatOpen && kind === "email" ? (
      <div className="shrink-0 px-3 pb-2 pt-1 sm:px-4">
        <ComposeFormatToolbar
          disabled={pending || assistPending}
          state={formatState}
          onExec={(command, value) => {
            editorRef.current?.exec(command, value);
            setFormatState(
              editorRef.current?.getFormatState() ?? EMPTY_RICH_TEXT_FORMAT,
            );
          }}
        />
      </div>
    ) : null;

  const footerRow = (
    <div className="shrink-0 border-t border-border-default px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1 text-text-caption">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void onPickFiles(e.target.files)}
        />
        <div className="relative" ref={emojiMenuRef}>
          <button
            type="button"
            className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-subtle hover:text-text-primary disabled:cursor-not-allowed ${
              emojiOpen ? "bg-subtle text-text-primary" : ""
            }`}
            title="Insert emoji"
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            disabled={pending}
            onClick={() => {
              setFormatOpen(false);
              setEmojiOpen((open) => !open);
            }}
          >
            <Smile className="size-4" />
          </button>
          {emojiOpen ? (
            <div className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-border-default bg-surface p-2 shadow-lg">
              <div className="grid grid-cols-8 gap-0.5">
                {COMPOSE_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-base hover:bg-subtle"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${
            formatOpen ? "bg-subtle text-text-primary" : ""
          }`}
          title={kind === "email" ? "Text formatting" : "Formatting is available for email"}
          aria-label="Text formatting"
          aria-pressed={formatOpen}
          disabled={pending || kind !== "email"}
          onClick={() => {
            setEmojiOpen(false);
            setFormatOpen((open) => {
              const next = !open;
              if (next) editorRef.current?.focus();
              return next;
            });
          }}
        >
          <Type className="size-4" />
        </button>
        <button
          type="button"
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          title={
            kind === "email"
              ? attachments.length >= COMPOSE_MAX_ATTACHMENTS
                ? `Up to ${COMPOSE_MAX_ATTACHMENTS} files`
                : "Attach files"
              : "Attachments are available for email"
          }
          aria-label="Attach files"
          disabled={
            pending ||
            kind !== "email" ||
            attachments.length >= COMPOSE_MAX_ATTACHMENTS
          }
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-danger disabled:cursor-not-allowed"
          title="Discard without saving"
          aria-label="Discard without saving"
          onClick={onCancel}
          disabled={pending}
        >
          <Trash2 className="size-4" />
        </button>
        <Button
          type="button"
          variant="brand"
          className="min-w-[96px] cursor-pointer"
          disabled={pending}
          onClick={() => onSend({ attachments })}
        >
          {pending ? "Sending…" : kind === "call" ? "Call" : "Send"}
        </Button>
      </div>
      </div>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="mt-3 overflow-hidden rounded-xl border border-border-default bg-surface shadow-[0_1px_2px_rgba(11,11,16,0.04)]">
        <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-2.5 sm:px-5">
          <p className="min-w-0 truncate text-sm">
            <span className="font-semibold text-text-primary">{titlePrefix}</span>
            {contact ? (
              <span className="text-text-caption"> to {contact.displayName || contact.email}</span>
            ) : toEmail ? (
              <span className="text-text-caption"> to {toEmail}</span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 text-sm text-text-caption hover:text-text-primary"
              onClick={() => setShowCc((v) => !v)}
            >
              Cc / Bcc
            </button>
            {onClose ? (
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
                title="Close and save draft"
                aria-label="Close and save draft"
                disabled={pending}
                onClick={onClose}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>

        {showCc ? (
          <label className="flex items-center gap-3 border-b border-border-default px-4 py-2.5 sm:px-5">
            <span className="w-14 shrink-0 text-xs text-text-caption">Cc</span>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              autoComplete="off"
              name="crm-compose-cc-inline"
              data-1p-ignore
              data-lpignore="true"
              className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder"
            />
          </label>
        ) : null}

        {messageArea}
        {attachmentRow}
        {feedbackRow}
        {formatToolbar}
        {assistRow}
        {footerRow}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {onBack ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle md:hidden"
              onClick={onBack}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <span
            className={`inline-flex size-8 items-center justify-center rounded-full ${
              kind === "email" ? "bg-[#FEF4EC] text-[#874400]" : "bg-violet-0 text-brand"
            }`}
          >
            {kind === "email" ? <Mail className="size-4" strokeWidth={1.75} /> : <Phone className="size-4" strokeWidth={1.75} />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{titlePrefix}</p>
            {kind === "email" ? (
              <p className="truncate text-[11px] text-text-caption">
                Unsent writing saves to Drafts when you leave · trash discards
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {kind === "email" ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 text-sm text-text-caption hover:text-text-primary"
              onClick={() => setShowCc((v) => !v)}
            >
              Cc Bcc
              <ChevronDown className="size-3.5" />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
              title="Close and save draft"
              aria-label="Close and save draft"
              disabled={pending}
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {kind === "email" ? (
          <div className="shrink-0 space-y-0 border-b border-border-default">
            <RecipientEmailField
              toEmail={toEmail ?? ""}
              onToEmailChange={(value) => setToEmail?.(value)}
              selectedContact={contact ? { id: contact.id, displayName: contact.displayName, email: contact.email, phone: contact.phone } : null}
              onSelectContact={onSelectContact}
              contacts={contacts}
              disabled={pending}
            />
            {showCc ? (
              <label className="flex items-center gap-3 border-t border-border-default px-4 py-2.5 sm:px-5">
                <span className="w-14 shrink-0 text-xs text-text-caption">Cc</span>
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  autoComplete="off"
                  name="crm-compose-cc"
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder"
                />
              </label>
            ) : null}
            <label className="flex items-center gap-3 border-t border-border-default px-4 py-2.5 sm:px-5">
              <span className="w-14 shrink-0 text-xs text-text-caption">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Add Subject here"
                autoComplete="off"
                name="crm-compose-subject"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder"
              />
            </label>
          </div>
        ) : kind === "call" ? (
          <div className="shrink-0 border-b border-border-default">
            <RecipientPhoneField
              phone={toPhone ?? ""}
              onPhoneChange={(value) => setToPhone?.(value)}
              selectedContact={contact ? { id: contact.id, displayName: contact.displayName, email: contact.email, phone: contact.phone } : null}
              onSelectContact={onSelectContact}
              contacts={contacts}
              disabled={pending}
            />
          </div>
        ) : null}

        {messageArea}
        {attachmentRow}
        {feedbackRow}
        {formatToolbar}
        {assistRow}
        {footerRow}
      </div>
    </div>
  );
}


function ThreadView({
  selected,
  organizerName,
  expanded,
  setExpanded,
  showDetails,
  setShowDetails,
  panelOpen,
  setPanelOpen,
  onBack,
  onReply,
  onReplyAll,
  onEditDraft,
  onComposeEmail,
  onCall,
  onTrash,
  onRestore,
  inTrash,
  editingDraftId = null,
  replyComposer,
}: {
  selected: InboxItem;
  organizerName: string;
  expanded: boolean;
  setExpanded: (v: boolean | ((p: boolean) => boolean)) => void;
  showDetails: boolean;
  setShowDetails: (v: boolean | ((p: boolean) => boolean)) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  onBack?: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onEditDraft?: () => void;
  onComposeEmail: () => void;
  onCall: () => void;
  onTrash: () => void;
  onRestore?: () => void;
  inTrash: boolean;
  editingDraftId?: string | null;
  /** Gmail-style inline reply box appended below the thread — scrolls with it
   * instead of swapping the whole panel out. */
  replyComposer?: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const replyComposerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!replyComposer) return;
    const node = replyComposerRef.current;
    if (!node) return;
    const timer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "end" });
      const field = node.querySelector<HTMLElement>(
        "textarea, [contenteditable='true'], input:not([type='hidden'])",
      );
      field?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [replyComposer, selected.id]);

  const isDraftThread = isInboxDraftItem(selected);
  const isMeetingThread =
    selected.type === "meeting" || selected.messages?.every((m) => m.type === "meeting");
  const isCallThread =
    selected.type === "call" || selected.messages?.every((m) => m.type === "call");
  const isSmsThread =
    selected.type === "sms" || selected.messages?.every((m) => m.type === "sms");
  const threadKindLabel = isDraftThread
    ? "Draft"
    : isMeetingThread
      ? "Meeting"
      : isCallThread
        ? "Call"
        : isSmsThread
          ? "SMS"
          : "Email";
  const messages: InboxThreadMessage[] = (
    selected.messages?.length > 0
      ? selected.messages
      : [
          {
            id: selected.id,
            contactId: selected.contactId,
            type: selected.type,
            subject: selected.subject,
            body: selected.body,
            dueAt: selected.dueAt,
            createdAt: selected.createdAt,
            folder: selected.folder,
            threadId: selected.threadId,
            gmailMessageId: selected.gmailMessageId,
            gmailThreadId: selected.gmailThreadId,
            rfcMessageId: selected.rfcMessageId,
            emailDirection: selected.emailDirection,
            needsManualResponse: selected.needsManualResponse,
          },
        ]
  ).filter((m) => {
    if (!inTrash && m.folder === "trash") return false;
    // Empty / quote-only leftovers are not real drafts.
    if (m.folder === "draft" && !hasUserDraftContent(m.body)) return false;
    // While editing, the composer is the only draft view — don't duplicate it above.
    if (replyComposer && (m.folder === "draft" || m.id === editingDraftId)) {
      return false;
    }
    return true;
  });
  const rootSubject = messages[0]?.subject ?? selected.subject;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-default bg-surface px-3 py-3 sm:gap-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-1.5">
          {onBack ? (
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-caption hover:bg-subtle md:hidden"
              onClick={onBack}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <span
            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full ${
              isMeetingThread
                ? "bg-[#E8B84A] text-white"
                : isCallThread
                  ? "bg-violet-0 text-brand"
                  : isSmsThread
                    ? "bg-[#F6FBF9] text-text-success"
                    : "bg-[#FEF4EC] text-[#874400]"
            }`}
          >
            {isMeetingThread ? (
              <Calendar className="size-4" strokeWidth={1.75} />
            ) : isCallThread ? (
              <Phone className="size-4" strokeWidth={1.75} />
            ) : isSmsThread ? (
              <MessageSquare className="size-4" strokeWidth={1.75} />
            ) : (
              <Mail className="size-4" strokeWidth={1.75} />
            )}
          </span>
          <p className="truncate text-sm font-semibold text-text-primary">
            {threadKindLabel} — {selected.contactName}
          </p>
          {selected.needsManualResponse ? (
            <span
              className="ml-1 inline-flex shrink-0 items-center gap-1 rounded border border-border-default bg-subtle px-2 py-0.5 text-[11px] font-semibold text-text-danger"
              title="This message needs a human response."
            >
              <AlertTriangle className="size-3" strokeWidth={2} />
              <span className="hidden sm:inline">Manual response needed</span>
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {isDraftThread && onEditDraft && !inTrash ? (
            <Button type="button" className="h-9 px-2.5 sm:px-4" onClick={onEditDraft}>
              <PenSquare className="size-4" strokeWidth={1.75} />
              <span className="hidden sm:inline">Edit draft</span>
            </Button>
          ) : null}
          {selected.contactEmail && !inTrash && !isMeetingThread && !isDraftThread ? (
            <>
              <Button type="button" variant="secondary" className="h-9 px-2.5 sm:px-4" onClick={onReply}>
                <Reply className="size-4" strokeWidth={1.75} />
                <span className="hidden sm:inline">Reply</span>
              </Button>
              <Button type="button" variant="secondary" className="h-9 px-2.5 sm:px-4" onClick={onReplyAll}>
                <ReplyAll className="size-4" strokeWidth={1.75} />
                <span className="hidden sm:inline">Reply all</span>
              </Button>
            </>
          ) : null}
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
            title={panelOpen ? "Hide contact" : "Show contact"}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </button>
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MoreVertical className="size-4" />
            </button>
            {moreOpen ? (
              <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-border-default bg-surface py-1 shadow-lg">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-subtle"
                  onClick={() => {
                    setMoreOpen(false);
                    onComposeEmail();
                  }}
                >
                  <Mail className="size-4 text-text-caption" />
                  Compose new email
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-subtle"
                  onClick={() => {
                    setMoreOpen(false);
                    onCall();
                  }}
                >
                  <Phone className="size-4 text-text-caption" />
                  Call
                </button>
                {inTrash && onRestore ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-subtle"
                    onClick={() => {
                      setMoreOpen(false);
                      onRestore();
                    }}
                  >
                    <InboxIcon className="size-4 text-text-caption" />
                    Restore to inbox
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-danger hover:bg-subtle"
                  onClick={() => {
                    setMoreOpen(false);
                    onTrash();
                  }}
                >
                  <Trash2 className="size-4" />
                  {inTrash ? "Delete forever" : "Move to trash"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        <article className="overflow-hidden rounded-xl border border-border-default bg-surface shadow-[0_1px_2px_rgba(11,11,16,0.04)]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 border-b border-border-default bg-subtle/50 px-3 py-3 text-left sm:px-4"
            onClick={() => setExpanded((v) => !v)}
          >
            <div className="flex min-w-0 items-center gap-2">
              {expanded ? (
                <ChevronUp className="size-4 shrink-0 text-text-caption" />
              ) : (
                <ChevronDown className="size-4 shrink-0 text-text-caption" />
              )}
              <span className="truncate text-sm font-medium text-text-primary">
                {isMeetingThread ? meetingTitle(rootSubject) : rootSubject}
              </span>
              {messages.length > 1 ? <span className="shrink-0 text-xs text-text-caption">({messages.length})</span> : null}
            </div>
            <span className="hidden shrink-0 text-xs text-text-caption sm:inline">{fullWhen(selected.createdAt)}</span>
          </button>

          {expanded ? (
            <div className="divide-y divide-border-default">
              {messages.map((msg) => {
                if (msg.type === "meeting") {
                  return (
                    <div key={msg.id} className="px-4 py-4 sm:px-5">
                      <MeetingCard msg={msg} organizerName={organizerName} />
                    </div>
                  );
                }
                const inbound = msg.emailDirection === "inbound";
                const isEmail = msg.type === "email";
                const msgIsDraft = msg.folder === "draft";
                const msgIsTrash = msg.folder === "trash";
                const directionLabel = isEmail
                  ? msgIsDraft
                    ? " · Draft"
                    : msgIsTrash
                      ? " · Trash"
                      : inbound
                        ? " · Received"
                        : " · Sent"
                  : msg.type === "call"
                    ? msgIsDraft
                      ? " · Draft"
                      : " · Call logged"
                    : msg.type === "sms"
                      ? msgIsDraft
                        ? " · Draft"
                        : inbound
                          ? " · Received"
                          : " · Sent"
                      : "";
                return (
                  <div key={msg.id} className="px-4 py-4 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white"
                        >
                          {initialsFromName(inbound ? selected.contactName : "You")}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary">{inbound ? selected.contactName : "You"}</p>
                          <p className="mt-0.5 text-xs text-text-caption">
                            {fullWhen(msg.createdAt)}
                            {directionLabel}
                          </p>
                          {showDetails && isEmail ? (
                            <dl className="mt-2 rounded-lg bg-subtle px-3 py-2 text-xs text-text-caption">
                              <div>
                                {inbound ? "From" : "To"}: {selected.contactEmail || "—"}
                              </div>
                              <div className="mt-1">
                                Subject: {normalizeEmailSubjectForCompose(msg.subject || "")}
                              </div>
                            </dl>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {selected.contactEmail && !inTrash ? (
                          <>
                            <button
                              type="button"
                              className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
                              title="Reply"
                              onClick={onReply}
                            >
                              <Reply className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
                              title="Reply all"
                              onClick={onReplyAll}
                            >
                              <ReplyAll className="size-4" />
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-danger"
                          title={inTrash ? "Delete forever" : "Move to trash"}
                          onClick={onTrash}
                        >
                          <Trash2 className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-text-caption hover:bg-subtle hover:text-text-link"
                          onClick={() => setShowDetails((v) => !v)}
                        >
                          {showDetails ? "Hide" : "Show"} details
                          <ChevronDown className={`size-3 transition-transform ${showDetails ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>

                    <EmailBody body={msg.body} subject={msg.subject} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </article>

        {replyComposer ? (
          <div ref={replyComposerRef} className="scroll-mt-4">
            {replyComposer}
          </div>
        ) : null}
      </div>
    </>
  );
}

type SideContact = {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTitle?: string | null;
  companyName?: string | null;
  companyIndustry?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  contactType?: string | null;
  leadSource?: string | null;
  ownerUserId?: string | null;
};

function sideContactFromInboxItem(item: InboxItem): SideContact {
  return {
    contactId: item.contactId,
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    contactPhone: item.contactPhone,
    contactTitle: item.contactTitle ?? null,
    companyName: item.companyName ?? null,
    companyIndustry: item.companyIndustry ?? null,
    addressLine: item.addressLine ?? null,
    city: item.city ?? null,
    country: item.country ?? null,
    contactType: item.contactType ?? null,
    leadSource: item.leadSource ?? null,
    ownerUserId: item.ownerUserId ?? null,
  };
}

function sideContactFromComposeOption(contact: InboxContactOption): SideContact {
  return {
    contactId: contact.id,
    contactName: contact.displayName,
    contactEmail: contact.email || null,
    contactPhone: contact.phone,
    contactTitle: null,
    companyName: null,
    companyIndustry: null,
    addressLine: null,
    city: null,
    country: null,
    contactType: null,
    leadSource: null,
    ownerUserId: null,
  };
}

function ContactPanel({
  sideContact,
  aboutOpen,
  setAboutOpen,
  onClose,
  onEmailContact,
  onSchedule,
}: {
  sideContact: SideContact;
  aboutOpen: boolean;
  setAboutOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  onClose: () => void;
  onEmailContact?: () => void;
  onSchedule: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <p className="truncate text-sm font-semibold text-text-primary">{sideContact.contactName}</p>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
          onClick={onClose}
          title="Hide panel"
        >
          <X className="size-4 xl:hidden" />
          <PanelRightClose className="hidden size-4 xl:block" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <button
          type="button"
          className="flex w-full items-center justify-between py-2 text-left"
          onClick={() => setAboutOpen((v) => !v)}
        >
          <span className="text-sm font-semibold text-text-primary">About this contact</span>
          <ChevronDown className={`size-4 text-text-caption transition-transform ${aboutOpen ? "rotate-180" : ""}`} />
        </button>

        {aboutOpen ? (
          <dl>
            <Field label="Contact person" value={sideContact.contactName} />
            <Field label="Email" value={sideContact.contactEmail} wrap="all" />
            <Field label="Phone" value={sideContact.contactPhone} wrap="all" />
            <Field
              label="Address"
              value={
                [sideContact.addressLine, sideContact.city, sideContact.country].filter(Boolean).join(", ") || null
              }
            />
            <Field label="Source" value={sideContact.leadSource ?? null} />
            <Field label="Stage" value={formatContactType(sideContact.contactType ?? null)} />
            <Field label="Industry" value={sideContact.companyIndustry ?? null} />
            <Field label="Company" value={sideContact.companyName ?? null} />
          </dl>
        ) : null}

        <div className="mt-4 space-y-2 border-t border-border-default pt-4">
          <Link to={`/contact/${sideContact.contactId}`} className="block">
            <Button type="button" variant="secondary" className="h-auto w-full py-2.5">
              Open contact
            </Button>
          </Link>
          {sideContact.contactEmail ? (
            <Button type="button" variant="brand" className="h-auto w-full py-2.5" onClick={() => onEmailContact?.()}>
              <Mail className="size-4 shrink-0" strokeWidth={1.75} />
              Email contact
            </Button>
          ) : null}
          {sideContact.contactEmail ? (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-link hover:underline"
              onClick={onSchedule}
            >
              <Calendar className="size-4" />
              Schedule meeting
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
