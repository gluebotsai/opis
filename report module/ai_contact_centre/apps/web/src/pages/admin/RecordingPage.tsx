import { useEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import dayjs from "dayjs";
import { Filter, LoaderCircle, Search } from "lucide-react";

import {
  CopilotWorkspace,
  PanelExpandButton,
  PanelRefreshButton,
} from "@/components/assistant/copilot-workspace";
import { WorkspaceEmptyState } from "@/components/workspace/workspace-empty-state";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { PerformanceDateRangeControl } from "@/components/performance/performance-date-range-control";
import { MenuSelect } from "@/components/ui/menu-select";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { Button, IconButton, segmentTabClassName } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { VoiceRecordingList, VoiceRecordingListSkeleton } from "@/components/workforce/voice-recording-list";
import { useMainFlush } from "@/contexts/main-flush";
import { organizationSettingsApi } from "@/features/workforce/organization-settings/api";
import type {
  OrganizationRecordingInput,
  OrganizationVoicePromptOption,
  VoiceRecording,
} from "@/features/workforce/organization-settings/types";
import type { PerformancePeriodSelection, PerformanceRange } from "@/features/performance/api";
import { StatusToggle } from "@/features/workforce/queues/status-toggle";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import { isSessionError } from "@/store/slices/auth-slice";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

function toInput(recording: {
  recordingEnabled: boolean;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  consentNoticeEnabled?: boolean;
  consentPromptId?: string | null;
  agentAccessEnabled?: boolean;
}): OrganizationRecordingInput {
  return {
    recordingEnabled: recording.recordingEnabled,
    inboundEnabled: recording.inboundEnabled ?? true,
    outboundEnabled: recording.outboundEnabled ?? true,
    consentNoticeEnabled: recording.consentNoticeEnabled ?? false,
    consentPromptId: recording.consentPromptId ?? null,
    agentAccessEnabled: recording.agentAccessEnabled ?? false,
  };
}

function DirectionCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-sm text-neutral-800",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded-[3px] border-[#171717] accent-neutral-900"
      />
      {label}
    </label>
  );
}

const RECORDING_PAGE_SIZE = 10;

type RecordingListQuery = {
  search: string;
  direction: "all" | "inbound" | "outbound";
  queue: string;
  agent: string;
  from: string;
  to: string;
};

const DEFAULT_RECORDING_FILTERS: RecordingListQuery = {
  search: "",
  direction: "all",
  queue: "all",
  agent: "all",
  from: "",
  to: "",
};

const RECORDING_DATE_PRESET: PerformanceRange = "30d";

function recordingDateBounds(selection: PerformancePeriodSelection): { from: string; to: string } {
  if (selection.mode === "custom") return { from: selection.start, to: selection.end };
  const end = dayjs();
  const days = selection.range === "today" ? 1 : selection.range === "7d" ? 7 : 30;
  return {
    from: end.subtract(days - 1, "day").format("YYYY-MM-DD"),
    to: end.format("YYYY-MM-DD"),
  };
}

function dayBoundIso(ymd: string, end: boolean): string {
  const parts = ymd.split("-").map(Number);
  const year = parts[0] ?? Number.NaN;
  const month = parts[1] || 1;
  const day = parts[2] || 1;
  const date = end
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return date.toISOString();
}

function countRecordingFilters(filters: RecordingListQuery): number {
  return [filters.direction !== "all", filters.queue !== "all", filters.agent !== "all"].filter(Boolean)
    .length;
}

function RecordingFilterMenu({
  applied,
  queues,
  agents,
  onApply,
}: {
  applied: RecordingListQuery;
  queues: string[];
  agents: string[];
  onApply: (next: Pick<RecordingListQuery, "direction" | "queue" | "agent">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(applied);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeCount = countRecordingFilters(applied);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (menuRef.current?.contains(target) || target.closest("[data-menu-select-list]")) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("[data-menu-select-list]")) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function applyDraft(next: RecordingListQuery) {
    onApply({ direction: next.direction, queue: next.queue, agent: next.agent });
    setOpen(false);
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <IconButton
        aria-label="Filters"
        aria-expanded={open}
        className="relative"
        onClick={() => {
          setDraft(applied);
          setOpen((current) => !current);
        }}
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
            <p className="mt-0.5 text-xs text-neutral-600">Narrow recordings by direction, queue, or agent</p>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-neutral-600">Direction</span>
              <MenuSelect
                value={draft.direction}
                options={[
                  { value: "all", label: "All directions" },
                  { value: "inbound", label: "Inbound" },
                  { value: "outbound", label: "Outbound" },
                ]}
                onChange={(direction) =>
                  setDraft((current) => ({
                    ...current,
                    direction: direction === "outbound" ? "outbound" : direction === "inbound" ? "inbound" : "all",
                  }))
                }
                ariaLabel="Filter by direction"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-neutral-600">Queue</span>
              <MenuSelect
                value={draft.queue}
                options={[
                  { value: "all", label: "All queues" },
                  ...queues.map((queue) => ({ value: queue, label: queue })),
                ]}
                onChange={(queue) => setDraft((current) => ({ ...current, queue }))}
                ariaLabel="Filter by queue"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-neutral-600">Agent</span>
              <MenuSelect
                value={draft.agent}
                options={[
                  { value: "all", label: "All agents" },
                  ...agents.map((agent) => ({ value: agent, label: agent })),
                ]}
                onChange={(agent) => setDraft((current) => ({ ...current, agent }))}
                ariaLabel="Filter by agent"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
            <Button variant="outline" onClick={() => applyDraft(DEFAULT_RECORDING_FILTERS)}>
              Reset
            </Button>
            <Button onClick={() => applyDraft(draft)}>Apply</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type RecordingTab = "recordings" | "configuration";

const RECORDING_TABS: Array<{ id: RecordingTab; label: string }> = [
  { id: "recordings", label: "Recordings" },
  { id: "configuration", label: "Configuration" },
];

function ConfigCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="mt-0.5 text-xs text-neutral-600">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function ConfigSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
          <p className="mt-1 text-sm text-neutral-600">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export default function RecordingPage() {
  const { copilotMinimized } = useMainFlush();
  const studio = copilotMinimized;
  const [form, setForm] = useState<OrganizationRecordingInput>(() =>
    toInput({ recordingEnabled: false }),
  );
  const formRef = useRef(form);
  formRef.current = form;
  const [prompts, setPrompts] = useState<OrganizationVoicePromptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<RecordingTab>("recordings");
  const [recordings, setRecordings] = useState<VoiceRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [dateSelection, setDateSelection] = useState<PerformancePeriodSelection>({
    mode: "preset",
    range: RECORDING_DATE_PRESET,
  });
  const [filters, setFilters] = useState<RecordingListQuery>(() => ({
    ...DEFAULT_RECORDING_FILTERS,
    ...recordingDateBounds({ mode: "preset", range: RECORDING_DATE_PRESET }),
  }));
  const [queueOptions, setQueueOptions] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsHost, setDetailsHost] = useState<HTMLDivElement | null>(null);
  const detailsDismissedRef = useRef(false);
  const recordingsOffsetRef = useRef(0);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRecordingsRef = useRef<() => void>(() => {});
  const recordingsGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const hasLoadedRecordingsRef = useRef(false);
  const listQueryRef = useRef<RecordingListQuery>(DEFAULT_RECORDING_FILTERS);
  listQueryRef.current = { ...filters, search: appliedSearch };

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { recording, prompts: nextPrompts } = await organizationSettingsApi.getRecording();
      setForm(toInput(recording));
      setPrompts(nextPrompts ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load recording settings";
      if (!isSessionError(message)) setError(message);
    } finally {
      setLoading(false);
    }
  }

  function recordingListParams(offset: number) {
    const query = listQueryRef.current;
    return {
      limit: RECORDING_PAGE_SIZE,
      offset,
      search: query.search,
      direction: query.direction,
      queue: query.queue,
      agent: query.agent,
      from: query.from ? dayBoundIso(query.from, false) : undefined,
      to: query.to ? dayBoundIso(query.to, true) : undefined,
    };
  }

  function applyRecordingPage(
    page: { recordings: VoiceRecording[]; hasMore: boolean; queues?: string[]; agents?: string[] },
    offset: number,
    replace: boolean,
  ) {
    setRecordings((current) => {
      if (replace) return page.recordings;
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...page.recordings.filter((row) => !seen.has(row.id))];
    });
    if (page.queues) setQueueOptions(page.queues);
    if (page.agents) setAgentOptions(page.agents);
    hasMoreRef.current = page.hasMore;
    recordingsOffsetRef.current = offset + page.recordings.length;
    hasLoadedRecordingsRef.current = true;
  }

  async function refresh() {
    const generation = ++recordingsGenerationRef.current;
    setRefreshing(true);
    setError(null);
    try {
      const [{ recording, prompts: nextPrompts }, page] = await Promise.all([
        organizationSettingsApi.getRecording(),
        organizationSettingsApi.listRecordings(recordingListParams(0)),
      ]);
      if (generation !== recordingsGenerationRef.current) return;
      setForm(toInput(recording));
      setPrompts(nextPrompts ?? []);
      applyRecordingPage(page, 0, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh recordings";
      if (!isSessionError(message)) setError(message);
    } finally {
      if (generation === recordingsGenerationRef.current) setRefreshing(false);
    }
  }

  async function loadMoreRecordings() {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const generation = recordingsGenerationRef.current;
    const offset = recordingsOffsetRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await organizationSettingsApi.listRecordings(recordingListParams(offset));
      if (generation !== recordingsGenerationRef.current) return;
      applyRecordingPage(page, offset, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load recordings";
      if (!isSessionError(message)) setError(message);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  function handleRecordingsScroll(event: UIEvent<HTMLDivElement>) {
    if ((!studio && tab !== "recordings") || recordingsLoading || loadingMoreRef.current || !hasMoreRef.current) {
      return;
    }
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 240) void loadMoreRecordings();
  }

  loadMoreRecordingsRef.current = () => {
    void loadMoreRecordings();
  };

  useEffect(() => {
    const root = listScrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRecordingsRef.current();
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [recordings.length, recordingsLoading, studio, tab]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const generation = ++recordingsGenerationRef.current;
    if (!hasLoadedRecordingsRef.current) setRecordingsLoading(true);
    void organizationSettingsApi
      .listRecordings(recordingListParams(0))
      .then((page) => {
        if (generation !== recordingsGenerationRef.current) return;
        applyRecordingPage(page, 0, true);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load recordings";
        if (!isSessionError(message)) setError(message);
        if (generation === recordingsGenerationRef.current) setRecordings([]);
      })
      .finally(() => {
        if (generation === recordingsGenerationRef.current) setRecordingsLoading(false);
      });
  }, [appliedSearch, filters.direction, filters.queue, filters.agent, filters.from, filters.to]);

  async function persist(next: OrganizationRecordingInput) {
    const previous = formRef.current;
    formRef.current = next;
    setForm(next);
    setSaving(true);
    setError(null);
    try {
      const { recording, prompts: nextPrompts } = await organizationSettingsApi.saveRecording(next);
      const saved = toInput(recording);
      formRef.current = saved;
      setForm(saved);
      setPrompts(nextPrompts ?? []);
    } catch (err) {
      formRef.current = previous;
      setForm(previous);
      setError(err instanceof Error ? err.message : "Failed to update recording");
    } finally {
      setSaving(false);
    }
  }

  function patch(partial: Partial<OrganizationRecordingInput>) {
    const next = { ...formRef.current, ...partial };
    if (next.recordingEnabled && !next.inboundEnabled && !next.outboundEnabled) {
      setError("Select inbound, outbound, or both when voice recording is on");
      return;
    }
    void persist(next);
  }

  const voiceOn = form.recordingEnabled;
  const promptOptions = prompts.map((prompt) => ({ value: prompt.id, label: prompt.name }));
  const disabledNested = saving || !voiceOn;
  const promptDisabled = disabledNested || !form.consentNoticeEnabled;
  useEffect(() => {
    if (selectedId && !recordings.some((row) => row.id === selectedId)) setSelectedId(null);
  }, [recordings, selectedId]);

  useEffect(() => {
    if (!studio || detailsDismissedRef.current || selectedId || recordings.length === 0) return;
    const first = recordings[0];
    if (!first) return;
    setSelectedId(first.id);
  }, [studio, selectedId, recordings]);

  function setVoiceEnabled(turningOn: boolean) {
    const current = formRef.current;
    const bothOff = !current.inboundEnabled && !current.outboundEnabled;
    void persist({
      ...current,
      recordingEnabled: turningOn,
      inboundEnabled: turningOn && bothOff ? true : current.inboundEnabled,
      outboundEnabled: turningOn && bothOff ? true : current.outboundEnabled,
    });
  }

  const voiceToggle = (
    <StatusToggle
      checked={form.recordingEnabled}
      disabled={saving}
      compact
      showLabel={false}
      ariaLabel="Voice recording"
      onChange={(status) => setVoiceEnabled(status === "active")}
    />
  );
  const consentToggle = (
    <StatusToggle
      checked={form.consentNoticeEnabled}
      disabled={disabledNested}
      compact
      showLabel={false}
      ariaLabel="Consent notice"
      onChange={(status) => patch({ consentNoticeEnabled: status === "active" })}
    />
  );
  const accessToggle = (
    <StatusToggle
      checked={form.agentAccessEnabled}
      disabled={saving}
      compact
      showLabel={false}
      ariaLabel="Agent access"
      onChange={(status) => patch({ agentAccessEnabled: status === "active" })}
    />
  );

  return (
    <CopilotWorkspace
      title="Voice Recording"
      subtitle="Capture consent preferences and record audio and video calls for verification."
      copilot={<EmbeddedCopilotPanel />}
    >
      <div className={contentPanelClassName}>
        {studio ? null : (
        <div className="shrink-0">
          <div className={cn("flex items-center justify-between gap-2 px-4 py-3", contentPanelHeaderBorderClassName)}>
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-semibold text-neutral-900">Recording</h2>
              <p className="mt-0.5 truncate text-sm text-neutral-600">Recorded calls and settings</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <PanelRefreshButton onClick={() => void refresh()} refreshing={refreshing} />
              <PanelExpandButton side="right" />
            </div>
          </div>
          <div className="space-y-2 px-5 pt-3">
          <div className="grid min-w-0 grid-cols-2 gap-1">
              {RECORDING_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={segmentTabClassName({
                    active: tab === item.id,
                    className: "w-full whitespace-nowrap",
                  })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          {tab === "recordings" ? (
            <div className="flex min-w-0 items-center gap-2 pb-1">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-neutral-900" strokeWidth={2.25} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search customer, agent, or queue"
                  className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-10 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <RecordingFilterMenu
                applied={{ ...filters, search: appliedSearch }}
                queues={queueOptions}
                agents={agentOptions}
                onApply={(next) => setFilters((current) => ({ ...current, ...next }))}
              />
            </div>
          ) : null}
          </div>
        </div>
        )}

        <div className={cn("flex min-h-0 flex-1 flex-col", studio && "xl:flex-row")}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {studio ? (
          <div className="shrink-0 space-y-4 px-4 py-4">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-xl bg-neutral-100" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConfigCard title="Recording" description="Enable call recording." action={voiceToggle} />
                <ConfigCard title="Direction" description="Choose which calls are recorded.">
                  <div className={cn("flex flex-wrap items-center gap-4", disabledNested && "opacity-60")}>
                    <DirectionCheckbox
                      label="Inbound"
                      checked={form.inboundEnabled}
                      disabled={disabledNested}
                      onChange={(checked) => patch({ inboundEnabled: checked })}
                    />
                    <DirectionCheckbox
                      label="Outbound"
                      checked={form.outboundEnabled}
                      disabled={disabledNested}
                      onChange={(checked) => patch({ outboundEnabled: checked })}
                    />
                  </div>
                </ConfigCard>
                <ConfigCard title="Consent notice" description="Play a prompt before recording." action={consentToggle}>
                  <div className={cn(promptDisabled && "opacity-60")}>
                    <MenuSelect
                      value={form.consentPromptId ?? ""}
                      options={promptOptions}
                      placeholder="Select a prompt"
                      disabled={promptDisabled}
                      ariaLabel="Consent prompt"
                      onChange={(value) => patch({ consentPromptId: value || null })}
                    />
                  </div>
                </ConfigCard>
                <ConfigCard title="Agent access" description="Let the handling agent open the recording." action={accessToggle} />
              </div>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-neutral-900" strokeWidth={2.25} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search customer, agent, or number"
                  className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-10 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <PerformanceDateRangeControl
                calendarOnly
                selection={dateSelection}
                onChange={(selection) => {
                  setDateSelection(selection);
                  setFilters((current) => ({ ...current, ...recordingDateBounds(selection) }));
                }}
              />
              <IconButton aria-label="Refresh recordings" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshIcon className={cn(refreshing && "animate-spin")} />
              </IconButton>
              <PanelExpandButton side="right" />
              <RecordingFilterMenu
                applied={{ ...filters, search: appliedSearch }}
                queues={queueOptions}
                agents={agentOptions}
                onApply={(next) => setFilters((current) => ({ ...current, ...next }))}
              />
            </div>
          </div>
        ) : null}
        <PanelScrollArea ref={listScrollRef} className={cn("min-h-0 flex-1 px-5", studio ? "pb-2" : "py-2")} onScroll={handleRecordingsScroll}>
          {error ? (
            <StatusBanner tone="error" className="mb-3">
              {error}
            </StatusBanner>
          ) : null}

          {studio || tab === "recordings" ? (
            recordingsLoading ? (
              <VoiceRecordingListSkeleton />
            ) : recordings.length === 0 ? (
              <WorkspaceEmptyState
                variant="inbox"
                title={
                  appliedSearch || filters.direction !== "all" || filters.queue !== "all" || filters.agent !== "all" || dateSelection.mode === "custom" || dateSelection.range !== RECORDING_DATE_PRESET
                    ? "No recordings match"
                    : "No recordings yet"
                }
                description={
                  appliedSearch || filters.direction !== "all" || filters.queue !== "all" || filters.agent !== "all" || dateSelection.mode === "custom" || dateSelection.range !== RECORDING_DATE_PRESET
                    ? "Try another search or filter."
                    : "Recorded calls will appear here."
                }
                className="h-full"
              />
            ) : (
              <>
                <VoiceRecordingList
                  recordings={recordings}
                  selectedId={studio ? selectedId : null}
                  onSelect={
                    studio
                      ? (row) => {
                          detailsDismissedRef.current = false;
                          setSelectedId(row.id);
                        }
                      : undefined
                  }
                  onCloseDetails={
                    studio
                      ? () => {
                          detailsDismissedRef.current = true;
                          setSelectedId(null);
                        }
                      : undefined
                  }
                  detailsHost={studio ? detailsHost : null}
                />
                {loadingMore ? (
                  <div className="flex items-center justify-center gap-2 py-3 text-sm text-neutral-600">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading more recordings…
                  </div>
                ) : null}
                <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden />
              </>
            )
          ) : loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-neutral-600">
              <LoaderCircle className="size-4 animate-spin" />
              Loading recording settings…
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-2">
              <ConfigSection
                title="Voice"
                description="Record calls so they can be reviewed for consent."
                action={voiceToggle}
              >
                <div className={cn("rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-4 py-3", disabledNested && "opacity-60")}>
                  <p className="text-sm font-semibold text-neutral-900">Direction</p>
                  <p className="mt-0.5 text-sm text-neutral-600">Choose which calls are recorded.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-8">
                    <DirectionCheckbox
                      label="Inbound"
                      checked={form.inboundEnabled}
                      disabled={disabledNested}
                      onChange={(checked) => patch({ inboundEnabled: checked })}
                    />
                    <DirectionCheckbox
                      label="Outbound"
                      checked={form.outboundEnabled}
                      disabled={disabledNested}
                      onChange={(checked) => patch({ outboundEnabled: checked })}
                    />
                  </div>
                </div>
              </ConfigSection>

              <ConfigSection
                title="Consent notice"
                description="Play a prompt before recording so the caller hears the notice."
                action={consentToggle}
              >
                <div className={cn(promptDisabled && "opacity-60")}>
                  <p className="text-sm font-semibold text-neutral-900">Prompt</p>
                  <div className="mt-2">
                    <MenuSelect
                      value={form.consentPromptId ?? ""}
                      options={promptOptions}
                      placeholder="Select a prompt"
                      disabled={promptDisabled}
                      ariaLabel="Consent prompt"
                      onChange={(value) => patch({ consentPromptId: value || null })}
                    />
                  </div>
                </div>
              </ConfigSection>

              <ConfigSection
                title="Agent access"
                description="Let the agent who handled the call open its recording."
                action={accessToggle}
              />
            </div>
          )}
        </PanelScrollArea>
        </div>
        {studio && selectedId ? (
          <div ref={setDetailsHost} className="flex min-h-0 w-full shrink-0 flex-col xl:w-[480px]" />
        ) : null}
        </div>
      </div>
    </CopilotWorkspace>
  );
}
