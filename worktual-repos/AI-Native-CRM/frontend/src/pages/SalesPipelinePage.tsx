import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Columns3,
  Download,
  GripVertical,
  Plus,
  Search,
  Table2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { ContactQuickActions } from "@/components/contacts/ContactQuickActions";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import type { CoworkerSuggestion } from "@/components/coworker/types";
import {
  DealCreateDraftPanel,
  emptyDealDraft,
} from "@/components/sales/DealCreateDraftPanel";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  type AgentToolProposal,
  type DealDraftFields,
} from "@/services/coworker";
import {
  CONTACT_EXPORT_FORMATS,
  downloadFile,
  type ContactExportFormat,
} from "@/lib/csv";
import {
  DEAL_STAGE_OPTIONS,
  DEAL_STAGE_LABELS,
  DEAL_STAGE_SHORT_LABELS,
  FORECAST_CATEGORY_LABELS,
  forecastCategoryBadgeClass,
  formatMoney,
  formatMoneyFull,
  isTerminalStage,
  nextDealStage,
  normalizeDealStage,
  stageBadgeClass,
  stageHeaderClass,
} from "@/lib/deal-stages";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  SalesPipelineKanbanSkeleton,
  SalesPipelineTableSkeleton,
} from "./SalesPipelinePageSkeleton";
import { ProposalDocumentSkeleton } from "./ProposalDocumentSkeleton";
import {
  CREATE_HIGHLIGHT_ROW_CLASS,
  SUCCESS_FLASH_CLASS,
} from "@/lib/ui-tones";
import {
  createProposal,
  deleteDeal,
  exportDeals,
  fetchDealFormOptions,
  fetchDealsBoard,
  fetchDealsPage,
  updateDealStage,
  type BoardColumn,
  type ClosedWonExtras,
  type PipelineDeal,
} from "@/services/sales";
import {
  readCreateSeedPrompt,
  readCreateUserText,
  stripCreateSeedPrompt,
} from "@/lib/coworker/create-handoff";

const DRAG_TYPE = "application/x-worktual-deal";

type PipelineView = "kanban" | "table";
type SortKey = "updated" | "amount" | "title" | "close" | "owner";

type TablePagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
};

const EMPTY_PAGINATION: TablePagination = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  hasNext: false,
};

type DealContactOption = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  companyId: string | null;
};

type WonBanner = {
  dealId: string;
  dealTitle: string;
  extras: ClosedWonExtras;
};

function ownerDisplayName(label: string | null): string {
  if (!label) return "—";
  const paren = label.indexOf(" (");
  return paren > 0 ? label.slice(0, paren) : label;
}

function formatCloseDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function columnValue(deals: PipelineDeal[]): number {
  return deals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
}

/** One currency label for a set of deal amounts. Mixed currencies are not added together. */
function formatDealTotal(deals: PipelineDeal[]): string | null {
  const priced = deals.filter((deal) => Number(deal.amount));
  if (priced.length === 0) return null;
  const codes = new Set(priced.map((deal) => deal.amountCurrency || ""));
  if (codes.size !== 1) return "Mixed currencies";
  const code = [...codes][0];
  return formatMoney(String(columnValue(priced)), code || null);
}

function sortDeals(deals: PipelineDeal[], sort: SortKey): PipelineDeal[] {
  const next = [...deals];
  next.sort((a, b) => {
    switch (sort) {
      case "amount":
        return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      case "title":
        return a.title.localeCompare(b.title);
      case "close": {
        const at = a.expectedCloseDate
          ? new Date(a.expectedCloseDate).getTime()
          : Number.POSITIVE_INFINITY;
        const bt = b.expectedCloseDate
          ? new Date(b.expectedCloseDate).getTime()
          : Number.POSITIVE_INFINITY;
        return at - bt;
      }
      case "owner":
        return ownerDisplayName(a.ownerName).localeCompare(
          ownerDisplayName(b.ownerName),
        );
      case "updated":
      default:
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }
  });
  return next;
}

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "updated", label: "Sort: Recently updated" },
  { value: "amount", label: "Sort: Amount (high→low)" },
  { value: "title", label: "Sort: Name (A→Z)" },
  { value: "owner", label: "Sort: Owner" },
  { value: "close", label: "Sort: Expected close" },
];

export function SalesPipelinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "list";
  // Board uses layout=; legacy view=table still works when not in create mode.
  const view: PipelineView =
    searchParams.get("layout") === "table" ||
    (workspaceMode === "list" && searchParams.get("view") === "table")
      ? "table"
      : "kanban";
  const highlightId = searchParams.get("highlight");
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [contacts, setContacts] = useState<DealContactOption[]>([]);
  const [wonBanner, setWonBanner] = useState<WonBanner | null>(null);
  const [highlightFlash, setHighlightFlash] = useState<string | null>(null);
  const [createdToast, setCreatedToast] = useState(false);
  const highlightHandled = useRef<string | null>(null);
  const [createDraft, setCreateDraft] = useState<DealDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyDealDraft(),
      readDraftSessionMemory("shell:sales"),
      "dealDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<DealDraftFields>) => void) | null
  >(null);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null);
  const [seedDisplayText, setSeedDisplayText] = useState<string | null>(null);
  const pendingProposalAfterDealRef = useRef(false);
  const seedConsumed = useRef(false);

  useEffect(() => {
    if (seedConsumed.current) return;
    const prompt = readCreateSeedPrompt(searchParams);
    if (!prompt) return;
    seedConsumed.current = true;
    setSeedPrompt(prompt);
    setSeedDisplayText(readCreateUserText(searchParams));
    setSearchParams(stripCreateSeedPrompt(searchParams), { replace: true });
  }, [searchParams, setSearchParams]);

  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [pendingMove, setPendingMove] = useState<{
    dealId: string;
    fromStage: string;
  } | null>(null);

  const [tableItems, setTableItems] = useState<PipelineDeal[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tablePagination, setTablePagination] =
    useState<TablePagination>(EMPTY_PAGINATION);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ContactExportFormat>("csv");
  const [exportError, setExportError] = useState<string | null>(null);
  const [creatingProposal, setCreatingProposal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchDealFormOptions()
      .then((result) => {
        if (!cancelled) setContacts(result.contacts);
      })
      .catch(() => {
        /* quick actions gracefully degrade without contact phone lookup */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDealsBoard();
      setColumns(result.columns);
    } catch {
      setError("Failed to load pipeline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "kanban") void loadBoard();
  }, [loadBoard, view]);

  useEffect(() => {
    if (!highlightId || loading) return;
    if (highlightHandled.current === highlightId) return;
    highlightHandled.current = highlightId;
    setHighlightFlash(highlightId);
    setCreatedToast(true);
    const t = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-deal-id="${CSS.escape(highlightId)}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }, 120);
    const clearFlash = window.setTimeout(() => setHighlightFlash(null), 4200);
    const clearToast = window.setTimeout(() => setCreatedToast(false), 3500);
    const next = new URLSearchParams(searchParams);
    next.delete("highlight");
    setSearchParams(next, { replace: true });
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(clearFlash);
      window.clearTimeout(clearToast);
    };
  }, [highlightId, loading, searchParams, setSearchParams]);

  const loadTablePage = useCallback(async (page: number) => {
    if (page === 1) setTableLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const result = await fetchDealsPage({ page });
      setTableItems((prev) =>
        page === 1
          ? result.items
          : [
              ...prev,
              ...result.items.filter(
                (item) => !prev.some((p) => p.id === item.id),
              ),
            ],
      );
      setTablePagination({
        page: result.pagination.page,
        pageSize: result.pagination.pageSize,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
        hasNext:
          result.pagination.hasNext ??
          result.pagination.page < result.pagination.totalPages,
      });
    } catch {
      setError("Failed to load deals.");
    } finally {
      setTableLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "table") return;
    setTableItems([]);
    setTablePagination(EMPTY_PAGINATION);
    void loadTablePage(1);
  }, [view, loadTablePage]);

  const loadMoreTable = useCallback(() => {
    if (!tablePagination.hasNext || loadingMore) return;
    void loadTablePage(tablePagination.page + 1);
  }, [tablePagination.hasNext, tablePagination.page, loadingMore, loadTablePage]);

  const tableSentinelRef = useInfiniteScroll({
    hasMore: view === "table" && tablePagination.hasNext,
    loading: loadingMore,
    onLoadMore: loadMoreTable,
  });

  const contactById = useMemo(() => {
    const map = new Map<string, DealContactOption>();
    for (const c of contacts) map.set(c.id, c);
    return map;
  }, [contacts]);

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const col of columns) {
      for (const d of col.deals) {
        if (d.ownerUserId && d.ownerName && !seen.has(d.ownerUserId)) {
          seen.set(d.ownerUserId, ownerDisplayName(d.ownerName));
        }
      }
    }
    for (const d of tableItems) {
      if (d.ownerUserId && d.ownerName && !seen.has(d.ownerUserId)) {
        seen.set(d.ownerUserId, ownerDisplayName(d.ownerName));
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [columns, tableItems]);

  const matchesFilters = useCallback(
    (d: PipelineDeal) => {
      const q = query.trim().toLowerCase();
      if (q) {
        const hay = [
          d.title,
          d.companyName,
          d.locationName,
          d.contactName ?? "",
          ownerDisplayName(d.ownerName),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (stageFilter !== "all" && d.stage !== stageFilter) return false;
      if (ownerFilter !== "all" && d.ownerUserId !== ownerFilter) return false;
      return true;
    },
    [query, stageFilter, ownerFilter],
  );

  const filteredColumns = useMemo(() => {
    return columns
      .filter((col) => stageFilter === "all" || col.stage === stageFilter)
      .map((col) => ({
        ...col,
        deals: sortDeals(col.deals.filter(matchesFilters), sortKey),
      }));
  }, [columns, matchesFilters, sortKey, stageFilter]);

  const filteredTableItems = useMemo(
    () => sortDeals(tableItems.filter(matchesFilters), sortKey),
    [tableItems, matchesFilters, sortKey],
  );

  const stats = useMemo(() => {
    const open = columns.filter((c) => !isTerminalStage(c.stage));
    const openDeals = open.flatMap((c) => c.deals);
    const pipeline = openDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const won = columns.find((c) => c.stage === "closed_won");
    return {
      openCount: open.reduce((s, c) => s + c.total, 0),
      pipeline,
      pipelineLabel: formatDealTotal(openDeals),
      wonCount: won?.total ?? 0,
    };
  }, [columns]);

  const exportableCount = Math.max(
    columns.reduce((s, c) => s + c.total, 0),
    tablePagination.total,
  );

  const setView = (next: PipelineView) => {
    const params = new URLSearchParams(searchParams);
    params.delete("view");
    if (next === "table") params.set("layout", "table");
    else params.delete("layout");
    setSearchParams(params, { replace: true });
  };

  const setWorkspace = useCallback(
    (mode: "list" | "create", opts?: { form?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
        if (next.get("view") === "table") next.set("layout", "table");
        next.set("view", "create");
        if (opts?.form) next.set("form", "1");
        else next.delete("form");
      } else {
        next.delete("view");
        next.delete("form");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const createPanelMode =
    searchParams.get("form") === "1" ? "form" : "guided";

  const onDraftPatch = useCallback(
    (patch: Partial<DealDraftFields>) => {
      const next = { ...patch };
      if (typeof next.stage === "string") {
        const resolved = normalizeDealStage(next.stage);
        if (resolved) next.stage = resolved;
        else delete next.stage;
      }
      if (draftPatchRef.current) {
        draftPatchRef.current(next);
      } else {
        setCreateDraft((prev) => ({ ...prev, ...next }));
      }
      if (
        workspaceMode === "list" &&
        (String(patch.title || "").trim() ||
          String(patch.companyName || "").trim() ||
          String(patch.companyId || "").trim())
      ) {
        setWorkspace("create");
      }
    },
    [workspaceMode, setWorkspace],
  );

  const onWorkspaceCommand = useCallback(
    (tool: AgentToolProposal) => {
      if (tool.name !== "set_workspace") return false;
      const mode = String(tool.args.mode || "");
      if (mode === "detail") {
        const entityId =
          typeof tool.args.entityId === "string" ? tool.args.entityId : undefined;
        if (entityId) {
          navigate(`/sales/${entityId}`);
          return true;
        }
      }
      const searchQ =
        typeof tool.args.search === "string" ? tool.args.search : undefined;
      if (mode === "list" && searchQ != null) {
        setQuery(searchQ);
        setWorkspace("list");
        return true;
      }
      if (mode !== "list" && mode !== "create") return false;
      if (mode === "create" && workspaceMode !== "create") {
        setCreateDraft(emptyDealDraft());
        pendingProposalAfterDealRef.current =
          String(tool.args.afterCreate || "") === "proposal";
      }
      setWorkspace(mode);
      return true;
    },
    [navigate, setWorkspace, workspaceMode],
  );

  const removeDealFromState = useCallback((dealId: string) => {
    setTableItems((prev) => prev.filter((d) => d.id !== dealId));
    setTablePagination((prev) => ({
      ...prev,
      total: Math.max(0, prev.total - 1),
    }));
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        deals: col.deals.filter((d) => d.id !== dealId),
        total: col.deals.some((d) => d.id === dealId)
          ? Math.max(0, col.total - 1)
          : col.total,
      })),
    );
  }, []);

  const applyMove = async (
    dealId: string,
    toStage: string,
    reason: string | null,
  ) => {
    let movedTitle = "";
    setColumns((prev) => {
      let moved: PipelineDeal | null = null;
      const without = prev.map((col) => {
        const deal = col.deals.find((d) => d.id === dealId);
        if (deal) {
          moved = { ...deal, stage: toStage };
          movedTitle = deal.title;
        }
        return {
          ...col,
          deals: col.deals.filter((d) => d.id !== dealId),
          total: col.deals.some((d) => d.id === dealId)
            ? Math.max(0, col.total - 1)
            : col.total,
        };
      });
      if (!moved) return prev;
      return without.map((col) =>
        col.stage === toStage
          ? {
              ...col,
              deals: [moved as PipelineDeal, ...col.deals],
              total: col.total + 1,
            }
          : col,
      );
    });

    const result = await updateDealStage(dealId, toStage, reason);
    if (!result.ok) {
      setError(result.error);
      void loadBoard();
      return;
    }
    if (toStage === "closed_won" && result.wonExtras) {
      setWonBanner({ dealId, dealTitle: movedTitle, extras: result.wonExtras });
    }
  };

  const moveStage = (dealId: string, fromStage: string, toStage: string) => {
    if (fromStage === toStage) return;
    if (toStage === "closed_lost") {
      setPendingMove({ dealId, fromStage });
      setLostReason("");
      setLostReasonOpen(true);
      return;
    }
    void applyMove(dealId, toStage, null);
  };

  const onAdvanceStage = (deal: PipelineDeal) => {
    const next = nextDealStage(deal.stage);
    if (!next) return;
    moveStage(deal.id, deal.stage, next);
  };

  const onDragStart = (event: DragEvent, deal: PipelineDeal) => {
    event.dataTransfer.setData(
      DRAG_TYPE,
      JSON.stringify({ dealId: deal.id, fromStage: deal.stage }),
    );
    event.dataTransfer.effectAllowed = "move";
    setDraggingId(deal.id);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDropStage(null);
  };

  const onDragOverColumn = (event: DragEvent, stage: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropStage !== stage) setDropStage(stage);
  };

  const onDragLeaveColumn = (event: DragEvent, stage: string) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    if (dropStage === stage) setDropStage(null);
  };

  const onDropColumn = (event: DragEvent, toStage: string) => {
    event.preventDefault();
    setDropStage(null);
    setDraggingId(null);

    const raw = event.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;

    let payload: { dealId: string; fromStage: string };
    try {
      payload = JSON.parse(raw) as { dealId: string; fromStage: string };
    } catch {
      return;
    }

    if (!payload.dealId) return;
    moveStage(payload.dealId, payload.fromStage, toStage);
  };

  const confirmLostReason = async () => {
    if (!pendingMove || !lostReason.trim()) return;
    await applyMove(pendingMove.dealId, "closed_lost", lostReason.trim());
    setLostReasonOpen(false);
    setPendingMove(null);
    setLostReason("");
  };

  const cancelLostReason = () => {
    setLostReasonOpen(false);
    setPendingMove(null);
    setLostReason("");
  };

  const handleExport = useCallback(
    (format: ContactExportFormat) => {
      if (exporting) return;
      setExportError(null);
      setExporting(true);
      void (async () => {
        try {
          const result = await exportDeals({
            search: query.trim() || undefined,
            stage: stageFilter,
            ownerUserId: ownerFilter,
            format,
          });
          if (!result.ok) {
            setExportError(result.error);
            return;
          }
          downloadFile(result.filename, result.content, result.mimeType);
          setExportOpen(false);
          if (result.truncated) {
            setExportError(
              `Exported first ${result.count.toLocaleString()} matching deals (limit reached).`,
            );
          }
        } catch {
          setExportError("Could not export deals. Try again.");
        } finally {
          setExporting(false);
        }
      })();
    },
    [exporting, ownerFilter, query, stageFilter],
  );

  const chips: CoworkerSuggestion[] = [
    {
      id: "chip-new-deal",
      label: "Create a new deal",
      prompt: "Help me create a new deal",
    },
    {
      id: "chip-new-proposal",
      label: "Create a proposal",
      prompt: "Create a proposal for this customer",
    },
    {
      id: "chip-new-quote",
      label: "Create a quotation",
      prompt: "Help me create a new quotation",
    },
    {
      id: "chip-schedule",
      label: "Schedule a meeting",
      prompt: "Schedule a meeting",
    },
    {
      id: "chip-show-list",
      label: "Show pipeline",
      prompt: "Show list",
    },
    {
      id: "chip-explain-board",
      label: "Explain this board",
      prompt: "Explain what's on my pipeline board right now",
    },
  ];

  const workspace = (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border-default bg-surface px-4 py-4 sm:px-6 sm:py-5">
          {exportError ? (
            <p
              className="mx-auto max-w-[1600px] text-sm text-text-secondary"
              role="status"
            >
              {exportError}
            </p>
          ) : null}

          {error ? (
            <p className="mx-auto max-w-[1600px] text-sm text-text-danger">
              {error}
            </p>
          ) : null}

          {createdToast ? (
            <p
              className={`mx-auto max-w-[1600px] ${SUCCESS_FLASH_CLASS}`}
              role="status"
            >
              Deal created — it’s highlighted on the board.
            </p>
          ) : null}

          {wonBanner ? (
            <div className={`mx-auto mt-4 flex max-w-[1600px] items-start justify-between gap-3 ${SUCCESS_FLASH_CLASS} p-4`}>
              <div className="text-sm text-text-secondary">
                <p className="font-semibold text-text-primary">
                  “{wonBanner.dealTitle}” marked won
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  <li>
                    {wonBanner.extras.contactPromoted
                      ? "Contact promoted to customer"
                      : "No contact to promote"}
                  </li>
                  <li>
                    {wonBanner.extras.contractId
                      ? `Contract ${wonBanner.extras.contractCreated ? "created" : "on file"}`
                      : "No contract created"}
                  </li>
                  <li>
                    {wonBanner.extras.serviceHandoff?.ok
                      ? `Service handoff sent${
                          wonBanner.extras.serviceHandoff.externalId
                            ? ` · ${wonBanner.extras.serviceHandoff.externalId}`
                            : ""
                        }`
                      : wonBanner.extras.serviceHandoff?.skipped
                        ? "Service handoff skipped"
                        : wonBanner.extras.serviceHandoff?.error
                          ? `Service handoff failed: ${wonBanner.extras.serviceHandoff.error}`
                          : "Service handoff pending"}
                  </li>
                </ul>
                <Link
                  to={`/sales/${wonBanner.dealId}`}
                  className="mt-1.5 inline-block text-xs font-medium text-text-link hover:underline"
                >
                  View deal
                </Link>
              </div>
              <button
                type="button"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-text-caption hover:bg-white/60"
                onClick={() => setWonBanner(null)}
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          {view === "kanban" ? (
            <div className="mx-auto mt-5 grid max-w-[1600px] gap-3 sm:grid-cols-3">
              <StatCard
                label="Open deals"
                value={stats.openCount.toLocaleString()}
              />
              <StatCard
                label="Pipeline value"
                value={stats.pipelineLabel ?? "—"}
              />
              <StatCard
                label="Won"
                value={stats.wonCount.toLocaleString()}
                accent
              />
            </div>
          ) : null}

          <div className="mx-auto mt-4 grid max-w-[1600px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              name="pipelineSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                view === "kanban"
                  ? "Search deal, company, contact, owner…"
                  : "Search deals…"
              }
              leftIcon={<Search className="size-4" strokeWidth={1.75} />}
            />
            <Select
              label=""
              name="stageFilter"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              options={[
                { value: "all", label: "All stages" },
                ...DEAL_STAGE_OPTIONS,
              ]}
            />
            <Select
              label=""
              name="ownerFilter"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              options={[
                { value: "all", label: "All owners" },
                ...ownerOptions,
              ]}
            />
            <Select
              label=""
              name="sortKey"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              options={SORT_OPTIONS}
            />
          </div>
        </div>

        <div className="flex min-h-[min(420px,55vh)] flex-1 flex-col overflow-hidden max-lg:min-h-[min(480px,58vh)]">
          {view === "table" ? (
            <div className="mx-auto h-full max-w-[1400px] overflow-auto px-4 py-4 sm:px-6 sm:py-6">
              {tableLoading ? (
                <SalesPipelineTableSkeleton />
              ) : (
                <>
                  <div className="crm-fade-in overflow-hidden rounded-2xl border border-border-default bg-surface shadow-[0_1px_2px_rgba(11,11,16,0.04)]">
                    <div className="scrollbar-hover overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="border-b border-border-default bg-subtle/80 text-text-caption">
                          <tr>
                            <th className="px-5 py-3.5 font-medium">Deal</th>
                            <th className="px-5 py-3.5 font-medium">Account</th>
                            <th className="px-5 py-3.5 font-medium">Owner</th>
                            <th className="px-5 py-3.5 font-medium">
                              Expected close
                            </th>
                            <th className="px-5 py-3.5 font-medium">Stage</th>
                            <th className="px-5 py-3.5 text-right font-medium">
                              Amount
                            </th>
                            <th className="px-5 py-3.5 text-center font-medium">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default/70">
                          {filteredTableItems.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="px-5 py-16 text-center text-text-caption"
                              >
                                No deals match these filters.
                              </td>
                            </tr>
                          ) : (
                            filteredTableItems.map((deal) => {
                              const linked = deal.contactId
                                ? contactById.get(deal.contactId)
                                : null;
                              const isHighlight =
                                highlightFlash === deal.id ||
                                highlightId === deal.id;
                              return (
                                <tr
                                  key={deal.id}
                                  data-deal-id={deal.id}
                                  className={`transition-colors hover:bg-violet-0/40 ${
                                    isHighlight ? CREATE_HIGHLIGHT_ROW_CLASS : ""
                                  }`}
                                >
                                  <td className="px-5 py-4">
                                    <div className="min-w-0">
                                      <Link
                                        to={`/sales/${deal.id}`}
                                        className="font-medium text-text-primary hover:text-brand"
                                      >
                                        {deal.title}
                                      </Link>
                                      {deal.contactName ? (
                                        <p className="mt-0.5 text-xs text-text-caption">
                                          {deal.contactName}
                                        </p>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-5 py-4">
                                    <p className="text-text-secondary">
                                      {deal.companyName}
                                    </p>
                                    <p className="mt-0.5 text-xs text-text-caption">
                                      {deal.locationName}
                                    </p>
                                  </td>
                                  <td className="px-5 py-4 text-text-secondary">
                                    {ownerDisplayName(deal.ownerName)}
                                  </td>
                                  <td className="px-5 py-4 text-text-secondary">
                                    {formatCloseDate(deal.expectedCloseDate)}
                                  </td>
                                  <td className="px-5 py-4">
                                    <span
                                      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${stageBadgeClass(deal.stage)}`}
                                    >
                                      {DEAL_STAGE_SHORT_LABELS[deal.stage] ??
                                        deal.stage}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-right font-medium tabular-nums text-text-primary">
                                    {formatMoneyFull(deal.amount, deal.amountCurrency)}
                                  </td>
                                  <td className="px-5 py-4">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {deal.contactId &&
                                      (linked ||
                                        deal.contactEmail ||
                                        deal.contactName) ? (
                                        <ContactQuickActions
                                          compact
                                          contactId={deal.contactId}
                                          displayName={
                                            linked?.displayName ||
                                            deal.contactName ||
                                            "Contact"
                                          }
                                          email={
                                            linked?.email ||
                                            deal.contactEmail ||
                                            ""
                                          }
                                          phone={linked?.phone ?? null}
                                        />
                                      ) : null}
                                      <ConfirmDeleteButton
                                        compact
                                        name={deal.title}
                                        entityLabel="deal"
                                        consequence="This permanently removes the deal from the pipeline."
                                        onConfirm={async () => {
                                          const result = await deleteDeal(
                                            deal.id,
                                          );
                                          if (!result.ok) return result;
                                          return { ok: true };
                                        }}
                                        onSuccess={() =>
                                          removeDealFromState(deal.id)
                                        }
                                      />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <InfiniteScrollSentinel ref={tableSentinelRef} />
                  {loadingMore ? (
                    <div className="px-4 py-3">
                      <SkeletonText width={96} height={12} />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : loading ? (
            <SalesPipelineKanbanSkeleton />
          ) : (
            <div className="crm-fade-in flex h-full min-h-0 w-full min-w-0 flex-1 flex-nowrap items-stretch gap-3 overflow-x-auto overflow-y-hidden px-4 py-4 sm:px-6 sm:py-5">
              {filteredColumns.map((col) => {
                const isDropTarget = dropStage === col.stage;
                const headerTone = stageHeaderClass(col.stage);
                return (
                  <div
                    key={col.stage}
                    className={`flex h-full min-h-0 w-[280px] min-w-[240px] max-w-[min(280px,calc(100vw-2.5rem))] shrink-0 flex-col rounded-xl border bg-subtle/60 transition-all ${
                      isDropTarget
                        ? "border-brand ring-2 ring-brand/20"
                        : "border-border-default/80"
                    }`}
                    onDragOver={(e) => onDragOverColumn(e, col.stage)}
                    onDragLeave={(e) => onDragLeaveColumn(e, col.stage)}
                    onDrop={(e) => onDropColumn(e, col.stage)}
                  >
                    <div
                      className={`relative overflow-hidden rounded-t-xl px-3.5 py-3 ${headerTone.header}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2
                            className={`text-sm font-semibold tracking-tight ${headerTone.title}`}
                          >
                            {DEAL_STAGE_SHORT_LABELS[col.stage] ?? col.stage}
                          </h2>
                          <p className={`mt-0.5 text-xs ${headerTone.meta}`}>
                            {col.total.toLocaleString()} deal
                            {col.total === 1 ? "" : "s"}
                            {(() => {
                              const totalLabel = formatDealTotal(col.deals);
                              return totalLabel ? ` · ${totalLabel}` : "";
                            })()}
                          </p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${headerTone.badge}`}
                        >
                          {col.deals.length}
                        </span>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2.5">
                      {col.deals.map((deal) => {
                        const next = nextDealStage(deal.stage);
                        const linked = deal.contactId
                          ? contactById.get(deal.contactId)
                          : null;
                        const isHighlight =
                          highlightFlash === deal.id || highlightId === deal.id;
                        return (
                          <article
                            key={deal.id}
                            data-deal-id={deal.id}
                            draggable
                            onDragStart={(e) => onDragStart(e, deal)}
                            onDragEnd={onDragEnd}
                            className={`group rounded-xl border border-border-default/80 bg-surface p-3 shadow-[0_1px_2px_rgba(11,11,16,0.05)] transition-all hover:border-brand/30 hover:shadow-[0_4px_12px_rgba(116,35,215,0.08)] active:cursor-grabbing ${
                              draggingId === deal.id
                                ? "scale-[0.98] opacity-40"
                                : "cursor-grab"
                            } ${isHighlight ? CREATE_HIGHLIGHT_ROW_CLASS : ""}`}
                          >
                            <div className="flex items-start gap-1.5">
                              <GripVertical
                                className="mt-0.5 size-3.5 shrink-0 text-neutral-300 group-hover:text-neutral-500"
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-text-caption">
                                  {deal.companyName}
                                  <span className="text-neutral-300"> · </span>
                                  {deal.locationName}
                                </p>
                                <Link
                                  to={`/sales/${deal.id}`}
                                  className="mt-0.5 line-clamp-2 block text-sm font-semibold leading-snug text-text-primary hover:text-brand"
                                  onClick={(e) => {
                                    if (draggingId) e.preventDefault();
                                  }}
                                  draggable={false}
                                >
                                  {deal.title}
                                </Link>
                                <dl className="mt-2 space-y-1.5 text-xs text-text-secondary">
                                  <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-1.5 gap-y-0.5">
                                    <dt className="text-text-caption">Name:</dt>
                                    <dd className="min-w-0 truncate font-medium text-text-primary">
                                      {deal.contactName || "—"}
                                    </dd>
                                    <dt className="text-text-caption">Owner:</dt>
                                    <dd className="min-w-0 truncate">
                                      {ownerDisplayName(deal.ownerName)}
                                    </dd>
                                    <dt className="text-text-caption">
                                      Expected close:
                                    </dt>
                                    <dd className="min-w-0 truncate">
                                      {formatCloseDate(deal.expectedCloseDate)}
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            </div>

                            {deal.contactId &&
                            (linked || deal.contactEmail || deal.contactName) ? (
                              <div className="mt-2.5 overflow-x-auto">
                                <ContactQuickActions
                                  compact
                                  contactId={deal.contactId}
                                  displayName={
                                    linked?.displayName ||
                                    deal.contactName ||
                                    "Contact"
                                  }
                                  email={
                                    linked?.email || deal.contactEmail || ""
                                  }
                                  phone={linked?.phone ?? null}
                                />
                              </div>
                            ) : null}

                            {deal.forecastCategory || deal.forecastFlagged ? (
                              <div className="mt-2 flex items-center gap-1.5">
                                {deal.forecastCategory ? (
                                  <span
                                    className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${forecastCategoryBadgeClass(deal.forecastCategory)}`}
                                    title={deal.forecastReason ?? undefined}
                                  >
                                    {FORECAST_CATEGORY_LABELS[deal.forecastCategory] ??
                                      deal.forecastCategory}
                                    {deal.forecastConfidencePercent != null
                                      ? ` · ${deal.forecastConfidencePercent}%`
                                      : ""}
                                  </span>
                                ) : null}
                                {deal.forecastFlagged ? (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded-md bg-[#fdecea] px-1.5 py-0.5 text-[10px] font-medium text-text-danger"
                                    title={
                                      deal.forecastReason ??
                                      "Forecast agent flagged this deal's stage/close date as unrealistic"
                                    }
                                  >
                                    <AlertTriangle className="size-3" />
                                    Review forecast
                                  </span>
                                ) : null}
                              </div>
                            ) : null}

                            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border-default/50 pt-2.5">
                              <span className="text-sm font-semibold tabular-nums text-text-primary">
                                {formatMoney(deal.amount, deal.amountCurrency)}
                              </span>
                              {next ? (
                                <button
                                  type="button"
                                  title={`Move to ${DEAL_STAGE_LABELS[next] ?? next}`}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAdvanceStage(deal);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-violet-0 px-2 py-1 text-xs font-medium text-brand opacity-80 transition-opacity hover:opacity-100"
                                >
                                  {DEAL_STAGE_SHORT_LABELS[next] ?? next}
                                  <ArrowRight className="size-3" />
                                </button>
                              ) : (
                                <span
                                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stageBadgeClass(deal.stage)}`}
                                >
                                  {DEAL_STAGE_SHORT_LABELS[deal.stage] ??
                                    deal.stage}
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}

                      {col.deals.length === 0 ? (
                        <div
                          className={`flex flex-1 items-center justify-center rounded-xl border border-dashed px-3 py-10 text-center text-xs ${
                            isDropTarget
                              ? "border-brand bg-violet-0/60 text-brand"
                              : "border-border-default text-text-caption"
                          }`}
                        >
                          {isDropTarget ? "Drop deal here" : "No deals"}
                        </div>
                      ) : null}

                      {col.total > col.deals.length && !query.trim() ? (
                        <Link
                          to="/sales?view=table"
                          className="rounded-lg px-2 py-2 text-center text-xs font-medium text-text-primary hover:bg-subtle"
                        >
                          +{col.total - col.deals.length} more in table
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div className="w-2 shrink-0" aria-hidden />
            </div>
          )}
        </div>
      </div>

      {lostReasonOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-lg">
            <h3 className="text-base font-semibold text-text-primary">
              Mark as lost
            </h3>
            <p className="mt-1 text-sm text-text-caption">
              Add a short reason for the loss.
            </p>
            <Textarea
              className="mt-4"
              label="Lost reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
            />
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                disabled={!lostReason.trim()}
                onClick={() => void confirmLostReason()}
              >
                Confirm lost
              </Button>
              <Button variant="secondary" onClick={cancelLostReason}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
            aria-labelledby="deal-export-title"
            className="w-full max-w-md rounded-xl border border-border-default bg-surface p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="deal-export-title"
              className="text-base font-semibold text-text-primary"
            >
              Export deals
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
                    name="dealExportFormat"
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
                onClick={() => handleExport(exportFormat)}
              >
                <Download className="size-4" strokeWidth={1.75} />
                {exporting ? "Exporting…" : "Download"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  const shellWorkspace = creatingProposal ? (
    <ProposalDocumentSkeleton />
  ) : workspaceMode === "create" ? (
      <DealCreateDraftPanel
        draft={createDraft}
        onDraftChange={setCreateDraft}
        patchRef={draftPatchRef}
        submitRef={draftSubmitRef}
        mode={createPanelMode}
        onCancel={() => {
          pendingProposalAfterDealRef.current = false;
          setWorkspace("list");
        }}
        onCreated={(dealId) => {
          setCreateDraft(emptyDealDraft());
          const next = new URLSearchParams(searchParams);
          next.delete("view");
          next.delete("form");
          next.set("highlight", dealId);
          setSearchParams(next, { replace: true });
          void loadBoard();
          if (pendingProposalAfterDealRef.current) {
            pendingProposalAfterDealRef.current = false;
            setCreatingProposal(true);
            void createProposal({ dealId, fromTemplate: true })
              .then((result) => {
                if (!result.ok) {
                  setCreatingProposal(false);
                  return;
                }
                navigate(`/sales/proposals/${result.id}`);
              })
              .catch(() => {
                setCreatingProposal(false);
              });
          }
        }}
      />
    ) : (
      workspace
    );

  return (
    <AgentModuleShell
      moduleId="sales"
      title="Pipeline"
      welcome="I'm your **Worktual co-worker**. I can create a deal, proposal, or quotation, schedule a meeting, open a deal from the board, move stages, or update details. The pipeline stays on the right."
      chips={chips}
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      draft={workspaceMode === "create" ? createDraft : null}
      workspace={shellWorkspace}
      workspaceTitle="Pipeline"
      workspaceSubtitle={
        workspaceMode === "list"
          ? view === "kanban"
            ? MODULE_WORKSPACE_DESCRIPTION.pipelineKanban
            : MODULE_WORKSPACE_DESCRIPTION.pipelineList
          : undefined
      }
      workspaceHeaderActions={
        workspaceMode === "list" ? (
          <>
            <div className="inline-flex rounded-xl border border-border-default bg-subtle p-1">
              <button
                type="button"
                onClick={() => setView("kanban")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  view === "kanban"
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-caption hover:text-text-primary"
                }`}
              >
                <Columns3 className="size-4" />
                Kanban
              </button>
              <button
                type="button"
                onClick={() => setView("table")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  view === "table"
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-caption hover:text-text-primary"
                }`}
              >
                <Table2 className="size-4" />
                Table
              </button>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setExportError(null);
                setExportOpen(true);
              }}
              disabled={exporting || exportableCount === 0}
              title={
                exportableCount === 0
                  ? "No deals to export"
                  : "Export filtered deals"
              }
            >
              <Download className="size-4" strokeWidth={1.75} />
              {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button
              variant="primary"
              onClick={() => setWorkspace("create", { form: true })}
            >
              <Plus className="size-4" />
              New deal
            </Button>
          </>
        ) : undefined
      }
      collapseChatToFab
      seedPrompt={seedPrompt}
      seedDisplayText={seedDisplayText}
      onSeedPromptConsumed={() => {
        setSeedPrompt(null);
        setSeedDisplayText(null);
      }}
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) => onDraftPatch(patch as Partial<DealDraftFields>)}
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_create_deal") {
          const submit = draftSubmitRef.current;
          if (!submit) return "Create form isn't ready yet — try again in a moment.";
          const result = await submit();
          if (result === true) return true;
          if (result === "cancelled") return false;
          return result;
        }
        if (tool.name === "propose_create_proposal") {
          // Handled by AgentModuleShell so attached requirement PDFs are used.
          return false;
        }
        return false;
      }}
      onAfterTool={() => void loadBoard()}
    />
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        accent
          ? "border-violet-100 bg-violet-0/70"
          : "border-border-default/80 bg-subtle/50"
      }`}
    >
      <p className="text-xs font-medium text-text-caption">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-text-primary tabular-nums">
        {value}
      </p>
    </div>
  );
}
