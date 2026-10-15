import { api } from "./api";

export type CoachingInsightSummary = {
  id: string;
  activityId: string;
  contactId: string | null;
  overallImpression: string;
  discoveryQuality: string | null;
  objectionHandling: string | null;
  methodologyNote: string | null;
  talkBalanceNote: string | null;
  strengths: string[];
  growthAreas: string[];
  highlightedMoment: string | null;
  coachingNote: string;
  analyzedAt: string;
};

export type CoachingTrendRow = {
  repUserId: string;
  repName: string;
  strong: number;
  solid: number;
  needsWork: number;
  total: number;
};

export type ReportsResponse = {
  ok: true;
  canSeeOrgSnapshot: boolean;
  generatedAt: string | null;
  payload: Record<string, unknown> | null;
  myCoaching: CoachingInsightSummary[];
  teamCoachingTrends: CoachingTrendRow[] | null;
};

export async function fetchReports() {
  const { data } = await api.get<ReportsResponse>("/api/reports");
  return data;
}

export async function refreshFunnelSnapshot() {
  const { data } = await api.post<
    { ok: true; generatedAt: string } | { ok: false; error: string }
  >("/api/home/analytics/refresh");
  return data;
}
