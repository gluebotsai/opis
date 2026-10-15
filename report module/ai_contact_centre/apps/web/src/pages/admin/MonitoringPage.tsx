import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";

import { CopilotWorkspace, PanelExpandButton, PanelRefreshButton, useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { ASSISTANT_REFRESH_MONITORING } from "@/features/assistant/assistant-api";
import { MonitoringAssignCallbackDialog } from "@/components/monitoring/monitoring-assign-callback-dialog";
import { MonitoringAgentsTab } from "@/components/monitoring/monitoring-agents-tab";
import { MonitoringPanelSkeleton } from "@/components/monitoring/monitoring-panel-skeleton";
import { MonitoringQueuesTab } from "@/components/monitoring/monitoring-queues-tab";
import { MonitoringConversationDetailSections } from "@/components/monitoring/monitoring-conversation-lifecycle";
import { MonitoringListenSpeakingCard } from "@/components/monitoring/monitoring-listen-speaking-card";
import { MonitoringSupervisorActions } from "@/components/monitoring/monitoring-supervisor-actions";
import {
  LivePulse,
  MonitoringDrawer,
  slaTone,
  StatusBadge,
} from "@/components/monitoring/monitoring-shared";
import { channelLabel } from "@/components/monitoring/monitoring-utils";
import { listenToLiveConversation } from "@/features/voice/supervisor-listen";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { IconButton } from "@/components/ui/button";
import { useMainFlush } from "@/contexts/main-flush";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { normalizeMonitoringChannel } from "@/features/monitoring/channel-utils";
import {
  mapMonitoringSnapshot,
  type CallbackAssignmentTarget,
} from "@/features/monitoring/map-monitoring-snapshot";
import { useMonitoringLive } from "@/features/monitoring/use-monitoring-live";
import type {
  ConversationDetail,
  LiveAgent,
  LiveAgentConversation,
  MissedInteraction,
  MonitoringTab,
  WaitingInteraction,
} from "@/features/monitoring/types";

const TABS: Array<{ id: MonitoringTab; label: string }> = [
  { id: "queues", label: "Queues" },
  { id: "agents", label: "Agents" },
];

function MonitoringListHeader({
  tab,
  liveConnected,
  refreshing,
  error,
  onTabChange,
  onRefresh,
}: {
  tab: MonitoringTab;
  liveConnected: boolean;
  refreshing: boolean;
  error: string | null;
  onTabChange: (tab: MonitoringTab) => void;
  onRefresh: () => void;
}) {
  const copilotMinimized = Boolean(useCopilotWorkspacePanels()?.copilotMinimized);

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {copilotMinimized ? null : (
          <div className="min-w-0 shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-semibold text-neutral-900">Live Monitoring</h2>
              <LivePulse connected={liveConnected} />
            </div>
            <p className="mt-0.5 text-sm text-neutral-600">Live supervisor view</p>
          </div>
        )}
        <SegmentTabs
          value={tab}
          options={TABS}
          onChange={onTabChange}
          fitContent={!copilotMinimized}
          equalWidth={!copilotMinimized}
          className={copilotMinimized ? "min-w-0 flex-1" : "ml-auto shrink-0"}
        />
        <div className="flex shrink-0 items-center gap-2">
          <PanelRefreshButton
            className="max-xl:hidden"
            onClick={onRefresh}
            refreshing={refreshing}
          />
          <PanelExpandButton side="right" />
        </div>
      </div>
      {error ? <p className="mt-1 text-[11px] text-amber-700">{error}</p> : null}
    </>
  );
}

type WatchConversationState = {
  id: string;
  channel: string;
  customer: string;
  agentName: string;
  queue: string;
  intent: string;
};

type MonitoringLocationState = {
  tab?: MonitoringTab;
  focusAgentId?: string;
  highlightTaskId?: string;
  watchConversation?: WatchConversationState;
} | null;

export default function MonitoringPage() {
  const location = useLocation();
  const { copilotMinimized } = useMainFlush();
  const { snapshot, loading, refreshing, error, liveConnected, refresh } = useMonitoringLive();
  const [tab, setTab] = useState<MonitoringTab>(() => {
    const state = location.state as MonitoringLocationState;
    return state?.tab ?? "queues";
  });
  const [expandedSide, setExpandedSide] = useState<"left" | "right">("left");
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const [callbackTarget, setCallbackTarget] = useState<CallbackAssignmentTarget | null>(null);
  const [pulse, setPulse] = useState(0);
  const [focusQueueId, setFocusQueueId] = useState<string | null>(null);
  const [focusWaitingId, setFocusWaitingId] = useState<string | null>(null);
  const [focusAgentId, setFocusAgentId] = useState<string | null>(() => {
    const state = location.state as MonitoringLocationState;
    return state?.focusAgentId ?? null;
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as MonitoringLocationState;
    if (state?.tab) setTab(state.tab);
    if (state?.focusAgentId) setFocusAgentId(state.focusAgentId);
  }, [location.state]);

  const state = useMemo(
    () => (snapshot ? mapMonitoringSnapshot(snapshot) : null),
    [snapshot],
  );
  const liveConversationsRef = useRef(state?.liveConversations);
  liveConversationsRef.current = state?.liveConversations;

  useEffect(() => {
    const watch = (location.state as MonitoringLocationState)?.watchConversation;
    if (!watch) return;
    const live = liveConversationsRef.current?.find((row) => row.id === watch.id);
    setTab("queues");
    setSelectedAgentId(null);
    setWatchOnly(true);
    if (live) {
      setConversationDetail({
        id: live.id,
        channel: live.channel,
        customer: live.customer,
        durationSeconds: live.durationSeconds,
        intent: live.intent,
        sla: live.sla,
        queue: live.queue,
        agentName: live.agentName ?? watch.agentName,
      });
      return;
    }
    setConversationDetail({
      id: watch.id,
      channel: normalizeMonitoringChannel(watch.channel),
      customer: watch.customer,
      durationSeconds: 0,
      intent: watch.intent,
      sla: "healthy",
      queue: watch.queue,
      agentName: watch.agentName,
    });
  }, [location.key, location.state]);

  const bumpPulse = useCallback(() => {
    setPulse((value) => value + 1);
  }, []);

  const handleRefresh = useCallback(() => {
    refresh();
    bumpPulse();
  }, [bumpPulse, refresh]);

  useEffect(() => {
    const onRefresh = () => {
      handleRefresh();
    };
    window.addEventListener(ASSISTANT_REFRESH_MONITORING, onRefresh);
    return () => window.removeEventListener(ASSISTANT_REFRESH_MONITORING, onRefresh);
  }, [handleRefresh]);

  const openConversation = useCallback(
    (agent: LiveAgent, conversation: LiveAgentConversation) => {
      setWatchOnly(false);
      setConversationDetail({
        ...conversation,
        agentName: agent.name,
      });
    },
    [],
  );

  const openCallbackForWaiting = useCallback(
    (row: WaitingInteraction) => {
      const source = snapshot?.waiting.find((item) => item.conversationId === row.id);
      setCallbackTarget({
        conversationId: row.id,
        contactId: source?.contactId ?? null,
        queueId: source?.queueId ?? null,
        channel: row.channel,
        customerName: row.customer,
        summary: `${row.customer} is waiting in ${row.queue}. Supervisor requested a social callback.`,
      });
    },
    [snapshot?.waiting],
  );

  const openCallbackForMissed = useCallback(
    (row: MissedInteraction) => {
      const source = snapshot?.missed.find((item) => item.id === row.id);
      setCallbackTarget({
        conversationId: source?.conversationId ?? null,
        contactId: source?.contactId ?? null,
        queueId: source?.queueId ?? null,
        channel: row.channel,
        customerName: row.customer,
        summary: `Follow up with ${row.customer} after a missed interaction on ${row.channel}.`,
      });
    },
    [snapshot?.missed],
  );

  if (loading && !state) {
    return (
      <CopilotWorkspace
        title="Live Monitoring"
        subtitle="Live supervisor view"
        expandedSide={expandedSide}
        onExpandedSideChange={setExpandedSide}
        copilot={<EmbeddedCopilotPanel />}
      >
        <MonitoringPanelSkeleton />
      </CopilotWorkspace>
    );
  }

  if (error && !state) {
    return (
      <CopilotWorkspace
        title="Live Monitoring"
        subtitle="Live supervisor view"
        expandedSide={expandedSide}
        onExpandedSideChange={setExpandedSide}
        copilot={<EmbeddedCopilotPanel />}
      >
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-neutral-800">Live monitoring unavailable</p>
          <p className="mt-1 max-w-sm text-xs text-neutral-600">{error}</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-4 rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-1.5 text-xs font-medium text-neutral-700"
          >
            Retry
          </button>
        </div>
      </CopilotWorkspace>
    );
  }

  if (!state) return null;

  return (
    <CopilotWorkspace
      title="Live Monitoring"
      subtitle="Live supervisor view"
      expandedSide={expandedSide}
      onExpandedSideChange={setExpandedSide}
      copilot={<EmbeddedCopilotPanel />}
    >
      <div className={contentPanelClassName}>
        {tab === "agents" && selectedAgentId && copilotMinimized ? null : (
        <div className={`shrink-0 px-3 pt-3 pb-0 xl:px-4 xl:pt-3.5 xl:pb-3 ${contentPanelHeaderBorderClassName}`}>
          {tab === "agents" && selectedAgentId ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <IconButton
                  variant="ghostIcon"
                  onClick={() => setSelectedAgentId(null)}
                  className="shrink-0 [&_svg]:size-[18px]"
                  aria-label="Back to agents"
                >
                  <ChevronLeft />
                </IconButton>
                <h2 className="truncate text-[18px] font-semibold text-neutral-900">Agent profile</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <PanelRefreshButton onClick={handleRefresh} refreshing={refreshing} />
                <PanelExpandButton side="right" />
              </div>
            </div>
          ) : (
            <>
              <MonitoringListHeader
                tab={tab}
                liveConnected={liveConnected}
                refreshing={refreshing}
                error={error}
                onTabChange={setTab}
                onRefresh={handleRefresh}
              />
            </>
          )}
        </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tab === "agents" ? (
            <MonitoringAgentsTab
              agents={state.agents}
              pulse={pulse}
              selectedAgentId={selectedAgentId}
              onSelectedAgentIdChange={setSelectedAgentId}
              focusAgentId={focusAgentId}
              onFocusAgentHandled={() => setFocusAgentId(null)}
              onSelectConversation={openConversation}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          ) : null}

          {tab === "queues" ? (
            <MonitoringQueuesTab
              queues={state.queues}
              waiting={state.waiting}
              missed={state.missed}
              callbacks={state.callbacks}
              liveConversations={state.liveConversations}
              pulse={pulse}
              focusQueueId={focusQueueId}
              focusWaitingId={focusWaitingId}
              onFocusQueueHandled={() => setFocusQueueId(null)}
              onFocusWaitingHandled={() => setFocusWaitingId(null)}
              onSelectMissed={() => undefined}
              onSelectLive={(row) => {
                setWatchOnly(false);
                setConversationDetail({
                  id: row.id,
                  channel: row.channel,
                  customer: row.customer,
                  durationSeconds: row.durationSeconds,
                  intent: row.intent,
                  sla: row.sla,
                  queue: row.queue,
                  agentName: row.agentName ?? "Unassigned",
                });
                if (row.channel === "voice") void listenToLiveConversation(row.id);
              }}
              onAssignCallbackWaiting={openCallbackForWaiting}
              onAssignCallbackMissed={openCallbackForMissed}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          ) : null}
        </div>
      </div>

      <MonitoringDrawer
        open={Boolean(conversationDetail)}
        title={conversationDetail?.customer ?? "Conversation"}
        subtitle={
          conversationDetail
            ? `${channelLabel(conversationDetail.channel)} · ${conversationDetail.queue}`
            : undefined
        }
        onClose={() => {
          setWatchOnly(false);
          setConversationDetail(null);
        }}
        widthClass="max-w-3xl"
      >
        {conversationDetail ? (
          <ConversationDetailPanel
            detail={conversationDetail}
            watchOnly={watchOnly}
          />
        ) : null}
      </MonitoringDrawer>

      <MonitoringAssignCallbackDialog
        open={Boolean(callbackTarget)}
        snapshot={snapshot}
        target={callbackTarget}
        onClose={() => setCallbackTarget(null)}
        onAssigned={handleRefresh}
      />
    </CopilotWorkspace>
  );
}

function ConversationDetailPanel({
  detail,
  watchOnly = false,
}: {
  detail: ConversationDetail;
  watchOnly?: boolean;
}) {
  const showSupervisorActions = !detail.isPast && detail.channel === "voice";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {detail.channel === "voice" && !detail.isPast ? (
        <MonitoringListenSpeakingCard customer={detail.customer} agentName={detail.agentName} />
      ) : null}
      <div className="shrink-0 rounded-lg border-[0.6px] border-[#bfbfbf] p-3">
        <p className="text-[10px] uppercase tracking-wide text-neutral-600">Agent</p>
        <p className="mt-1 text-sm font-medium text-neutral-900">{detail.agentName}</p>
      </div>

      <MonitoringConversationDetailSections
        conversationId={detail.id}
        isPast={detail.isPast}
        contextRows={
          <>
            <DetailRow label="Channel" value={channelLabel(detail.channel)} />
            <DetailRow label="Subject" value={detail.intent} />
            <DetailRow label="Queue" value={detail.queue} />
            {!detail.isPast ? (
              <div className="flex items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] pb-2 last:border-b-0 last:pb-0">
                <span className="text-xs text-neutral-600">SLA</span>
                <StatusBadge
                  label={
                    detail.sla === "healthy"
                      ? "Healthy"
                      : detail.sla === "at_risk"
                        ? "At Risk"
                        : "Breached"
                  }
                  tone={slaTone(detail.sla)}
                />
              </div>
            ) : null}
          </>
        }
      />

      {showSupervisorActions ? (
        <div className="shrink-0">
          <MonitoringSupervisorActions
            conversationId={detail.id}
            channel={detail.channel}
            watchOnly={watchOnly}
          />
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] pb-2">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className="text-xs font-medium text-neutral-900">{value}</span>
    </div>
  );
}
