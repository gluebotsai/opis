import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Gauge,
  LoaderCircle,
  MessagesSquare,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import {
  CopilotWorkspace,
  PanelExpandButton,
  PanelRefreshButton,
} from "@/components/assistant/copilot-workspace";
import {
  CHART_BAR_COLORS,
  CHART_CHANNEL_COLORS,
  DashboardBarChart,
  DashboardChannelChart,
  DashboardKpiCard,
  DashboardSparklineChart,
} from "@/components/dashboard/dashboard-charts";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { PerformanceDateRangeControl } from "@/components/performance/performance-date-range-control";
import { PerformanceExportMenu } from "@/components/performance/performance-export-menu";
import {
  PerformanceExportPreviewDialog,
  type ExportPreviewFormat,
} from "@/components/performance/performance-export-preview-dialog";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import {
  performanceApi,
  type PerformanceOverview,
  type PerformancePeriodSelection,
} from "@/features/performance/api";
import {
  buildDashboardPdfBlob,
  captureElementAsPng,
  downloadCsvText,
  downloadDataUrlAsPng,
  downloadPdfBlob,
  performanceExportFilename,
} from "@/features/performance/performance-export";
import { sentimentChartColor } from "@/features/workspace/sentiment";
import { workspaceChannelMeta } from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";

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

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PerformancePage() {
  const { setPerformancePeriod } = useCopilotPage();
  const [expandedSide, setExpandedSide] = useState<"left" | "right">("right");
  const [selection, setSelection] = useState<PerformancePeriodSelection>({
    mode: "preset",
    range: "30d",
  });
  const [overview, setOverview] = useState<PerformanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"png" | "csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFormat, setPreviewFormat] = useState<ExportPreviewFormat>("png");
  const [previewStatus, setPreviewStatus] = useState<"capturing" | "ready" | "error">("capturing");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewCsvText, setPreviewCsvText] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selection.mode === "preset") {
      setPerformancePeriod({ range: selection.range });
    } else {
      setPerformancePeriod({ start: selection.start, end: selection.end });
    }
    return () => setPerformancePeriod(undefined);
  }, [selection, setPerformancePeriod]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void performanceApi
      .getOverview(selection)
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load performance");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, refreshTick]);

  const periodLabel = useMemo(() => {
    if (!overview) return "";
    const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    return `${formatter.format(new Date(overview.period.start))} – ${formatter.format(
      new Date(overview.period.end),
    )}`;
  }, [overview]);

  async function openPngPreview() {
    const element = exportRef.current;
    if (!element || !overview) return;

    const filename = performanceExportFilename(selection, "png");
    setPreviewFormat("png");
    setPreviewOpen(true);
    setPreviewFilename(filename);
    setPreviewError(null);
    if (previewImageUrl) {
      setPreviewStatus("ready");
      return;
    }

    setPreviewStatus("capturing");
    try {
      setExporting("png");
      const dataUrl = await captureElementAsPng(element);
      setPreviewImageUrl(dataUrl);
      setPreviewStatus("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to generate PNG preview";
      setPreviewStatus("error");
      setPreviewError(message);
      setError(message);
    } finally {
      setExporting(null);
    }
  }

  async function openCsvPreview() {
    if (!overview) return;

    setPreviewFormat("csv");
    setPreviewOpen(true);
    setPreviewFilename(performanceExportFilename(selection, "csv"));
    setPreviewError(null);
    if (previewCsvText) {
      setPreviewStatus("ready");
      return;
    }

    setPreviewStatus("capturing");
    try {
      setExporting("csv");
      const report = await performanceApi.fetchReportCsv(selection);
      setPreviewCsvText(report.text);
      setPreviewFilename(report.filename);
      setPreviewStatus("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to generate CSV preview";
      setPreviewStatus("error");
      setPreviewError(message);
      setError(message);
    } finally {
      setExporting(null);
    }
  }

  async function openPdfPreview() {
    const element = exportRef.current;
    if (!element || !overview) return;

    setPreviewFormat("pdf");
    setPreviewOpen(true);
    setPreviewFilename(performanceExportFilename(selection, "pdf"));
    setPreviewError(null);
    if (previewImageUrl && previewCsvText) {
      setPreviewStatus("ready");
      return;
    }

    setPreviewStatus("capturing");
    try {
      setExporting("pdf");
      const [dataUrl, report] = await Promise.all([
        previewImageUrl
          ? Promise.resolve(previewImageUrl)
          : captureElementAsPng(element),
        previewCsvText
          ? Promise.resolve({ text: previewCsvText })
          : performanceApi.fetchReportCsv(selection),
      ]);
      setPreviewImageUrl(dataUrl);
      setPreviewCsvText(report.text);
      setPreviewStatus("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to generate PDF preview";
      setPreviewStatus("error");
      setPreviewError(message);
      setError(message);
    } finally {
      setExporting(null);
    }
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewStatus("capturing");
    setPreviewImageUrl(null);
    setPreviewCsvText(null);
    setPreviewError(null);
  }

  async function savePreview() {
    if (previewFormat === "csv") {
      if (!previewCsvText) return;
      downloadCsvText(previewCsvText, previewFilename);
      closePreview();
      return;
    }
    if (previewFormat === "pdf") {
      if (!previewImageUrl || !previewCsvText) return;
      const blob = await buildDashboardPdfBlob(previewImageUrl, previewCsvText);
      downloadPdfBlob(blob, previewFilename);
      closePreview();
      return;
    }
    if (!previewImageUrl) return;
    downloadDataUrlAsPng(previewImageUrl, previewFilename);
    closePreview();
  }

  const handledTrend = overview?.kpis.handledChangePercent;

  const handledTrendPoints = useMemo(
    () =>
      overview?.daily.map((point) => ({
        date: point.date,
        label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
          new Date(`${point.date}T00:00:00`),
        ),
        value: point.handled,
      })) ?? [],
    [overview],
  );

  const handleTimeTrendPoints = useMemo(
    () =>
      overview?.daily.map((point) => ({
        date: point.date,
        label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
          new Date(`${point.date}T00:00:00`),
        ),
        value: point.avgHandleSeconds,
      })) ?? [],
    [overview],
  );

  const channelMix = useMemo(
    () =>
      overview?.channels.map((item, index) => ({
        label: item.label,
        value: item.value,
        color: channelColor(item.label, index),
      })) ?? [],
    [overview],
  );

  const agentSentimentMix = useMemo(
    () =>
      overview?.agentSentiment.map((item) => ({
        label: item.label,
        value: item.value,
        color: sentimentChartColor(item.label),
      })) ?? [],
    [overview],
  );

  return (
    <>
      <CopilotWorkspace
      title="My Performance"
      subtitle="Track your workload, response efficiency, and customer outcomes."
      expandedSide={expandedSide}
      onExpandedSideChange={setExpandedSide}
      copilot={<EmbeddedCopilotPanel />}
    >
      <div
        ref={exportRef}
        data-performance-export-root="true"
        className={contentPanelClassName}
      >
        <div
          data-export-header
          className={`flex shrink-0 items-center justify-between gap-3 px-4 py-3 ${contentPanelHeaderBorderClassName}`}
        >
          <div className="hidden min-w-0 xl:block">
            <p className="text-[18px] font-semibold text-neutral-900">Reports</p>
            <p className="mt-0.5 text-sm text-neutral-600">
              {periodLabel || "Your personal contact center results"}
            </p>
          </div>
          <div data-export-ignore="true" className="flex min-w-0 w-full flex-nowrap items-center gap-2 overflow-x-auto xl:w-auto">
            <PerformanceDateRangeControl selection={selection} onChange={setSelection} />
            <PerformanceExportMenu
              disabled={loading || !overview}
              exporting={exporting}
              enableScheduleUi
              scheduleAudience="agent"
              onDownloadReport={() => void openPngPreview()}
            />
            <PanelRefreshButton
              onClick={() => setRefreshTick((tick) => tick + 1)}
              refreshing={loading}
            />
            <PanelExpandButton side="right" />
          </div>
        </div>

        <PanelScrollArea className="px-4 py-4">
          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-neutral-600">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              Loading your performance…
            </div>
          ) : error ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <Activity className="size-7 text-neutral-300" />
              <p className="mt-3 text-sm font-medium text-neutral-800">Performance unavailable</p>
              <p className="mt-1 max-w-sm text-xs text-neutral-600">{error}</p>
            </div>
          ) : overview ? (
            <div className="@container/kpis space-y-6 bg-white" data-export-body>
              <section className="space-y-4">
                <DashboardSectionHeader description="Snapshot of your handled volume and service quality for this period" />
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
                  caption="Completed conversations"
                  trend={
                    handledTrend === null
                      ? { label: "New", positive: true }
                      : {
                          label: `${Math.abs(handledTrend ?? 0)}%`,
                          positive: (handledTrend ?? 0) >= 0,
                        }
                  }
                />
                <DashboardKpiCard
                  icon={CheckCircle2}
                  iconClassName="bg-emerald-100 text-emerald-600"
                  label="Resolution rate"
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
              </section>

              <section className="space-y-3" data-export-main-column>
                <DashboardSectionHeader description="Daily trends for workload and average handle time" />
                <div className="grid grid-cols-1 items-stretch gap-4 @[42rem]/kpis:grid-cols-2 [&>*]:min-w-0">
                  <DashboardSparklineChart
                    title="Daily Handled Trend"
                    subtitle="Handled by day"
                    info="Number of conversations you completed each day in the selected period."
                    points={handledTrendPoints}
                    color="#3b82f6"
                  />
                  <DashboardSparklineChart
                    title="Daily Handle-Time Trend"
                    subtitle="Handle time by day"
                    info="Average time from assignment to conversation end for each day in the selected period."
                    points={handleTimeTrendPoints}
                    summary={formatDuration(overview.kpis.avgHandleSeconds)}
                    formatValue={formatDuration}
                    color="#fdba74"
                  />
                </div>
              </section>

              <section className="@container/breakdowns min-w-0 space-y-4" data-export-breakdowns>
                <DashboardSectionHeader description="Channel mix, conversation tone, and disposition outcomes" />
                <div
                  className="grid min-w-0 grid-cols-1 items-stretch gap-4 @[40rem]/breakdowns:grid-cols-2 [&>*]:min-w-0"
                  data-export-pies
                >
                  <div data-export-channel-mix className="min-w-0">
                    <DashboardChannelChart
                      title="Channel mix"
                      subtitle="Assigned conversations by channel"
                      info="Share of your assigned conversations by channel in the selected period."
                      channels={channelMix}
                      emptyText="No channel data yet"
                    />
                  </div>
                  <div data-export-agent-sentiment className="min-w-0">
                    <DashboardChannelChart
                      title="Agent sentiment mix"
                      subtitle="Your tone across handled conversations"
                      info="Share of your latest agent-tone label per handled conversation in the selected period."
                      channels={agentSentimentMix}
                      emptyText="No sentiment data yet"
                    />
                  </div>
                </div>
                <div
                  className="grid min-w-0 grid-cols-1 items-stretch gap-4 @[40rem]/breakdowns:grid-cols-2 [&>*]:min-w-0"
                  data-export-bars
                >
                  <div data-export-dispositions className="min-w-0 @[40rem]/breakdowns:col-span-2">
                    <DashboardBarChart
                      title="Resolution outcomes"
                      subtitle="Final dispositions for completed work"
                      info="How your completed conversations were dispositioned in the selected period."
                      items={overview.dispositions}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3" data-export-recent>
                <DashboardSectionHeader description="Latest assignments in this period" />
                <div className="overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white">
                <div className="flex items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
                  <p className="text-sm font-semibold text-neutral-900">Recent conversations</p>
                  <span className="text-sm font-medium text-neutral-400">
                    {overview.recent.length} shown
                  </span>
                </div>
                {overview.recent.length ? (
                  <div>
                    {overview.recent.map((conversation) => {
                      const channelLabel = workspaceChannelMeta(conversation.channel).label;

                      return (
                      <div
                        key={conversation.id}
                        className={cn(
                          "grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3",
                          listRowDividerClassName("4"),
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span title={channelLabel} aria-label={channelLabel}>
                              <WorkspaceChannelIcon
                                channel={conversation.channel}
                                className="size-6 shrink-0 rounded-[4px]"
                              />
                            </span>
                            <p className="truncate text-sm font-medium text-neutral-800">
                              {conversation.subject ||
                                conversation.visitorId ||
                                "Customer conversation"}
                            </p>
                          </div>
                          <p className="mt-1 truncate text-sm text-neutral-600">
                            {conversation.disposition ||
                              conversation.resolution ||
                              "No disposition"}{" "}
                            · Assigned {formatDate(conversation.assignedAt)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "self-start rounded-full px-2 py-1 text-sm font-medium",
                            conversation.status === "resolved" ||
                              conversation.status === "closed"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-blue-50 text-blue-700",
                          )}
                        >
                          {titleCase(conversation.status)}
                        </span>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-10 text-center text-sm text-neutral-400">
                    No assigned conversations in this period
                  </div>
                )}
                </div>
              </section>
            </div>
          ) : null}
        </PanelScrollArea>
      </div>
    </CopilotWorkspace>

      <PerformanceExportPreviewDialog
        open={previewOpen}
        format={previewFormat}
        status={previewStatus}
        imageUrl={previewImageUrl}
        csvText={previewCsvText}
        filename={previewFilename}
        error={previewError}
        onFormatChange={(format) => {
          if (format === "png") void openPngPreview();
          else if (format === "csv") void openCsvPreview();
          else void openPdfPreview();
        }}
        onClose={closePreview}
        onSave={savePreview}
      />
    </>
  );
}
