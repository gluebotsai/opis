export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "candidate" | "active" | "cooling" | "resolved";
export type AnalyticsSource = "nlp" | "rules" | "baseline" | "baseline_fallback";
export type RiskLevel = "low" | "medium" | "high";
export type PrescriptivePriority = "high" | "medium" | "low";
export type AnalyticsDataStatus = "healthy" | "partial" | "no_data" | "stale" | "error";

export type DiagnosticDriver = {
  key: string;
  label: string;
  count: number;
  share: number;
};

export type DiagnosticEvidence = {
  label: string;
  detail: string;
};

export type DiagnosticWeeklyWindowStats = {
  windowStart: string;
  windowEnd: string;
  missedEventCount: number;
  uniqueMissedConversations: number;
  agentDemandConversations: number;
  missedContactRate: number | null;
};

export type DiagnosticWeeklyComparison = {
  thisWeek: DiagnosticWeeklyWindowStats;
  lastWeek: DiagnosticWeeklyWindowStats;
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

export type DiagnosticIncidentFacts = {
  windowStart: string;
  windowEnd: string;
  channel: string;
  queueId: string | null;
  queueName: string | null;
  agentDemandConversations: number;
  uniqueMissedConversations: number;
  missedEventCount: number;
  missedContactRate: number;
  readyAgentsAverage: number | null;
  oldestWaitSeconds: number | null;
  topDriver: string;
  drivers: DiagnosticDriver[];
  unrecoveredMissedContacts?: number;
};

export type DiagnosticBaselineFacts = {
  method: string;
  lookbackDays: number;
  missedContactRate: number;
  uniqueMissedConversations: number;
  missedEventCount?: number;
  readyAgentsAverage: number | null;
  oldestWaitSeconds: number | null;
  robustZScore: number;
};

export type DiagnosticIncidentRecord = {
  id: string;
  fingerprint: string;
  version: number;
  status: IncidentStatus;
  severity: IncidentSeverity;
  incidentType: string;
  metric: string;
  headline: string;
  change: string;
  summary: string;
  factors: Array<{ label: string; value: number }>;
  evidence: DiagnosticEvidence[];
  source: AnalyticsSource;
  generatedAt: string;
  scope: {
    channel: string;
    queueId: string | null;
    queueName: string | null;
  };
  currentFacts: DiagnosticIncidentFacts;
  baselineFacts: DiagnosticBaselineFacts;
};

export type ForecastChartPoint = {
  label: string;
  actual?: number;
  forecast?: number;
};

export type HourlyVolumeSource = "forecast_expected" | "historical_actual";

export type HourlyVolumeEvidence = {
  points: ForecastChartPoint[];
  peakHour: string | null;
  observedPeakHour: string | null;
  timeZone: string;
  source: HourlyVolumeSource;
  windowDays: number;
  supportingHours: ForecastChartPoint[];
};

export type PredictiveRiskSignal = {
  tone: "high" | "medium";
  title: string;
  detail: string;
  queueId?: string | null;
  bucketStart?: string;
};

export type PredictiveSummary = {
  expectedContacts: number;
  peakDay: string | null;
  peakHour: string | null;
  busiestChannel: string | null;
  busiestQueue: { id: string; name: string } | null;
};

export type PredictiveAnalytics = {
  forecastVersion: string;
  generatedAt: string;
  historyDays: number;
  horizon: string;
  method: string;
  summary: PredictiveSummary;
  volumeForecast: ForecastChartPoint[];
  missedRateForecast: ForecastChartPoint[];
  hourlyVolume: HourlyVolumeEvidence;
  risks: PredictiveRiskSignal[];
  source: AnalyticsSource;
};

export type PrescriptiveMemberChange = {
  agentId: string;
  displayName: string;
};

export type PrescriptiveRecommendation = {
  key: string;
  priority: PrescriptivePriority;
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
    add: PrescriptiveMemberChange[];
    remove: PrescriptiveMemberChange[];
  };
  destination?: {
    type: string;
    queueId?: string;
  };
};

export type PrescriptiveAnalytics = {
  decision: "update" | "no_change";
  planId: string | null;
  forecastVersion: string | null;
  recommendations: PrescriptiveRecommendation[];
  source: AnalyticsSource;
};

export type DashboardAnalyticsResponse = {
  schemaVersion: number;
  generatedAt: string;
  period: { start: string; end: string };
  diagnostic: {
    incidents: DiagnosticIncidentRecord[];
    selectedIncidentId: string | null;
    healthy: boolean;
    weeklyComparison: DiagnosticWeeklyComparison | null;
  };
  predictive: PredictiveAnalytics;
  prescriptive: PrescriptiveAnalytics;
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
