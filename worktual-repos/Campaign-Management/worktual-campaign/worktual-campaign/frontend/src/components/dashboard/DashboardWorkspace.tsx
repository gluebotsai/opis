import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import {
  AnalyticsVisual,
  deriveVisualFromFindings,
  type StructuredAnalytics,
} from "@/components/analytics/AnalyticsVisual";
import {
  ContentPanelShell,
  CopilotChatShell,
  CopilotWorkspace,
} from "@/components/assistant/copilot-workspace";
import { DashboardOverviewPanel } from "@/components/dashboard/DashboardOverviewPanel";
import { DashboardPeriodMenu } from "@/components/dashboard/DashboardPeriodMenu";
import { ReportsCampaignMonitoringPane } from "@/components/campaigns/ReportsCampaignMonitoringPane";
import { EventsTrackingPane } from "@/components/campaigns/EventsTrackingPane";
import { useLoadOnce } from "@/hooks/useLoadOnce";
import { useAgentNavigation } from "@/hooks/use-agent-navigation";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import {
  handoffJoinPayload,
  handoffSourceLabel,
  readChatHandoff,
  type HandoffMessage,
} from "@/lib/chat-handoff";
import {
  campaignInPerformanceRange,
  channelAllowed,
  configuredAgentChannelSet,
  buildDashboardPeriodPayload,
  dashboardActivitySeriesFilter,
  dashboardPeriodToAgentFilter,
  formatChannel,
  isPpcOnlyCampaign,
  isRanCampaignStatus,
  loadDashboardBundle,
  dailyTrendForRange,
  rangeLabel,
  rollupChannels,
  rollupChannelsFromList,
  rollupKey,
  shouldShowPausedAlert,
  sumListMetricsTrackedEngagement,
  type PerformanceCustomRange,
  type PerformanceRange,
  type PausedAlert,
} from "@/lib/dashboard-metrics";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  getCampaignProfile,
  subscribeActivePack,
} from "@/lib/industry-packs";
import {
  claimedCreateCampaignSocketSession,
  emitJoinSession,
  emitLeaveSession,
  emitUpdateDashboardPeriod,
} from "@/lib/agents-join";
import {
  applySessionReadyChatMessages,
  isAgentBusyError,
  isHydrationSessionReady,
} from "@/lib/agents-chat-runtime";
import { pickModuleWelcome } from "@/lib/module-welcomes";
import { buildDashboardSnapshot } from "@/lib/dashboard-snapshot";
import { buildEventsSnapshot } from "@/lib/events-snapshot";
import { isCampaignSessionAccessDenied } from "@/lib/create-campaign-active-session";
import {
  createFreshDashboardSessionId,
  getOrCreateDashboardSessionId,
} from "@/lib/dashboard-agent-session";
import { getToken } from "@/services/api";
import {
  fetchCampaignOpsFeed,
  subscribeCampaignOpsFeedStream,
  type CampaignOpsFeedPayload,
  fetchPortfolioPerformance,
  type ActiveLiveSendRow,
  type ActivitySeriesPoint,
  type PortfolioTotalsApi,
} from "@/services/campaigns.service";
import { getAgentsSocket } from "@/services/agents.socket";
import {
  isConfigChannelHidden,
  isConfigurationUiHidden,
} from "@/lib/campaign-channels";
import {
  formatHubOnDemandBrief,
  mapApiRunToOnDemandRun,
} from "@/lib/on-demand-sends-mock";
import { listOnDemandRunsApi } from "@/services/on-demand.service";

type DashboardPanelView = "overview" | "campaigns" | "events";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  analytics?: StructuredAnalytics | null;
  suggestions?: string[];
};

const DASHBOARD_AGENT_MODULE = "reports";

function dashboardStaticWelcomeMessage(): ChatMessage {
  return {
    id: `welcome-dashboard-${crypto.randomUUID()}`,
    role: "assistant",
    text: pickModuleWelcome("dashboard"),
  };
}

function collapseDuplicateAssistant(rows: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === "assistant" &&
      row.role === "assistant" &&
      prev.text.trim() === row.text.trim()
    ) {
      continue;
    }
    // Parallel join race can append two different LLM greets before any user turn.
    if (
      prev &&
      prev.role === "assistant" &&
      row.role === "assistant" &&
      !prev.analytics &&
      !row.analytics &&
      out.every((m) => m.role === "assistant")
    ) {
      out[out.length - 1] = row;
      continue;
    }
    out.push(row);
  }
  return out;
}

function analyticsForChat(
  raw: StructuredAnalytics | undefined | null,
): StructuredAnalytics | null {
  if (!raw) return null;
  if (raw.include_visual === false) return null;
  if (raw.visual?.kind) return deriveVisualFromFindings(raw);
  return null;
}

function toLocalMessages(
  rows: Array<{
    id?: string;
    role?: string;
    text?: string;
    meta?: { analytics?: StructuredAnalytics; suggestions?: string[] };
    analytics?: StructuredAnalytics;
    suggestions?: string[];
  }>,
): ChatMessage[] {
  return collapseDuplicateAssistant(
    rows
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const rawAnalytics =
          m.analytics ||
          (m.meta && typeof m.meta === "object" ? m.meta.analytics : undefined);
        const analytics = analyticsForChat(rawAnalytics);
        const suggestions =
          m.suggestions ||
          (m.meta && typeof m.meta === "object" ? m.meta.suggestions : undefined);
        return {
          id: m.id || crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          text: m.text || "",
          analytics: analytics || null,
          suggestions: Array.isArray(suggestions) ? suggestions : undefined,
        };
      }),
  );
}

/**
 * Dashboard = co-worker chat (reports agent) + campaign Overview panel.
 */
export function DashboardWorkspace() {
  const handoffRef = useRef(readChatHandoff(DASHBOARD_AGENT_MODULE));
  const carried = handoffRef.current;

  const [chatSessionId, setChatSessionId] = useState(() =>
    getOrCreateDashboardSessionId(),
  );
  const chatSessionIdRef = useRef(chatSessionId);
  chatSessionIdRef.current = chatSessionId;
  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );
  const [expandedSide, setExpandedSide] = useState<"left" | "right">("right");
  const [range, setRange] = useState<PerformanceRange>("weekly");
  const [customRange, setCustomRange] = useState<PerformanceCustomRange | null>(
    null,
  );

  const { data, error, loading, reload } = useLoadOnce(
    () => loadDashboardBundle(),
    [packId],
  );

  const periodAgentFilter = useMemo(
    () => dashboardPeriodToAgentFilter(range, customRange),
    [range, customRange],
  );

  const configuredChannels = useMemo(
    () => configuredAgentChannelSet(data?.configChannels),
    [data?.configChannels],
  );

  const activitySeriesFilter = useMemo(
    () =>
      dashboardActivitySeriesFilter(
        range,
        customRange,
        (data?.allList ?? []).filter((r) => !isPpcOnlyCampaign(r)),
      ),
    [range, customRange, data?.allList],
  );

  const { data: opsFeed, reload: reloadOpsFeed } = useLoadOnce(
    () =>
      fetchCampaignOpsFeed({
        relative: activitySeriesFilter.relative,
        from: periodAgentFilter.from_date,
        to: periodAgentFilter.to_date,
        activityFrom: activitySeriesFilter.activity_from,
        activityTo: activitySeriesFilter.activity_to,
        liveLimit: 8,
        failureLimit: 6,
      }),
    [
      packId,
      periodAgentFilter.relative,
      periodAgentFilter.from_date,
      periodAgentFilter.to_date,
      activitySeriesFilter.relative,
      activitySeriesFilter.activity_from,
      activitySeriesFilter.activity_to,
    ],
  );

  const { data: performanceSnapshot, reload: reloadPortfolio } = useLoadOnce(
    () =>
      fetchPortfolioPerformance({
        mode: "launch",
        relative: periodAgentFilter.relative,
        from: periodAgentFilter.from_date,
        to: periodAgentFilter.to_date,
        activityFrom: activitySeriesFilter.activity_from,
        activityTo: activitySeriesFilter.activity_to,
      }),
    [
      packId,
      periodAgentFilter.relative,
      periodAgentFilter.from_date,
      periodAgentFilter.to_date,
      activitySeriesFilter.activity_from,
      activitySeriesFilter.activity_to,
    ],
  );

  const { data: onDemandRuns } = useLoadOnce(async () => {
    try {
      return await listOnDemandRunsApi();
    } catch {
      return [];
    }
  }, [packId]);

  const hubOnDemand = useMemo(() => {
    const mapped = (onDemandRuns || []).map((row) => {
      try {
        return mapApiRunToOnDemandRun(row);
      } catch {
        return null;
      }
    }).filter(Boolean) as ReturnType<typeof mapApiRunToOnDemandRun>[];

    const hubish = mapped.filter(
      (r) => r.source === "hub" || r.source === "spoke",
    );
    const pool = hubish.length ? hubish : mapped;
    const latest = pool[0] || null;
    return {
      count: pool.length,
      latest: latest
        ? {
            id: latest.id,
            title: latest.title,
            brief: formatHubOnDemandBrief(latest),
            createdAt: latest.createdAt,
          }
        : null,
    };
  }, [onDemandRuns]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void reload();
      void reloadPortfolio();
      void reloadOpsFeed();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [reload, reloadPortfolio, reloadOpsFeed]);

  const [opsFeedStream, setOpsFeedStream] =
    useState<CampaignOpsFeedPayload | null>(null);

  useEffect(() => {
    setOpsFeedStream(null);
    return subscribeCampaignOpsFeedStream(
      {
        relative: activitySeriesFilter.relative,
        from: periodAgentFilter.from_date,
        to: periodAgentFilter.to_date,
        activityFrom: activitySeriesFilter.activity_from,
        activityTo: activitySeriesFilter.activity_to,
        liveLimit: 8,
        failureLimit: 6,
      },
      setOpsFeedStream,
    );
  }, [
    periodAgentFilter.from_date,
    periodAgentFilter.to_date,
    activitySeriesFilter.relative,
    activitySeriesFilter.activity_from,
    activitySeriesFilter.activity_to,
  ]);

  const opsFeedEffective = opsFeedStream ?? opsFeed;
  const liveSendCount = opsFeedEffective?.activeSends?.length ?? 0;

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (carried?.messages?.length) {
      return carried.messages.map((m) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        text: m.text,
      }));
    }
    return [dashboardStaticWelcomeMessage()];
  });
  const messagesRef = useRef<HandoffMessage[]>([]);
  messagesRef.current = messages;
  useAgentNavigation({
    sessionId: chatSessionId,
    module: DASHBOARD_AGENT_MODULE,
    getMessages: () => messagesRef.current,
  });
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
  const rangeRef = useRef(range);
  const customRangeRef = useRef(customRange);
  rangeRef.current = range;
  customRangeRef.current = customRange;

  const criticalConfig = useMemo(() => {
    if (isConfigurationUiHidden()) return [];
    return (data?.configChannels || []).filter(
      (c) => c.status === "blocked" && !isConfigChannelHidden(c.channel),
    );
  }, [data?.configChannels]);

  const rangedList = useMemo(() => {
    return (data?.allList || []).filter((row) =>
      campaignInPerformanceRange(row, range, customRange),
    );
  }, [data?.allList, range, customRange]);

  const rangedDetails = useMemo(() => {
    const rangedIds = new Set(rangedList.map((row) => row.id));
    return (data?.details || []).filter((camp) => rangedIds.has(camp.id));
  }, [data?.details, rangedList]);

  const pausedAlerts = useMemo(() => {
    const rows: PausedAlert[] = [];
    for (const camp of rangedDetails) {
      for (const ch of camp.channels ?? []) {
        if (!channelAllowed(rollupKey(ch.channel), configuredChannels)) continue;
        if (!shouldShowPausedAlert(camp, ch)) continue;
        rows.push({
          campaignId: camp.id,
          campaignName: camp.name,
          channel: formatChannel(ch.channel),
          reason: ch.pauseReason,
          pausedAt: ch.pausedAt ?? null,
        });
      }
    }
    return rows;
  }, [rangedDetails, configuredChannels]);

  const kpis = useMemo(() => {
    const messagingList = rangedList.filter((r) => !isPpcOnlyCampaign(r));
    const liveInRange = messagingList.filter(
      (r) => String(r.status).toLowerCase() === "live",
    );
    const scheduledInRange = messagingList.filter(
      (r) => String(r.status).toLowerCase() === "scheduled",
    );
    const completedInRange = messagingList.filter(
      (r) => String(r.status).toLowerCase() === "completed",
    );
    const ranInRange = messagingList.filter((r) =>
      isRanCampaignStatus(r.status),
    );
    const api: PortfolioTotalsApi | undefined = performanceSnapshot?.totals;
    if (api) {
      return {
        liveCount: api.live_count,
        scheduledCount: api.scheduled_count,
        completedCount: api.completed_count ?? completedInRange.length,
        ranCount: api.campaigns_ran ?? ranInRange.length,
        campaignsWithSend: api.campaigns_with_send ?? 0,
        campaignsWithFailure: api.campaigns_with_failure ?? 0,
        messagesSent: api.sent,
        messagesFailed: api.failed,
        sent: api.sent,
        failed: api.failed,
        stubSent: api.stub_sent ?? 0,
        opens: api.opens,
        clicks: api.clicks,
        totalOpens: api.total_opens ?? api.opens,
        totalClicks: api.total_clicks ?? api.clicks,
        openRate:
          api.open_rate_pct != null ? api.open_rate_pct / 100 : null,
        clickRate:
          api.click_rate_pct != null ? api.click_rate_pct / 100 : null,
        ctor: api.ctor_pct != null ? api.ctor_pct / 100 : null,
        trackedSent: api.open_tracked_delivered ?? 0,
        clickTrackedSent: api.click_tracked_delivered ?? 0,
      };
    }
    const metrics = sumListMetricsTrackedEngagement(ranInRange, null);
    return {
      liveCount: liveInRange.length,
      scheduledCount: scheduledInRange.length,
      completedCount: completedInRange.length,
      ranCount: ranInRange.length,
      campaignsWithSend: ranInRange.filter((r) => (r.sent ?? 0) > 0).length,
      campaignsWithFailure: ranInRange.filter((r) => (r.failed ?? 0) > 0).length,
      messagesSent: metrics.sent,
      messagesFailed: metrics.failed,
      ...metrics,
    };
  }, [rangedList, configuredChannels, performanceSnapshot?.totals]);

  const channelRollup = useMemo(() => {
    const apiRollup = performanceSnapshot?.totals?.channel_rollup;
    if (apiRollup?.length) {
      return apiRollup.map((row) => ({
        key: rollupKey(row.channel) || row.channel,
        label: formatChannel(row.channel),
        sent: row.delivered ?? row.sent,
        opens: row.opens,
        clicks: row.clicks,
        failed: row.failed,
        stubSent: row.stubSent ?? 0,
        impressions: 0,
        spend: 0,
        conversions: 0,
        currency: null as string | null,
        campaigns: row.campaigns,
      }));
    }
    const fromList = rollupChannelsFromList(rangedList);
    const raw =
      fromList.some(
        (r) =>
          r.sent > 0 ||
          r.impressions > 0 ||
          r.spend > 0 ||
          r.stubSent > 0 ||
          r.opens > 0,
      )
        ? fromList
        : rollupChannels(rangedDetails);
    return raw;
  }, [
    rangedList,
    rangedDetails,
    performanceSnapshot?.totals?.channel_rollup,
  ]);

  const dailyTrend = useMemo(() => {
    const server =
      performanceSnapshot?.activitySeries?.length
        ? performanceSnapshot.activitySeries
        : opsFeedEffective?.activitySeries;
    if (Array.isArray(server) && server.length > 0) {
      return server.map((row: ActivitySeriesPoint) => ({
        date: row.date,
        label:
          row.label ||
          new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
          }).format(new Date(`${row.date}T12:00:00`)),
        sent: row.sent ?? 0,
        failed: row.failed ?? 0,
        opens: row.opens ?? 0,
        clicks: row.clicks ?? 0,
      }));
    }
    const daily =
      data && "daily" in data && Array.isArray(data.daily) ? data.daily : [];
    return dailyTrendForRange(daily, range, customRange);
  }, [
    performanceSnapshot?.activitySeries,
    opsFeedEffective?.activitySeries,
    data,
    range,
    customRange,
  ]);

  const monitoringCampaigns = useMemo(() => {
    return rangedList.filter((r) => !isPpcOnlyCampaign(r));
  }, [rangedList]);

  const hasAttention =
    pausedAlerts.length > 0 || criticalConfig.length > 0;

  const [panelView, setPanelView] = useState<DashboardPanelView>("overview");
  const [eventsInitialId, setEventsInitialId] = useState<string | null>(null);
  const [, setSearchParams] = useSearchParams();

  const openCampaignMonitoring = (
    campaignId?: string,
    status?: string,
    forceTab?: "live" | "scheduled" | "past" | "on-demand" | "personalised-crm",
  ) => {
    setEventsInitialId(null);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        const tab =
          forceTab ||
          (String(status || "").toLowerCase() === "scheduled"
            ? "scheduled"
            : String(status || "").toLowerCase() === "completed"
              ? "past"
              : "live");
        n.set("tab", tab);
        if (campaignId) n.set("id", campaignId);
        else n.delete("id");
        n.delete("from");
        return n;
      },
      { replace: true },
    );
    setPanelView("campaigns");
  };

  const openEventsTracking = (eventId?: string) => {
    setEventsInitialId(eventId || null);
    setPanelView("events");
  };

  const backToOverview = () => {
    setEventsInitialId(null);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("tab");
        n.delete("id");
        return n;
      },
      { replace: true },
    );
    setPanelView("overview");
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for your Worktual co-worker.");
      return;
    }
    sessionReadyRef.current = false;
    const socket = getAgentsSocket();
    setSocketError(null);

    const sameSession = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!payload.session_id || payload.session_id !== chatSessionId) return false;
      if (payload.module && payload.module !== DASHBOARD_AGENT_MODULE) return false;
      return true;
    };

    const onReady = (payload: {
      session_id?: string;
      module?: string;
      ready_phase?: string;
      messages?: Array<{ id?: string; role?: string; text?: string }>;
    }) => {
      if (!sameSession(payload)) return;
      const followUpReady = sessionReadyRef.current;
      sessionReadyRef.current = true;
      const rows = toLocalMessages(payload.messages || []);
      if (!rows.length) return;
      const hydration = isHydrationSessionReady(payload);
      const busy = sendingRef.current || typingRef.current;
      setMessages((prev) => {
        const merged = applySessionReadyChatMessages(prev, rows, {
          busy,
          followUpReady,
          hydration,
        });
        if (merged === prev) return prev;
        const byId = new Map(prev.map((m) => [m.id, m]));
        return merged.map((m) => {
          if (m.analytics?.visual) return m;
          const local = byId.get(m.id);
          if (local?.analytics?.visual) {
            return {
              ...m,
              analytics: local.analytics,
              suggestions: local.suggestions ?? m.suggestions,
            };
          }
          return m;
        });
      });
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      text?: string;
      analytics?: StructuredAnalytics;
      suggestions?: string[];
    }) => {
      if (payload.session_id && payload.session_id !== chatSessionId) return;
      const text = payload.text || "";
      if (!text && !payload.analytics) return;
      const analytics = analyticsForChat(payload.analytics);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last?.role === "assistant" &&
          last.text.trim() === text.trim() &&
          !analytics
        ) {
          return prev;
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text,
            analytics,
            suggestions: Array.isArray(payload.suggestions)
              ? payload.suggestions
              : undefined,
          },
        ];
      });
      setTyping(false);
      setSending(false);
      if (analytics?.visual) {
        void reload();
      }
    };

    const onTyping = (payload: {
      session_id?: string;
      typing?: boolean;
    }) => {
      if (payload.session_id && payload.session_id !== chatSessionId) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) setSending(false);
    };

    const onError = (payload: {
      message?: string;
      session_id?: string;
      code?: string;
    }) => {
      if (
        payload.session_id &&
        payload.session_id !== chatSessionIdRef.current
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
        const nextId = createFreshDashboardSessionId();
        setChatSessionId(nextId);
        setMessages([dashboardStaticWelcomeMessage()]);
        setTyping(false);
        setSending(false);
        setSocketError(null);
        return;
      }
      setSocketError(payload.message || "Co-worker error");
      setTyping(false);
      setSending(false);
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("agent_error", onError);
    socket.on("error", onError);

    let cancelled = false;
    let disposeJoin = () => {};
    void (async () => {
      const [snap, events_snapshot] = await Promise.all([
        buildDashboardSnapshot({
          range: rangeRef.current,
          customRange: customRangeRef.current,
          periodLabel: rangeLabel(rangeRef.current, customRangeRef.current),
          campaigns: data?.allList,
        }).catch(() => null),
        buildEventsSnapshot(),
      ]);
      if (cancelled) return;
      if (claimedCreateCampaignSocketSession()) return;
      disposeJoin = emitJoinSession(socket, {
        session_id: chatSessionId,
        token,
        module: DASHBOARD_AGENT_MODULE,
        skip_welcome: true,
        campaign_profile: getCampaignProfile(),
        dashboard_period: buildDashboardPeriodPayload(
          rangeRef.current,
          customRangeRef.current,
          data?.allList ?? [],
        ),
        ...(snap ? { dashboard_snapshot: snap } : {}),
        events_snapshot,
        ...handoffJoinPayload(carried),
      });
    })();

    return () => {
      cancelled = true;
      disposeJoin();
      const leavingId = chatSessionIdRef.current;
      if (leavingId && token && !claimedCreateCampaignSocketSession()) {
        emitLeaveSession(socket, leavingId, DASHBOARD_AGENT_MODULE);
      }
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("agent_error", onError);
      socket.off("error", onError);
    };
  }, [chatSessionId, reload, data?.allList]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    let disposePeriodEmit = () => {};
    void (async () => {
      const [snap, events_snapshot] = await Promise.all([
        buildDashboardSnapshot({
          range,
          customRange,
          periodLabel: rangeLabel(range, customRange),
          campaigns: data?.allList,
        }).catch(() => null),
        buildEventsSnapshot(),
      ]);
      if (cancelled) return;
      if (claimedCreateCampaignSocketSession()) return;
      disposePeriodEmit = emitUpdateDashboardPeriod(getAgentsSocket(), {
        session_id: chatSessionId,
        token,
        module: DASHBOARD_AGENT_MODULE,
        dashboard_period: buildDashboardPeriodPayload(
          range,
          customRange,
          data?.allList ?? [],
        ),
        ...(snap ? { dashboard_snapshot: snap } : {}),
        events_snapshot,
      });
    })();
    return () => {
      cancelled = true;
      disposePeriodEmit();
    };
  }, [chatSessionId, range, customRange, data?.allList]);

  const busy = sending || typing;

  const send = (text: string) => {
    const token = getToken();
    if (!token || !text.trim() || busy) return;
    const trimmed = text.trim();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: trimmed },
    ]);
    setInput("");
    setSending(true);
    setTyping(true);
    getAgentsSocket().emit("user_message", {
      session_id: chatSessionId,
      token,
      module: DASHBOARD_AGENT_MODULE,
      text: trimmed,
      campaign_profile: getCampaignProfile(),
      dashboard_period: buildDashboardPeriodPayload(
        range,
        customRange,
        data?.allList ?? [],
      ),
    });
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", { session_id: chatSessionId });
    setTyping(false);
    setSending(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const restartChat = () => {
    const token = getToken();
    if (!token) return;
    getAgentsSocket().emit("leave_session", {
      session_id: chatSessionId,
      token,
      module: DASHBOARD_AGENT_MODULE,
    });
    const nextId = createFreshDashboardSessionId();
    setChatSessionId(nextId);
    setMessages([dashboardStaticWelcomeMessage()]);
    setInput("");
    setTyping(false);
    setSending(false);
    setSocketError(null);
  };

  const periodControl = (
    <DashboardPeriodMenu
      range={range}
      customRange={customRange}
      onChange={(next, custom) => {
        setRange(next);
        setCustomRange(custom);
      }}
    />
  );

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
          <p className="text-sm text-neutral-500">
            Ask about campaigns launched today or in another period — sent,
            failed, open rate, click rate, or who was delivered. Overview on the
            right matches{" "}
            {rangeLabel(range, customRange).toLowerCase()}.
          </p>
        ) : null}
        {collapseDuplicateAssistant(messages).map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <div className={chatBubbleClass(m.role)}>
              <ChatBubbleText text={m.text} role={m.role} />
              {m.role === "assistant" && m.analytics?.visual ? (
                <AnalyticsVisual analytics={m.analytics} />
              ) : null}
              {m.role === "assistant" && m.suggestions?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => send(s)}
                      className="rounded-full border border-border-default bg-white px-2.5 py-1 text-[11px] text-neutral-700 hover:bg-subtle disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? <AgentThinkingIndicator /> : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );

  const chatFooter = (
    <AgentChatComposer
      value={input}
      onChange={setInput}
      onSend={() => send(input)}
      onStop={stopGeneration}
      busy={busy}
      inputRef={inputRef}
      placeholder="Ask about campaigns…"
      className="w-full"
      maxWidthClass=""
    />
  );

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
              footer={chatFooter}
            >
              {chatMessages}
            </CopilotChatShell>
          }
        >
          <ContentPanelShell
            title={
              panelView === "campaigns"
                ? "Campaign monitoring"
                : panelView === "events"
                  ? "Events tracking"
                  : "Overview"
            }
            headerActions={
              panelView === "overview" ? (
                periodControl
              ) : (
                <button
                  type="button"
                  onClick={backToOverview}
                  className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  <ArrowLeft className="size-[18px]" strokeWidth={2.25} />
                  Back
                </button>
              )
            }
            className="border-[0.6px] border-[#bfbfbf] bg-white shadow-none"
          >
            {panelView === "overview" ? (
              <div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto bg-white">
                <DashboardOverviewPanel
                  loading={loading && !data}
                  error={error}
                  range={range}
                  customRange={customRange}
                  kpis={kpis}
                  channelRollup={channelRollup}
                  dailyTrend={dailyTrend}
                  monitoringCampaigns={monitoringCampaigns}
                  pausedAlerts={pausedAlerts}
                  criticalConfig={criticalConfig}
                  hasAttention={hasAttention}
                  synthetic={Boolean(
                    data && "synthetic" in data && data.synthetic,
                  )}
                  hubOnDemand={hubOnDemand}
                  activeLiveSends={
                    (opsFeedEffective?.activeSends ?? []) as ActiveLiveSendRow[]
                  }
                  onOpenCampaignMonitoring={() => openCampaignMonitoring()}
                  onOpenHubOnDemand={() =>
                    openCampaignMonitoring(undefined, undefined, "on-demand")
                  }
                  onOpenEventsTracking={() => openEventsTracking()}
                  onSelectMonitoringCampaign={(id) => {
                    const row = monitoringCampaigns.find((c) => c.id === id);
                    openCampaignMonitoring(id, row?.status);
                  }}
                  onSelectEvent={(id) => openEventsTracking(id)}
                />
              </div>
            ) : panelView === "campaigns" ? (
              <div className="min-h-0 flex-1 overflow-hidden bg-white">
                <ReportsCampaignMonitoringPane />
              </div>
            ) : (
              <div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto bg-white p-3 sm:p-4">
                <EventsTrackingPane
                  initialEventId={eventsInitialId}
                  onOpenDraft={(id) => openEventsTracking(id)}
                />
              </div>
            )}
          </ContentPanelShell>
        </CopilotWorkspace>
      </div>
    </div>
  );
}
