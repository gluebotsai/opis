import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAppSelector } from "@/store";
import { normalizeRole } from "@/lib/rbac";
import {
  fetchHomeDashboard,
  refreshFunnelSnapshot,
} from "@/services/home";
import { DashboardAnalyticsPanel } from "@/components/home/DashboardAnalyticsPanel";
import { ReportsPageSkeleton } from "./ReportsPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";

/** Marketing campaign nav only — analytics data comes from the same home API as Dashboard. */
export function ReportsPage() {
  const role = normalizeRole(useAppSelector((s) => s.auth.user?.role));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<
    Awaited<ReturnType<typeof fetchHomeDashboard>>["analytics"] | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHomeDashboard();
      setAnalytics(data.analytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics.");
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (role !== "marketing") {
    return <Navigate to="/dashboard" replace />;
  }

  async function onRefresh() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await refreshFunnelSnapshot();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("Snapshot refreshed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !analytics) {
    return (
      <AgentModuleShell
        moduleId="reports"
        title="Reports & Analytics"
        welcome="I'm your **reports agent**. Ask me about campaign funnel trends or pipeline breakdowns."
        chips={[
          {
            id: "chip-explain",
            label: "Explain these reports",
            prompt: "Explain what these reports are showing me",
          },
        ]}
        surface="list"
        workspaceTitle="Reports & Analytics"
        workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.reportsMarketing}
        workspace={<ReportsPageSkeleton />}
      />
    );
  }

  const workspace = (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {analytics ? (
        <div>
          <DashboardAnalyticsPanel
            analytics={analytics}
            onRefresh={
              analytics.canSeeOrgSnapshot ? () => void onRefresh() : undefined
            }
            refreshing={busy}
            refreshMessage={message}
            refreshError={error}
          />
        </div>
      ) : (
        <p className="mt-8 text-sm text-text-danger">
          {error ?? "No analytics data available."}
        </p>
      )}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="reports"
      title="Reports & Analytics"
      welcome="I'm your **reports agent**. Ask me about campaign funnel trends or pipeline breakdowns."
      chips={[
        {
          id: "chip-explain",
          label: "Explain these reports",
          prompt: "Explain what these reports are showing me",
        },
      ]}
      surface="list"
      workspaceTitle="Reports & Analytics"
      workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.reportsMarketing}
      workspace={workspace}
      onAfterTool={() => void load()}
    />
  );
}
