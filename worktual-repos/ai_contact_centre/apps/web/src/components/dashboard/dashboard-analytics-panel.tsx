import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  LineChart,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { DashboardBarChart } from "@/components/dashboard/dashboard-charts";
import { DashboardForecastChart } from "@/components/dashboard/dashboard-forecast-chart";
import { Button } from "@/components/ui/button";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import {
  dedupeDiagnosticIncidents,
  incidentDisplayLabel,
  type DashboardAnalytics,
  type DiagnosticIncident,
  type DiagnosticWeeklyComparison,
  type PrescriptiveRecommendation,
} from "@/features/dashboard/analytics-api";
import { cn } from "@/lib/utils";

function AnalyticsLayerHeader({
  icon: Icon,
  title,
  description,
  accentClass,
}: {
  icon: typeof Search;
  title: string;
  description: string;
  accentClass: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "flex size-[38px] shrink-0 items-center justify-center rounded-xl",
          accentClass,
        )}
      >
        <Icon className="size-6" strokeWidth={2.25} aria-hidden />
      </div>
      <div>
        <p className="text-[16px] font-semibold text-neutral-900">{title}</p>
        <p className="mt-0.5 text-sm text-neutral-600">{description}</p>
      </div>
    </div>
  );
}

function SeverityBadge({
  severity,
  status,
}: {
  severity: DiagnosticIncident["severity"];
  status: DiagnosticIncident["status"];
}) {
  const styles = {
    critical: "bg-rose-100 text-rose-800",
    high: "bg-rose-50 text-rose-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-blue-50 text-blue-700",
  }[severity];
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", styles)}>
      {status === "active" ? `${severity} · active` : status.replaceAll("_", " ")}
    </span>
  );
}

function RiskBadge({
  tone,
  title,
  detail,
}: {
  tone: "high" | "medium";
  title: string;
  detail: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border-[0.6px] px-3 py-2.5",
        tone === "high"
          ? "border-amber-200 bg-amber-50/70"
          : "border-[#bfbfbf] bg-neutral-50",
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn("mt-0.5 size-3.5 shrink-0", tone === "high" ? "text-amber-600" : "text-neutral-600")}
          aria-hidden
        />
        <div>
          <p className="text-xs font-semibold text-neutral-900">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function PrescriptiveActionCard({
  recommendation,
  onReviewMembers,
  onNavigate,
}: {
  recommendation: PrescriptiveRecommendation;
  onReviewMembers?: (recommendation: PrescriptiveRecommendation) => void;
  onNavigate?: (recommendation: PrescriptiveRecommendation) => void;
}) {
  const priorityStyles = {
    high: "bg-rose-50 text-rose-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-blue-50 text-blue-700",
  }[recommendation.priority];

  return (
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
            priorityStyles,
          )}
        >
          {recommendation.priority} priority
        </span>
        <Sparkles className="size-3.5 shrink-0 text-indigo-400" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-semibold text-neutral-900">{recommendation.title}</p>
      <p className="mt-1 text-xs font-medium text-emerald-700">{recommendation.impact}</p>
      <p className="mt-2 text-xs leading-relaxed text-neutral-600">{recommendation.rationale}</p>
      {recommendation.queue ? (
        <button
          type="button"
          onClick={() => onReviewMembers?.(recommendation)}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          <Users className="size-3.5" aria-hidden />
          {recommendation.queue.currentMemberCount} → {recommendation.queue.suggestedMemberCount} members
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onNavigate?.(recommendation)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
      >
        {recommendation.action}
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function formatWeeklyComparisonLine(comparison: DiagnosticWeeklyComparison): string {
  const changeSuffix =
    comparison.eventCountChangePercent != null
      ? ` (${comparison.eventCountChange >= 0 ? "+" : ""}${comparison.eventCountChangePercent}%)`
      : comparison.eventCountChange !== 0
        ? ` (${comparison.eventCountChange >= 0 ? "+" : ""}${comparison.eventCountChange})`
        : "";
  return `Last 7 days: ${comparison.thisWeek.missedEventCount} missed events vs ${comparison.lastWeek.missedEventCount} in the prior week${changeSuffix}.`;
}

function HealthyState({
  weeklyComparison,
}: {
  weeklyComparison: DiagnosticWeeklyComparison | null;
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-neutral-900">No active incidents</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            Diagnostic checks did not find a material missed-contact spike in the latest window.
          </p>
          {weeklyComparison ? (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              {formatWeeklyComparisonLine(weeklyComparison)}
              {weeklyComparison.highlightScope?.queueName
                ? ` Most activity in ${weeklyComparison.highlightScope.queueName}.`
                : weeklyComparison.highlightScope?.channel &&
                    weeklyComparison.highlightScope.channel !== "all"
                  ? ` Most activity in ${weeklyComparison.highlightScope.channel}.`
                  : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyDataState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50/70 px-4 py-5 text-xs text-neutral-600">
      {label}
    </div>
  );
}

function UpdatingState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-5">
      <div className="flex items-start gap-3">
        <RefreshIcon className="mt-0.5 size-4 animate-spin text-blue-600" />
        <div>
          <p className="text-sm font-semibold text-neutral-900">Analysis in progress</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">{label}</p>
        </div>
      </div>
    </div>
  );
}

export function DashboardAnalyticsPanel({
  data,
  loading = false,
  refreshing = false,
  error = null,
  selectedIncidentId,
  onIncidentSelect,
  onNavigateRecommendation,
}: {
  data: DashboardAnalytics | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  selectedIncidentId?: string | null;
  onIncidentSelect?: (incidentId: string) => void;
  onNavigateRecommendation?: (recommendation: PrescriptiveRecommendation) => void;
}) {
  const [memberDialog, setMemberDialog] = useState<PrescriptiveRecommendation | null>(null);

  const incidents = useMemo(
    () => (data ? dedupeDiagnosticIncidents(data.diagnostic.incidents) : []),
    [data],
  );

  const selectedIncident = useMemo(() => {
    if (!data) return null;
    return (
      incidents.find((incident) => incident.id === selectedIncidentId) ??
      incidents[0] ??
      null
    );
  }, [data, incidents, selectedIncidentId]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!data) {
    return <EmptyDataState label={loading ? "Loading analytics..." : "Analytics unavailable."} />;
  }

  const diagnostic = selectedIncident;
  const predictive = data.predictive;
  const prescriptive = data.prescriptive;
  const hasPersistedUpdate = new Date(data.meta.lastUpdatedAt).getTime() > 0;

  return (
    <div className="@container/analytics space-y-6 bg-white" data-export-body>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 text-xs text-neutral-600">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" aria-hidden />
          {hasPersistedUpdate
            ? `Updated ${new Date(data.meta.lastUpdatedAt).toLocaleString()}`
            : refreshing
              ? "Preparing the first analytics snapshot"
              : "No analytics snapshot generated yet"}
        </span>
        <span className="rounded-full bg-neutral-50 px-2 py-0.5 capitalize text-neutral-600">
          {data.meta.dataStatus.replaceAll("_", " ")}
        </span>
        {data.meta.forecastVersion ? (
          <span className="rounded-full bg-neutral-50 px-2 py-0.5 text-neutral-600">
            {data.meta.forecastVersion}
          </span>
        ) : null}
        {refreshing ? (
          <span className="inline-flex items-center gap-1 text-neutral-600">
            <RefreshIcon className="size-3.5 animate-spin" />
            Updating…
          </span>
        ) : null}
      </div>

      <section className="flex flex-col gap-[16px]">
        <AnalyticsLayerHeader
          icon={Search}
          title="Diagnostic analytics"
          description="What happened and why — root-cause breakdown for anomalies"
          accentClass="bg-blue-50 text-blue-600"
        />

        {incidents.length > 1 ? (
          <div className="flex flex-wrap gap-[16px]">
            {incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => onIncidentSelect?.(incident.id)}
                className={cn(
                  "rounded-full border-[0.6px] px-3 py-1 text-xs font-medium transition-colors",
                  incident.id === selectedIncident?.id
                    ? "border-[#bfbfbf] bg-neutral-100 text-neutral-900"
                    : "border-[#bfbfbf] bg-white text-neutral-600 hover:bg-neutral-50",
                )}
              >
                {incidentDisplayLabel(incident)}
              </button>
            ))}
          </div>
        ) : null}

        {diagnostic ? (
          <>
            <div className="flex flex-col gap-[16px] rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
              <div className="flex items-start justify-between gap-[16px]">
                <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                  <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-neutral-600">
                    {diagnostic.metric}
                  </p>
                  <p className="text-base font-semibold text-neutral-900">{diagnostic.headline}</p>
                  <p className="text-[12px] text-rose-600">{diagnostic.change}</p>
                </div>
                <SeverityBadge severity={diagnostic.severity} status={diagnostic.status} />
              </div>
              <p className="text-sm leading-relaxed text-neutral-600">{diagnostic.summary}</p>
            </div>

            <div className="grid gap-[16px] xl:grid-cols-2">
              <DashboardBarChart
                title="Contributing factors"
                subtitle="Estimated share of the missed-contact spike"
                info="Estimated share of each factor in the missed-contact spike."
                items={diagnostic.factors}
                maxValue={100}
                xAxisLabel="Factor"
                yAxisLabel="Share"
                formatValue={(value) => `${value}%`}
                formatAxisValue={(value) => `${value}%`}
              />

              <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
                <p className="text-sm font-bold capitalize text-neutral-900">Supporting evidence</p>
                <p className="mt-0.5 text-sm text-neutral-600">
                  Signals used to explain the change
                </p>
                <ul className="mt-4 space-y-3">
                  {diagnostic.evidence.map((item) => (
                    <li
                      key={item.label}
                      className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5"
                    >
                      <p className="text-[14px] font-semibold text-neutral-800">{item.label}</p>
                      <p className="mt-0.5 text-[12px] text-neutral-600">{item.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : refreshing && data.meta.dataStatus === "no_data" ? (
          <UpdatingState label="Checking recent missed contacts and operational signals." />
        ) : (
          <HealthyState weeklyComparison={data.diagnostic.weeklyComparison} />
        )}
      </section>

      <section className="space-y-3">
        <AnalyticsLayerHeader
          icon={LineChart}
          title="Predictive analytics"
          description="What is likely to happen next — forecasts and early risk signals"
          accentClass="bg-violet-50 text-violet-600"
        />

        {predictive.volumeForecast.length > 0 ? (
          <>
            <div className="grid grid-cols-2 items-stretch gap-4 @[42rem]/analytics:grid-cols-4">
              <div className="flex min-h-[100px] flex-col rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-neutral-800">Expected contacts</p>
                <p className="mt-auto pt-3 text-[22px] font-bold leading-none tracking-tight tabular-nums text-neutral-900">
                  {predictive.summary.expectedContacts}
                </p>
              </div>
              <div className="flex min-h-[100px] flex-col rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-neutral-800">Peak day</p>
                <p className="mt-auto pt-3 text-[22px] font-bold leading-none tracking-tight tabular-nums text-neutral-900">
                  {predictive.summary.peakDay ?? "—"}
                </p>
              </div>
              <div className="flex min-h-[100px] flex-col rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-neutral-800">Peak hour</p>
                <p className="mt-auto pt-3 text-[22px] font-bold leading-none tracking-tight tabular-nums text-neutral-900">
                  {predictive.summary.peakHour ?? "—"}
                </p>
              </div>
              <div className="flex min-h-[100px] flex-col rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-neutral-800">Busiest queue</p>
                <p className="mt-auto pt-3 text-[22px] font-bold leading-none tracking-tight tabular-nums text-neutral-900">
                  {predictive.summary.busiestQueue?.name ?? "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 @[42rem]/analytics:grid-cols-2">
              <DashboardForecastChart
                title="Conversation volume forecast"
                subtitle="Inbound by day"
                info="Daily inbound conversations — compare what happened with what was forecast."
                points={predictive.volumeForecast}
                yAxisLabel="Inbound conversations"
              />
              <DashboardForecastChart
                title="Missed contact rate forecast"
                subtitle="Missed rate by day"
                info="Share of demand missed each day — compare actual rate with forecast."
                points={predictive.missedRateForecast}
                unit="%"
                yAxisLabel="Missed rate (%)"
              />
            </div>
            {(predictive.hourlyVolume?.points.length ?? 0) > 0 ? (
              <DashboardForecastChart
                title="Inbound volume by hour"
                subtitle={
                  predictive.hourlyVolume?.peakHour
                    ? `Peak hour ${predictive.hourlyVolume.peakHour}`
                    : "Typical hour vs forecast"
                }
                info="Inbound conversations by hour of day over the last 7 days, in the organization timezone, compared with the forecast hourly profile. Peak hour is the hour where that forecast profile is highest."
                points={predictive.hourlyVolume?.points ?? []}
                xAxisLabel="Hour of day"
                yAxisLabel="Inbound conversations"
                highlightLabel={predictive.hourlyVolume?.peakHour ?? undefined}
                highlightSeries={
                  predictive.hourlyVolume?.source === "historical_actual" ? "actual" : "forecast"
                }
              />
            ) : null}

            {predictive.risks.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-neutral-900">Early risk signals</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {predictive.risks.map((risk) => (
                    <RiskBadge key={`${risk.title}-${risk.bucketStart ?? ""}`} {...risk} />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : refreshing ? (
          <UpdatingState label="Building the seven-day seasonal forecast in the background." />
        ) : (
          <EmptyDataState label="Not enough conversation history to generate a forecast yet." />
        )}
      </section>

      <section className="space-y-3">
        <AnalyticsLayerHeader
          icon={BrainCircuit}
          title="Prescriptive analytics"
          description="What to do — ranked actions with expected impact"
          accentClass="bg-emerald-100 text-emerald-600"
        />

        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3">
          <div className="flex items-start gap-2">
            <Target className="mt-0.5 size-4 shrink-0 text-indigo-500" aria-hidden />
            <p className="text-xs leading-relaxed text-neutral-700">
              Recommendations are generated from diagnostic drivers and forecast risk.
              {prescriptive.decision === "no_change"
                ? " The current workforce plan is unchanged."
                : " Review and confirm before applying staffing or routing changes."}
            </p>
          </div>
        </div>

        {prescriptive.recommendations.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {prescriptive.recommendations.map((item) => (
              <PrescriptiveActionCard
                key={`${item.key}-${item.title}`}
                recommendation={item}
                onReviewMembers={setMemberDialog}
                onNavigate={onNavigateRecommendation}
              />
            ))}
          </div>
        ) : refreshing && data.meta.dataStatus === "no_data" ? (
          <UpdatingState label="Recommendations will appear after diagnostic and forecast results are ready." />
        ) : prescriptive.decision === "no_change" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-4 text-xs text-emerald-800">
            No new workforce actions needed. Inputs match the previous effective plan.
          </div>
        ) : (
          <EmptyDataState label="No prescriptive actions are available for the current period." />
        )}
      </section>

      <div className="rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <TrendingUp className="size-3.5 shrink-0" aria-hidden />
          Live analytics from operational data. Diagnostic: {data.meta.sources.diagnostic}. Predictive:{" "}
          {data.meta.sources.predictive}. Prescriptive: {data.meta.sources.prescriptive}.
        </div>
      </div>

      <MemberChangesDialog
        recommendation={memberDialog}
        onClose={() => setMemberDialog(null)}
      />
    </div>
  );
}

function MemberChangesDialog({
  recommendation,
  onClose,
}: {
  recommendation: PrescriptiveRecommendation | null;
  onClose: () => void;
}) {
  if (!recommendation?.queue) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-changes-title"
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id="member-changes-title" className="text-base font-semibold text-neutral-900">
              Workforce member changes
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Review current and suggested queue membership before applying changes.
            </p>
          </div>
          <Button variant="secondary" className="h-[38px] px-2" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2">
            <p className="font-medium text-neutral-900">{recommendation.queue.name}</p>
            <p className="mt-1 text-xs text-neutral-600">
              Current {recommendation.queue.currentMemberCount} members · Suggested{" "}
              {recommendation.queue.suggestedMemberCount}
            </p>
          </div>
          {recommendation.memberChanges?.add.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Proposed additions
              </p>
              <ul className="space-y-2">
                {recommendation.memberChanges.add.map((agent) => (
                  <li
                    key={agent.agentId}
                    className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2"
                  >
                    {agent.displayName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {recommendation.memberChanges?.remove.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                Proposed removals
              </p>
              <ul className="space-y-2">
                {recommendation.memberChanges.remove.map((agent) => (
                  <li
                    key={agent.agentId}
                    className="rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2"
                  >
                    {agent.displayName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
