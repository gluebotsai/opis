import { DASHBOARD_ANALYTICS_PROMPT_VERSION } from "./dashboard-analytics-math.js";
import type {
  DiagnosticBaselineFacts,
  DiagnosticIncidentFacts,
  IncidentSeverity,
} from "./dashboard-analytics-types.js";

const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const DIAGNOSTIC_TIMEOUT_MS = 8_000;
const FORECAST_TIMEOUT_MS = 12_000;
const WORKFORCE_TIMEOUT_MS = 8_000;

type DiagnosticReviewRequest = {
  fingerprint: string;
  incidentType: string;
  severity: IncidentSeverity;
  persistenceBuckets: number;
  detectorReasons: string[];
  previousIncident: {
    version: number;
    severity: IncidentSeverity;
    headline: string;
    topDriver: string;
    missedContactRate: number;
    uniqueMissedConversations: number;
  } | null;
  currentFacts: DiagnosticIncidentFacts;
  baselineFacts: DiagnosticBaselineFacts;
};

export type DiagnosticReviewResult = {
  decision: "update" | "no_change";
  headline?: string;
  summary?: string;
  modelName?: string | null;
};

export type ForecastAdjustmentResult = {
  decision: "adjust" | "no_adjustment";
  organizationDailyMultipliers?: Array<{ date: string; multiplier: number }>;
  scopeAdjustments?: Array<{
    scopeType: "queue" | "channel" | "organization";
    scopeId: string;
    date: string;
    startHour: number;
    endHour: number;
    multiplier: number;
    evidenceIds: string[];
  }>;
  peakWindows?: Array<{
    date: string;
    startHour: number;
    endHour: number;
    scopeId?: string;
  }>;
  riskLabels?: Array<{
    scopeId: string;
    risk: "low" | "medium" | "high";
    evidenceIds: string[];
  }>;
  summary?: string;
  modelName?: string | null;
};

export type WorkforcePlanResult = {
  decision: "update" | "no_change";
  planFingerprint?: string;
  queuePlans?: Array<{
    queueId: string;
    queueName: string;
    channel: string;
    window: string;
    priority: "high" | "medium" | "low";
    currentMemberCount: number;
    suggestedMemberCount: number;
    addAgents: Array<{ agentId: string; reasonCodes: string[] }>;
    removeAgents: Array<{ agentId: string; reasonCodes: string[] }>;
    rationale: string;
    confidence: "low" | "medium" | "high";
  }>;
  reason?: string;
  modelName?: string | null;
};

function internalHeaders(organizationId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }
  return headers;
}

export async function fetchDiagnosticReview(
  organizationId: string,
  payload: DiagnosticReviewRequest,
): Promise<DiagnosticReviewResult | null> {
  try {
    const response = await fetch(
      `${NLP_SERVICE_URL}/internal/v1/dashboard-analytics/diagnostic-review`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        body: JSON.stringify({
          schemaVersion: 1,
          promptVersion: DASHBOARD_ANALYTICS_PROMPT_VERSION,
          task: "review_diagnostic_candidate",
          candidate: {
            fingerprint: payload.fingerprint,
            incidentType: payload.incidentType,
            severity: payload.severity,
            persistenceBuckets: payload.persistenceBuckets,
            detectorReasons: payload.detectorReasons,
          },
          previousIncident: payload.previousIncident,
          currentFacts: payload.currentFacts,
          baselineFacts: payload.baselineFacts,
          allowedEvidenceIds: [
            "rate_delta",
            "top_driver",
            "ready_coverage",
            "oldest_wait",
            "peak_queue",
          ],
          allowedRecommendationKeys: [
            "increase_ready_coverage",
            "review_offer_timeout",
            "configure_overflow",
            "assign_callbacks",
          ],
        }),
      },
    );
    if (!response.ok) return null;
    const result = (await response.json()) as DiagnosticReviewResult & { modelName?: string };
    if (result.decision !== "update" && result.decision !== "no_change") return null;
    return result;
  } catch {
    return null;
  }
}

export async function fetchForecastAdjustment(
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<ForecastAdjustmentResult | null> {
  try {
    const response = await fetch(
      `${NLP_SERVICE_URL}/internal/v1/dashboard-analytics/forecast-adjustment`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS),
        body: JSON.stringify({
          schemaVersion: 1,
          promptVersion: DASHBOARD_ANALYTICS_PROMPT_VERSION,
          task: "adjust_seven_day_contact_forecast",
          ...payload,
        }),
      },
    );
    if (!response.ok) return null;
    const result = (await response.json()) as ForecastAdjustmentResult;
    if (result.decision !== "adjust" && result.decision !== "no_adjustment") return null;
    return result;
  } catch {
    return null;
  }
}

export async function fetchWorkforcePlan(
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<WorkforcePlanResult | null> {
  try {
    const response = await fetch(
      `${NLP_SERVICE_URL}/internal/v1/dashboard-analytics/workforce-plan`,
      {
        method: "POST",
        headers: internalHeaders(organizationId),
        signal: AbortSignal.timeout(WORKFORCE_TIMEOUT_MS),
        body: JSON.stringify({
          schemaVersion: 1,
          promptVersion: DASHBOARD_ANALYTICS_PROMPT_VERSION,
          task: "build_daily_workforce_plan",
          ...payload,
        }),
      },
    );
    if (!response.ok) return null;
    const result = (await response.json()) as WorkforcePlanResult;
    if (result.decision !== "update" && result.decision !== "no_change") return null;
    return result;
  } catch {
    return null;
  }
}
