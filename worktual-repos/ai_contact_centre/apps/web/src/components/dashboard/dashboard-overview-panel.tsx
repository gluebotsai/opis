import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Gauge,
  MessagesSquare,
  Target,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";

import {
  DashboardBarChart,
  DashboardChannelChart,
  DashboardKpiCard,
  DashboardPresenceMixChart,
  DashboardSparklineChart,
  CHART_BAR_COLORS,
  CHART_CHANNEL_COLORS,
} from "@/components/dashboard/dashboard-charts";
import { DashboardOverviewSkeleton } from "@/components/dashboard/dashboard-overview-skeleton";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import type { DashboardOverview } from "@/features/dashboard/api";

const CONVERSATION_CHANNEL_COLORS: Record<string, string> = {
  voice: CHART_CHANNEL_COLORS.voice,
  call: CHART_CHANNEL_COLORS.voice,
  calls: CHART_CHANNEL_COLORS.voice,
  chat: CHART_CHANNEL_COLORS.chat,
  webchat: CHART_CHANNEL_COLORS.chat,
  email: CHART_CHANNEL_COLORS.email,
  whatsapp: CHART_CHANNEL_COLORS.whatsapp,
  instagram: "#ec4899",
  facebook: "#1877f2",
};

function channelColor(channel: string, index: number): string {
  const key = channel.trim().toLowerCase();
  return (
    CONVERSATION_CHANNEL_COLORS[key] ??
    CHART_BAR_COLORS[index % CHART_BAR_COLORS.length] ??
    "#2563eb"
  );
}

function channelNameFromRow(
  row: { label: string; channel?: string; handler?: "ai" | "agent" },
): string {
  return row.channel ?? row.label.split(" · ")[0]?.trim() ?? row.label;
}

function handlerFromRow(
  row: { label: string; handler?: "ai" | "agent" },
): "ai" | "agent" {
  if (row.handler) return row.handler;
  return row.label.includes("Agent") ? "agent" : "ai";
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function slaRateValue(kpis: { slaRate: number; firstResponseCount: number }): string {
  return kpis.firstResponseCount > 0 ? `${kpis.slaRate}%` : "—";
}

function slaRateCaption(kpis: { firstResponseCount: number; withinSlaCount: number }): string {
  return kpis.firstResponseCount > 0
    ? `${kpis.withinSlaCount} of ${kpis.firstResponseCount} first replies`
    : "No first replies in period";
}

type DashboardOverviewPanelProps = {
  overview: DashboardOverview | null;
  loading: boolean;
  error: string | null;
};

export function DashboardOverviewPanel({ overview, loading, error }: DashboardOverviewPanelProps) {
  const handledTrend = useMemo(
    () =>
      overview?.daily.map((point) => ({
        date: point.date,
        label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
          new Date(`${point.date}T12:00:00`),
        ),
        value: point.handled,
      })) ?? [],
    [overview],
  );

  const handleTimeTrend = useMemo(
    () =>
      overview?.daily.map((point) => ({
        date: point.date,
        label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
          new Date(`${point.date}T12:00:00`),
        ),
        value: point.avgHandleSeconds,
      })) ?? [],
    [overview],
  );

  const { aiChannelMix, agentChannelMix } = useMemo(() => {
    const ai: Array<{ label: string; value: number; color: string }> = [];
    const agent: Array<{ label: string; value: number; color: string }> = [];
    const colorIndex = new Map<string, number>();

    for (const row of overview?.channels ?? []) {
      const name = channelNameFromRow(row);
      const index = colorIndex.get(name) ?? colorIndex.size;
      colorIndex.set(name, index);
      const slice = {
        label: name,
        value: row.value,
        color: channelColor(name, index),
      };
      if (handlerFromRow(row) === "agent") {
        agent.push(slice);
      } else {
        ai.push(slice);
      }
    }

    return { aiChannelMix: ai, agentChannelMix: agent };
  }, [overview]);

  const dispositionBars = useMemo(
    () =>
      (overview?.dispositions ?? []).map((item) => ({
        label: item.label,
        value: item.value,
      })),
    [overview],
  );

  const avgDailyHandled = useMemo(() => {
    if (!overview?.daily.length) return 0;
    const daysWithVolume = overview.daily.filter((point) => point.handled > 0).length;
    if (!daysWithVolume) return 0;
    return Math.round(overview.kpis.handled / daysWithVolume);
  }, [overview]);

  const activeChannels = useMemo(
    () => (overview?.channels ?? []).filter((channel) => channel.value > 0).length,
    [overview],
  );

  if (loading) {
    return <DashboardOverviewSkeleton />;
  }

  if (error) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <Activity className="size-7 text-neutral-300" />
        <p className="mt-3 text-sm font-medium text-neutral-800">Dashboard unavailable</p>
        <p className="mt-1 max-w-sm text-xs text-neutral-600">{error}</p>
      </div>
    );
  }

  if (!overview) return null;

  const handledChange = overview.kpis.handledChangePercent;

  return (
    <div className="@container/kpis space-y-6 bg-white" data-export-body>
      <section className="space-y-4">
        <DashboardSectionHeader description="Snapshot of handled volume and service quality for this period" />
        <div
          className="grid grid-cols-2 items-stretch gap-x-4 gap-y-4 @[42rem]/kpis:grid-cols-3"
          data-export-kpis
        >
          <DashboardKpiCard
            icon={MessagesSquare}
            iconClassName="bg-blue-100 text-blue-600"
            label="Handled Volume"
            info="Total conversations handled by agents in the selected period, compared with the prior period."
            value={overview.kpis.handled}
            caption="vs prior period"
            trend={
              handledChange === null
                ? { label: "New", positive: true }
                : {
                    label: `${Math.abs(handledChange ?? 0)}%`,
                    positive: (handledChange ?? 0) >= 0,
                  }
            }
          />
          <DashboardKpiCard
            icon={CheckCircle2}
            iconClassName="bg-emerald-100 text-emerald-600"
            label="Resolution Rate"
            info="Share of handled conversations that were resolved in the selected period."
            value={`${overview.kpis.resolutionRate}%`}
            caption="Resolved from handled"
          />
          <DashboardKpiCard
            icon={Clock3}
            iconClassName="bg-cyan-100 text-cyan-600"
            label="Avg First Response"
            info="Average time from assignment to the agent's first reply. Shown as — when no conversations in the period have both timestamps. Values under 0.5s round to 0s."
            value={formatDuration(overview.kpis.avgFirstResponseSeconds)}
            caption={
              overview.kpis.avgFirstResponseSeconds == null
                ? "No first replies in period"
                : "Average after assignment"
            }
          />
          <DashboardKpiCard
            icon={Gauge}
            iconClassName="bg-violet-100 text-violet-600"
            label="Avg Handle Time"
            info="Average time from assignment until the conversation was closed or handed off. Shown as — when no conversations in the period have both assignment and end timestamps."
            value={formatDuration(overview.kpis.avgHandleSeconds)}
            caption={
              overview.kpis.avgHandleSeconds == null
                ? "No completed handles in period"
                : "Average assigned to end"
            }
          />
          <DashboardKpiCard
            icon={Target}
            iconClassName="bg-amber-100 text-amber-600"
            label="First-Reply SLA"
            info="Percentage of first replies sent within 60 seconds of assignment. Shown as — when no conversations in the period have a first reply."
            value={slaRateValue(overview.kpis)}
            caption={slaRateCaption(overview.kpis)}
          />
          <DashboardKpiCard
            icon={ArrowUpRight}
            iconClassName="bg-rose-100 text-rose-600"
            label="Hand-offs"
            info="Conversations transferred or handed off to another queue or agent."
            value={overview.kpis.transferred}
            caption="Conversations handed off"
          />
        </div>

        <div className="grid grid-cols-2 items-stretch gap-x-4 gap-y-4">
          <DashboardKpiCard
            icon={CheckCircle2}
            iconClassName="bg-teal-100 text-teal-600"
            label="Resolved"
            info="Total conversations closed with a resolution in the selected period."
            value={overview.kpis.resolved}
            caption="Closed with resolution"
          />
          <DashboardKpiCard
            icon={TrendingUp}
            iconClassName="bg-indigo-100 text-indigo-600"
            label="Daily Avg Handled"
            info="Average handled conversations per day across active channels in the selected period."
            value={avgDailyHandled}
            caption={`Across ${activeChannels} active channel${activeChannels === 1 ? "" : "s"}`}
          />
        </div>
      </section>

      <section className="space-y-3" data-export-main-column>
        <DashboardSectionHeader description="Daily trends for workload and average handle time" />
        <div className="grid grid-cols-1 gap-4 @[42rem]/kpis:grid-cols-2">
          <DashboardSparklineChart
            title="Daily Handled Trend"
            subtitle="Handled by day"
            info="Number of conversations handled by agents each day in the selected period."
            points={handledTrend}
            color="#3b82f6"
            xAxisLabel="Date"
            yAxisLabel="Handled conversations"
          />
          <DashboardSparklineChart
            title="Daily Handle-Time Trend"
            subtitle="Handle time by day"
            info="Average time from assignment to conversation end for each day in the selected period."
            points={handleTimeTrend}
            summary={formatDuration(overview.kpis.avgHandleSeconds)}
            formatValue={formatDuration}
            formatAxisValue={(seconds) => `${Math.round(seconds / 3600)}h`}
            color="#fdba74"
            xAxisLabel="Date"
            yAxisLabel="Average handle time"
          />
        </div>
      </section>

      <section className="@container/breakdowns min-w-0 space-y-4" data-export-breakdowns>
        <DashboardSectionHeader description="Channel mix, agent presence, and disposition outcomes" />
        <div
          className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,347px),1fr))] items-stretch gap-4 [&>*]:min-w-0"
          data-export-pies
        >
          <DashboardChannelChart
            title="AI channel mix"
            subtitle="Volume by channel — AI handled"
            info="Share of AI-handled conversation volume by channel in the selected period."
            channels={aiChannelMix}
            emptyText="No AI conversations"
          />
          <DashboardChannelChart
            title="Support Agent channel mix"
            subtitle="Volume by channel — support agent handled"
            info="Share of support-agent-handled conversation volume by channel in the selected period."
            channels={agentChannelMix}
            emptyText="No agent conversations"
          />
        </div>
        <div
          className="grid min-w-0 grid-cols-1 items-stretch gap-4 @[56rem]/breakdowns:grid-cols-2 [&>*]:min-w-0"
          data-export-bars
        >
          <DashboardPresenceMixChart
            title="Agent presence mix"
            subtitle="Average time in each on-duty state — all agents"
            info="Average time agents spent in each on-duty presence state during the selected period."
            slices={overview.presenceMix ?? []}
            emptyText="No agent presence history for this period"
          />
          <DashboardBarChart
            title="Disposition outcomes"
            subtitle="How conversations were closed"
            info="Final disposition labels applied when conversations were closed in the selected period."
            items={dispositionBars}
          />
        </div>
      </section>
    </div>
  );
}
