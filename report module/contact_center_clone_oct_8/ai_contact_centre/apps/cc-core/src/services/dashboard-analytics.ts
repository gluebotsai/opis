import type { DbClient } from "../lib/rls.js";
import { DASHBOARD_ANALYTICS_SCHEMA_VERSION } from "./dashboard-analytics-math.js";
import {
  buildDiagnosticWeeklyComparison,
  dedupeIncidentsByScope,
  refreshDiagnosticIncidents,
  selectIncident,
  storedIncidentToRecord,
} from "./dashboard-analytics-diagnostic.js";
import {
  buildHourlyVolumeChart,
  buildPredictiveAnalytics,
  buildMissedRateForecastChart,
  buildVolumeForecastChart,
  emptyHourlyVolume,
  type HourlyForecastPoint,
} from "./dashboard-analytics-predictive.js";
import { buildPrescriptiveAnalytics } from "./dashboard-analytics-prescriptive.js";
import type {
  AnalyticsDataStatus,
  DashboardAnalyticsResponse,
  ForecastChartPoint,
  HourlyVolumeEvidence,
  PredictiveAnalytics,
  PredictiveRiskSignal,
  PrescriptiveAnalytics,
  PrescriptiveRecommendation,
} from "./dashboard-analytics-types.js";
import { resolvePerformanceWindow, type rangeSchema } from "./reporting.js";
import {
  getDashboardAnalyticsSnapshot,
  getLatestWorkforcePlan,
  type StoredForecastRun,
} from "./dashboard-analytics-storage.js";
import type { z } from "zod";

type DashboardAnalyticsQuery = z.infer<typeof rangeSchema> & {
  incidentId?: string | null;
};

function emptyPredictiveAnalytics(): PredictiveAnalytics {
  return {
    forecastVersion: "none",
    generatedAt: new Date(0).toISOString(),
    historyDays: 56,
    horizon: "7d",
    method: "seasonal_baseline_plus_llm_adjustment",
    summary: {
      expectedContacts: 0,
      peakDay: null,
      peakHour: null,
      busiestChannel: null,
      busiestQueue: null,
    },
    volumeForecast: [],
    missedRateForecast: [],
    hourlyVolume: emptyHourlyVolume(),
    risks: [],
    source: "baseline",
  };
}

function persistedForecastToAnalytics(
  run: StoredForecastRun | null,
  volumeForecast: ForecastChartPoint[] = [],
  missedRateForecast: ForecastChartPoint[] = [],
  hourlyVolume: HourlyVolumeEvidence = emptyHourlyVolume(),
): PredictiveAnalytics {
  if (!run) return emptyPredictiveAnalytics();
  const summary = run.summaryJson;
  return {
    forecastVersion: `volume-${run.forecastDate}`,
    generatedAt: run.generatedAt,
    historyDays: run.historyDays,
    horizon: "7d",
    method: run.method,
    summary: {
      expectedContacts: Number(summary.expectedContacts ?? 0),
      peakDay: typeof summary.peakDay === "string" ? summary.peakDay : null,
      peakHour: hourlyVolume.peakHour,
      busiestChannel:
        typeof summary.busiestChannel === "string" ? summary.busiestChannel : null,
      busiestQueue:
        summary.busiestQueue && typeof summary.busiestQueue === "object"
          ? (summary.busiestQueue as { id: string; name: string })
          : null,
    },
    volumeForecast:
      volumeForecast.length > 0
        ? volumeForecast
        : ((summary.volumeForecast as ForecastChartPoint[] | undefined) ?? []),
    missedRateForecast:
      missedRateForecast.length > 0
        ? missedRateForecast
        : ((summary.missedRateForecast as ForecastChartPoint[] | undefined) ?? []),
    hourlyVolume,
    risks: (summary.risks as PredictiveRiskSignal[] | undefined) ?? [],
    source: run.llmAdjustmentJson ? "nlp" : "baseline",
  };
}

function persistedPlanToAnalytics(
  plan: Awaited<ReturnType<typeof getLatestWorkforcePlan>>,
  forecastVersion: string | null,
): PrescriptiveAnalytics {
  if (!plan) {
    return {
      decision: "no_change",
      planId: null,
      forecastVersion,
      recommendations: [],
      source: "rules",
    };
  }
  return {
    decision: plan.decision,
    planId: plan.id,
    forecastVersion,
    recommendations:
      (plan.planJson.recommendations as PrescriptiveRecommendation[] | undefined) ?? [],
    source: plan.source === "nlp" ? "nlp" : "rules",
  };
}

export async function readDashboardAnalytics(
  db: DbClient,
  organizationId: string,
  query: DashboardAnalyticsQuery,
): Promise<DashboardAnalyticsResponse> {
  const window = resolvePerformanceWindow(query);
  const {
    incidents: storedIncidents,
    forecastRun,
    workforcePlan,
  } = await getDashboardAnalyticsSnapshot(db, organizationId);
  const incidents = dedupeIncidentsByScope(storedIncidents.map(storedIncidentToRecord));
  const selected = selectIncident(incidents, query.incidentId);
  const weeklyComparison = await buildDiagnosticWeeklyComparison(db, organizationId);
  const forecastPoints =
    (forecastRun?.forecastJson.points as HourlyForecastPoint[] | undefined) ?? [];
  let volumeForecast: ForecastChartPoint[] = [];
  let missedRateForecast: ForecastChartPoint[] = [];
  let hourlyVolume = emptyHourlyVolume();
  if (forecastRun) {
    [volumeForecast, missedRateForecast, hourlyVolume] = await Promise.all([
      buildVolumeForecastChart(db, organizationId, forecastPoints),
      buildMissedRateForecastChart(db, organizationId, forecastPoints),
      buildHourlyVolumeChart(db, organizationId, forecastPoints),
    ]);
  }
  const predictive = persistedForecastToAnalytics(
    forecastRun,
    volumeForecast,
    missedRateForecast,
    hourlyVolume,
  );
  const prescriptive = persistedPlanToAnalytics(
    workforcePlan,
    forecastRun ? `volume-${forecastRun.forecastDate}` : null,
  );
  const timestamps = [
    ...storedIncidents.map((incident) => incident.lastDetectedAt),
    forecastRun?.generatedAt,
    workforcePlan?.createdAt,
  ].filter((value): value is string => Boolean(value));
  const lastUpdatedAt =
    timestamps.sort((left, right) => right.localeCompare(left))[0] ??
    new Date(0).toISOString();
  const hasAnyData =
    incidents.length > 0 ||
    predictive.volumeForecast.length > 0 ||
    prescriptive.recommendations.length > 0;
  const ageMs = Date.now() - new Date(lastUpdatedAt).getTime();
  const dataStatus: AnalyticsDataStatus = !hasAnyData
    ? "no_data"
    : ageMs > 24 * 60 * 60 * 1_000
      ? "stale"
      : incidents.length === 0
        ? "healthy"
        : "partial";

  return {
    schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    period: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    diagnostic: {
      incidents,
      selectedIncidentId: selected?.id ?? null,
      healthy: incidents.length === 0,
      weeklyComparison,
    },
    predictive,
    prescriptive,
    meta: {
      lastUpdatedAt,
      dataStatus,
      incidentCount: incidents.length,
      forecastVersion: forecastRun ? `volume-${forecastRun.forecastDate}` : null,
      sources: {
        diagnostic: incidents.some((incident) => incident.source === "nlp")
          ? "nlp"
          : "rules",
        predictive: predictive.source,
        prescriptive: prescriptive.source,
      },
    },
  };
}

export async function refreshDashboardAnalytics(
  db: DbClient,
  organizationId: string,
  query: DashboardAnalyticsQuery,
): Promise<DashboardAnalyticsResponse> {
  const window = resolvePerformanceWindow(query);
  const generatedAt = new Date().toISOString();

  const [diagnosticResult, predictiveResult] = await Promise.all([
    refreshDiagnosticIncidents(db, organizationId),
    buildPredictiveAnalytics(db, organizationId),
  ]);
  const incidents = diagnosticResult.incidents;
  const weeklyComparison = diagnosticResult.weeklyComparison;

  const selected = selectIncident(incidents, query.incidentId);
  const prescriptive = await buildPrescriptiveAnalytics(
    db,
    organizationId,
    predictiveResult.analytics,
    selected,
    predictiveResult.forecastRun,
  );

  const dataStatus: AnalyticsDataStatus =
    incidents.length === 0 && predictiveResult.analytics.volumeForecast.length === 0
      ? "no_data"
      : incidents.length === 0
        ? "healthy"
        : "partial";

  return {
    schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
    generatedAt,
    period: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    diagnostic: {
      incidents,
      selectedIncidentId: selected?.id ?? null,
      healthy: incidents.length === 0,
      weeklyComparison,
    },
    predictive: predictiveResult.analytics,
    prescriptive,
    meta: {
      lastUpdatedAt: generatedAt,
      dataStatus,
      incidentCount: incidents.length,
      forecastVersion: predictiveResult.analytics.forecastVersion,
      sources: {
        diagnostic: incidents.some((incident) => incident.source === "nlp") ? "nlp" : "rules",
        predictive: predictiveResult.analytics.source,
        prescriptive: prescriptive.source,
      },
    },
  };
}
