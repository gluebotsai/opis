import { api } from "./api";

export type LeadSummaryCitation = {
  text: string;
  sourceKind: "activity" | "omni" | "score";
  sourceId: string | null;
  activityType: string | null;
  conversationId: string | null;
};

export type LeadSummaryView = {
  summary: string;
  headline: string | null;
  intent: string | null;
  recommendedAction?: string | null;
  citations?: LeadSummaryCitation[];
  omniChannelSummary?: string | null;
  source: string;
  updatedAt: string;
};

export type LeadScoreStatusView = {
  status: string | null;
  score: number | null;
  fitScore: number | null;
  intentScore: number | null;
  scoreDelta: number | null;
  grade: string | null;
  band: string | null;
  rationale: string | null;
  factors: string[];
  positiveReasons: string[];
  negativeReasons: string[];
  behaviouralPositiveReasons: string[];
  behaviouralNegativeReasons: string[];
  behaviouralReasons: string[];
  pillars: {
    demographics: number;
    firmographics: number;
    behavioural: number;
  } | null;
  nextBestAction: string | null;
  salesReady: boolean;
  previousScore: number | null;
  updatedAt: string | null;
  source?: string | null;
} | null;

/** Keep the number on screen while a rescore is still running. */
export function mergeLeadScoreStatus(
  previous: LeadScoreStatusView,
  next: LeadScoreStatusView,
): LeadScoreStatusView {
  if (!next) return previous;
  const carriedScore =
    next.score ?? next.previousScore ?? previous?.score ?? previous?.previousScore ?? null;
  if (!previous) {
    return carriedScore == null || carriedScore === next.score
      ? next
      : { ...next, score: carriedScore };
  }
  const inFlight =
    next.status === "pending" ||
    next.status === "scoring" ||
    next.status === "queued";
  if (!inFlight && next.score != null) return next;
  return {
    ...next,
    score: carriedScore,
    fitScore: next.fitScore ?? previous.fitScore,
    intentScore: next.intentScore ?? previous.intentScore,
    grade: next.grade ?? previous.grade,
    band: next.band ?? previous.band,
    rationale: next.rationale ?? previous.rationale,
  };
}

export type LeadSummaryResponse =
  | { ok: true; summary: LeadSummaryView | null; scoreStatus: LeadScoreStatusView }
  | { ok: false; error: string };

export async function fetchLeadSummary(
  contactId: string,
  options?: { force?: boolean },
) {
  const { data } = await api.get<LeadSummaryResponse>(
    `/api/contacts/${contactId}/summary`,
    options?.force ? { params: { force: "1" } } : undefined,
  );
  return data;
}

export async function refreshLeadSummary(contactId: string) {
  const { data } = await api.post<LeadSummaryResponse>(
    `/api/contacts/${contactId}/summary/refresh`,
  );
  return data;
}

export async function draftNbaFollowUpEmail(
  contactId: string,
  nextBestAction: string,
) {
  const { data } = await api.post<
    | { ok: true; subject: string; body: string }
    | { ok: false; error: string }
  >(`/api/contacts/${contactId}/follow-up-draft`, { nextBestAction });
  return data;
}

export async function setManualLeadScore(
  contactId: string,
  input: { score: number; reason: string },
) {
  const { data } = await api.post<
    | { ok: true; score: number; summary: LeadSummaryView }
    | { ok: false; error: string }
  >(`/api/contacts/${contactId}/lead-score`, input);
  return data;
}
