import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import {
  CompanyCreateDraftPanel,
  emptyCompanyDraft,
  saveCompanyDraft,
} from "@/components/companies/CompanyCreateDraftPanel";
import { CompanyLogo } from "@/components/companies/CompanyLogo";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { createListCache } from "@/lib/list-cache";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import {
  EXPANSION_SIGNAL_LABELS,
  expansionSignalPillClass,
} from "@/lib/company-labels";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import {
  clearDraftSessionMemory,
  hydrateDraftFromMemory,
  readDraftSessionMemory,
  readDraftSessionMemoryRaw,
  writeDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  type AgentToolProposal,
  type CompanyDraftFields,
} from "@/services/coworker";
import {
  deleteCompany,
  COMPANY_LIST_PAGE_SIZE,
  fetchCompaniesPage,
  fetchCompany,
  updateCompany,
  type CompanyListItem,
} from "@/services/companies";
import { CompaniesPageSkeleton } from "./CompaniesPageSkeleton";
import {
  CREATE_HIGHLIGHT_ROW_CLASS,
  SUCCESS_FLASH_CLASS,
} from "@/lib/ui-tones";

const SEARCH_DEBOUNCE_MS = 300;

const PENDING_COMPANY_SCOPES = ["company-create", "shell:company"] as const;

let pendingCompanySave: Promise<string | null> | null = null;

function companyToListItem(company: {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  locations?: Array<unknown>;
}): CompanyListItem {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    industry: company.industry,
    employeeCount: company.employeeCount,
    locationCount: company.locations?.length ?? 1,
    logoUrl: null,
    createdAt: new Date().toISOString(),
    expansionSignal: null,
  };
}

/** A ready company left in this tab (name + location) still needs a row. */
function finishPendingCompanyOnce(): Promise<string | null> {
  if (pendingCompanySave) return pendingCompanySave;
  pendingCompanySave = (async () => {
    let chosen: { scope: string; raw: string; draft: CompanyDraftFields } | null =
      null;
    for (const scope of PENDING_COMPANY_SCOPES) {
      const mem = readDraftSessionMemory(scope);
      if (mem.pendingIntent !== "create_company") continue;
      const draft = hydrateDraftFromMemory(
        emptyCompanyDraft(),
        mem,
        "companyDraft",
      );
      const raw = readDraftSessionMemoryRaw(scope);
      if (!raw || !draft.name.trim() || !draft.locationName.trim()) continue;
      chosen = { scope, raw, draft };
      break;
    }
    if (!chosen) return null;
    clearDraftSessionMemory(chosen.scope);
    const result = await saveCompanyDraft(chosen.draft);
    if (!result.ok) {
      if (!result.existingId) writeDraftSessionMemory(chosen.scope, chosen.raw);
      return result.existingId ?? null;
    }
    clearDraftSessionMemory("company-create");
    clearDraftSessionMemory("shell:company");
    return result.id;
  })();
  return pendingCompanySave;
}

function formatEmployeeCount(count: number | null | undefined): string | null {
  if (count == null || count <= 0) return null;
  return `${new Intl.NumberFormat().format(count)} ${
    count === 1 ? "employee" : "employees"
  }`;
}

type CompanyListSnapshot = {
  items: CompanyListItem[];
  page: number;
  hasNext: boolean;
};

const companyListCache = createListCache<CompanyListSnapshot>();

export function CompaniesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "list";
  const [query, setQuery] = useState(search);
  const listKey = search;
  const listKeyRef = useRef(listKey);
  const seeded = useRef(companyListCache.read(listKey)).current;

  const [items, setItems] = useState<CompanyListItem[]>(seeded?.items ?? []);
  const [page, setPage] = useState(seeded?.page ?? 1);
  const [hasNext, setHasNext] = useState(seeded?.hasNext ?? false);
  const [loading, setLoading] = useState(!seeded);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const [createDraft, setCreateDraft] = useState<CompanyDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyCompanyDraft(),
      readDraftSessionMemory("shell:company"),
      "companyDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<CompanyDraftFields>) => void) | null
  >(null);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);
  const pendingDuplicateIdRef = useRef<string | null>(null);
  const createDraftRef = useRef(createDraft);
  createDraftRef.current = createDraft;

  const { createdToast, isHighlighted } = useCreateHighlight();

  const setWorkspace = useCallback(
    (mode: "list" | "create", opts?: { form?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
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
    (patch: Partial<CompanyDraftFields>) => {
      if (draftPatchRef.current) {
        draftPatchRef.current(patch);
      } else {
        setCreateDraft((prev) => {
          const next = { ...prev, ...patch };
          createDraftRef.current = next;
          return next;
        });
      }
      if (
        workspaceMode === "list" &&
        typeof patch.name === "string" &&
        patch.name.trim()
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
          navigate(`/company/${entityId}`);
          return true;
        }
      }
      const searchQ =
        typeof tool.args.search === "string" ? tool.args.search : undefined;
      if (mode === "list" && searchQ != null) {
        const next = new URLSearchParams(searchParams);
        if (searchQ.trim()) next.set("q", searchQ.trim());
        else next.delete("q");
        setSearchParams(next, { replace: true });
        return true;
      }
      if (mode !== "list" && mode !== "create") return false;
      setWorkspace(mode);
      return true;
    },
    [navigate, searchParams, setSearchParams, setWorkspace],
  );

  useEffect(() => {
    setQuery(search);
  }, [search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const trimmed = query.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, searchParams, setSearchParams]);

  const loadPage = useCallback(
    async (pageNum: number, append: boolean, pinId?: string) => {
      const id = ++requestId.current;
      // Rows already held for this search are shown straight away and
      // refreshed behind the user, so returning never falls back to the
      // skeleton.
      const known = append ? undefined : companyListCache.read(listKeyRef.current);
      if (known) {
        setItems(known.items);
        setPage(known.page);
        setHasNext(known.hasNext);
      }
      if (append) setLoadingMore(true);
      else if (!known) setLoading(true);
      setError(null);
      try {
        const result = await fetchCompaniesPage({
          page: pageNum,
          pageSize: COMPANY_LIST_PAGE_SIZE,
          search: search || undefined,
        });
        if (id !== requestId.current) return;
        let pinned: CompanyListItem | null = null;
        if (pinId && !result.items.some((item) => item.id === pinId)) {
          const detail = await fetchCompany(pinId);
          if (detail.ok) pinned = companyToListItem(detail.company);
        }
        if (id !== requestId.current) return;
        setItems((prev) => {
          const next = !append
            ? result.items
            : [
                ...prev,
                ...result.items.filter((item) => !prev.some((row) => row.id === item.id)),
              ];
          if (pinned && !next.some((item) => item.id === pinned.id)) {
            return [pinned, ...next];
          }
          return next;
        });
        setPage(pageNum);
        setHasNext(
          result.pagination.hasNext ?? pageNum < result.pagination.totalPages,
        );
      } catch {
        if (id === requestId.current) setError("Failed to load companies.");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [search],
  );

  useEffect(() => {
    listKeyRef.current = listKey;
    void loadPage(1, false);
  }, [loadPage, listKey]);

  // Keep the cache level with what is on screen, appended pages included.
  useEffect(() => {
    if (loading || loadingMore || error) return;
    companyListCache.write(listKeyRef.current, { items, page, hasNext });
  }, [items, page, hasNext, loading, loadingMore, error]);

  const revealCreatedCompany = useCallback(
    (companyId: string, draftName?: string) => {
      const name = (draftName ?? createDraftRef.current.name).trim().toLowerCase();
      const pending = hydrateDraftFromMemory(
        emptyCompanyDraft(),
        readDraftSessionMemory("company-create"),
        "companyDraft",
      );
      if (
        !pending.name.trim() ||
        pending.name.trim().toLowerCase() === name
      ) {
        clearDraftSessionMemory("company-create");
      }
      clearDraftSessionMemory("shell:company");
      const blank = emptyCompanyDraft();
      createDraftRef.current = blank;
      setCreateDraft(blank);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("view");
          next.delete("form");
          next.set("highlight", companyId);
          return next;
        },
        { replace: true },
      );
      void loadPage(1, false, companyId);
    },
    [loadPage, setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    void finishPendingCompanyOnce().then((companyId) => {
      if (cancelled || !companyId) return;
      revealCreatedCompany(companyId);
    });
    return () => {
      cancelled = true;
    };
  }, [revealCreatedCompany]);

  const onLoadMore = useCallback(() => {
    if (!hasNext || loading || loadingMore) return;
    void loadPage(page + 1, true);
  }, [hasNext, loading, loadingMore, loadPage, page]);

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNext,
    loading: loading || loadingMore,
    onLoadMore,
  });

  const showEmpty = !loading && items.length === 0;

  const listWorkspace = (
    <div className="crm-fade-in mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full min-w-[180px] sm:ml-auto sm:w-[240px]">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies…"
            leftIcon={<Search className="size-3.5" strokeWidth={1.75} />}
            className="h-9 text-sm"
            aria-label="Search companies"
          />
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-text-danger" role="status">
          {error}
        </p>
      ) : null}

      {createdToast ? (
        <p
          className={`mt-4 ${SUCCESS_FLASH_CLASS}`}
          role="status"
        >
          Company created — it's highlighted below.
        </p>
      ) : null}

      {showEmpty ? (
        <div className="mt-8 rounded-xl border border-dashed border-border-default bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text-primary">
            {search ? "No companies found" : "No companies yet"}
          </p>
          <p className="mt-1 text-sm text-text-caption">
            {search
              ? "Try a different search term."
              : "Add an account to start tracking locations and deals."}
          </p>
          {!search ? (
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => setWorkspace("create", { form: true })}
            >
              Add company
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((company) => (
              <Link
                key={company.id}
                data-highlight-id={company.id}
                to={`/company/${company.id}`}
                state={{
                  companyName: company.name,
                  locationCount: company.locationCount,
                }}
                className={`rounded-xl border border-border-default bg-surface p-5 transition-colors hover:border-brand/40 hover:bg-violet-0/40 ${
                  isHighlighted(company.id) ? CREATE_HIGHLIGHT_ROW_CLASS : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <CompanyLogo
                    name={company.name}
                    logoUrl={company.logoUrl}
                    domain={company.domain}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-text-primary">
                        {company.name}
                      </h2>
                      {company.expansionSignal &&
                      company.expansionSignal !== "none" ? (
                        <span
                          className={expansionSignalPillClass(
                            company.expansionSignal,
                          )}
                          title="Expansion & Revenue Matcher Agent's upsell/cross-sell signal"
                        >
                          {EXPANSION_SIGNAL_LABELS[company.expansionSignal] ??
                            company.expansionSignal}
                        </span>
                      ) : null}
                    </div>
                    {company.industry ? (
                      <p className="mt-0.5 truncate text-sm text-text-secondary">
                        {company.industry}
                      </p>
                    ) : null}
                    {company.domain ? (
                      <p className="mt-0.5 truncate text-xs text-text-caption">
                        {company.domain}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-text-caption">
                      Created{" "}
                      {new Date(company.createdAt).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </p>
                    <p className="mt-2 text-sm text-text-secondary">
                      {[
                        formatEmployeeCount(company.employeeCount),
                        `${company.locationCount} ${
                          company.locationCount === 1 ? "location" : "locations"
                        }`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
            {loadingMore
              ? Array.from({ length: 3 }).map((_, index) => (
                  <SkeletonCard key={`company-more-${index}`} className="p-5">
                    <div className="flex items-start gap-3">
                      <Skeleton height={44} width={44} borderRadius={12} />
                      <div className="min-w-0 flex-1 space-y-2">
                        <SkeletonText width={`${72 - index * 6}%`} height={20} />
                        <SkeletonText width={92} height={12} />
                        <SkeletonText width={120} />
                      </div>
                    </div>
                  </SkeletonCard>
                ))
              : null}
          </div>
          <InfiniteScrollSentinel ref={sentinelRef} />
          {loadingMore ? (
            <p className="sr-only" role="status">
              Loading more companies
            </p>
          ) : null}
        </>
      )}
    </div>
  );

  const shellWorkspace =
    workspaceMode === "create" ? (
      <CompanyCreateDraftPanel
        draft={createDraft}
        onDraftChange={(next) => {
          createDraftRef.current = next;
          setCreateDraft(next);
        }}
        patchRef={draftPatchRef}
        submitRef={draftSubmitRef}
        onDuplicate={(existingId) => {
          pendingDuplicateIdRef.current = existingId;
        }}
        mode={createPanelMode}
        onCancel={() => setWorkspace("list")}
        onCreated={(companyId) => {
          revealCreatedCompany(companyId);
        }}
      />
    ) : (
      listWorkspace
    );

  return (
    <AgentModuleShell
      moduleId="company"
      title="Companies"
      welcome="I'm with you on companies — we can add an account together, or dig through the list on the right."
      chips={[
        {
          id: "chip-new-company",
          label: "Create a new company",
          prompt: "Help me create a new company",
        },
        {
          id: "chip-show-list",
          label: "Show companies",
          prompt: "Show list",
        },
      ]}
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      draft={workspaceMode === "create" ? createDraft : null}
      workspaceTitle="Companies"
      workspaceSubtitle={
        workspaceMode === "list"
          ? MODULE_WORKSPACE_DESCRIPTION.companies
          : undefined
      }
      workspaceHeaderActions={
        workspaceMode === "list" ? (
          <Button
            variant="primary"
            onClick={() => setWorkspace("create", { form: true })}
          >
            <Plus className="size-4" strokeWidth={2} />
            Add company
          </Button>
        ) : undefined
      }
      workspace={
        loading && items.length === 0 && workspaceMode === "list" ? (
          <CompaniesPageSkeleton />
        ) : (
          shellWorkspace
        )
      }
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) =>
        onDraftPatch(patch as Partial<CompanyDraftFields>)
      }
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_create_company") {
          let submit = draftSubmitRef.current;
          if (!submit) {
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
            submit = draftSubmitRef.current;
          }
          pendingDuplicateIdRef.current = null;
          if (!submit) {
            const saved = await saveCompanyDraft(createDraftRef.current);
            if (saved.ok) {
              revealCreatedCompany(saved.id, createDraftRef.current.name);
              return true;
            }
            if (saved.existingId) {
              const name = createDraftRef.current.name.trim() || "That company";
              navigate(`/company/${saved.existingId}`);
              return `**${name}** already exists — I've opened that record instead of creating a duplicate.`;
            }
            return saved.error || "Couldn't create company.";
          }
          const result = await submit();
          if (result === true) return true;
          const existingId = pendingDuplicateIdRef.current;
          pendingDuplicateIdRef.current = null;
          if (existingId) {
            const name = createDraftRef.current.name.trim() || "That company";
            navigate(`/company/${existingId}`);
            return `**${name}** already exists — I've opened that record instead of creating a duplicate.`;
          }
          return result;
        }
        // Field updates/deletes proposed while still on the list (before any
        // detail navigation) — mirrors CompanyDetailPage so the mutation isn't
        // dropped by a race with the detail-view navigate.
        if (tool.name === "propose_update_company") {
          const companyId = String(tool.args.companyId || "");
          if (!companyId) return false;
          const detail = await fetchCompany(companyId);
          if (!detail.ok) return false;
          const company = detail.company;
          const patchKeys = [
            "name",
            "domain",
            "industry",
            "linkedinUrl",
            "ownerUserId",
            "channelRole",
            "parentCompanyId",
          ] as const;
          const patch: Record<string, string> = {};
          for (const key of patchKeys) {
            const val = tool.args[key];
            if (typeof val === "string" && val.trim()) {
              patch[key] = val.trim();
            }
          }
          let employeeCount = company.employeeCount;
          if (
            typeof tool.args.employeeCount === "string" &&
            tool.args.employeeCount.trim()
          ) {
            const n = Number(tool.args.employeeCount);
            if (Number.isFinite(n)) employeeCount = n;
          }
          if (Object.keys(patch).length === 0 && employeeCount === company.employeeCount) {
            return false;
          }
          const result = await updateCompany(companyId, {
            name: patch.name ?? company.name,
            domain: patch.domain !== undefined ? patch.domain : company.domain,
            industry:
              patch.industry !== undefined ? patch.industry : company.industry,
            employeeCount,
            linkedinUrl:
              patch.linkedinUrl !== undefined
                ? patch.linkedinUrl
                : company.linkedinUrl,
            ownerUserId:
              patch.ownerUserId !== undefined
                ? patch.ownerUserId
                : company.ownerUserId,
            channelRole:
              patch.channelRole !== undefined
                ? patch.channelRole
                : company.channelRole,
            parentCompanyId:
              patch.parentCompanyId !== undefined
                ? patch.parentCompanyId
                : company.parentCompanyId,
          });
          if (!result.ok) return false;
          return true;
        }
        if (tool.name === "propose_delete_company") {
          const companyId = String(tool.args.companyId || "");
          if (!companyId) return false;
          const result = await deleteCompany(companyId);
          if (!result.ok) return false;
          return true;
        }
        return false;
      }}
      onAfterTool={() => void loadPage(1, false)}
    />
  );
}
