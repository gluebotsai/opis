import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Download,
  Pin,
  Plus,
  Search,
  Settings2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import { ContactQuickActions } from "@/components/contacts/ContactQuickActions";
import { DeleteContactButton } from "@/components/contacts/DeleteContactButton";
import {
  ContactCreateDraftPanel,
  emptyContactDraft,
  NEW_COMPANY,
} from "@/components/contacts/ContactCreateDraftPanel";
import { ContactDetailPane } from "@/components/contacts/ContactDetailPane";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { ContactImportDialog } from "@/components/contacts/ContactImportDialog";
import {
  formatContactType,
  LEAD_STATUS_OPTIONS,
  CONTACT_TYPE_OPTIONS,
  STATUS_OPTIONS,
} from "@/components/contacts/contact-labels";
import { createListCache } from "@/lib/list-cache";
import type { BusinessType } from "@/config/modules";
import { showCompanyOnContacts } from "@/lib/business-type-copy";
import { initialsFromName } from "@/lib/avatar";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import { WORKTUAL_ICON_BUTTON } from "@/lib/worktual-control-tokens";
import { runContactImportCoworkerTool } from "@/lib/coworker/contact-import-mutation";
import { canEditContacts, normalizeRole } from "@/lib/rbac";
import { CONTACT_EXPORT_FORMATS, downloadFile, type ContactExportFormat } from "@/lib/csv";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  exportContacts,
  CONTACT_LIST_PAGE_SIZE,
  fetchContactsPage,
  getProspectPull,
  importProspectPull,
  enrichContactViaZoominfo,
  setContactPinned,
  startProspectPull,
  type ContactListItem,
  type DuplicateCandidateView,
} from "@/services/contacts";
import type { AgentToolProposal, ContactDraftFields, CoworkerSessionMemory } from "@/services/coworker";
import { runContactCoworkerMutation } from "@/lib/coworker/contact-mutations";
import { useAppSelector } from "@/store";
import { ContactsPageSkeleton } from "./ContactsPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  createLocation,
  fetchCompany,
  updateCompany,
  updateLocation,
} from "@/services/companies";
import {
  CREATE_HIGHLIGHT_ROW_CLASS,
  SUCCESS_FLASH_CLASS,
} from "@/lib/ui-tones";

type ContactsWorkspaceMode = "list" | "create" | "detail";

type ChatContactFilters = {
  search?: string;
  location?: string;
  leadSource?: string;
  owner?: string;
  company?: string;
  email?: string;
  phone?: string;
  createdOn?: string;
  leadStatus?: string;
  contactType?: string;
};

const CHAT_FILTER_KEYS = [
  "cq",
  "location",
  "leadSource",
  "owner",
  "company",
  "email",
  "phone",
  "createdOn",
  "leadStatus",
  "contactType",
  "stage",
] as const;

function applyChatContactFilters(
  next: URLSearchParams,
  filters: ChatContactFilters,
) {
  next.delete("q");
  for (const key of CHAT_FILTER_KEYS) next.delete(key);
  const search = filters.search?.trim() ?? "";
  if (search) next.set("cq", search);
  const pairs: Array<[string, string | undefined]> = [
    ["location", filters.location],
    ["leadSource", filters.leadSource],
    ["owner", filters.owner],
    ["company", filters.company],
    ["email", filters.email],
    ["phone", filters.phone],
    ["createdOn", filters.createdOn],
    ["leadStatus", filters.leadStatus],
    ["contactType", filters.contactType],
  ];
  for (const [key, value] of pairs) {
    const text = cleanChatFilter(key, value);
    if (text) next.set(key, text);
  }
}

function cleanChatFilter(key: string, value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (!text || text === "all") return "";
  if (key === "leadStatus") {
    const status = text.toLowerCase().replace(/[\s_-]+/g, "");
    return [
      "new",
      "contacted",
      "qualifying",
      "qualified",
      "disqualified",
      "converted",
    ].includes(status)
      ? status
      : "";
  }
  if (key === "contactType") {
    let stage = text.toLowerCase().replace(/[\s_-]+/g, "");
    if (stage.endsWith("s")) stage = stage.slice(0, -1);
    return ["contact", "lead", "prospect", "customer", "churned"].includes(stage)
      ? stage
      : "";
  }
  return text;
}

function chatFiltersFromTool(
  args: Record<string, unknown>,
): ChatContactFilters {
  const text = (key: string) =>
    typeof args[key] === "string" ? args[key].trim() : "";
  return {
    search: text("search"),
    location: text("location"),
    leadSource: text("leadSource"),
    owner: text("owner"),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    createdOn: text("createdOn"),
    leadStatus: text("leadStatus"),
    contactType: text("stage") || text("contactType"),
  };
}

function parseWorkspaceMode(
  view: string | null,
  id: string | null,
): ContactsWorkspaceMode {
  if (view === "create") return "create";
  if (view === "detail" && id) return "detail";
  if (id && view !== "list" && view !== "create") return "detail";
  return "list";
}

function ownerDisplayName(label: string | null | undefined): string {
  if (!label) return "—";
  const paren = label.indexOf(" (");
  return paren > 0 ? label.slice(0, paren) : label;
}

const CONTACT_AVATAR_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-800",
  "bg-cyan-100 text-cyan-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-lime-100 text-lime-800",
] as const;

function contactAvatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CONTACT_AVATAR_TONES[hash % CONTACT_AVATAR_TONES.length]!;
}

function contactListWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function contactMetaLine(
  contact: ContactListItem,
  showCompany: boolean,
  showOwner: boolean,
): string {
  const parts: string[] = [];
  if (showCompany && contact.companyName) parts.push(contact.companyName);
  if (contact.title) parts.push(contact.title);
  parts.push(formatContactType(contact.contactType));
  if (showOwner && contact.ownerName) {
    parts.push(ownerDisplayName(contact.ownerName));
  }
  return parts.join(" · ");
}

/** Title-case words for list display (keeps non-letter characters). */
function formatContactListName(name: string): string {
  return name.replace(/[A-Za-z]+/g, (word) => {
    if (word.length === 1) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

type ContactListSnapshot = {
  items: ContactListItem[];
  page: number;
  total: number;
  hasNext: boolean;
  showOwner: boolean;
  businessType: BusinessType;
};

const contactListCache = createListCache<ContactListSnapshot>();

function contactListKey(filters: Record<string, string>): string {
  return JSON.stringify(filters);
}

export function ContactsPage() {
  const user = useAppSelector((s) => s.auth.user);
  const canImport = canEditContacts(normalizeRole(user?.role));
  const [searchParams, setSearchParams] = useSearchParams();
  const typedSearch = searchParams.get("q") ?? "";
  const chatSearch = searchParams.get("cq") ?? "";
  const search = typedSearch.trim() || chatSearch.trim();
  const contactType =
    searchParams.get("contactType") ?? searchParams.get("stage") ?? "all";
  const leadStatus = searchParams.get("leadStatus") ?? "all";
  const rawStatus = searchParams.get("status") ?? "all";
  const status = ["all", "active", "inactive", "unknown"].includes(rawStatus)
    ? rawStatus
    : "all";
  const location = searchParams.get("location") ?? "";
  const leadSourceFilter = searchParams.get("leadSource") ?? "";
  const ownerFilter = searchParams.get("owner") ?? "";
  const companyFilter = searchParams.get("company") ?? "";
  const emailFilter = searchParams.get("email") ?? "";
  const phoneFilter = searchParams.get("phone") ?? "";
  const createdOn = searchParams.get("createdOn") ?? "";
  const viewParam = searchParams.get("view");
  const idParam = searchParams.get("id");
  const workspaceMode = parseWorkspaceMode(viewParam, idParam);
  const activeContactId = workspaceMode === "detail" ? idParam : null;

  const listKey = contactListKey({
    search,
    contactType,
    leadStatus,
    status,
    location,
    leadSource: leadSourceFilter,
    owner: ownerFilter,
    company: companyFilter,
    email: emailFilter,
    phone: phoneFilter,
    createdOn,
  });
  const listKeyRef = useRef(listKey);
  const seeded = useRef(contactListCache.read(listKey)).current;

  const [items, setItems] = useState<ContactListItem[]>(seeded?.items ?? []);
  const [page, setPage] = useState(seeded?.page ?? 1);
  const [total, setTotal] = useState(seeded?.total ?? 0);
  const [hasNext, setHasNext] = useState(seeded?.hasNext ?? false);
  const [showOwner, setShowOwner] = useState(seeded?.showOwner ?? false);
  const [businessType, setBusinessType] = useState(
    seeded?.businessType ?? user?.businessType ?? "b2b",
  );
  const [loading, setLoading] = useState(!seeded);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableScrollEl, setTableScrollEl] = useState<HTMLDivElement | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(typedSearch);

  const [pinPending] = useState(false);
  const [pinError] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<ContactListItem | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ContactExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const [createDraft, setCreateDraft] = useState<ContactDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyContactDraft(),
      readDraftSessionMemory("shell:contact"),
      "contactDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<ContactDraftFields>) => void) | null
  >(null);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);
  const sessionMemoryExtraRef = useRef<CoworkerSessionMemory | null>(null);

  const clearPendingDuplicates = useCallback(() => {
    sessionMemoryExtraRef.current = null;
  }, []);

  const onDuplicatesFound = useCallback((duplicates: DuplicateCandidateView[]) => {
    sessionMemoryExtraRef.current = {
      slots: {
        pendingDuplicateContacts: duplicates.map((dup) => ({
          id: dup.id,
          displayName: dup.displayName,
          email: dup.email,
          phone: dup.phone,
          companyName: dup.companyName,
        })),
      },
    };
  }, []);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);

  const { createdToast, isHighlighted } = useCreateHighlight();

  const showCompany = showCompanyOnContacts(businessType);

  const typedSearchRef = useRef(typedSearch);
  const chatSearchRef = useRef(chatSearch);
  typedSearchRef.current = typedSearch;
  chatSearchRef.current = chatSearch;
  const listFiltersRef = useRef({
    contactType,
    leadStatus,
    status,
    location,
    leadSource: leadSourceFilter,
    owner: ownerFilter,
    company: companyFilter,
    email: emailFilter,
    phone: phoneFilter,
    createdOn,
  });
  listFiltersRef.current = {
    contactType,
    leadStatus,
    status,
    location,
    leadSource: leadSourceFilter,
    owner: ownerFilter,
    company: companyFilter,
    email: emailFilter,
    phone: phoneFilter,
    createdOn,
  };
  const loadSeq = useRef(0);

  const patchParams = useCallback(
    (patch: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (!v || v === "all" || (k === "q" && !v.trim())) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setWorkspace = useCallback(
    (
      mode: ContactsWorkspaceMode,
      opts?: {
        entityId?: string;
        search?: string;
        form?: boolean;
        filters?: ChatContactFilters;
      },
    ) => {
      if (opts?.filters) {
        chatSearchRef.current = opts.filters.search?.trim() ?? "";
        typedSearchRef.current = "";
        const text = (value?: string) => value?.trim() ?? "";
        listFiltersRef.current = {
          ...listFiltersRef.current,
          contactType: text(opts.filters.contactType) || "all",
          leadStatus: text(opts.filters.leadStatus) || "all",
          location: text(opts.filters.location),
          leadSource: text(opts.filters.leadSource),
          owner: text(opts.filters.owner),
          company: text(opts.filters.company),
          email: text(opts.filters.email),
          phone: text(opts.filters.phone),
          createdOn: text(opts.filters.createdOn),
        };
      } else if (opts?.search != null) {
        chatSearchRef.current = opts.search.trim();
        typedSearchRef.current = "";
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (mode === "list") {
            next.delete("view");
            next.delete("id");
            next.delete("form");
          } else if (mode === "create") {
            next.set("view", "create");
            next.delete("id");
            if (opts?.form) next.set("form", "1");
            else next.delete("form");
          } else {
            next.set("view", "detail");
            next.delete("form");
            if (opts?.entityId) next.set("id", opts.entityId);
          }
          if (opts?.filters) {
            applyChatContactFilters(next, opts.filters);
          } else if (opts?.search != null) {
            // Chat filters the list without filling the search box.
            next.delete("q");
            if (opts.search.trim()) next.set("cq", opts.search.trim());
            else next.delete("cq");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const createPanelMode =
    searchParams.get("form") === "1" ? "form" : "guided";

  useEffect(() => {
    setSearchDraft(typedSearch);
  }, [typedSearch]);

  useEffect(() => {
    if (!toolsMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!toolsMenuRef.current?.contains(event.target as Node)) {
        setToolsMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolsMenuOpen]);

  const commitSearch = useCallback(() => {
    typedSearchRef.current = searchDraft.trim();
    chatSearchRef.current = "";
    listFiltersRef.current = {
      ...listFiltersRef.current,
      location: "",
      leadSource: "",
      owner: "",
      company: "",
      email: "",
      phone: "",
      createdOn: "",
    };
    patchParams({
      q: searchDraft.trim(),
      cq: "",
      location: "",
      leadSource: "",
      owner: "",
      company: "",
      email: "",
      phone: "",
      createdOn: "",
    });
  }, [patchParams, searchDraft]);

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      const seq = ++loadSeq.current;
      const effectiveSearch =
        typedSearchRef.current.trim() || chatSearchRef.current.trim();
      // Rows already held for this view are shown straight away and refreshed
      // behind the user, so returning to the list never falls back to the
      // skeleton.
      const known = append ? undefined : contactListCache.read(listKeyRef.current);
      if (known) {
        setItems(known.items);
        setPage(known.page);
        setTotal(known.total);
        setHasNext(known.hasNext);
        setShowOwner(known.showOwner);
        setBusinessType(known.businessType);
      }
      if (append) setLoadingMore(true);
      else if (!known) setLoading(true);
      setError(null);
      try {
        const filters = listFiltersRef.current;
        const result = await fetchContactsPage({
          page: pageNum,
          pageSize: CONTACT_LIST_PAGE_SIZE,
          search: effectiveSearch,
          contactType: filters.contactType,
          leadStatus: filters.leadStatus,
          status: filters.status,
          location: filters.location,
          leadSource: filters.leadSource,
          owner: filters.owner,
          company: filters.company,
          email: filters.email,
          phone: filters.phone,
          createdOn: filters.createdOn,
        });
        if (seq !== loadSeq.current) return;
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setPage(pageNum);
        setTotal(result.pagination.total);
        setHasNext(result.pagination.hasNext ?? pageNum < result.pagination.totalPages);
        setShowOwner(result.showOwner);
        setBusinessType(result.businessType);
      } catch {
        if (seq !== loadSeq.current) return;
        setError("Failed to load contacts.");
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    listKeyRef.current = listKey;
    void loadPage(1, false);
  }, [
    loadPage,
    listKey,
    search,
    contactType,
    leadStatus,
    status,
    location,
    leadSourceFilter,
    ownerFilter,
    companyFilter,
    emailFilter,
    phoneFilter,
    createdOn,
  ]);

  // Keep the cache level with what is on screen, appended pages included.
  // Skipped while a fetch is in flight, so a stale list is never stored under
  // the key it is being replaced for.
  useEffect(() => {
    if (loading || loadingMore || error) return;
    contactListCache.write(listKeyRef.current, {
      items,
      page,
      total,
      hasNext,
      showOwner,
      businessType,
    });
  }, [items, page, total, hasNext, showOwner, businessType, loading, loadingMore, error]);

  const onLoadMore = useCallback(() => {
    if (!hasNext || loading || loadingMore) return;
    void loadPage(page + 1, true);
  }, [hasNext, loading, loadingMore, loadPage, page]);

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNext,
    loading: loading || loadingMore,
    onLoadMore,
    scrollRoot: tableScrollEl,
    rootMargin: "80px",
  });

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const created = (item: ContactListItem) =>
        new Date(item.createdAt || item.updatedAt).getTime();
      return created(b) - created(a);
    });
  }, [items]);

  const onPin = async (id: string, isPinned: boolean) => {
    const result = await setContactPinned(id, !isPinned);
    if (result.ok) {
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, isPinned: !isPinned } : c)));
    }
  };

  const onUnpinContact = (id: string) => {
    void onPin(id, true);
  };

  const openContact = useCallback(
    (
      contactId: string,
      event?: { metaKey?: boolean; ctrlKey?: boolean; button?: number },
    ) => {
      const href = `/contact/${contactId}`;
      if (event?.metaKey || event?.ctrlKey || event?.button === 1) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      setWorkspace("detail", { entityId: contactId });
    },
    [setWorkspace],
  );

  const onContactDraftPatch = useCallback(
    (patch: Partial<ContactDraftFields>) => {
      if (draftPatchRef.current) {
        draftPatchRef.current(patch);
        return;
      }
      setCreateDraft((prev) => {
        const next = { ...prev, ...patch };
        if (
          patch.companyName?.trim() &&
          (patch.companyId === undefined || patch.companyId === "")
        ) {
          next.companyId = NEW_COMPANY;
          next.locationId = "";
        }
        return next;
      });
    },
    [],
  );

  const onWorkspaceCommand = useCallback(
    (tool: AgentToolProposal) => {
      if (tool.name !== "set_workspace") return false;
      const mode = String(tool.args.mode || "") as ContactsWorkspaceMode;
      if (mode !== "list" && mode !== "create" && mode !== "detail") {
        return false;
      }
      const entityId =
        typeof tool.args.entityId === "string" ? tool.args.entityId : undefined;
      const searchQ =
        typeof tool.args.search === "string" ? tool.args.search : undefined;
      if (mode === "create" && workspaceMode !== "create") {
        setCreateDraft(emptyContactDraft());
      }
      if (mode === "list" || (mode === "detail" && !entityId)) {
        setWorkspace("list", { filters: chatFiltersFromTool(tool.args) });
        return true;
      }
      setWorkspace(mode, { entityId, search: searchQ });
      return true;
    },
    [setWorkspace, workspaceMode],
  );

  const onExport = (format: ContactExportFormat) => {
    if (exporting) return;
    setExportError(null);
    setExporting(true);
    void exportContacts({
      search,
      contactType,
      leadStatus,
      status,
      location,
      leadSource: leadSourceFilter,
      owner: ownerFilter,
      company: companyFilter,
      email: emailFilter,
      phone: phoneFilter,
      createdOn,
      format,
    }).then((result) => {
      setExporting(false);
      if (!result.ok) {
        setExportError(result.error);
        return;
      }
      downloadFile(result.filename, result.content, result.mimeType);
      setExportOpen(false);
      if (result.truncated) {
        setExportError(
          `Exported first ${result.count.toLocaleString()} matching contacts (limit reached).`,
        );
      }
    });
  };

  const listTitle = contactType === "lead" ? "Lead desk" : "Contacts";
  const listDescription =
    contactType === "lead"
      ? MODULE_WORKSPACE_DESCRIPTION.leads
      : MODULE_WORKSPACE_DESCRIPTION.contacts;

  const listWorkspace = (
    <div className="crm-fade-in flex h-full max-h-full min-h-0 min-w-0 w-full flex-col overflow-hidden px-3 py-2 sm:px-5 sm:py-3">
      {pinError ? (
        <p className="mb-2 shrink-0 text-sm text-text-danger" role="status">
          {pinError}
        </p>
      ) : null}
      {exportError ? (
        <p className="mb-2 shrink-0 text-sm text-text-secondary" role="status">
          {exportError}
        </p>
      ) : null}
      {createdToast ? (
        <p
          className={`mb-2 shrink-0 ${SUCCESS_FLASH_CLASS}`}
          role="status"
        >
          Contact created — it's highlighted below.
        </p>
      ) : null}

      <div className="flex shrink-0 flex-col gap-3 @[44rem]:flex-row @[44rem]:flex-wrap @[44rem]:items-start">
        <div className="min-w-0 w-full @[44rem]:min-w-[14rem] @[44rem]:flex-[2_1_16rem]">
          <Input
              placeholder="Search name, email, phone, company, city, owner, source, or a created date"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitSearch();
              }
            }}
            leftIcon={<Search className="size-4" strokeWidth={1.75} />}
            aria-label="Search contacts"
          />
          {searchDraft.trim() !== typedSearch.trim() ? (
            <p className="mt-1 text-xs text-text-caption">Press Enter to search</p>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-3 gap-3 @[44rem]:contents">
          <div className="min-w-0 @[44rem]:min-w-[8.5rem] @[44rem]:max-w-[11rem] @[44rem]:flex-[1_1_8.5rem]">
            <Select
              options={[...CONTACT_TYPE_OPTIONS]}
              value={contactType}
              onChange={(e) =>
                patchParams({ contactType: e.target.value, stage: "" })
              }
              aria-label="Filter by stage"
            />
          </div>
          <div className="min-w-0 @[44rem]:min-w-[8.5rem] @[44rem]:max-w-[11rem] @[44rem]:flex-[1_1_8.5rem]">
            <Select
              options={[...LEAD_STATUS_OPTIONS]}
              value={leadStatus}
              onChange={(e) => patchParams({ leadStatus: e.target.value })}
              aria-label="Filter by lead status"
            />
          </div>
          <div className="min-w-0 @[44rem]:min-w-[8.5rem] @[44rem]:max-w-[11rem] @[44rem]:flex-[1_1_8.5rem]">
            <Select
              options={[...STATUS_OPTIONS]}
              value={status}
              onChange={(e) => patchParams({ status: e.target.value })}
              aria-label="Filter contacts"
            />
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-4 shrink-0 text-sm text-text-danger">{error}</p>
      ) : null}

      <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {sortedItems.length === 0 ? (
          <div className="px-2 py-16 text-center">
            <p className="text-sm font-medium text-text-primary">
              No contacts found
            </p>
            {search.trim() ||
            contactType !== "all" ||
            leadStatus !== "all" ||
            status !== "all" ? (
              <p className="mt-2 text-sm text-text-caption">
                Clear filters to see records.
              </p>
            ) : null}
          </div>
        ) : (
          <div
            ref={setTableScrollEl}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <ul className="divide-y divide-[#e5e5e5]">
              {sortedItems.map((c) => {
                const meta = contactMetaLine(c, showCompany, showOwner);
                const addedAt = contactListWhen(c.createdAt || c.updatedAt);
                return (
                  <li
                    key={c.id}
                    data-highlight-id={c.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open ${c.displayName}${c.isPinned ? " (pinned)" : ""}`}
                    className={`group flex cursor-pointer items-start gap-3 px-1 py-3.5 transition-colors hover:bg-neutral-50 sm:px-2 ${
                      isHighlighted(c.id)
                        ? CREATE_HIGHLIGHT_ROW_CLASS
                        : c.isPinned
                          ? "bg-brand/[0.03]"
                          : "bg-white"
                    }`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.closest("a, button, input, textarea, select")
                      ) {
                        return;
                      }
                      openContact(c.id, e);
                    }}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return;
                      const target = e.target as HTMLElement;
                      if (
                        target.closest("a, button, input, textarea, select")
                      ) {
                        return;
                      }
                      e.preventDefault();
                      openContact(c.id, e);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      const target = e.target as HTMLElement;
                      if (
                        target.closest("a, button, input, textarea, select")
                      ) {
                        return;
                      }
                      e.preventDefault();
                      openContact(c.id);
                    }}
                  >
                    <span
                      className={`mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${contactAvatarTone(c.displayName)}`}
                      aria-hidden
                    >
                      {initialsFromName(c.displayName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-semibold text-neutral-900">
                          {formatContactListName(c.displayName)}
                        </p>
                        {c.isPinned ? (
                          <button
                            type="button"
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-brand hover:bg-brand/10 disabled:opacity-50"
                            title="Unpin contact"
                            aria-label={`Unpin ${c.displayName}`}
                            disabled={pinPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnpinContact(c.id);
                            }}
                          >
                            <Pin
                              className="size-3.5 fill-current"
                              strokeWidth={1.75}
                            />
                          </button>
                        ) : null}
                      </div>
                      {c.email ? (
                        <button
                          type="button"
                          className="mt-0.5 block max-w-full truncate text-left text-sm text-neutral-700 hover:underline"
                          title={`Email ${c.displayName}`}
                          onClick={() => setEmailDraft(c)}
                        >
                          {c.email}
                        </button>
                      ) : c.phone ? (
                        <p className="mt-0.5 truncate text-sm text-neutral-700">
                          {c.phone}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-sm text-neutral-400">—</p>
                      )}
                      {meta ? (
                        <p className="mt-0.5 truncate text-sm text-neutral-400">
                          {meta}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 self-start overflow-visible">
                      {addedAt ? (
                        <time
                          dateTime={c.createdAt || c.updatedAt}
                          className="whitespace-nowrap text-[11px] leading-4 text-neutral-400"
                        >
                          {addedAt}
                        </time>
                      ) : null}
                      <div className="flex items-center gap-0.5">
                      <ContactQuickActions
                        contactId={c.id}
                        displayName={c.displayName}
                        email={c.email}
                        phone={c.phone}
                        variant="list"
                      />
                      <DeleteContactButton
                        id={c.id}
                        name={c.displayName}
                        compact
                        onDeleted={() => {
                          setItems((prev) =>
                            prev.filter((item) => item.id !== c.id),
                          );
                          setTotal((prev) => Math.max(0, prev - 1));
                        }}
                      />
                      </div>
                    </div>
                  </li>
                );
              })}
              {loadingMore
                ? Array.from({ length: 3 }).map((_, index) => (
                    <li
                      key={`contact-more-${index}`}
                      className="flex items-start gap-3 px-1 py-3.5 sm:px-2"
                      aria-hidden
                    >
                      <Skeleton height={40} width={40} borderRadius={999} />
                      <div className="min-w-0 flex-1 space-y-2 pt-1">
                        <SkeletonText width={`${68 - index * 8}%`} height={14} />
                        <SkeletonText width={160} height={12} />
                      </div>
                    </li>
                  ))
                : null}
            </ul>
            <InfiniteScrollSentinel ref={sentinelRef} />
            {loadingMore ? (
              <p className="sr-only" role="status">
                Loading more contacts
              </p>
            ) : null}
          </div>
        )}
      </div>

      {emailDraft ? (
        <EmailComposeDialog
          onClose={() => setEmailDraft(null)}
          initialContact={{
            id: emailDraft.id,
            displayName: emailDraft.displayName,
            email: emailDraft.email,
            phone: emailDraft.phone,
          }}
          initialTo={emailDraft.email}
        />
      ) : null}
    </div>
  );

  const workspace =
    workspaceMode === "create" ? (
      <ContactCreateDraftPanel
        draft={createDraft}
        onDraftChange={setCreateDraft}
        patchRef={draftPatchRef}
        submitRef={draftSubmitRef}
        onDuplicatesFound={onDuplicatesFound}
        mode={createPanelMode}
        onCancel={() => {
          clearPendingDuplicates();
          setWorkspace("list");
        }}
        onCreated={(contactId) => {
          clearPendingDuplicates();
          sessionMemoryExtraRef.current = {
            slots: { contactId },
            lastEntities: { contactId },
          };
          setCreateDraft(emptyContactDraft());
          const next = new URLSearchParams(searchParams);
          next.delete("form");
          next.set("view", "detail");
          next.set("id", contactId);
          next.set("highlight", contactId);
          setSearchParams(next, { replace: true });
          void loadPage(1, false);
        }}
      />
    ) : workspaceMode === "detail" && activeContactId ? (
      <ContactDetailPane
        contactId={activeContactId}
        onBack={() => setWorkspace("list")}
        onUnavailable={() => {
          setWorkspace("list");
          void loadPage(1, false);
        }}
        refreshToken={detailRefreshToken}
      />
    ) : (
      listWorkspace
    );

  return (
    <AgentModuleShell
      moduleId="contact"
      title={listTitle}
      welcome="I'm your **Worktual co-worker**. I can search, create, and update contacts in natural conversation — ask one thing at a time. The list stays on the right."
      chips={[]}
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      entityId={activeContactId}
      draft={workspaceMode === "create" ? createDraft : null}
      workspaceTitle={listTitle}
      workspaceHeaderLeading={
        workspaceMode === "list" ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[18px] font-semibold text-neutral-900">
              {listTitle}
            </p>
            <p className="mt-0.5 truncate text-sm text-neutral-500">
              {listDescription}
            </p>
          </div>
        ) : undefined
      }
      workspaceHeaderActions={
        workspaceMode === "list" ? (
          <>
            <div className="relative" ref={toolsMenuRef}>
              <button
                type="button"
                className={`${WORKTUAL_ICON_BUTTON} ${
                  toolsMenuOpen ? "bg-neutral-100" : ""
                }`}
                title="Import and export"
                aria-label="Import and export"
                aria-haspopup="menu"
                aria-expanded={toolsMenuOpen}
                onClick={() => setToolsMenuOpen((open) => !open)}
              >
                <Settings2 strokeWidth={1.75} />
              </button>
              {toolsMenuOpen ? (
                <div
                  role="menu"
                  className="absolute top-full right-0 z-30 mt-1 min-w-[11rem] overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-sm"
                >
                  {canImport ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        setImportOpen(true);
                      }}
                    >
                      <Upload className="size-4 text-neutral-500" strokeWidth={1.75} />
                      Import CSV
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={exporting || total === 0}
                    title={
                      total === 0
                        ? "No contacts to export"
                        : "Export filtered contacts"
                    }
                    onClick={() => {
                      if (exporting || total === 0) return;
                      setToolsMenuOpen(false);
                      setExportError(null);
                      setExportOpen(true);
                    }}
                  >
                    <Download className="size-4 text-neutral-500" strokeWidth={1.75} />
                    {exporting ? "Exporting…" : "Export"}
                  </button>
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => {
                setCreateDraft(emptyContactDraft());
                setWorkspace("create", { form: true });
              }}
            >
              <Plus className="size-4" strokeWidth={1.75} />
              Add contact
            </Button>
          </>
        ) : undefined
      }
      workspaceHeaderTall={workspaceMode === "list"}
      workspace={
        <>
          <ContactImportDialog
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={() => void loadPage(1, false)}
          />
          {exportOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              role="presentation"
              onClick={() => {
                if (!exporting) setExportOpen(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-md rounded-xl border border-border-default bg-surface p-5 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-base font-semibold text-text-primary">
                  Export contacts
                </h2>
                <p className="mt-1 text-sm text-text-caption">
                  Choose a file type. Current search and filters are applied.
                </p>
                <fieldset className="mt-4 space-y-2" disabled={exporting}>
                  <legend className="sr-only">File type</legend>
                  {CONTACT_EXPORT_FORMATS.map((option) => (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                        exportFormat === option.value
                          ? "border-border-strong bg-subtle"
                          : "border-border-default hover:border-border-strong"
                      }`}
                    >
                      <input
                        type="radio"
                        name="contactExportFormat"
                        className="mt-1"
                        checked={exportFormat === option.value}
                        onChange={() => setExportFormat(option.value)}
                      />
                      <span>
                        <span className="block text-sm font-medium text-text-primary">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-caption">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={exporting}
                    onClick={() => setExportOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={exporting}
                    onClick={() => onExport(exportFormat)}
                  >
                    <Download className="size-4" strokeWidth={1.75} />
                    {exporting ? "Exporting…" : "Download"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {loading && items.length === 0 && workspaceMode === "list" ? (
            <ContactsPageSkeleton />
          ) : (
            workspace
          )}
        </>
      }
      onWorkspaceCommand={onWorkspaceCommand}
      sessionMemoryExtraRef={sessionMemoryExtraRef}
      onContactDraftPatch={onContactDraftPatch}
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_enrich_contact_zoominfo") {
          const contactId = String(
            tool.args.contactId || activeContactId || "",
          ).trim();
          if (!contactId) {
            return "Open a contact detail first, or pass contactId.";
          }
          try {
            const res = await enrichContactViaZoominfo(contactId);
            if (res && "ok" in res && (res as { ok?: boolean }).ok === false) {
              return (
                (res as { error?: string }).error ||
                "ZoomInfo enrich failed."
              );
            }
            const summary =
              (res as { summary?: string | null })?.summary?.trim() ||
              "Contact enriched with ZoomInfo.";
            return summary;
          } catch (err) {
            return err instanceof Error
              ? err.message
              : "ZoomInfo enrich failed.";
          }
        }
        if (tool.name === "propose_pull_prospect_leads") {
          const phase = String(tool.args.phase || "start").toLowerCase();
          const importNowRaw = tool.args.importNow;
          const importNow =
            phase === "import" ||
            importNowRaw === true ||
            importNowRaw === "true" ||
            importNowRaw === 1 ||
            importNowRaw === "1";
          const existingJobId = String(tool.args.jobId || "").trim();
          const selectedIds = Array.isArray(tool.args.selectedIds)
            ? tool.args.selectedIds.map(String)
            : undefined;
          if (phase === "import" && existingJobId) {
            try {
              const result = await importProspectPull(existingJobId, selectedIds);
              if (!result.ok) return result.error || "Import failed.";
              void loadPage(1, false);
              return (
                result.message ||
                `Imported ${result.imported.length} prospect lead(s).`
              );
            } catch {
              return "Prospect import failed — try again.";
            }
          }
          try {
            const criteria: Record<string, unknown> = {};
            for (const key of [
              "industries",
              "geos",
              "sizeTiers",
              "titles",
              "technographics",
            ] as const) {
              const val = tool.args[key];
              if (Array.isArray(val) && val.length) criteria[key] = val;
            }
            if (typeof tool.args.productFitHint === "string") {
              criteria.productFitHint = tool.args.productFitHint;
            }
            if (typeof tool.args.freeText === "string") {
              criteria.freeText = tool.args.freeText;
            }
            const started = await startProspectPull({
              limit:
                typeof tool.args.limit === "number"
                  ? tool.args.limit
                  : Number(tool.args.limit) || 10,
              sources: Array.isArray(tool.args.sources)
                ? tool.args.sources.map(String)
                : undefined,
              criteria,
            });
            if (!started.ok) return started.error || "Failed to start pull.";
            // Poll until ready / failed (bounded). ZoomInfo search is ~5s; qualify LLM can add more.
            let review = await getProspectPull(started.jobId);
            for (let i = 0; i < 80; i++) {
              if (!review.ok) break;
              const st = review.job.status;
              if (
                st === "ready_for_review" ||
                st === "failed" ||
                st === "imported" ||
                st === "cancelled"
              ) {
                break;
              }
              await new Promise((r) => setTimeout(r, 1500));
              review = await getProspectPull(started.jobId);
            }
            if (!review.ok) return review.error || "Pull failed.";
            if (review.job.status === "failed") {
              return (
                review.job.lastError ||
                "Prospect pull failed. Check research provider keys."
              );
            }
            if (review.job.status !== "ready_for_review") {
              return `Prospect pull still running (${review.job.status}, job ${started.jobId}). Say **check prospect pull ${started.jobId}** or ask again shortly.`;
            }
            if (review.candidates.length === 0) {
              const summary = review.job.resultSummary;
              const skippedExisting =
                summary &&
                typeof summary === "object" &&
                !Array.isArray(summary) &&
                typeof summary.skippedExisting === "number"
                  ? summary.skippedExisting
                  : 0;
              if (skippedExisting > 0) {
                return `The next matches are already in Contacts (${skippedExisting} skipped, job ${started.jobId}). I did not import them again. Ask for a different role or company, for example **pull 1 CEO lead**.`;
              }
              const sources =
                (review.job.sourcesUsed || review.job.sourcesRequested || []).join(
                  ", ",
                ) || "providers";
              return `Found 0 prospect lead(s) from ${sources} (job ${started.jobId}). Try a broader title/company, or say **pull 5 leads from ZoomInfo** with a role like CEO or Manager.`;
            }
            const lines = review.candidates
              .slice(0, 12)
              .map((c) => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
                const reasons = Array.isArray(c.qualifyReasons)
                  ? (c.qualifyReasons as string[]).join("; ")
                  : "";
                return `- ${name || "Lead"} @ ${c.companyName || c.companyDomain || "—"} (${(c.sourcesFoundIn || []).join("+")})${reasons ? ` — ${reasons}` : ""}`;
              })
              .join("\n");
            const sources =
              (review.job.sourcesUsed || review.job.sourcesRequested || []).join(
                ", ",
              ) || "providers";
            const preview = `Found ${review.candidates.length} prospect lead(s) from ${sources} (job ${started.jobId}). Review:\n${lines}`;
            if (importNow) {
              try {
                const imported = await importProspectPull(
                  started.jobId,
                  selectedIds,
                );
                if (!imported.ok) {
                  return `${preview}\n\n${imported.error || "Import failed."}`;
                }
                void loadPage(1, false);
                const summary =
                  imported.message ||
                  `Imported ${imported.imported.length} prospect lead(s).`;
                return `${summary}\n${lines}`;
              } catch {
                return `${preview}\n\nProspect import failed — try again.`;
              }
            }
            return `${preview}\n\nSay **import these leads** to add them to Contacts (enrichment will run after import).`;
          } catch (err) {
            const msg = err instanceof Error ? err.message.trim() : "";
            if (/timeout/i.test(msg)) {
              return "Prospect pull timed out waiting for providers. Try again with sources=[\"zoominfo\"] only.";
            }
            return msg || "Prospect pull failed — try again.";
          }
        }
        if (tool.name === "propose_import_contacts") {
          const result = await runContactImportCoworkerTool(tool, {
            businessType,
          });
          if (typeof result === "string" && /^imported\b/i.test(result)) {
            void loadPage(1, false);
          }
          return result;
        }
        if (tool.name === "propose_create_contact") {
          const submit = draftSubmitRef.current;
          if (!submit) return "Create form isn't ready yet — try again in a moment.";
          const result = await submit();
          if (result === true) return true;
          if (result === "cancelled") return false;
          return result;
        }
        if (
          tool.name === "propose_update_contact" ||
          tool.name === "propose_set_lead_score" ||
          tool.name === "propose_delete_contact"
        ) {
          const handled = await runContactCoworkerMutation(tool, {
            activeContactId,
          });
          if (handled === true) {
            if (
              tool.name === "propose_update_contact" ||
              tool.name === "propose_set_lead_score"
            ) {
              setDetailRefreshToken((n) => n + 1);
              void loadPage(1, false);
            } else {
              setWorkspace("list");
              void loadPage(1, false);
            }
          }
          return handled;
        }
        if (tool.name === "propose_update_company") {
          const companyId = String(tool.args.companyId || "").trim();
          if (!companyId) return false;
          const detail = await fetchCompany(companyId);
          if (!detail.ok) return false;
          const company = detail.company;
          const patchKeys = [
            "name",
            "domain",
            "industry",
            "linkedinUrl",
          ] as const;
          const patch: Partial<{
            name: string;
            domain: string;
            industry: string;
            linkedinUrl: string;
            employeeCount: number;
          }> = {};
          for (const key of patchKeys) {
            const val = tool.args[key];
            if (typeof val === "string" && val.trim()) {
              patch[key] = val.trim();
            }
          }
          const empRaw = tool.args.employeeCount;
          if (typeof empRaw === "string" && empRaw.trim()) {
            const n = Number(empRaw.replace(/,/g, ""));
            if (Number.isFinite(n)) patch.employeeCount = n;
          } else if (typeof empRaw === "number" && Number.isFinite(empRaw)) {
            patch.employeeCount = empRaw;
          }
          if (Object.keys(patch).length === 0) return false;
          const result = await updateCompany(companyId, {
            name: patch.name ?? company.name,
            domain: patch.domain !== undefined ? patch.domain : company.domain,
            industry:
              patch.industry !== undefined ? patch.industry : company.industry,
            employeeCount:
              patch.employeeCount !== undefined
                ? patch.employeeCount
                : company.employeeCount,
            linkedinUrl:
              patch.linkedinUrl !== undefined
                ? patch.linkedinUrl
                : company.linkedinUrl,
            ownerUserId: company.ownerUserId,
          });
          if (!result.ok) return false;
          setDetailRefreshToken((n) => n + 1);
          return true;
        }
        if (tool.name === "propose_update_company_location") {
          const companyId = String(tool.args.companyId || "").trim();
          if (!companyId) return false;
          const detail = await fetchCompany(companyId);
          if (!detail.ok) return false;
          const company = detail.company;
          let locationId = String(tool.args.locationId || "").trim();
          let location = locationId
            ? company.locations.find((loc) => loc.id === locationId)
            : company.locations[0];
          if (!location && company.locations[0]) {
            location = company.locations[0];
            locationId = location.id;
          }
          const cityArg =
            typeof tool.args.city === "string" ? tool.args.city.trim() : "";
          const addressArg =
            typeof tool.args.address === "string"
              ? tool.args.address.trim()
              : "";
          const nameArg =
            typeof tool.args.name === "string" ? tool.args.name.trim() : "";
          if (!location) {
            const created = await createLocation(companyId, {
              name: nameArg || cityArg || "Headquarters",
              type: "hq",
              city: cityArg || null,
              address: addressArg || null,
            });
            if (!created.ok) {
              return "error" in created ? created.error : false;
            }
            setDetailRefreshToken((n) => n + 1);
            return true;
          }
          const typeRaw =
            typeof tool.args.type === "string"
              ? tool.args.type.trim().toLowerCase()
              : "";
          const locType: "hq" | "branch" =
            typeRaw === "branch"
              ? "branch"
              : location.type === "branch"
                ? "branch"
                : "hq";
          const updated = await updateLocation(companyId, locationId, {
            name: nameArg || location.name,
            type: locType,
            city: cityArg || location.city,
            address: addressArg !== "" ? addressArg : location.address,
          });
          if (!updated.ok) {
            return "error" in updated ? updated.error : false;
          }
          setDetailRefreshToken((n) => n + 1);
          return true;
        }
        return false;
      }}
      onAfterTool={() => void loadPage(1, false)}
    />
  );
}
