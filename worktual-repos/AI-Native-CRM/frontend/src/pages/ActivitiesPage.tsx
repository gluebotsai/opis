import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ActivityLogDraftPanel,
  emptyActivityDraft,
} from "@/components/activities/ActivityLogDraftPanel";
import {
  type AgentToolProposal,
  type ActivityDraftFields,
  mergeSessionMemoryPatch,
} from "@/services/coworker";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
  writeDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ListTodo,
  Plus,
  Search,
} from "lucide-react";
import {
  ActivityTypeBadge,
  ActivityTypeIcon,
  ACTIVITY_TYPE_OPTIONS,
  activityFeedStatusTone,
} from "@/lib/activity-type-style";
import {
  deriveTaskDisplayStatus,
  TASK_DISPLAY_STATUS_LABELS,
  type TaskStatus,
} from "@/lib/task-status";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { contactActivityHref, hrefForActivity } from "@/lib/activity-href";
import { DispositionTag } from "@/components/contacts/DispositionTag";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  completeActivityTask,
  fetchActivitiesPage,
  fetchActivityStats,
  type ActivityFeedItem,
  type ActivityFeedStatus,
  type ActivityStats,
} from "@/services/activities";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { ActivitiesPageSkeleton } from "./ActivitiesPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import {
  CHIP_BASE,
  CREATE_HIGHLIGHT_ROW_CLASS,
  SUCCESS_FLASH_CLASS,
  TONE_ACCENT,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";
import {
  readCreateSeedPrompt,
  readCreateUserText,
  readHandoffDealId,
  stripCreateSeedPrompt,
} from "@/lib/coworker/create-handoff";

const SEARCH_DEBOUNCE_MS = 300;

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All types" },
  ...ACTIVITY_TYPE_OPTIONS.filter((o) => o.value !== "note"),
];

const STATUS_TABS: Array<{ id: ActivityFeedStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "logged", label: "Logged" },
];

const STATUS_TAB_IDS = new Set(STATUS_TABS.map((t) => t.id));

function parseStatusParam(raw: string | null): ActivityFeedStatus | "all" {
  if (raw && STATUS_TAB_IDS.has(raw as ActivityFeedStatus | "all")) {
    return raw as ActivityFeedStatus | "all";
  }
  return "all";
}

const OWNER_OPTIONS = [
  { value: "mine", label: "My activities" },
  { value: "all", label: "Team (all)" },
];

function statusBadge(status: ActivityFeedStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "upcoming":
      return { label: "Upcoming", className: activityFeedStatusTone("upcoming") };
    case "overdue":
      return { label: "Overdue", className: activityFeedStatusTone("overdue") };
    case "logged":
      return { label: "Logged", className: activityFeedStatusTone("logged") };
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) {
    return `Today · ${d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  if (dayKey(iso) === dayKey(yesterday.toISOString())) {
    return `Yesterday · ${d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function groupByDay(items: ActivityFeedItem[]) {
  const groups: Array<{ key: string; label: string; items: ActivityFeedItem[] }> =
    [];
  const index = new Map<string, number>();
  for (const item of items) {
    const anchor = item.dueAt ?? item.createdAt;
    const key = dayKey(anchor);
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, groups.length);
      groups.push({ key, label: dayLabel(anchor), items: [item] });
    } else {
      groups[existing]!.items.push(item);
    }
  }
  return groups;
}

export function ActivitiesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "list";
  const initialSearch = searchParams.get("q") ?? "";
  /** URL is source of truth for filters so tabs stay in sync and clicks always stick. */
  const type = searchParams.get("type") ?? "all";
  const status = parseStatusParam(searchParams.get("status"));
  const ownerScope: "mine" | "all" =
    searchParams.get("owner") === "all" ? "all" : "mine";

  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [stats, setStats] = useState<ActivityStats>({
    total: 0,
    upcoming: 0,
    overdue: 0,
    logged: 0,
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [canViewAll, setCanViewAll] = useState(false);
  const [query, setQuery] = useState(initialSearch);
  const [appliedQuery, setAppliedQuery] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const hasLoadedOnce = useRef(false);
  const [createDraft, setCreateDraft] = useState<ActivityDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyActivityDraft(),
      readDraftSessionMemory("shell:activities"),
      "activityDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<ActivityDraftFields>) => void) | null
  >(null);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null);
  const [seedDisplayText, setSeedDisplayText] = useState<string | null>(null);
  const seedConsumed = useRef(false);

  useEffect(() => {
    const handoffDealId = readHandoffDealId(searchParams);
    if (handoffDealId) {
      const prev = readDraftSessionMemory("shell:activities");
      const merged = mergeSessionMemoryPatch(prev, {
        lastEntities: { dealId: handoffDealId },
      });
      writeDraftSessionMemory("shell:activities", JSON.stringify(merged));
    }
    if (seedConsumed.current) return;
    const prompt = readCreateSeedPrompt(searchParams);
    if (!prompt && !handoffDealId) return;
    if (prompt) {
      seedConsumed.current = true;
      setSeedPrompt(prompt);
      setSeedDisplayText(readCreateUserText(searchParams));
    }
    if (prompt || handoffDealId) {
      const next = stripCreateSeedPrompt(searchParams);
      next.set("view", "create");
      next.delete("form");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { createdToast, isHighlighted } = useCreateHighlight();

  const patchListParams = useCallback(
    (patch: {
      type?: string;
      status?: ActivityFeedStatus | "all";
      owner?: "mine" | "all";
      q?: string | null;
    }) => {
      const next = new URLSearchParams(searchParams);
      if (patch.type !== undefined) {
        if (patch.type !== "all") next.set("type", patch.type);
        else next.delete("type");
      }
      if (patch.status !== undefined) {
        if (patch.status !== "all") next.set("status", patch.status);
        else next.delete("status");
      }
      if (patch.owner !== undefined) {
        if (patch.owner === "all") next.set("owner", "all");
        else next.delete("owner");
      }
      if (patch.q !== undefined) {
        const q = patch.q?.trim() ?? "";
        if (q) next.set("q", q);
        else next.delete("q");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

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
    (patch: Partial<ActivityDraftFields>) => {
      setCreateDraft((prev) => ({ ...prev, ...patch }));
      if (
        workspaceMode === "list" &&
        typeof patch.contactId === "string" &&
        patch.contactId.trim()
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
      if (mode !== "list" && mode !== "create") return false;
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
        if (workspaceMode !== "create") {
          setCreateDraft(emptyActivityDraft());
        }
        next.set("view", "create");
        next.delete("form");
      } else {
        next.delete("view");
        next.delete("form");
        const search = tool.args.search;
        if (typeof search === "string" && search.trim()) {
          setQuery(search.trim());
          next.set("q", search.trim());
        }
        const entityId = tool.args.entityId;
        if (typeof entityId === "string" && entityId.trim()) {
          next.set("highlight", entityId.trim());
        }
      }
      setSearchParams(next, { replace: true });
      return true;
    },
    [searchParams, setSearchParams, workspaceMode],
  );

  useEffect(() => {
    const t = window.setTimeout(
      () => setAppliedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const q = appliedQuery.trim();
    if (q) next.set("q", q);
    else next.delete("q");
    const prevQ = searchParams.get("q") ?? "";
    if (prevQ === q) return;
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only mirror search text
  }, [appliedQuery, setSearchParams]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [pageResult, statsResult] = await Promise.all([
        fetchActivitiesPage({
          page: 1,
          search: appliedQuery,
          type,
          status,
          ownerScope,
        }),
        fetchActivityStats(ownerScope),
      ]);
      if (id !== requestId.current) return;
      setItems(pageResult.items);
      setPage(pageResult.pagination.page);
      setTotal(pageResult.pagination.total);
      setHasNext(pageResult.pagination.hasNext);
      setCanViewAll(pageResult.canViewAll);
      setStats({
        total: statsResult.total,
        upcoming: statsResult.upcoming,
        overdue: statsResult.overdue,
        logged: statsResult.logged,
      });
      if (!pageResult.canViewAll && ownerScope === "all") {
        const next = new URLSearchParams(searchParams);
        next.delete("owner");
        setSearchParams(next, { replace: true });
      }
      hasLoadedOnce.current = true;
    } catch {
      if (id === requestId.current) setError("Failed to load activities.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [
    appliedQuery,
    type,
    status,
    ownerScope,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!hasNext || loading || loadingMore) return;
    const nextPage = page + 1;
    const id = ++requestId.current;
    setLoadingMore(true);
    try {
      const result = await fetchActivitiesPage({
        page: nextPage,
        search: appliedQuery,
        type,
        status,
        ownerScope,
      });
      if (id !== requestId.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...result.items.filter((i) => !seen.has(i.id))];
      });
      setPage(result.pagination.page);
      setTotal(result.pagination.total);
      setHasNext(result.pagination.hasNext);
    } finally {
      if (id === requestId.current) setLoadingMore(false);
    }
  }, [
    hasNext,
    loading,
    loadingMore,
    page,
    appliedQuery,
    type,
    status,
    ownerScope,
  ]);

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNext,
    loading: loading || loadingMore,
    onLoadMore: () => void loadMore(),
  });

  const groups = useMemo(() => groupByDay(items), [items]);

  const onCompleteTask = async (activity: ActivityFeedItem) => {
    if (activity.type !== "task" || activity.taskStatus === "completed") return;
    setCompletingId(activity.id);
    const result = await completeActivityTask(activity.id);
    setCompletingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItems((prev) =>
      prev.map((row) =>
        row.id === activity.id
          ? { ...row, taskStatus: "completed", status: "logged" }
          : row,
      ),
    );
    const nextStats = await fetchActivityStats(ownerScope);
    setStats({
      total: nextStats.total,
      upcoming: nextStats.upcoming,
      overdue: nextStats.overdue,
      logged: nextStats.logged,
    });
  };

  const listWorkspace = (
    <div className="crm-fade-in mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {error ? (
        <p className="mt-4 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {createdToast ? (
        <p
          className={`mt-4 ${SUCCESS_FLASH_CLASS}`}
          role="status"
        >
          Activity logged — it's highlighted below.
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total activities"
          value={stats.total}
          icon={ListTodo}
          tone="brand"
        />
        <KpiCard
          label="Upcoming"
          value={stats.upcoming}
          icon={Clock}
          tone="blue"
        />
        <KpiCard
          label="Overdue"
          value={stats.overdue}
          icon={AlertCircle}
          tone="red"
        />
        <KpiCard
          label="Logged"
          value={stats.logged}
          icon={CheckCircle2}
          tone="green"
        />
      </div>

      <div className="mt-6 space-y-3 rounded-xl border border-border-default bg-surface p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Activity status">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => patchListParams({ status: tab.id })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "bg-subtle text-text-secondary hover:bg-neutral-200 hover:text-text-primary"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          className={`grid gap-3 ${
            canViewAll
              ? "sm:grid-cols-[1fr_160px_180px]"
              : "sm:grid-cols-[1fr_180px]"
          }`}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subject or details…"
            leftIcon={<Search className="size-4" strokeWidth={1.75} />}
            aria-label="Search activities"
          />
          <Select
            value={type}
            onChange={(e) => patchListParams({ type: e.target.value })}
            options={TYPE_FILTER_OPTIONS}
            aria-label="Filter by type"
          />
          {canViewAll ? (
            <Select
              value={ownerScope}
              onChange={(e) =>
                patchListParams({
                  owner: e.target.value === "all" ? "all" : "mine",
                })
              }
              options={OWNER_OPTIONS}
              aria-label="Owner scope"
            />
          ) : null}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        {items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium text-text-primary">
              No activities found
            </p>
            <p className="mt-2 text-sm text-text-caption">
              Log an activity on a contact, or clear filters to see more.
            </p>
            <Link to="/contact" className="mt-4 inline-block">
              <Button variant="secondary">Open contacts</Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-default bg-subtle text-text-caption">
                <tr>
                  <th className="px-4 py-3 font-medium">Activity</th>
                  <th className="px-4 py-3 font-medium">Related to</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    onCompleteTask={onCompleteTask}
                    completingId={completingId}
                    isHighlighted={isHighlighted}
                    onOpenActivity={(activity) => {
                      const contactId = activity.contactId?.trim();
                      if (contactId) {
                        navigate(
                          contactActivityHref(contactId, activity.id, activity.type),
                        );
                        return;
                      }
                      const href = hrefForActivity(activity);
                      if (href) navigate(href);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {items.length > 0 ? (
        <>
          <InfiniteScrollSentinel ref={sentinelRef} />
          {loadingMore ? (
            <div className="mt-2 flex justify-center">
              <SkeletonText width={96} height={12} />
            </div>
          ) : null}
          {!hasNext ? (
            <p className="mt-2 text-center text-xs text-text-caption">
              Showing {items.length} of {total}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const workspace =
    workspaceMode === "create" ? (
      <ActivityLogDraftPanel
        draft={createDraft}
        onDraftChange={setCreateDraft}
        patchRef={draftPatchRef}
        submitRef={draftSubmitRef}
        mode={createPanelMode}
        onCancel={() => setWorkspace("list")}
        onCreated={(activityId) => {
          setCreateDraft(emptyActivityDraft());
          const next = new URLSearchParams(searchParams);
          next.delete("view");
          next.delete("form");
          next.set("highlight", activityId);
          setSearchParams(next, { replace: true });
          void reload();
        }}
      />
    ) : (
      listWorkspace
    );

  return (
    <AgentModuleShell
      moduleId="activities"
      title="Activities"
      welcome="I'm with you on activities — we can log a call or note together, or scan what's overdue on the right."
      chips={[
        {
          id: "chip-log-activity",
          label: "Log an activity",
          prompt: "Help me log a new activity",
        },
        {
          id: "chip-show-list",
          label: "Show activities",
          prompt: "Show list",
        },
      ]}
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      draft={workspaceMode === "create" ? createDraft : null}
      seedPrompt={workspaceMode === "create" ? seedPrompt : null}
      seedDisplayText={workspaceMode === "create" ? seedDisplayText : null}
      onSeedPromptConsumed={() => {
        setSeedPrompt(null);
        setSeedDisplayText(null);
      }}
      workspaceTitle="Activities"
      workspaceSubtitle={
        workspaceMode === "list"
          ? MODULE_WORKSPACE_DESCRIPTION.activities
          : undefined
      }
      workspaceHeaderActions={
        workspaceMode === "list" ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setCreateDraft(emptyActivityDraft());
              setWorkspace("create", { form: true });
            }}
          >
            <Plus className="size-4" strokeWidth={2} />
            Log activity
          </Button>
        ) : undefined
      }
      workspace={
        loading && !hasLoadedOnce.current && workspaceMode === "list" ? (
          <ActivitiesPageSkeleton />
        ) : (
          workspace
        )
      }
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) =>
        onDraftPatch(patch as Partial<ActivityDraftFields>)
      }
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_create_activity") {
          const submit = draftSubmitRef.current;
          if (!submit) return "Create form isn't ready yet — try again in a moment.";
          const result = await submit();
          if (result === true) return true;
          return result;
        }
        return false;
      }}
      onAfterTool={() => void reload()}
    />
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof ListTodo;
  tone: "brand" | "blue" | "red" | "green";
}) {
  const toneClass =
    tone === "brand"
      ? TONE_ACCENT
      : tone === "blue"
        ? TONE_INFO
        : tone === "red"
          ? TONE_DANGER
          : TONE_SUCCESS;

  return (
    <div className="rounded-xl border border-border-default bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold text-text-primary">
            {value}
          </p>
        </div>
        <span
          className={`inline-flex size-9 items-center justify-center rounded-lg ${toneClass}`}
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </div>
    </div>
  );
}

function GroupRows({
  group,
  onCompleteTask,
  completingId,
  isHighlighted,
  onOpenActivity,
}: {
  group: { label: string; items: ActivityFeedItem[] };
  onCompleteTask: (activity: ActivityFeedItem) => void;
  completingId: string | null;
  isHighlighted: (id: string) => boolean;
  onOpenActivity: (activity: ActivityFeedItem) => void;
}) {
  return (
    <>
      <tr className="bg-subtle/60">
        <td
          colSpan={5}
          className="px-4 py-2 text-xs font-semibold tracking-wide text-text-caption uppercase"
        >
          {group.label}
        </td>
      </tr>
      {group.items.map((activity) => {
        const taskDisplay =
          activity.type === "task"
            ? deriveTaskDisplayStatus(
                activity.taskStatus as TaskStatus | null,
                activity.dueAt,
              )
            : null;
        const badge = taskDisplay
          ? {
              label: TASK_DISPLAY_STATUS_LABELS[taskDisplay],
              className:
                taskDisplay === "completed"
                  ? `${CHIP_BASE} ${TONE_SUCCESS}`
                  : taskDisplay === "overdue"
                    ? `${CHIP_BASE} ${TONE_DANGER}`
                    : taskDisplay === "in_progress"
                      ? `${CHIP_BASE} ${TONE_WARNING}`
                      : `${CHIP_BASE} ${TONE_MUTED}`,
            }
          : statusBadge(activity.status);
        const timeSource = activity.dueAt ?? activity.createdAt;
        const canComplete =
          activity.type === "task" && activity.taskStatus !== "completed";
        return (
          <tr
            key={activity.id}
            data-highlight-id={activity.id}
            data-return-focus={activity.id}
            className={`cursor-pointer border-b border-border-default/70 last:border-0 hover:bg-neutral-50/80 ${
              isHighlighted(activity.id) ? CREATE_HIGHLIGHT_ROW_CLASS : ""
            }`}
            onClick={() => onOpenActivity(activity)}
          >
            <td className="px-4 py-3">
              <div className="flex items-start gap-3">
                <ActivityTypeIcon
                  type={activity.type}
                  size="sm"
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">
                    {activity.subject}
                  </p>
                  {activity.disposition ? (
                    <div className="mt-1">
                      <DispositionTag label={activity.disposition} />
                    </div>
                  ) : null}
                  <p className="mt-0.5 text-xs text-text-caption">
                    {new Date(timeSource).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  {activity.bodyPreview ? (
                    <p className="mt-1 line-clamp-1 text-xs text-text-caption">
                      {activity.bodyPreview}
                    </p>
                  ) : null}
                  {canComplete ? (
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-text-link hover:underline disabled:opacity-50"
                      disabled={completingId === activity.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onCompleteTask(activity);
                      }}
                    >
                      {completingId === activity.id
                        ? "Completing…"
                        : "Mark complete"}
                    </button>
                  ) : null}
                </div>
              </div>
            </td>
            <td className="px-4 py-3 text-text-secondary">
              {activity.contactId?.trim() ? (
                <Link
                  to={contactActivityHref(
                    activity.contactId,
                    activity.id,
                    activity.type,
                  )}
                  className="font-medium text-text-link hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {activity.contactName}
                </Link>
              ) : (
                <span className="font-medium text-text-secondary">
                  {activity.contactName}
                </span>
              )}
              {activity.companyName ? (
                <p className="mt-0.5 text-xs text-text-caption">
                  {activity.companyId ? (
                    <Link
                      to={`/company/${activity.companyId}`}
                      className="hover:text-text-link hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {activity.companyName}
                    </Link>
                  ) : (
                    activity.companyName
                  )}
                </p>
              ) : null}
            </td>
            <td className="px-4 py-3">
              <ActivityTypeBadge type={activity.type} />
            </td>
            <td className="px-4 py-3 text-text-secondary">
              {activity.dueAt
                ? new Date(activity.dueAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—"}
            </td>
            <td className="px-4 py-3">
              <span
                className={badge.className}
              >
                {badge.label}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
