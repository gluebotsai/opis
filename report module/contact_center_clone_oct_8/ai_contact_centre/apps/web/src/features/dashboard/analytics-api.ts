import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import type { PerformancePeriodSelection } from "@/features/performance/api";

export type AnalyticsIncidentSeverity = "low" | "medium" | "high" | "critical";
export type AnalyticsIncidentStatus = "candidate" | "active" | "cooling" | "resolved";
export type AnalyticsSource = "nlp" | "rules" | "baseline" | "baseline_fallback";
export type AnalyticsDataStatus = "healthy" | "partial" | "no_data" | "stale" | "error";

export type DiagnosticWeeklyComparison = {
  thisWeek: {
    windowStart: string;
    windowEnd: string;
    missedEventCount: number;
    uniqueMissedConversations: number;
    agentDemandConversations: number;
    missedContactRate: number | null;
  };
  lastWeek: {
    windowStart: string;
    windowEnd: string;
    missedEventCount: number;
    uniqueMissedConversations: number;
    agentDemandConversations: number;
    missedContactRate: number | null;
  };
  eventCountChange: number;
  eventCountChangePercent: number | null;
  rateDeltaPoints: number | null;
  trend: "up" | "down" | "flat";
  highlightScope: {
    channel: string;
    queueId: string | null;
    queueName: string | null;
  } | null;
};

export type DiagnosticIncident = {
  id: string;
  fingerprint: string;
  version: number;
  status: AnalyticsIncidentStatus;
  severity: AnalyticsIncidentSeverity;
  incidentType: string;
  metric: string;
  headline: string;
  change: string;
  summary: string;
  factors: Array<{ label: string; value: number }>;
  evidence: Array<{ label: string; detail: string }>;
  source: AnalyticsSource;
  generatedAt: string;
  scope: {
    channel: string;
    queueId: string | null;
    queueName: string | null;
  };
};

const INCIDENT_SEVERITY_RANK: Record<AnalyticsIncidentSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function incidentDisplayLabel(incident: Pick<DiagnosticIncident, "scope">): string {
  if (incident.scope.channel === "all") return "all";
  return incident.scope.queueName ?? incident.scope.channel;
}

function incidentDedupeKey(incident: Pick<DiagnosticIncident, "scope">): string {
  if (incident.scope.channel === "all") return "org";
  return `label:${incidentDisplayLabel(incident).toLowerCase()}`;
}

function shouldPreferIncident(
  challenger: Pick<DiagnosticIncident, "severity" | "incidentType">,
  incumbent: Pick<DiagnosticIncident, "severity" | "incidentType">,
): boolean {
  const challengerRank = INCIDENT_SEVERITY_RANK[challenger.severity];
  const incumbentRank = INCIDENT_SEVERITY_RANK[incumbent.severity];
  if (challengerRank !== incumbentRank) {
    return challengerRank > incumbentRank;
  }
  return (
    challenger.incidentType === "weekly_missed_contact_spike" &&
    incumbent.incidentType !== "weekly_missed_contact_spike"
  );
}

export function dedupeDiagnosticIncidents(incidents: DiagnosticIncident[]): DiagnosticIncident[] {
  const byScope = new Map<string, DiagnosticIncident>();
  for (const incident of incidents) {
    const key = incidentDedupeKey(incident);
    const existing = byScope.get(key);
    if (!existing || shouldPreferIncident(incident, existing)) {
      byScope.set(key, incident);
    }
  }
  return [...byScope.values()].sort(
    (left, right) => INCIDENT_SEVERITY_RANK[right.severity] - INCIDENT_SEVERITY_RANK[left.severity],
  );
}

export type ForecastChartPoint = {
  label: string;
  actual?: number;
  forecast?: number;
};

export type HourlyVolumeEvidence = {
  points: ForecastChartPoint[];
  peakHour: string | null;
  observedPeakHour?: string | null;
  timeZone?: string;
  source: "forecast_expected" | "historical_actual";
  windowDays: number;
  supportingHours: ForecastChartPoint[];
};

export type PredictiveRisk = {
  tone: "high" | "medium";
  title: string;
  detail: string;
  queueId?: string | null;
  bucketStart?: string;
};

export type PrescriptiveRecommendation = {
  key: string;
  priority: "high" | "medium" | "low";
  title: string;
  impact: string;
  rationale: string;
  action: string;
  impactStatus: "not_calibrated" | "estimated";
  window?: string;
  queue?: {
    id: string;
    name: string;
    currentMemberCount: number;
    suggestedMemberCount: number;
  };
  memberChanges?: {
    add: Array<{ agentId: string; displayName: string }>;
    remove: Array<{ agentId: string; displayName: string }>;
  };
  destination?: {
    type: string;
    queueId?: string;
  };
};

export type DashboardAnalytics = {
  schemaVersion: number;
  generatedAt: string;
  period: { start: string; end: string };
  diagnostic: {
    incidents: DiagnosticIncident[];
    selectedIncidentId: string | null;
    healthy: boolean;
    weeklyComparison: DiagnosticWeeklyComparison | null;
  };
  predictive: {
    forecastVersion: string;
    generatedAt: string;
    historyDays: number;
    horizon: string;
    method: string;
    summary: {
      expectedContacts: number;
      peakDay: string | null;
      peakHour: string | null;
      busiestChannel: string | null;
      busiestQueue: { id: string; name: string } | null;
    };
    volumeForecast: ForecastChartPoint[];
    missedRateForecast: ForecastChartPoint[];
    hourlyVolume?: HourlyVolumeEvidence;
    risks: PredictiveRisk[];
    source: AnalyticsSource;
  };
  prescriptive: {
    decision: "update" | "no_change";
    planId: string | null;
    forecastVersion: string | null;
    recommendations: PrescriptiveRecommendation[];
    source: AnalyticsSource;
  };
  meta: {
    lastUpdatedAt: string;
    dataStatus: AnalyticsDataStatus;
    incidentCount: number;
    forecastVersion: string | null;
    sources: {
      diagnostic: AnalyticsSource;
      predictive: AnalyticsSource;
      prescriptive: AnalyticsSource;
    };
  };
};

function selectionParams(selection: PerformancePeriodSelection, incidentId?: string | null) {
  const params =
    selection.mode === "preset"
      ? { range: selection.range }
      : { start: selection.start, end: selection.end };
  return incidentId ? { ...params, incidentId } : params;
}

export const dashboardAnalyticsApi = {
  async getAnalytics(
    selection: PerformancePeriodSelection,
    incidentId?: string | null,
  ): Promise<DashboardAnalytics> {
    const { data } = await ccCoreHttp.get<DashboardAnalytics>(apiV1("/dashboard/analytics"), {
      params: selectionParams(selection, incidentId),
    });
    return data;
  },

  async requestRefresh(selection: PerformancePeriodSelection): Promise<"queued" | "running"> {
    const { data } = await ccCoreHttp.post<{ status: "queued" | "running" }>(
      apiV1("/dashboard/analytics/refresh"),
      undefined,
      { params: selectionParams(selection) },
    );
    return data.status;
  },

  async getRefreshStatus(): Promise<{ running: boolean }> {
    const { data } = await ccCoreHttp.get<{ running: boolean }>(
      apiV1("/dashboard/analytics/refresh-status"),
    );
    return data;
  },
};
