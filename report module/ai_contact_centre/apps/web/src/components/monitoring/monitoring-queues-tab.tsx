import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Search } from "lucide-react";

import { PanelRefreshButton } from "@/components/assistant/copilot-workspace";

import type {
  CallbackInteraction,
  LiveConversation,
  MissedInteraction,
  MonitoringChannel,
  QueueSnapshot,
  WaitingInteraction,
} from "@/features/monitoring/types";
import {
  groupCallbackInteractions,
  sortWaitingInteractions,
} from "@/features/monitoring/group-callback-interactions";
import { groupMissedInteractions } from "@/features/monitoring/group-missed-interactions";
import {
  callbackTaskStatusLabel,
  callbackTaskStatusTone,
  latestMissedAttempt,
  missedFollowUpDisplayLabel,
  missedFollowUpDisplayTone,
  matchesMissedStatusFilter,
  resolveMissedGroupCallback,
  resolveMissedGroupConnected,
  type MissedStatusFilter,
} from "@/features/monitoring/monitoring-queue-utils";
import { MonitoringChannelIcon } from "@/components/monitoring/monitoring-channel-icon";
import { channelLabel } from "@/components/monitoring/monitoring-utils";
import { Button, IconButton, segmentTabClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MenuSelect } from "@/components/ui/menu-select";

import {
  formatDuration,
  formatRelativeTime,
  MonitoringEmptyState,
  MonitoringFilterPills,
  MonitoringList,
  MonitoringListRow,
  MonitoringQueueCards,
  MonitoringTabShell,
  slaTone,
  StatusBadge,
  useMonitoringCardLayout,
} from "./monitoring-shared";
import {
  CallbackDetailPanel,
  MissedDetailPanel,
  MonitoringQueueDetailPanel,
  WaitingDetailPanel,
} from "./monitoring-queue-detail-panel";

type QueuesView = "live" | "waiting" | "missed" | "callbacks";

const LIVE_CHANNEL_ORDER: MonitoringChannel[] = [
  "voice",
  "webchat",
  "whatsapp",
  "instagram",
  "facebook",
  "email",
];

const MISSED_STATUS_FILTER_OPTIONS: Array<{ id: MissedStatusFilter; label: string }> = [
  { id: "all", label: "All statuses" },
  { id: "callback_pending", label: "Not assigned" },
  { id: "coworker_assigned", label: "Coworker assigned" },
  { id: "callback_assigned", label: "Supervisor assigned" },
  { id: "connected", label: "Agent reached" },
  { id: "no_callback_for_web", label: "No callback for web" },
];

const DEFAULT_QUEUE_FILTERS = {
  queueFilter: "all",
  missedStatusFilter: "all" as MissedStatusFilter,
  missedChannelFilter: "all" as MonitoringChannel | "all",
};

type QueueFilterDraft = typeof DEFAULT_QUEUE_FILTERS;

function countActiveQueueFilters(filters: QueueFilterDraft): number {
  return [
    filters.queueFilter !== "all",
    filters.missedStatusFilter !== "all",
    filters.missedChannelFilter !== "all",
  ].filter(Boolean).length;
}

function QueueFilterMenu({
  applied,
  queueOptions,
  missedChannelOptions,
  showMissedFilters,
  onApply,
}: {
  applied: QueueFilterDraft;
  queueOptions: Array<{ id: string; label: string }>;
  missedChannelOptions: Array<{ id: MonitoringChannel | "all"; label: string }>;
  showMissedFilters: boolean;
  onApply: (next: QueueFilterDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<QueueFilterDraft>(applied);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeCount = countActiveQueueFilters(applied);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (menuRef.current?.contains(target) || target.closest("[data-menu-select-list]")) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("[data-menu-select-list]")) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function openMenu() {
    setDraft(applied);
    setOpen((current) => !current);
  }

  function applyDraft(next: QueueFilterDraft) {
    onApply(next);
    setOpen(false);
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <IconButton
        aria-label="Filters"
        aria-expanded={open}
        className="relative"
        onClick={openMenu}
      >
        <Filter className="text-neutral-900" strokeWidth={1.5} />
        {activeCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex size-[15px] items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold leading-none text-white">
            {activeCount}
          </span>
        ) : null}
      </IconButton>

      {open ? (
        <div className="absolute top-full right-0 z-30 mt-2 w-[22rem] overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-sm">
          <div className="border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
            <p className="text-sm font-semibold text-neutral-900">Filters</p>
            <p className="mt-0.5 text-xs text-neutral-600">Narrow the list by queue and more</p>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-neutral-600">Queue</span>
              <MenuSelect
                value={draft.queueFilter}
                options={queueOptions.map((queue) => ({ value: queue.id, label: queue.label }))}
                onChange={(queueFilter) =>
                  setDraft((current) => ({ ...current, queueFilter }))
                }
                ariaLabel="Filter by queue"
              />
            </div>

            {showMissedFilters ? (
              <>
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-neutral-600">Status</span>
                  <MenuSelect
                    value={draft.missedStatusFilter}
                    options={MISSED_STATUS_FILTER_OPTIONS.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                    onChange={(missedStatusFilter) =>
                      setDraft((current) => ({ ...current, missedStatusFilter }))
                    }
                    ariaLabel="Filter missed by follow-up status"
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-neutral-600">Channel</span>
                  <MenuSelect
                    value={draft.missedChannelFilter}
                    options={missedChannelOptions.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                    onChange={(missedChannelFilter) =>
                      setDraft((current) => ({ ...current, missedChannelFilter }))
                    }
                    ariaLabel="Filter missed by channel"
                  />
                </div>
              </>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
            <Button
              variant="outline"
              onClick={() => applyDraft(DEFAULT_QUEUE_FILTERS)}
            >
              Reset
            </Button>
            <Button onClick={() => applyDraft(draft)}>Apply</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


function slaLabel(sla: WaitingInteraction["sla"]): string {
  if (sla === "healthy") return "Healthy";
  if (sla === "at_risk") return "At risk";
  return "Breached";
}

function elapsedSinceStart(startedAt: string | null, fallbackSeconds: number): number {
  if (startedAt) {
    const startedMs = Date.parse(startedAt);
    if (Number.isFinite(startedMs)) {
      return Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    }
  }
  return Math.max(0, Math.floor(fallbackSeconds));
}

/** Open time on the Live list only. Days keep multi-day ages readable. */
function formatLiveOpenDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const parts = [`${days}d`];
  if (remainingHours) parts.push(`${remainingHours}h`);
  if (remainingMinutes) parts.push(`${remainingMinutes}m`);
  return parts.join(" ");
}

function compareLiveNewestFirst(left: LiveConversation, right: LiveConversation): number {
  const leftMs = left.startedAt ? Date.parse(left.startedAt) : Number.NaN;
  const rightMs = right.startedAt ? Date.parse(right.startedAt) : Number.NaN;
  const leftKnown = Number.isFinite(leftMs);
  const rightKnown = Number.isFinite(rightMs);
  if (leftKnown && rightKnown && leftMs !== rightMs) return rightMs - leftMs;
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  return left.durationSeconds - right.durationSeconds;
}

function LiveElapsedTimer({
  startedAt,
  seconds,
}: {
  startedAt: string | null;
  seconds: number;
}) {
  const [elapsed, setElapsed] = useState(() => elapsedSinceStart(startedAt, seconds));

  useEffect(() => {
    setElapsed(elapsedSinceStart(startedAt, seconds));
    const id = window.setInterval(() => {
      setElapsed(elapsedSinceStart(startedAt, seconds));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, seconds]);

  return formatLiveOpenDuration(elapsed);
}

function matchesSearch(customer: string, search: string): boolean {
  if (!search.trim()) return true;
  return customer.toLowerCase().includes(search.trim().toLowerCase());
}

function emptyStateCopy(view: QueuesView, hasFilters: boolean) {
  if (view === "live") {
    return {
      title: "No live conversations",
      description: hasFilters
        ? "Try another search, queue, or channel."
        : "Nothing is open right now.",
    };
  }
  if (view === "waiting") {
    return {
      title: "No customers waiting",
      description: hasFilters
        ? "Try another search or queue filter."
        : "Everything is moving smoothly right now.",
    };
  }
  if (view === "missed") {
    return {
      title: "No missed interactions",
      description: hasFilters
        ? "Try another search, queue, status, or channel filter."
        : "No abandoned or missed contacts in the last 7 days.",
    };
  }
  return {
    title: "No open callbacks",
    description: hasFilters
      ? "Try another search."
      : "Assigned and recently completed callback tasks will appear here.",
  };
}

export function MonitoringQueuesTab({
  queues,
  waiting,
  missed,
  callbacks,
  liveConversations,
  pulse,
  focusQueueId,
  focusWaitingId,
  onFocusQueueHandled,
  onFocusWaitingHandled,
  onSelectMissed,
  onSelectLive,
  onAssignCallbackWaiting,
  onAssignCallbackMissed,
  onRefresh,
  refreshing = false,
}: {
  queues: QueueSnapshot[];
  waiting: WaitingInteraction[];
  missed: MissedInteraction[];
  callbacks: CallbackInteraction[];
  liveConversations: LiveConversation[];
  pulse: number;
  focusQueueId?: string | null;
  focusWaitingId?: string | null;
  onFocusQueueHandled?: () => void;
  onFocusWaitingHandled?: () => void;
  onSelectMissed: (row: MissedInteraction) => void;
  onSelectLive: (row: LiveConversation) => void;
  onAssignCallbackWaiting?: (row: WaitingInteraction) => void;
  onAssignCallbackMissed?: (row: MissedInteraction) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [view, setView] = useState<QueuesView>("live");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [missedStatusFilter, setMissedStatusFilter] = useState<MissedStatusFilter>("all");
  const [missedChannelFilter, setMissedChannelFilter] = useState<MonitoringChannel | "all">("all");
  const [liveChannelFilter, setLiveChannelFilter] = useState<MonitoringChannel | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedWaiting, setSelectedWaiting] = useState<WaitingInteraction | null>(null);
  const [selectedMissedAttempts, setSelectedMissedAttempts] = useState<MissedInteraction[] | null>(
    null,
  );
  const [selectedCallbackTasks, setSelectedCallbackTasks] = useState<CallbackInteraction[] | null>(
    null,
  );
  const { cardLayout, fullWidth } = useMonitoringCardLayout();

  const queueOptions = useMemo(
    () => [
      { id: "all", label: "All queues" },
      ...queues.map((queue) => ({ id: queue.name, label: queue.name })),
    ],
    [queues],
  );

  useEffect(() => {
    if (focusQueueId) {
      const queue = queues.find((row) => row.id === focusQueueId);
      if (queue) {
        setQueueFilter(queue.name);
        setView("waiting");
      }
      onFocusQueueHandled?.();
    }
  }, [focusQueueId, onFocusQueueHandled, queues]);

  useEffect(() => {
    if (!focusWaitingId) return;
    const row = waiting.find((item) => item.id === focusWaitingId);
    if (row) {
      setView("waiting");
      setSelectedWaiting(row);
    }
    onFocusWaitingHandled?.();
  }, [focusWaitingId, onFocusWaitingHandled, waiting]);

  const selectedMissedIdsKey = selectedMissedAttempts?.map((row) => row.id).join("|") ?? "";

  useEffect(() => {
    if (!selectedMissedIdsKey) return;
    const refreshed = selectedMissedIdsKey
      .split("|")
      .map((id) => missed.find((row) => row.id === id))
      .filter((row): row is MissedInteraction => Boolean(row))
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
      );
    if (refreshed.length > 0) setSelectedMissedAttempts(refreshed);
  }, [missed, selectedMissedIdsKey]);

  const filteredWaiting = useMemo(
    () =>
      sortWaitingInteractions(
        waiting.filter(
          (row) =>
            (queueFilter === "all" || row.queue === queueFilter) &&
            matchesSearch(row.customer, search),
        ),
      ),
    [queueFilter, search, waiting],
  );

  const filteredMissed = useMemo(
    () =>
      missed.filter(
        (row) =>
          (queueFilter === "all" || row.queue === queueFilter) && matchesSearch(row.customer, search),
      ),
    [missed, queueFilter, search],
  );

  const liveMatching = useMemo(
    () =>
      liveConversations
        .filter(
          (row) =>
            (queueFilter === "all" || row.queue === queueFilter) &&
            matchesSearch(row.customer, search),
        )
        .sort(compareLiveNewestFirst),
    [liveConversations, queueFilter, search],
  );

  const liveChannelOptions = useMemo(() => {
    const counts = new Map<MonitoringChannel, number>();
    for (const row of liveMatching) {
      counts.set(row.channel, (counts.get(row.channel) ?? 0) + 1);
    }
    const channels = [...counts.keys()].sort(
      (left, right) => LIVE_CHANNEL_ORDER.indexOf(left) - LIVE_CHANNEL_ORDER.indexOf(right),
    );
    return [
      { id: "all" as const, label: "All", count: liveMatching.length },
      ...channels.map((channel) => ({
        id: channel,
        label: channelLabel(channel),
        count: counts.get(channel) ?? 0,
      })),
    ];
  }, [liveMatching]);

  const filteredLive = useMemo(
    () =>
      liveChannelFilter === "all"
        ? liveMatching
        : liveMatching.filter((row) => row.channel === liveChannelFilter),
    [liveChannelFilter, liveMatching],
  );

  const filteredCallbacks = useMemo(
    () =>
      callbacks.filter(
        (row) =>
          (queueFilter === "all" || row.queue === queueFilter) &&
          matchesSearch(row.customer, search),
      ),
    [callbacks, queueFilter, search],
  );

  const groupedCallbacks = useMemo(
    () => groupCallbackInteractions(filteredCallbacks),
    [filteredCallbacks],
  );

  const groupedMissed = useMemo(
    () => groupMissedInteractions(filteredMissed),
    [filteredMissed],
  );

  const missedChannelOptions = useMemo(() => {
    const channels = [...new Set(filteredMissed.map((row) => row.channel))].sort();
    return [
      { id: "all" as const, label: "All channels" },
      ...channels.map((channel) => ({ id: channel, label: channelLabel(channel) })),
    ];
  }, [filteredMissed]);

  const filteredMissedGroups = useMemo(
    () =>
      groupedMissed.filter((group) => {
        if (missedChannelFilter !== "all" && group.channel !== missedChannelFilter) {
          return false;
        }
        if (missedStatusFilter !== "all") {
          return matchesMissedStatusFilter(group, missedStatusFilter);
        }
        return true;
      }),
    [groupedMissed, missedChannelFilter, missedStatusFilter],
  );

  const viewCounts = useMemo(
    () => ({
      live: liveMatching.length,
      waiting: filteredWaiting.length,
      missed: groupedMissed.length,
      callbacks: groupedCallbacks.length,
    }),
    [liveMatching, filteredWaiting, groupedMissed, groupedCallbacks],
  );

  const hasFilters =
    Boolean(search.trim()) ||
    queueFilter !== "all" ||
    missedStatusFilter !== "all" ||
    missedChannelFilter !== "all" ||
    (view === "live" && liveChannelFilter !== "all");
  const emptyCopy = emptyStateCopy(view, hasFilters);

  function clearSelection() {
    setSelectedWaiting(null);
    setSelectedMissedAttempts(null);
    setSelectedCallbackTasks(null);
  }

  function openMissed(attempts: MissedInteraction[]) {
    const sorted = [...attempts].sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
    );
    setSelectedMissedAttempts(sorted);
    onSelectMissed(sorted[0]!);
  }

  if (selectedWaiting) {
    return (
      <MonitoringQueueDetailPanel
        title={selectedWaiting.customer}
        subtitle="Customer waiting in queue"
        backLabel="Back to queues"
        onClose={clearSelection}
      >
        <WaitingDetailPanel row={selectedWaiting} onAssignCallback={onAssignCallbackWaiting} />
      </MonitoringQueueDetailPanel>
    );
  }

  if (selectedMissedAttempts?.length) {
    const latest = latestMissedAttempt(selectedMissedAttempts)!;
    const callback = resolveMissedGroupCallback(selectedMissedAttempts);
    const connected = resolveMissedGroupConnected(selectedMissedAttempts);
    const missedSubtitle =
      selectedMissedAttempts.length > 1
        ? `${selectedMissedAttempts.length} missed in 24h`
        : missedFollowUpDisplayLabel({
            connectedAfterMiss: connected.connectedAfterMiss,
            callbackAssigned: callback.callbackAssigned,
            callbackStatus: callback.callbackStatus,
            callbackAssignmentSource: callback.callbackAssignmentSource,
            channel: latest.channel,
          });

    return (
      <MonitoringQueueDetailPanel
        title={latest.customer}
        subtitle={missedSubtitle}
        backLabel="Back to queues"
        contactId={latest.contactId}
        onClose={clearSelection}
      >
        <MissedDetailPanel
          attempts={selectedMissedAttempts}
          onAssignCallback={onAssignCallbackMissed}
        />
      </MonitoringQueueDetailPanel>
    );
  }

  if (selectedCallbackTasks?.length) {
    const latest = selectedCallbackTasks[0]!;
    return (
      <MonitoringQueueDetailPanel
        title={latest.customer}
        subtitle={
          selectedCallbackTasks.length > 1
            ? `${selectedCallbackTasks.length} open callbacks`
            : "Assigned to agent"
        }
        backLabel="Back to queues"
        contactId={latest.contactId}
        onClose={clearSelection}
      >
        <CallbackDetailPanel tasks={selectedCallbackTasks} />
      </MonitoringQueueDetailPanel>
    );
  }

  return (
    <MonitoringTabShell
        toolbar={
          <div className="space-y-2">
            <div className="min-w-0 overflow-x-auto">
              <div className="grid min-w-full grid-cols-[repeat(3,minmax(max-content,1fr))] gap-1">
                {(
                  [
                    { id: "live", label: "Live conversations", count: viewCounts.live },
                    { id: "missed", label: "Missed / abandoned", count: viewCounts.missed },
                    { id: "callbacks", label: "Callbacks", count: viewCounts.callbacks },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={segmentTabClassName({
                      active: view === item.id,
                      className: "w-full whitespace-nowrap",
                    })}
                  >
                    {item.label}
                    <span
                      className={cn(
                        "ml-1 tabular-nums",
                        view === item.id ? "text-white/70" : "text-neutral-400",
                      )}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-w-0 w-full items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-900" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search customer…"
                  className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-9 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <QueueFilterMenu
                applied={{
                  queueFilter,
                  missedStatusFilter,
                  missedChannelFilter,
                }}
                queueOptions={queueOptions}
                missedChannelOptions={missedChannelOptions}
                showMissedFilters={view === "missed"}
                onApply={(next) => {
                  setQueueFilter(next.queueFilter);
                  setMissedStatusFilter(next.missedStatusFilter);
                  setMissedChannelFilter(next.missedChannelFilter);
                }}
              />
              {onRefresh ? (
                <PanelRefreshButton
                  className="xl:hidden"
                  onClick={onRefresh}
                  refreshing={refreshing}
                />
              ) : null}
            </div>
            {view === "live" ? (
              <MonitoringFilterPills
                value={liveChannelFilter}
                options={liveChannelOptions}
                onChange={setLiveChannelFilter}
              />
            ) : null}
          </div>
        }
      >
        {view === "live" && filteredLive.length === 0 ? (
          <MonitoringEmptyState title={emptyCopy.title} description={emptyCopy.description} />
        ) : null}

        {view === "waiting" && filteredWaiting.length === 0 ? (
          <MonitoringEmptyState title={emptyCopy.title} description={emptyCopy.description} />
        ) : null}

        {view === "missed" && filteredMissedGroups.length === 0 ? (
          <MonitoringEmptyState title={emptyCopy.title} description={emptyCopy.description} />
        ) : null}

        {view === "callbacks" && groupedCallbacks.length === 0 ? (
          <MonitoringEmptyState title={emptyCopy.title} description={emptyCopy.description} />
        ) : null}

        {cardLayout &&
        view === "waiting" &&
        queueFilter === "all" &&
        filteredWaiting.length > 0 ? (
          <MonitoringQueueCards
            queues={queues}
            fullWidth={fullWidth}
            className="mb-4"
            onSelectQueue={(queue) => setQueueFilter(queue.name)}
          />
        ) : null}

        {view === "live" && filteredLive.length > 0 ? (
          <MonitoringList key={`live-${pulse}`} layout="list">
            {filteredLive.map((row) => (
              <MonitoringListRow
                key={row.id}
                seed={row.id}
                initials={row.customer.slice(0, 2).toUpperCase()}
                title={row.customer}
                subtitleIcon={<MonitoringChannelIcon channel={row.channel} />}
                subtitle={`${channelLabel(row.channel)} · ${row.queue}`}
                detail={row.agentName ? `Handling by ${row.agentName}` : row.intent}
                trailingBottom={
                  <LiveElapsedTimer startedAt={row.startedAt} seconds={row.durationSeconds} />
                }
                layout="list"
                onClick={() => onSelectLive(row)}
              />
            ))}
          </MonitoringList>
        ) : null}

        {view === "waiting" && filteredWaiting.length > 0 ? (
          <MonitoringList key={`waiting-${pulse}`} layout="list">
            {filteredWaiting.map((row) => (
              <MonitoringListRow
                key={row.id}
                seed={row.id}
                initials={row.customer.slice(0, 2).toUpperCase()}
                title={row.customer}
                subtitleIcon={<MonitoringChannelIcon channel={row.channel} />}
                subtitle={`${channelLabel(row.channel)} · ${row.queue}`}
                detail={`Position #${row.position}${row.priority === "high" ? " · High priority" : ""}`}
                badges={<StatusBadge label={slaLabel(row.sla)} tone={slaTone(row.sla)} />}
                trailingBottom={formatDuration(row.waitingSeconds)}
                layout="list"
                onClick={() => setSelectedWaiting(row)}
              />
            ))}
          </MonitoringList>
        ) : null}

        {view === "missed" && filteredMissedGroups.length > 0 ? (
          <MonitoringList key={`missed-${pulse}`} layout="list">
            {filteredMissedGroups.map((group) => (
              <MonitoringListRow
                key={group.id}
                seed={group.latest.id}
                initials={group.customer.slice(0, 2).toUpperCase()}
                title={group.customer}
                subtitleIcon={<MonitoringChannelIcon channel={group.channel} />}
                subtitle={`${channelLabel(group.channel)} · ${group.queue}`}
                badgesPlacement="below"
                badges={
                  <>
                    <StatusBadge label={`${group.count} missed`} tone="neutral" />
                    <StatusBadge
                      label={missedFollowUpDisplayLabel(group)}
                      tone={missedFollowUpDisplayTone(group)}
                    />
                    {group.latest.priority === "high" ? (
                      <StatusBadge label="High priority" tone="warning" />
                    ) : null}
                  </>
                }
                trailingBottom={formatRelativeTime(group.latest.occurredAt)}
                layout="list"
                onClick={() => openMissed(group.attempts)}
              />
            ))}
          </MonitoringList>
        ) : null}

        {view === "callbacks" && groupedCallbacks.length > 0 ? (
          <MonitoringList key={`callbacks-${pulse}`} layout="list">
            {groupedCallbacks.map((group) => (
              <MonitoringListRow
                key={group.id}
                seed={group.latest.id}
                initials={group.customer.slice(0, 2).toUpperCase()}
                title={group.customer}
                subtitleIcon={<MonitoringChannelIcon channel={group.channel} />}
                subtitle={`${channelLabel(group.channel)} · ${group.assignedAgentName}`}
                detail={
                  group.count > 1
                    ? `${group.count} callbacks · ${group.latest.title}`
                    : group.latest.title
                }
                badges={
                  <>
                    <StatusBadge
                      label={callbackTaskStatusLabel(group.latest.status)}
                      tone={callbackTaskStatusTone(group.latest.status)}
                    />
                    {group.latest.priority === "high" ? (
                      <StatusBadge label="High priority" tone="warning" />
                    ) : null}
                  </>
                }
                trailingBottom={formatRelativeTime(
                  group.latest.status === "completed" && group.latest.completedAt
                    ? group.latest.completedAt
                    : group.latest.createdAt,
                )}
                layout="list"
                onClick={() => setSelectedCallbackTasks(group.tasks)}
              />
            ))}
          </MonitoringList>
        ) : null}
      </MonitoringTabShell>
  );
}
