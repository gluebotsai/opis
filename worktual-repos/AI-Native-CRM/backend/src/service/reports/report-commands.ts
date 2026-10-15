/**
 * Framework-agnostic reports commands for Fastify Wave 10.
 */

import { canViewAllRecords } from "@/service/auth/rbac";
import { getCurrentUserRole } from "@/service/auth/require-role";
import {
  generateFunnelSnapshot,
  loadDashboardAnalytics,
  type FunnelSnapshotPayload,
  type CoachingInsightSummary,
  type CoachingTrendRow,
} from "@/dao/reports/report-service";

export type ReportsPayload = {
  canSeeOrgSnapshot: boolean;
  generatedAt: string | null;
  payload: FunnelSnapshotPayload | Record<string, unknown> | null;
  /** Sales & Pre-sales Coach Agent — own coaching feed, private by construction. */
  myCoaching: CoachingInsightSummary[];
  /** Manager/admin only — aggregate counts, never raw coaching text. */
  teamCoachingTrends: CoachingTrendRow[] | null;
};

export async function getReportsCommand(): Promise<ReportsPayload> {
  const analytics = await loadDashboardAnalytics();
  const snap = analytics.funnelSnapshot;
  const payload: FunnelSnapshotPayload | Record<string, unknown> | null = snap
    ? {
        leadsByStatus: {},
        dealsByStage: snap.dealsByStage,
        wonCount: snap.wonCount,
        lostCount: snap.lostCount,
        lostReasons: snap.lostReasons,
        quoteCounts: snap.quoteCounts,
        invoiceCounts: snap.invoiceCounts,
        generatedAt: snap.generatedAt ?? new Date().toISOString(),
      }
    : null;

  return {
    canSeeOrgSnapshot: analytics.canSeeOrgSnapshot,
    generatedAt: snap?.generatedAt ?? null,
    payload,
    myCoaching: analytics.myCoaching,
    teamCoachingTrends: analytics.teamCoachingTrends,
  };
}

export async function refreshFunnelSnapshotCommand(): Promise<
  | { ok: true; generatedAt: string }
  | { ok: false; error: string }
> {
  const role = await getCurrentUserRole();
  if (!canViewAllRecords(role)) {
    return {
      ok: false,
      error: "Only admins and managers can refresh org snapshots.",
    };
  }
  const snapshot = await generateFunnelSnapshot();
  return { ok: true, generatedAt: snapshot.generatedAt.toISOString() };
}
