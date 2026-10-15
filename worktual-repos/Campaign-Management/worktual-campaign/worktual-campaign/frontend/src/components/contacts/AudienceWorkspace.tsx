import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
  Paperclip,
  Phone,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import {
  CopilotChatShell,
  CopilotWorkspace,
  PanelExpandButton,
} from "@/components/assistant/copilot-workspace";
import { Button } from "@/components/ui/Button";
import { ContentFadeIn } from "@/components/skeleton";
import { ContactDetailSkeleton } from "@/pages/ContactDetailSkeleton";
import { ContactsSummaryPanel } from "@/components/contacts/ContactsSummaryPanel";
import { ContactGuidedPreview } from "@/components/contacts/ContactGuidedPreview";
import {
  ContactCampaignActivityPanel,
} from "@/components/contacts/ContactCampaignActivityPanel";
import {
  createFreshAudienceSessionId,
  clearAudienceSessionId,
} from "@/lib/audience-agent-session";
import { contactsWelcomeMessage } from "@/lib/module-welcomes";
import { isCampaignSessionAccessDenied } from "@/lib/create-campaign-active-session";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import {
  applyAgentNavigate,
  handoffJoinPayload,
  handoffSourceLabel,
  normalizeModule,
  readChatHandoff,
  type HandoffMessage,
} from "@/lib/chat-handoff";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  getCampaignProfile,
  isB2cPack,
  subscribeActivePack,
} from "@/lib/industry-packs";
import {
  applySessionReadyChatMessages,
  appendAssistantDeduped,
  isAgentBusyError,
  isHydrationSessionReady,
} from "@/lib/agents-chat-runtime";
import { bindJoinOnConnect } from "@/lib/agents-join";
import { getToken } from "@/services/api";
import {
  deferAgentsConnectError,
  getAgentsSocket,
  type ContactCandidate,
  type ContactDraftFields,
} from "@/services/agents.socket";
import {
  contactDisplayName,
  fetchContacts,
  CONTACTS_PAGE_SIZE,
  formatContactAddedOn,
  formatContactsApiError,
  getContact,
  deleteContact,
  importContacts,
  saveContactPushFields,
  type ContactImportResult,
  type ContactImportRow,
  type ContactItem,
} from "@/services/contacts.service";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { ContactCrmProfilePanel } from "@/components/contacts/ContactCrmProfilePanel";
import { ContactManualEditDialog } from "@/components/contacts/ContactManualEditDialog";
import {
  EMPTY_PUSH_FORM,
  type ContactPushFormValues,
} from "@/components/contacts/ContactPushFields";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Failed import rows — show download in chat. */
  importFailed?: ContactImportResult["errors"];
  importSourceRows?: ContactImportRow[];
};

type RightMode = "list" | "detail" | "create" | "matches";

function audienceViewFromPath(pathname: string): {
  mode: RightMode;
  contactId: string | null;
} {
  const rest = pathname.replace(/^\/audience\/?/, "").replace(/\/$/, "");
  if (!rest) return { mode: "list", contactId: null };
  if (rest === "new" || rest === "create") {
    return { mode: "create", contactId: null };
  }
  if (rest.includes("/")) return { mode: "list", contactId: null };
  return { mode: "detail", contactId: rest };
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

/** Randomized opener — agent skips remote welcome (skip_welcome). */
function contactsStaticWelcomeMessage(b2c = false): ChatMessage {
  return contactsWelcomeMessage(b2c);
}

function audienceEmptyHint(total: number, b2c: boolean): string {
  const one = b2c ? "customer" : "contact";
  const many = b2c ? "customers" : "contacts";
  if (total <= 0) {
    return `No ${many} yet. Create one, or tell me who to look up.`;
  }
  if (total === 1) {
    return `1 ${one} in your audience. Create, update, or view?`;
  }
  return `${total.toLocaleString()} ${many} in your audience. Create, update, or view?`;
}

function toLocalMessages(
  rows: Array<{ id?: string; role?: string; text?: string; content?: string }>,
): ChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role as "user" | "assistant",
      text: m.text || m.content || "",
    }))
    .filter((m) => m.text.trim().length > 0);
}

function draftFromContact(row: ContactItem): ContactDraftFields {
  const app = row.app_push?.find((r) => r.active !== false) || row.app_push?.[0];
  const web = row.web_push?.find((r) => r.active !== false) || row.web_push?.[0];
  return {
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    company_name: row.company_name ?? "",
    city: row.city ?? "",
    app_push_token: app?.endpoint ?? "",
    app_push_platform: app?.platform ?? "",
    app_push_asked: app?.endpoint ? "1" : "",
    web_push_endpoint: web?.endpoint ?? "",
    web_push_p256dh: "",
    web_push_auth: "",
    web_push_asked: web?.endpoint ? "1" : "",
  };
}

function draftFromCandidate(c: ContactCandidate): ContactDraftFields {
  return {
    ...EMPTY_DRAFT,
    first_name: c.first_name || "",
    last_name: c.last_name || "",
    email: c.email || "",
    phone: c.phone || "",
    company_name: c.company_name || "",
    city: c.city || "",
  };
}

function contactSubtitle(row: ContactItem): string {
  const phone = row.phone?.trim() || "—";
  const email = row.email?.trim() || "—";
  return `${phone}  ${email}`;
}

function toCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadContactsCsv(rows: ContactItem[]) {
  const header = ["Name", "Email", "Phone", "Company", "City", "Created date"];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        contactDisplayName(row),
        row.email ?? "",
        row.phone ?? "",
        row.company_name ?? "",
        row.city ?? "",
        row.created_at ? formatContactAddedOn(row.created_at) : "",
      ]
        .map((cell) => toCsvCell(String(cell)))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audience-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Minimal CSV line splitter (handles quoted commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Parse Audience-style CSV into import rows. */
function parseContactsCsv(text: string): ContactImportRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const idx = (aliases: string[]) =>
    headers.findIndex((h) => aliases.includes(h));

  const nameI = idx(["name", "fullname", "contact"]);
  const firstI = idx(["firstname", "first"]);
  const lastI = idx(["lastname", "last", "surname"]);
  const emailI = idx(["email", "emailaddress"]);
  const phoneI = idx(["phone", "mobile", "phonenumber", "tel"]);
  const companyI = idx(["company", "companyname", "organization", "org"]);
  const cityI = idx(["city", "town", "location"]);

  const rows: ContactImportRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const cell = (j: number) =>
      j >= 0 && j < cols.length ? cols[j].trim() : "";
    const row: ContactImportRow = {
      firstName: cell(firstI) || undefined,
      lastName: cell(lastI) || undefined,
      email: cell(emailI) || undefined,
      phone: cell(phoneI) || undefined,
      companyName: cell(companyI) || undefined,
      city: cell(cityI) || undefined,
      name: cell(nameI) || undefined,
    };
    if (
      row.email ||
      row.phone ||
      row.name ||
      row.firstName ||
      row.lastName
    ) {
      rows.push(row);
    }
  }
  return rows;
}

const CONSENT_OPTIONS = [
  { value: "website_form", label: "Website form" },
  { value: "purchase", label: "Purchase / customer" },
  { value: "event_opt_in", label: "Event opt-in" },
  { value: "partner", label: "Partner / referral" },
  { value: "verbal", label: "Verbal (weak)" },
  { value: "booth", label: "Booth / offline (weak)" },
  { value: "unknown", label: "Unknown (weak)" },
] as const;

function isWeakConsentSource(source: string): boolean {
  return ["", "unknown", "verbal", "booth", "offline", "other", "none"].includes(
    source.trim().toLowerCase(),
  );
}

/** Failed import rows → CSV (same columns as import + Error). Re-import ignores Error. */
function downloadFailedImportCsv(
  errors: ContactImportResult["errors"],
  sourceRows: ContactImportRow[],
) {
  if (!errors.length) return;
  const header = [
    "Name",
    "Email",
    "Phone",
    "Company",
    "City",
    "Error",
  ];
  const lines = [
    header.join(","),
    ...errors.map((e) => {
      const src = sourceRows[e.row - 1];
      const name =
        e.name ||
        [e.first_name, e.last_name].filter(Boolean).join(" ").trim() ||
        src?.name ||
        [src?.firstName, src?.lastName].filter(Boolean).join(" ").trim() ||
        "";
      return [
        name,
        e.email ?? src?.email ?? "",
        e.phone ?? src?.phone ?? "",
        e.company_name ?? src?.companyName ?? "",
        e.city ?? src?.city ?? "",
        e.message || e.action || "failed",
      ]
        .map((cell) => toCsvCell(String(cell)))
        .join(",");
    }),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audience-failed-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function DraftField({
  label,
  value,
  icon: Icon,
  required,
}: {
  label: string;
  value?: string | null;
  icon?: LucideIcon;
  required?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface px-3 py-2.5">
      <p
        className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${
          required ? "text-red-600" : "text-text-caption"
        }`}
      >
        {Icon ? (
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        ) : null}
        {label}
        {required ? (
          <span className="normal-case tracking-normal text-red-600" aria-hidden>
            *
          </span>
        ) : null}
      </p>
      <p
        className={`mt-1 text-sm ${
          value?.trim() ? "font-medium text-text-primary" : "text-text-caption"
        }`}
      >
        {value?.trim() || "—"}
      </p>
    </div>
  );
}

function DraftFieldsPanel({
  draft,
  hint,
  b2c,
}: {
  draft: ContactDraftFields;
  hint?: string;
  b2c?: boolean;
}) {
  const channelOk =
    Boolean(String(draft.email || "").trim()) ||
    Boolean(String(draft.phone || "").trim());
  const appPush = formatDraftAppPush(draft);
  const webPush = formatDraftWebPush(draft);
  return (
    <div className="space-y-3">
      {hint ? <p className="text-xs text-text-caption">{hint}</p> : null}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <DraftField label="First name" value={draft.first_name} required />
        <DraftField label="Last name (optional)" value={draft.last_name} />
        <DraftField
          label="Email"
          value={draft.email}
          icon={Mail}
          required={!channelOk}
        />
        <DraftField
          label="Phone"
          value={draft.phone}
          icon={Phone}
          required={!channelOk}
        />
        <DraftField
          label={b2c ? "Company (optional)" : "Company (optional)"}
          value={draft.company_name}
        />
        <DraftField label="City (optional)" value={draft.city} />
        {appPush && appPush !== "—" ? (
          <DraftField label="App push" value={appPush} />
        ) : null}
        {webPush && webPush !== "—" ? (
          <DraftField label="Web push" value={webPush} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Left: stable contacts co-worker chat.
 * Right: list / create draft / detail — fields auto-fill from chat draft; no manual save.
 */
export function AudienceWorkspace({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const handoffRef = useRef(readChatHandoff("contacts"));
  const carried = handoffRef.current;
  const [activeSessionId, setActiveSessionId] = useState(sessionId);
  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );
  const b2c = packId === "generic-b2c" || isB2cPack();
  const peopleLabel = b2c ? "Customers" : "Audience";
  const unitOne = b2c ? "customer" : "person";
  const unitMany = b2c ? "customers" : "people";

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (carried?.messages?.length) {
      return carried.messages.map((m) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        text: m.text,
      }));
    }
    const initialB2c =
      getActivePackId() === "generic-b2c" || isB2cPack();
    return [contactsStaticWelcomeMessage(initialB2c)];
  });
  const messagesRef = useRef<HandoffMessage[]>([]);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const sessionReadyRef = useRef(false);
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  sendingRef.current = sending;
  typingRef.current = typing;
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [items, setItems] = useState<ContactItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  const [withChannelTotal, setWithChannelTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [rightMode, setRightMode] = useState<RightMode>("list");
  const [expandedSide, setExpandedSide] = useState<"left" | "right">("right");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContactItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pushForm, setPushForm] = useState<ContactPushFormValues>(EMPTY_PUSH_FORM);
  const [pushSaving, setPushSaving] = useState(false);
  const [manualEditOpen, setManualEditOpen] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ContactDraftFields>(EMPTY_DRAFT);
  const draftRef = useRef(draft);
  const itemsRef = useRef(items);
  const [focusContactId, setFocusContactId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [matchesTotalCount, setMatchesTotalCount] = useState<number | null>(
    null,
  );
  const [detailFromMatches, setDetailFromMatches] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const rightModeRef = useRef<RightMode>("list");
  const detailIdRef = useRef<string | null>(null);
  /** After +Add, ignore stale draft/candidates until server clear is confirmed. */
  const freshCreateRef = useRef(false);
  const lastCreatedIdRef = useRef<string | null>(null);
  /** When true, GET /contacts must not overwrite an in-progress chat draft. */
  const agentDraftLockRef = useRef(false);
  /** Bumps on New chat so stale session_ready cannot repopulate old messages. */
  const chatEpochRef = useRef(0);
  /** Agent/user opened create — allow /audience/new without bouncing to list. */
  const createRouteAllowedRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const lastLoadedDetailIdRef = useRef<string | null>(null);
  /** Detail opened from Found contacts — back returns to matches pane. */
  const detailBackTargetRef = useRef<"list" | "matches">("list");
  /** Keep Found contacts when URL is /audience (detail uses /audience/:id). */
  const matchesPanelActiveRef = useRef(false);
  /** Full Found-contacts list — survives detail load / state_update shrinking candidates. */
  const matchesListSnapshotRef = useRef<ContactCandidate[]>([]);

  const mergeCandidatesFromServer = useCallback(
    (next: ContactCandidate[] | undefined | null) => {
      if (!next?.length) return;
      const snap = matchesListSnapshotRef.current;
      if (
        matchesPanelActiveRef.current &&
        snap.length > 1 &&
        next.length < snap.length
      ) {
        return;
      }
      setCandidates(next);
      if (matchesPanelActiveRef.current && next.length >= snap.length) {
        matchesListSnapshotRef.current = [...next];
      }
    },
    [],
  );

  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ContactImportRow[]>([]);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importConsent, setImportConsent] = useState("website_form");
  const [importUpsert, setImportUpsert] = useState(true);
  const [importCompliance, setImportCompliance] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(
    null,
  );
  const importFileRef = useRef<HTMLInputElement>(null);
  const chatCsvFileRef = useRef<HTMLInputElement>(null);
  const [chatImportBusy, setChatImportBusy] = useState(false);

  useEffect(() => {
    rightModeRef.current = rightMode;
  }, [rightMode]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    detailIdRef.current = detailId;
  }, [detailId]);

  const draftHasValues = (d?: ContactDraftFields | null) =>
    Boolean(
      d &&
        [
          d.first_name,
          d.last_name,
          d.email,
          d.phone,
          d.company_name,
          d.city,
          d.app_push_token,
          d.web_push_endpoint,
        ].some((v) => String(v || "").trim().length > 0),
    );

  const showSuccessToast = useCallback((message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
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

  const loadContacts = useCallback(async (nextPage: number, nextSearch: string) => {
    setLoading(true);
    setListError(null);
    try {
      const result = await fetchContacts({
        page: nextPage,
        limit: CONTACTS_PAGE_SIZE,
        search: nextSearch,
      });
      setItems(result.contacts);
      setTotalContacts(result.total);
      setWithChannelTotal(result.withChannel);
      setTotalPages(result.totalPages);
      setPage(result.page);
    } catch (err) {
      setListError(
        formatContactsApiError(
          err,
          b2c ? "Failed to load customers" : "Failed to load audience",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [b2c]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadContacts(page, searchDebounced);
  }, [page, searchDebounced, loadContacts]);

  const handleExportContacts = useCallback(async () => {
    try {
      const exportLimit = Math.min(Math.max(totalContacts, items.length), 5000);
      const result = await fetchContacts({
        page: 1,
        limit: exportLimit,
        search: searchDebounced,
      });
      downloadContactsCsv(result.contacts);
    } catch (err) {
      showSuccessToast(
        formatContactsApiError(err, "Export failed. Try again."),
      );
    }
  }, [items.length, searchDebounced, showSuccessToast, totalContacts]);

  const syncAgentFocus = useCallback(
    (contactId: string | null) => {
      const token = getToken();
      if (!token) return;
      getAgentsSocket().emit("join_session", {
        session_id: activeSessionId,
        token,
        module: "contacts",
        skip_welcome: true,
        campaign_profile: getCampaignProfile(),
        audience_contact_count: totalContacts,
        ...(contactId ? { focus_contact_id: contactId } : {}),
      });
    },
    [activeSessionId, totalContacts],
  );

  const loadDetail = useCallback(
    async (id: string, seed?: ContactItem | null) => {
      const openingNew = lastLoadedDetailIdRef.current !== id;
      if (openingNew) {
        lastLoadedDetailIdRef.current = id;
      }
      const seeded =
        seed || itemsRef.current.find((row) => row.id === id) || null;
      if (seeded) {
        setDetail(seeded);
        setDraft(draftFromContact(seeded));
        setDetailError(null);
      } else {
        setDetailLoading(true);
        setDetailError(null);
      }
      setFocusContactId(id);
      if (!agentDraftLockRef.current) {
        syncAgentFocus(id);
      }
      try {
        const row = await getContact(id);
        if (detailIdRef.current !== id) return;
        setDetail(row);
        setDraft(draftFromContact(row));
        setPushForm(EMPTY_PUSH_FORM);
        setPushError(null);
        setDetailError(null);
      } catch (err) {
        if (detailIdRef.current !== id) return;
        if (!seeded) {
          setDetail(null);
          setDetailError(formatContactsApiError(err, "Failed to load contact"));
        }
      } finally {
        if (detailIdRef.current === id) setDetailLoading(false);
      }
    },
    [syncAgentFocus],
  );

  useEffect(() => {
    if (rightMode === "detail" && detailId) {
      void loadDetail(detailId);
    }
  }, [rightMode, detailId, loadDetail]);

  const openCreateFromAgent = useCallback(() => {
    // Keep Contact setup open like create-campaign overview — do NOT set
    // freshCreateRef here (that flag clears/blocks live draft sync).
    createRouteAllowedRef.current = true;
    if (rightModeRef.current !== "create") {
      setRightMode("create");
      rightModeRef.current = "create";
    }
    setExpandedSide("right");
    if (window.location.pathname !== "/audience/new") {
      navigateRef.current("/audience/new");
    }
  }, []);

  const openDetailFromAgent = useCallback((contactId: string) => {
    if (!contactId) return;
    freshCreateRef.current = false;
    agentDraftLockRef.current = false;
    setDetailFromMatches(false);
    detailBackTargetRef.current = "list";
    setDetailId(contactId);
    detailIdRef.current = contactId;
    if (rightModeRef.current !== "detail") {
      setRightMode("detail");
      rightModeRef.current = "detail";
      setExpandedSide("right");
      void loadDetailRef.current(contactId);
      navigateRef.current(`/audience/${contactId}`);
    }
  }, []);

  const openMatchesFromAgent = useCallback(
    (rows: ContactCandidate[], totalCount?: number | null) => {
    freshCreateRef.current = false;
    agentDraftLockRef.current = false;
    detailBackTargetRef.current = "list";
    matchesPanelActiveRef.current = true;
    matchesListSnapshotRef.current = [...rows];
    setMatchesTotalCount(
      typeof totalCount === "number" ? totalCount : rows.length,
    );
    setCandidates(rows);
    setDetailId(null);
    detailIdRef.current = null;
    setFocusContactId(null);
    setRightMode("matches");
    rightModeRef.current = "matches";
    setExpandedSide("right");
    if (window.location.pathname !== "/audience") {
      navigateRef.current("/audience");
    }
  },
  []);

  /** Sync draft fields from agent. Panel switches when openPanel (live chat tools). */
  const applyAgentDraftMode = useCallback(
    (
      state?: {
        mode?: "create" | "update" | "view" | null;
        focus_contact_id?: string | null;
        draft_contact?: ContactDraftFields | null;
        reset?: boolean;
      },
      opts?: { openPanel?: boolean },
    ) => {
      if (!state) return;
      if (state.draft_contact !== undefined && state.draft_contact !== null) {
        agentDraftLockRef.current = true;
        setDraft({ ...EMPTY_DRAFT, ...state.draft_contact });
      }
      if (!opts?.openPanel) return;
      const mode = String(state.mode || "").toLowerCase();
      if (mode === "create" || state.reset) {
        setDetailId(null);
        detailIdRef.current = null;
        lastLoadedDetailIdRef.current = null;
        setFocusContactId(null);
        openCreateFromAgent();
        return;
      }
      if (
        (mode === "update" || mode === "view") &&
        state.focus_contact_id
      ) {
        openDetailFromAgent(state.focus_contact_id);
      }
    },
    [openCreateFromAgent, openDetailFromAgent],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing]);

  const pageRef = useRef(page);
  const searchDebouncedRef = useRef(searchDebounced);
  pageRef.current = page;
  searchDebouncedRef.current = searchDebounced;

  const loadContactsRef = useRef(loadContacts);
  const loadDetailRef = useRef(loadDetail);
  const showSuccessToastRef = useRef(showSuccessToast);
  loadContactsRef.current = () =>
    loadContacts(pageRef.current, searchDebouncedRef.current);
  loadDetailRef.current = loadDetail;
  showSuccessToastRef.current = showSuccessToast;

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for your Worktual co-worker.");
      return;
    }
    sessionReadyRef.current = false;
    const socket = getAgentsSocket();
    setSocketError(null);

    const onReady = (payload: {
      session_id?: string;
      module?: string;
      agent_busy?: boolean;
      state?: {
        draft_contact?: ContactDraftFields;
        focus_contact_id?: string | null;
        mode?: string | null;
        candidates?: ContactCandidate[];
      };
      messages?: Array<{ id?: string; role?: string; text?: string }>;
    }) => {
      const sid = payload.session_id || "";
      if (sid && sid !== activeSessionIdRef.current) return;
      if (payload.module && payload.module !== "contacts") return;
      const epochAtJoin = chatEpochRef.current;
      const rows = toLocalMessages(payload.messages || []);
      const followUpReady = sessionReadyRef.current;
      sessionReadyRef.current = true;
      const hydration = isHydrationSessionReady(payload);

      if (rows.length && epochAtJoin === chatEpochRef.current) {
        setMessages((prev) => {
          // After New chat, keep the welcome — do not revive a prior thread.
          if (chatEpochRef.current !== epochAtJoin) return prev;
          return applySessionReadyChatMessages(prev, rows, {
            busy: sendingRef.current || typingRef.current,
            followUpReady,
            hydration,
          });
        });
      }
      if (freshCreateRef.current) {
        const serverDraft = payload.state?.draft_contact;
        if (
          agentDraftLockRef.current ||
          draftHasValues(serverDraft) ||
          draftHasValues(draftRef.current)
        ) {
          freshCreateRef.current = false;
          if (serverDraft && draftHasValues(serverDraft)) {
            setDraft({ ...EMPTY_DRAFT, ...serverDraft });
          }
          if (payload.state?.focus_contact_id !== undefined) {
            setFocusContactId(payload.state.focus_contact_id);
          }
          if (payload.state?.candidates) {
            mergeCandidatesFromServer(payload.state.candidates);
          }
          return;
        }
        setDraft(EMPTY_DRAFT);
        setFocusContactId(null);
        setCandidates([]);
        freshCreateRef.current = false;
        return;
      }
      if (payload.state?.draft_contact && !agentDraftLockRef.current) {
        setDraft({ ...EMPTY_DRAFT, ...payload.state.draft_contact });
      }
      if (payload.state?.focus_contact_id !== undefined) {
        setFocusContactId(payload.state.focus_contact_id);
      }
      if (payload.state?.candidates) {
        mergeCandidatesFromServer(payload.state.candidates);
      }
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionIdRef.current)
        return;
      const text = payload.text || "";
      if (!text) return;
      setMessages((prev) => appendAssistantDeduped(prev, text));
      setTyping(false);
      setSending(false);
    };

    const onTyping = (payload: {
      session_id?: string;
      typing?: boolean;
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) setSending(false);
    };

    const onState = (payload: {
      session_id?: string;
      state?: {
        draft_contact?: ContactDraftFields;
        focus_contact_id?: string | null;
        mode?: "create" | "update" | null;
        candidates?: ContactCandidate[];
        last_action?: string | null;
      };
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      if (!payload.state) return;
      if (freshCreateRef.current) {
        if (
          draftHasValues(payload.state.draft_contact) ||
          agentDraftLockRef.current ||
          draftHasValues(draftRef.current)
        ) {
          freshCreateRef.current = false;
          agentDraftLockRef.current = true;
          if (draftHasValues(payload.state.draft_contact)) {
            setDraft({ ...EMPTY_DRAFT, ...payload.state.draft_contact });
          }
          applyAgentDraftMode(
            { ...payload.state, mode: payload.state.mode || "create" },
            { openPanel: true },
          );
          return;
        }
        setDraft(EMPTY_DRAFT);
        setFocusContactId(null);
        setCandidates([]);
        freshCreateRef.current = false;
        return;
      }
      // Live draft tools: open create/update panel (create-campaign style).
      const stateMode = String(payload.state.mode || "").toLowerCase();
      const lastAction = String(payload.state.last_action || "").toLowerCase();
      const liveCreate =
        stateMode === "create" &&
        lastAction !== "lookup" &&
        lastAction !== "search" &&
        lastAction !== "query_contacts" &&
        (lastAction === "set_draft" ||
          lastAction === "verify_match" ||
          lastAction === "verify_mismatch" ||
          draftHasValues(payload.state.draft_contact));
      const liveUpdate =
        stateMode === "update" &&
        Boolean(payload.state.focus_contact_id) &&
        (lastAction === "set_draft" ||
          lastAction === "get" ||
          lastAction === "lookup");
      if (liveCreate || liveUpdate) {
        applyAgentDraftMode(payload.state, { openPanel: true });
        if (payload.state.focus_contact_id !== undefined) {
          setFocusContactId(payload.state.focus_contact_id);
        }
        if (payload.state.candidates) {
          mergeCandidatesFromServer(payload.state.candidates);
        }
        return;
      }
      // While create/detail panel is open, merge draft (like create-campaign).
      if (
        agentDraftLockRef.current ||
        rightModeRef.current === "create" ||
        rightModeRef.current === "detail"
      ) {
        if (payload.state.draft_contact) {
          if (rightModeRef.current === "create") {
            setDraft({ ...EMPTY_DRAFT, ...payload.state.draft_contact });
          } else if (rightModeRef.current === "detail") {
            const focus = payload.state.focus_contact_id ?? null;
            const viewing = detailIdRef.current;
            // Do not apply session draft while browsing another contact in the list.
            if (viewing && focus === viewing) {
              setDraft({ ...EMPTY_DRAFT, ...payload.state.draft_contact });
            }
          } else {
            setDraft({ ...EMPTY_DRAFT, ...payload.state.draft_contact });
          }
        }
        if (payload.state.focus_contact_id !== undefined) {
          setFocusContactId(payload.state.focus_contact_id);
        }
        if (payload.state.candidates) {
          mergeCandidatesFromServer(payload.state.candidates);
        }
        return;
      }
      // Join/restore: keep list (or current URL view). Do not open create from stale mode.
      applyAgentDraftMode(payload.state, { openPanel: false });
      if (
        rightModeRef.current === "detail" &&
        payload.state.focus_contact_id &&
        payload.state.focus_contact_id !== detailIdRef.current
      ) {
        setDetailId(payload.state.focus_contact_id);
      }
      if (payload.state.focus_contact_id !== undefined) {
        setFocusContactId(payload.state.focus_contact_id);
      }
      if (payload.state.candidates) {
        mergeCandidatesFromServer(payload.state.candidates);
      }
    };

    const onError = (payload: {
      message?: string;
      session_id?: string;
      code?: string;
    }) => {
      if (
        payload.session_id &&
        payload.session_id !== activeSessionId
      ) {
        return;
      }
      if (isAgentBusyError(payload)) {
        setSocketError(
          "Still working on your last message — wait for the reply, then send again.",
        );
        return;
      }
      // Shared browser / account switch can resume another user's durable session.
      if (isCampaignSessionAccessDenied(payload.message)) {
        chatEpochRef.current += 1;
        clearAudienceSessionId();
        const nextId = createFreshAudienceSessionId();
        agentDraftLockRef.current = false;
        freshCreateRef.current = false;
        activeSessionIdRef.current = nextId;
        setActiveSessionId(nextId);
        setMessages([contactsStaticWelcomeMessage(b2c)]);
        setTyping(false);
        setSending(false);
        setSocketError(null);
        return;
      }
      setSocketError(payload.message || "Co-worker error");
      setTyping(false);
      setSending(false);
    };

    let cancelConnectErrorReport: (() => void) | null = null;
    const onConnectError = (err: Error) => {
      setTyping(false);
      setSending(false);
      cancelConnectErrorReport?.();
      cancelConnectErrorReport = deferAgentsConnectError(socket, err, setSocketError);
    };
    const onConnect = () => {
      cancelConnectErrorReport?.();
      cancelConnectErrorReport = null;
      setSocketError(null);
    };

    const onUi = (payload: {
      session_id?: string;
      type?: string;
      payload?: {
        contact?: ContactCandidate;
        contact_id?: string;
        draft_contact?: ContactDraftFields;
        focus_contact_id?: string | null;
        mode?: "create" | "update" | null;
        reset?: boolean;
        path?: string;
        create?: boolean;
        module?: string;
        query?: string;
        candidates?: ContactCandidate[];
        already_exists?: boolean;
        clear_draft?: boolean;
        status?: string;
        summary?: Record<string, number>;
      };
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      const type = payload.type;
      const p = payload.payload;

      if (type === "draft_updated" && p) {
        const isCreatePanel = Boolean(p.reset || p.mode === "create");
        if (p.reset) {
          freshCreateRef.current = true;
        } else if (isCreatePanel && draftHasValues(p.draft_contact)) {
          freshCreateRef.current = false;
        } else if (!isCreatePanel) {
          freshCreateRef.current = false;
        }
        agentDraftLockRef.current = true;
        // Always merge draft first (create-campaign live checklist style).
        if (p.draft_contact) {
          setDraft({ ...EMPTY_DRAFT, ...p.draft_contact });
        }
        if (p.candidates) setCandidates(p.candidates);

        // Create / reset — must win over detail URL + update mode (new contact from open profile).
        if (isCreatePanel) {
          setFocusContactId(null);
          applyAgentDraftMode(
            {
              ...p,
              mode: "create",
              focus_contact_id: null,
              draft_contact: p.draft_contact ?? EMPTY_DRAFT,
            },
            { openPanel: true },
          );
          if (p.already_exists) {
            showSuccessToastRef.current("Contact already exists");
          }
          return;
        }

        // Duplicate during create — stay on setup panel; match is clickable below.
        if (p.duplicate_during_create || (p.mode === "create" && p.already_exists)) {
          setFocusContactId(null);
          applyAgentDraftMode(
            {
              ...p,
              mode: "create",
              draft_contact: p.draft_contact ?? EMPTY_DRAFT,
            },
            { openPanel: true },
          );
          return;
        }

        // Update existing contact → detail panel with live fields.
        if (p.mode === "update" && p.focus_contact_id) {
          applyAgentDraftMode(p, { openPanel: true });
          setFocusContactId(p.focus_contact_id);
          if (p.already_exists) {
            showSuccessToastRef.current("Contact already exists");
          }
          return;
        }

        // View contact → read-only detail panel.
        if (p.mode === "view" && p.focus_contact_id) {
          freshCreateRef.current = false;
          agentDraftLockRef.current = false;
          applyAgentDraftMode(p, { openPanel: true });
          setFocusContactId(p.focus_contact_id);
          return;
        }

        // Panel already open — keep syncing only.
        if (
          rightModeRef.current === "create" ||
          rightModeRef.current === "detail"
        ) {
          applyAgentDraftMode(p, { openPanel: false });
        }
        if (p.focus_contact_id !== undefined) {
          setFocusContactId(p.focus_contact_id);
        }
        if (p.already_exists) showSuccessToastRef.current("Contact already exists");
      }

      if (type === "navigate" && p) {
        const path = String(p.path || "").trim();
        const targetModule = normalizeModule(String(p.module || ""));
        if (
          targetModule === "contacts" &&
          (p.create || path === "/audience/new")
        ) {
          createRouteAllowedRef.current = true;
          freshCreateRef.current = true;
          setDraft(EMPTY_DRAFT);
          setFocusContactId(null);
          setCandidates([]);
          setDetailId(null);
          detailIdRef.current = null;
          lastLoadedDetailIdRef.current = null;
          setRightMode("create");
          rightModeRef.current = "create";
          setExpandedSide("right");
          navigateRef.current("/audience/new");
          return;
        }
        applyAgentNavigate(
          {
            session_id: payload.session_id,
            type: "navigate",
            payload: p,
          },
          {
            sessionId: activeSessionId,
            module: "contacts",
            navigate: (to, opts) => navigateRef.current(to, opts),
            getMessages: () => messagesRef.current,
          },
        );
        return;
      }

      if (type === "contact_candidates" && p?.candidates) {
        const viewPanel =
          p.mode === "view" ||
          Boolean(
            p.focus_contact_id &&
              !p.duplicate_during_create &&
              p.mode !== "create",
          );
        if (viewPanel) {
          freshCreateRef.current = false;
          agentDraftLockRef.current = false;
        }
        // During fresh create, still show duplicates; drop only non-view create noise.
        if (
          freshCreateRef.current &&
          (p.candidates?.length || 0) > 0 &&
          !p.duplicate_during_create &&
          !viewPanel
        ) {
          return;
        }
        if (p.duplicate_during_create) {
          freshCreateRef.current = false;
        }
        if (p.list_query && (p.candidates?.length || 0) > 0) {
          matchesListSnapshotRef.current = [...(p.candidates || [])];
        }
        setCandidates(p.candidates);
        if (p.draft_contact && draftHasValues(p.draft_contact)) {
          setDraft({ ...EMPTY_DRAFT, ...p.draft_contact });
          freshCreateRef.current = false;
          agentDraftLockRef.current = true;
        } else if (p.draft_contact && !freshCreateRef.current) {
          setDraft({ ...EMPTY_DRAFT, ...p.draft_contact });
        }
        // Duplicate during create — keep setup panel; show clickable match below.
        if (p.duplicate_during_create || p.mode === "create") {
          setFocusContactId(null);
          applyAgentDraftMode(
            {
              mode: "create",
              focus_contact_id: null,
              draft_contact: p.draft_contact ?? draftRef.current,
            },
            { openPanel: true },
          );
          return;
        }
        // Single-match lookup for edit → open detail panel with live draft.
        if (
          p.mode === "update" &&
          p.focus_contact_id &&
          !freshCreateRef.current
        ) {
          applyAgentDraftMode(
            {
              mode: "update",
              focus_contact_id: p.focus_contact_id,
              draft_contact: p.draft_contact,
            },
            { openPanel: true },
          );
          setFocusContactId(p.focus_contact_id);
          return;
        }
        // View: one match → detail; several → clickable matches panel.
        if (viewPanel) {
          const rows = p.candidates || [];
          const matchedCount =
            typeof p.matched_count === "number"
              ? p.matched_count
              : rows.length;
          if (p.list_query && matchedCount === 0) {
            detailBackTargetRef.current = "list";
            openMatchesFromAgent([], 0);
            return;
          }
          if (p.list_query && matchedCount > 1) {
            detailBackTargetRef.current = "list";
            openMatchesFromAgent(rows, matchedCount);
            return;
          }
          if (p.focus_contact_id || rows.length === 1) {
            const cid = p.focus_contact_id || rows[0]?.id;
            if (cid) {
              detailBackTargetRef.current = "list";
              applyAgentDraftMode(
                {
                  mode: "view",
                  focus_contact_id: cid,
                  draft_contact: p.draft_contact,
                },
                { openPanel: true },
              );
              setFocusContactId(cid);
            }
            return;
          }
          if (rows.length > 1) {
            detailBackTargetRef.current = "list";
            openMatchesFromAgent(rows, matchedCount);
            return;
          }
        }
        // Search query → contacts list. Do not leave an active create flow.
        if (
          rightModeRef.current !== "list" &&
          rightModeRef.current !== "create" &&
          !freshCreateRef.current &&
          p.mode !== "create"
        ) {
          setRightMode("list");
          rightModeRef.current = "list";
          setExpandedSide("right");
          setDetailId(null);
          detailIdRef.current = null;
          navigateRef.current("/audience");
        }
      }

      if (type === "contact_created") {
        agentDraftLockRef.current = false;
        const createdId = p?.contact?.id || p?.contact_id || p?.focus_contact_id;
        if (createdId && lastCreatedIdRef.current === createdId) {
          return;
        }
        if (createdId) lastCreatedIdRef.current = createdId;
        showSuccessToastRef.current("Contact created");
        void loadContactsRef.current();
        if (p?.contact) {
          setDraft(draftFromCandidate(p.contact));
        }
        if (createdId) {
          const pendingDraft = { ...draftRef.current };
          void (async () => {
            if (
              pendingDraft.app_push_token?.trim() ||
              (pendingDraft.web_push_endpoint?.trim() &&
                pendingDraft.web_push_p256dh?.trim() &&
                pendingDraft.web_push_auth?.trim())
            ) {
              try {
                const c = p?.contact;
                await saveContactPushFields(
                  {
                    id: createdId,
                    first_name: c?.first_name || pendingDraft.first_name || null,
                    last_name: c?.last_name || pendingDraft.last_name || null,
                    email: c?.email || pendingDraft.email || null,
                    phone: c?.phone || pendingDraft.phone || null,
                    company_name:
                      c?.company_name || pendingDraft.company_name || null,
                    city: c?.city || pendingDraft.city || null,
                  },
                  {
                    appPushToken: pendingDraft.app_push_token?.trim() || undefined,
                    appPushPlatform: pendingDraft.app_push_platform || "android",
                    webPushEndpoint:
                      pendingDraft.web_push_endpoint?.trim() || undefined,
                    webPushP256dh: pendingDraft.web_push_p256dh?.trim() || undefined,
                    webPushAuth: pendingDraft.web_push_auth?.trim() || undefined,
                  },
                );
                setPushForm(EMPTY_PUSH_FORM);
              } catch {
                /* push register optional on create */
              }
            }
          })();
          setDetailId(createdId);
          detailIdRef.current = createdId;
          setRightMode("detail");
          rightModeRef.current = "detail";
          setExpandedSide("right");
          navigateRef.current(`/audience/${createdId}`);
        } else {
          setRightMode("list");
          rightModeRef.current = "list";
          setExpandedSide("right");
          navigateRef.current("/audience");
        }
      }

      if (type === "contact_updated") {
        agentDraftLockRef.current = false;
        showSuccessToastRef.current("Contact updated");
        void loadContactsRef.current();
        if (p?.contact) {
          setDraft(draftFromCandidate(p.contact));
          if (p.contact.id) {
            setDetailId(p.contact.id);
            detailIdRef.current = p.contact.id;
            setFocusContactId(p.contact.id);
            setRightMode("detail");
            rightModeRef.current = "detail";
            setExpandedSide("right");
            void loadDetailRef.current(p.contact.id);
            navigateRef.current(`/audience/${p.contact.id}`);
          }
        } else if (detailIdRef.current) {
          void loadDetailRef.current(detailIdRef.current);
        }
      }

      if (type === "contacts_imported") {
        const status = p?.status;
        if (status === "held_for_review") {
          showSuccessToastRef.current("Import held for compliance review");
        } else if (status === "dry_run") {
          showSuccessToastRef.current("Import dry run complete");
        } else {
          showSuccessToastRef.current("Contacts imported");
          void loadContactsRef.current();
        }
      }

      if (type === "contact_deleted") {
        showSuccessToastRef.current("Contact deleted");
        void loadContactsRef.current();
        setRightMode("list");
        rightModeRef.current = "list";
        setExpandedSide("right");
        setDetailId(null);
        detailIdRef.current = null;
        navigateRef.current("/audience");
      }

      if (p?.clear_draft) {
        setDraft(EMPTY_DRAFT);
      }
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("state_update", onState);
    socket.on("agent_error", onError);
    socket.on("error", onError);
    socket.on("connect_error", onConnectError);
    socket.on("connect", onConnect);
    socket.on("ui_event", onUi);

    const join = () => {
      const view = audienceViewFromPath(window.location.pathname);
      socket.emit("join_session", {
        session_id: activeSessionId,
        token,
        module: "contacts",
        skip_welcome: true,
        campaign_profile: getCampaignProfile(),
        audience_contact_count: totalContacts,
        ...(view.contactId ? { focus_contact_id: view.contactId } : {}),
        ...handoffJoinPayload(carried),
      });
    };
    bindJoinOnConnect(socket, join);

    return () => {
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("state_update", onState);
      socket.off("agent_error", onError);
      socket.off("error", onError);
      cancelConnectErrorReport?.();
      socket.off("connect_error", onConnectError);
      socket.off("connect", onConnect);
      socket.off("ui_event", onUi);
      socket.off("connect", join);
    };
  }, [
    activeSessionId,
    applyAgentDraftMode,
    carried,
    mergeCandidatesFromServer,
    totalContacts,
  ]);

  const busy = sending || typing || chatImportBusy;

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const token = getToken();
      if (!trimmed || !token || busy) return;
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: trimmed },
      ]);
      setInput("");
      setSending(true);
      setTyping(true);
      setSocketError(null);
      // Create vs update is decided by the LLM via SET_DRAFT_FIELDS (mode=create /
      // reset_draft) → draft_updated / navigate ui_events. FE does not parse intent.
      const attachFocus =
        rightModeRef.current === "detail" && Boolean(detailIdRef.current);
      getAgentsSocket().emit("user_message", {
        session_id: activeSessionId,
        token,
        module: "contacts",
        text: trimmed,
        ...(attachFocus ? { focus_contact_id: detailIdRef.current } : {}),
      });
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [busy, activeSessionId],
  );

  const importCsvFromChat = useCallback(
    async (file: File) => {
      if (chatImportBusy) return;
      setChatImportBusy(true);
      setSocketError(null);
      const userMsg = `Import CSV: ${file.name}`;
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: userMsg },
      ]);
      try {
        const text = await file.text();
        const rows = parseContactsCsv(text);
        if (!rows.length) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "No contact rows found in that CSV. Use headers like Name, Email, Phone, Company, City.",
            },
          ]);
          return;
        }
        if (rows.length > 2000) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "Import is limited to 2000 rows per file. Split the CSV and try again.",
            },
          ]);
          return;
        }

        const result = await importContacts({
          rows,
          dryRun: false,
          upsert: true,
          consentSource: "website_form",
          sourceLabel: file.name || "chat_csv",
        });

        const s = result.summary;
        let reply =
          `Import ${result.status.replace(/_/g, " ")} · quality ${result.quality_score}. ` +
          `total ${s.total}, created ${s.created}, updated ${s.updated}, skipped ${s.skipped}, failed ${s.failed}. ` +
          `Consent source: website form.`;
        if (result.errors.length) {
          reply += " Download the CSV to fix and re-import.";
        } else {
          reply += " All rows passed validation.";
        }

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: reply,
            importFailed:
              result.errors.length > 0 ? result.errors : undefined,
            importSourceRows: result.errors.length > 0 ? rows : undefined,
          },
        ]);

        if (result.status === "completed" && (s.created > 0 || s.updated > 0)) {
          showSuccessToast(
            `Imported ${s.created} created, ${s.updated} updated`,
          );
          void loadContactsRef.current();
        }
      } catch (err) {
        const msg = axios.isAxiosError(err)
          ? (err.response?.data as { message?: string } | undefined)?.message ||
            err.message
          : err instanceof Error
            ? err.message
            : "Import failed";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Import failed: ${msg}`,
          },
        ]);
      } finally {
        setChatImportBusy(false);
        if (chatCsvFileRef.current) chatCsvFileRef.current.value = "";
      }
    },
    [chatImportBusy, loadContacts, showSuccessToast],
  );

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", { session_id: activeSessionId });
    setTyping(false);
    setSending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const goListInternal = useCallback(() => {
    createRouteAllowedRef.current = false;
    setRightMode("list");
    rightModeRef.current = "list";
    matchesPanelActiveRef.current = false;
    matchesListSnapshotRef.current = [];
    setMatchesTotalCount(null);
    // Keep dashboard split (chat ~40% / panel ~60%) — do not expand chat on list/new chat.
    setExpandedSide("right");
    setDetailId(null);
    detailIdRef.current = null;
    lastLoadedDetailIdRef.current = null;
    agentDraftLockRef.current = false;
    setDetail(null);
    setDetailError(null);
    setCandidates([]);
    setManualEditOpen(false);
  }, []);

  const restartChat = () => {
    const token = getToken();
    if (!token) return;
    const leavingId = activeSessionIdRef.current;
    chatEpochRef.current += 1;
    getAgentsSocket().emit("stop_generation", { session_id: leavingId });
    getAgentsSocket().emit("leave_session", {
      session_id: leavingId,
      token,
      module: "contacts",
    });
    clearAudienceSessionId();
    const nextId = createFreshAudienceSessionId();
    agentDraftLockRef.current = false;
    freshCreateRef.current = false;
    createRouteAllowedRef.current = false;
    activeSessionIdRef.current = nextId;
    setActiveSessionId(nextId);
    setMessages([contactsStaticWelcomeMessage(b2c)]);
    setInput("");
    setTyping(false);
    setSending(false);
    setSocketError(null);
    setDraft(EMPTY_DRAFT);
    setFocusContactId(null);
    goListInternal();
    if (window.location.pathname !== "/audience") {
      navigate("/audience");
    }
  };

  const openDetailInternal = useCallback(
    (id: string, opts?: { fromMatches?: boolean }) => {
      agentDraftLockRef.current = false;
      freshCreateRef.current = false;
      lastLoadedDetailIdRef.current = null;
      if (opts?.fromMatches) {
        detailBackTargetRef.current = "matches";
        setDetailFromMatches(true);
      } else {
        detailBackTargetRef.current = "list";
        setDetailFromMatches(false);
        setCandidates([]);
      }
      const seed = itemsRef.current.find((row) => row.id === id) || null;
      if (seed) {
        setDetail(seed);
        setDraft(draftFromContact(seed));
        setDetailError(null);
      }
      setDetailId(id);
      detailIdRef.current = id;
      setFocusContactId(id);
      setRightMode("detail");
      rightModeRef.current = "detail";
      setExpandedSide("right");
      setManualEditOpen(false);
    },
    [],
  );

  const goBackFromDetail = useCallback(() => {
    if (
      detailBackTargetRef.current === "matches" ||
      matchesPanelActiveRef.current
    ) {
      detailBackTargetRef.current = "list";
      setDetailFromMatches(false);
      const restored =
        matchesListSnapshotRef.current.length > 0
          ? [...matchesListSnapshotRef.current]
          : [...candidates];
      setCandidates(restored);
      setRightMode("matches");
      rightModeRef.current = "matches";
      setExpandedSide("right");
      setDetailId(null);
      detailIdRef.current = null;
      setDetail(null);
      lastLoadedDetailIdRef.current = null;
      if (location.pathname !== "/audience") navigate("/audience");
      return;
    }
    goListInternal();
    if (location.pathname !== "/audience") navigate("/audience");
  }, [location.pathname, navigate, goListInternal]);

  const goList = () => {
    detailBackTargetRef.current = "list";
    setDetailFromMatches(false);
    goListInternal();
    if (location.pathname !== "/audience") navigate("/audience");
  };

  const openDetail = (id: string, opts?: { fromMatches?: boolean }) => {
    openDetailInternal(id, opts);
    if (location.pathname !== `/audience/${id}`) navigate(`/audience/${id}`);
  };

  useEffect(() => {
    const v = audienceViewFromPath(location.pathname);
    if (v.mode === "create") {
      // View / matches from chat overrides create URL without wiping the panel.
      if (
        rightModeRef.current === "detail" ||
        rightModeRef.current === "matches"
      ) {
        return;
      }
      // Honor /audience/new only after user/agent intentionally opened create.
      // Stale create URLs (refresh / leftover session) bounce back to the list.
      if (
        rightModeRef.current !== "create" &&
        !freshCreateRef.current &&
        !createRouteAllowedRef.current
      ) {
        navigate("/audience", { replace: true });
        return;
      }
      if (rightModeRef.current !== "create") {
        freshCreateRef.current = true;
        lastCreatedIdRef.current = null;
        setDraft(EMPTY_DRAFT);
        setPushForm(EMPTY_PUSH_FORM);
        setPushError(null);
        setFocusContactId(null);
        setDetailId(null);
        detailIdRef.current = null;
        lastLoadedDetailIdRef.current = null;
        setDetail(null);
        setDetailError(null);
        setCandidates([]);
        setRightMode("create");
        rightModeRef.current = "create";
        setExpandedSide("right");
      }
      return;
    }
    if (v.mode === "detail" && v.contactId) {
      if (
        rightModeRef.current !== "detail" ||
        detailIdRef.current !== v.contactId
      ) {
        const fromMatches =
          matchesPanelActiveRef.current || detailBackTargetRef.current === "matches";
        openDetailInternal(v.contactId, fromMatches ? { fromMatches: true } : undefined);
      }
      return;
    }
    if (rightModeRef.current === "matches" || matchesPanelActiveRef.current) {
      return;
    }
    if (rightModeRef.current === "create") {
      return;
    }
    if (rightModeRef.current !== "list") goListInternal();
  }, [location.pathname, goListInternal, openDetailInternal, navigate]);

  const openCreate = () => {
    const token = getToken();
    createRouteAllowedRef.current = true;
    freshCreateRef.current = true;
    lastCreatedIdRef.current = null;
    setDraft(EMPTY_DRAFT);
    setPushForm(EMPTY_PUSH_FORM);
    setPushError(null);
    setFocusContactId(null);
    setDetailId(null);
    detailIdRef.current = null;
    lastLoadedDetailIdRef.current = null;
    agentDraftLockRef.current = false;
    setDetail(null);
    setDetailError(null);
    setCandidates([]);
    setRightMode("create");
    rightModeRef.current = "create";
    setExpandedSide("right");
    if (location.pathname !== "/audience/new") navigate("/audience/new");

    const startCreateChat = () => {
      send("I want to create a new contact.");
    };

    // Clear server draft/focus/matches, then start chat only after clear is confirmed.
    if (!token) {
      startCreateChat();
      return;
    }
    const socket = getAgentsSocket();
    let started = false;
    const beginOnce = () => {
      if (started) return;
      started = true;
      socket.off("session_ready", onClearedReady);
      window.clearTimeout(fallbackTimer);
      startCreateChat();
    };
    const onClearedReady = (payload: {
      session_id?: string;
      module?: string;
      state?: { draft_contact?: ContactDraftFields };
    }) => {
      if (payload.session_id && payload.session_id !== activeSessionId) return;
      if (payload.module && payload.module !== "contacts") return;
      if (draftHasValues(payload.state?.draft_contact)) return;
      beginOnce();
    };
    const fallbackTimer = window.setTimeout(beginOnce, 600);
    socket.on("session_ready", onClearedReady);
    socket.emit("join_session", {
      session_id: activeSessionId,
      token,
      module: "contacts",
      skip_welcome: true,
      clear_contact_draft: true,
      campaign_profile: getCampaignProfile(),
    });
  };

  const resetImportPanel = () => {
    setImportRows([]);
    setImportFileName(null);
    setImportError(null);
    setImportResult(null);
    setImportCompliance(false);
    setImportBusy(false);
    if (importFileRef.current) importFileRef.current.value = "";
  };

  const openImport = () => {
    resetImportPanel();
    setImportOpen(true);
  };

  const closeImport = () => {
    setImportOpen(false);
    resetImportPanel();
  };

  const onImportFile = async (file: File | null) => {
    setImportError(null);
    setImportResult(null);
    if (!file) {
      setImportRows([]);
      setImportFileName(null);
      return;
    }
    try {
      const text = await file.text();
      const rows = parseContactsCsv(text);
      if (!rows.length) {
        setImportRows([]);
        setImportFileName(file.name);
        setImportError(
          "No contact rows found. Use headers like Name, Email, Phone, Company, City.",
        );
        return;
      }
      if (rows.length > 2000) {
        setImportError("Import is limited to 2000 rows per file.");
        setImportRows([]);
        setImportFileName(file.name);
        return;
      }
      setImportRows(rows);
      setImportFileName(file.name);
    } catch {
      setImportError("Could not read that CSV file.");
      setImportRows([]);
      setImportFileName(file.name);
    }
  };

  const runImport = async (dryRun: boolean) => {
    if (!importRows.length || importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await importContacts({
        rows: importRows,
        dryRun,
        upsert: importUpsert,
        consentSource: importConsent,
        complianceAcknowledged: importCompliance,
        sourceLabel: importFileName || "audience_csv",
      });
      setImportResult(result);
      if (result.status === "completed") {
        showSuccessToast(
          `Imported ${result.summary.created} created, ${result.summary.updated} updated`,
        );
        void loadContactsRef.current();
      } else if (result.status === "held_for_review") {
        setImportError(
          result.errors[0]?.message ||
            "Held for compliance review. Acknowledge review below, then import again.",
        );
      }
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message ||
          err.message
        : err instanceof Error
          ? err.message
          : "Import failed";
      setImportError(msg);
    } finally {
      setImportBusy(false);
    }
  };

  const chatMessages = (
    <div className="flex min-h-0 flex-1 flex-col">
      {socketError ? (
        <p className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}
      <div className="dashboard-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {carried?.fromModule ? (
        <p className="text-center text-[11px] text-text-caption">
          Earlier in {handoffSourceLabel(carried.fromModule)}
        </p>
      ) : null}
      {messages.length === 0 && !busy ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-500">
          {audienceEmptyHint(totalContacts, b2c)}
        </div>
      ) : null}
      {messages.map((m) => {
        const isUser = m.role === "user";
        const showFailedCsv =
          m.role === "assistant" &&
          Boolean(m.importFailed && m.importFailed.length > 0);
        return (
          <div key={m.id} className="space-y-2">
            <div
              className={
                isUser ? "flex justify-end" : "flex justify-start"
              }
            >
              <div className={chatBubbleClass(m.role)}>
                <ChatBubbleText text={m.text} role={m.role} />
              </div>
            </div>
            {showFailedCsv ? (
              <div className="flex justify-start">
                <button
                  type="button"
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                  onClick={() =>
                    downloadFailedImportCsv(
                      m.importFailed!,
                      m.importSourceRows || [],
                    )
                  }
                >
                  <Download className="size-3.5" strokeWidth={1.75} />
                  Download failed rows CSV
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {busy ? (
        <AgentThinkingIndicator
          label={
            chatImportBusy
              ? "Importing contacts…"
              : "Agent is preparing a response"
          }
        />
      ) : null}
      <div ref={bottomRef} />
      </div>
    </div>
  );

  const chatFooter = (
    <>
      <input
        ref={chatCsvFileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importCsvFromChat(file);
        }}
      />
      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        busy={busy}
        onStop={chatImportBusy ? undefined : stopGeneration}
        inputRef={inputRef}
        placeholder={
          b2c
            ? "Ask about customers or attach a CSV…"
            : "Ask about audience or attach a CSV…"
        }
        className="w-full"
        maxWidthClass=""
        leading={
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-200/80 hover:text-neutral-800 disabled:opacity-40"
            disabled={busy}
            aria-label={
              b2c
                ? "Attach CSV to import customers"
                : "Attach CSV to import contacts"
            }
            title={
              b2c ? "Import customers from CSV" : "Import contacts from CSV"
            }
            onClick={() => chatCsvFileRef.current?.click()}
          >
            <Paperclip className="size-4" strokeWidth={1.75} />
          </button>
        }
      />
    </>
  );

  const listPane = (
    <ContactsSummaryPanel
      title={peopleLabel}
      contacts={items}
      selectedId={detailId}
      search={search}
      loading={loading}
      error={listError}
      stats={{
        total: totalContacts,
        withChannel: withChannelTotal,
      }}
      unitOne={unitOne}
      unitMany={unitMany}
      page={page}
      totalPages={totalPages}
      onSearchChange={setSearch}
      onSelectContact={openDetail}
      onPageChange={setPage}
      onExport={() => void handleExportContacts()}
      onImport={openImport}
      onRefresh={() => void loadContacts(page, searchDebounced)}
    />
  );

  const createPane = (
    <ContactGuidedPreview
      draft={draft}
      b2c={b2c}
      candidates={candidates}
      onClose={goList}
      onSelectCandidate={(c) => {
        if (c.id) openDetail(c.id);
      }}
      title={b2c ? "Customer setup" : "Contact setup"}
      nextQuestion={null}
    />
  );

  const detailPane = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 bg-white px-4 py-3">
        <button
          type="button"
          onClick={goBackFromDetail}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-900"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          {detailFromMatches
            ? "Back to results"
            : b2c
              ? "All customers"
              : "All audience"}
        </button>
        <div className="flex items-center gap-1">
          {detailId ? (
            <ConfirmDeleteButton
              name={
                [draft.first_name, draft.last_name].filter(Boolean).join(" ") ||
                draft.email ||
                draft.phone ||
                "this contact"
              }
              entityLabel={b2c ? "customer" : "contact"}
              consequence="This permanently removes them from your audience."
              confirmLabel="Delete"
              compact
              onConfirm={async () => {
                try {
                  await deleteContact(detailId);
                  return { ok: true };
                } catch (err) {
                  return {
                    ok: false,
                    error: formatContactsApiError(err, "Could not delete."),
                  };
                }
              }}
              onSuccess={() => {
                showSuccessToast(
                  b2c ? "Customer deleted" : "Contact deleted",
                );
                void loadContacts(page, searchDebounced);
                goList();
              }}
            />
          ) : null}
          <PanelExpandButton side="right" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detailLoading && !detail ? (
          <ContactDetailSkeleton />
        ) : detailError && !detail ? (
          <div>
            <p className="text-sm text-text-danger">{detailError}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={goList}
            >
              {b2c ? "Back to customers" : "Back to audience"}
            </Button>
          </div>
        ) : (
          <ContentFadeIn>
            <ContactCrmProfilePanel
              draft={draft}
              detail={detail}
              b2c={b2c}
              onEdit={
                detailId && detail
                  ? () => setManualEditOpen(true)
                  : undefined
              }
              appPush={detail?.app_push}
              webPush={detail?.web_push}
              pushEditable={Boolean(detailId && detail)}
              pushForm={pushForm}
              onPushFormChange={setPushForm}
              pushSaving={pushSaving}
              pushError={pushError}
              pushSaveDisabled={!detailId}
              onPushSave={async () => {
                if (!detailId || !detail) return false;
                setPushSaving(true);
                setPushError(null);
                try {
                  const latest = await saveContactPushFields(detail, {
                    appPushToken: pushForm.appPushToken.trim() || undefined,
                    appPushPlatform: pushForm.appPushPlatform || "android",
                  });
                  setDetail(latest);
                  if (!agentDraftLockRef.current) {
                    setDraft(draftFromContact(latest));
                  }
                  setPushForm(EMPTY_PUSH_FORM);
                  showSuccessToast("App push saved");
                  return true;
                } catch (err) {
                  setPushError(
                    formatContactsApiError(err, "Failed to save App push"),
                  );
                  return false;
                } finally {
                  setPushSaving(false);
                }
              }}
            />

            {detail && manualEditOpen ? (
              <ContactManualEditDialog
                key={detail.id}
                contact={detail}
                open={manualEditOpen}
                b2c={b2c}
                onClose={() => setManualEditOpen(false)}
                onSaved={(latest) => {
                  setDetail(latest);
                  if (!agentDraftLockRef.current) {
                    setDraft(draftFromContact(latest));
                  }
                  showSuccessToast(b2c ? "Customer updated" : "Contact updated");
                  void loadContacts(page, searchDebounced);
                }}
              />
            ) : null}

            {detailId ? (
              <ContactCampaignActivityPanel
                contactId={detailId}
                active={rightMode === "detail"}
                engagement={detail?.campaign_engagement ?? null}
                className="mt-4"
              />
            ) : null}
          </ContentFadeIn>
        )}
      </div>
    </div>
  );

  const matchesPane = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#bfbfbf]/80 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-neutral-900">Found contacts</p>
          {matchesTotalCount != null && matchesTotalCount > 0 ? (
            <p className="text-xs text-neutral-500">
              {matchesTotalCount} match{matchesTotalCount === 1 ? "" : "es"}
              {candidates.length > 0 && candidates.length < matchesTotalCount
                ? ` · showing ${candidates.length}`
                : ""}
            </p>
          ) : null}
        </div>
        <PanelExpandButton side="right" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {candidates.length === 0 ? (
          <p className="text-sm text-neutral-500">No matches to show.</p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((c, idx) => (
              <li key={c.id || `${idx}`}>
                <button
                  type="button"
                  onClick={() => c.id && openDetail(c.id, { fromMatches: true })}
                  className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left text-sm transition hover:border-neutral-300 hover:bg-white"
                >
                  <p className="font-medium text-neutral-900">
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") ||
                      c.email ||
                      c.phone ||
                      "Contact"}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {[c.email, c.phone, c.company_name, c.city]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const rightPane =
    rightMode === "create"
      ? createPane
      : rightMode === "detail"
        ? detailPane
        : rightMode === "matches"
          ? matchesPane
          : listPane;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-full min-h-0 flex-col gap-3 bg-[#f3f4f6] p-4 sm:p-5">
        <CopilotWorkspace
          fillHeight
          constrainWidth={false}
          className="min-h-0 flex-1"
          expandedSide={expandedSide}
          onExpandedSideChange={setExpandedSide}
          copilot={
            <CopilotChatShell
              title="Your Worktual co-worker"
              onRestart={restartChat}
              onRestartIcon="refresh"
              footer={chatFooter}
            >
              {chatMessages}
            </CopilotChatShell>
          }
        >
          {rightPane}
        </CopilotWorkspace>
      </div>

      {importOpen ? (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-default bg-surface shadow-xl"
            role="dialog"
            aria-labelledby="import-contacts-title"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border-default px-4 py-3">
              <div>
                <h2
                  id="import-contacts-title"
                  className="text-sm font-semibold text-text-primary"
                >
                  Import contacts
                </h2>
                <p className="mt-0.5 text-xs text-text-caption">
                  CSV with Name, Email, Phone, Company, City (Export format
                  works). Max 2000 rows.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
                onClick={closeImport}
                aria-label="Close import"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="secondary"
                className="h-9 w-full text-sm"
                onClick={() => importFileRef.current?.click()}
                disabled={importBusy}
              >
                <Upload className="size-3.5" strokeWidth={1.75} />
                {importFileName ? "Choose another CSV" : "Choose CSV file"}
              </Button>

              {importFileName ? (
                <p className="text-xs text-text-caption">
                  {importFileName}
                  {importRows.length
                    ? ` · ${importRows.length} row${importRows.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              ) : null}

              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-caption">
                  Consent source
                </span>
                <select
                  value={importConsent}
                  onChange={(e) => {
                    setImportConsent(e.target.value);
                    setImportCompliance(false);
                  }}
                  className="h-9 w-full rounded-lg border border-border-default bg-surface px-2.5 text-sm text-text-primary outline-none"
                  disabled={importBusy}
                >
                  {CONSENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={importUpsert}
                  onChange={(e) => setImportUpsert(e.target.checked)}
                  disabled={importBusy}
                  className="size-3.5 rounded border-border-default"
                />
                Update existing matches (email or phone)
              </label>

              {isWeakConsentSource(importConsent) ? (
                <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                  <input
                    type="checkbox"
                    checked={importCompliance}
                    onChange={(e) => setImportCompliance(e.target.checked)}
                    disabled={importBusy}
                    className="mt-0.5 size-3.5 rounded border-border-default"
                  />
                  <span>
                    I reviewed this list and acknowledge weak consent provenance.
                    Required to write contacts when consent is verbal/unknown/booth.
                  </span>
                </label>
              ) : null}

              {importError ? (
                <p className="text-sm text-text-danger">{importError}</p>
              ) : null}

              {importResult ? (
                <div className="rounded-lg border border-border-default bg-subtle/50 px-3 py-2.5 text-sm text-text-primary">
                  <p className="font-medium capitalize">
                    {importResult.status.replace(/_/g, " ")}
                    {importResult.quality_score != null
                      ? ` · quality ${importResult.quality_score}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-text-caption">
                    total {importResult.summary.total} · created{" "}
                    {importResult.summary.created} · updated{" "}
                    {importResult.summary.updated} · skipped{" "}
                    {importResult.summary.skipped} · failed{" "}
                    {importResult.summary.failed}
                    {importResult.summary.held
                      ? ` · held ${importResult.summary.held}`
                      : ""}
                  </p>
                  {importResult.errors.length > 0 ? (
                    <>
                      <p className="mt-2 text-xs text-text-caption">
                        Download the CSV to fix and re-import.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        className="mt-2.5 h-8 w-full text-xs"
                        onClick={() =>
                          downloadFailedImportCsv(
                            importResult.errors,
                            importRows,
                          )
                        }
                      >
                        <Download className="size-3.5" strokeWidth={1.75} />
                        Download failed rows CSV
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 flex-1 text-sm"
                  disabled={!importRows.length || importBusy}
                  onClick={() => void runImport(true)}
                >
                  {importBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Dry run
                </Button>
                <Button
                  type="button"
                  variant="brand"
                  className="h-9 flex-1 text-sm"
                  disabled={
                    !importRows.length ||
                    importBusy ||
                    (isWeakConsentSource(importConsent) && !importCompliance)
                  }
                  onClick={() => void runImport(false)}
                >
                  {importBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Import
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
