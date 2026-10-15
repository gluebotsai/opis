import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { CopilotWorkspace, PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { DashboardAnalyticsPanel } from "@/components/dashboard/dashboard-analytics-panel";
import { DashboardAnalyticsSkeleton } from "@/components/dashboard/dashboard-analytics-skeleton";
import { DashboardViewToggle } from "@/components/dashboard/dashboard-view-toggle";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import {
  dashboardAnalyticsApi,
  type DashboardAnalytics,
  type PrescriptiveRecommendation,
} from "@/features/dashboard/analytics-api";
import type { PerformancePeriodSelection } from "@/features/performance/api";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { useAuth } from "@/hooks/use-auth";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";

const DEFAULT_PERIOD: PerformancePeriodSelection = { mode: "preset", range: "7d" };
const REFRESH_POLL_INTERVAL_MS = 3_000;
const MAX_REFRESH_POLLS = 25;
/** Background analytics sweeper cadence. */
const BACKGROUND_SWEEP_INTERVAL_MS = 10_000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function DashboardAnalyticsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { setIncidentId, setPerformancePeriod } = useCopilotPage();
  const [expandedSide, setExpandedSide] = useState<"left" | "right">("right");
  const [period] = useState<PerformancePeriodSelection>(DEFAULT_PERIOD);
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);

  useEffect(() => {
    setPerformancePeriod(
      period.mode === "preset"
        ? { range: period.range }
        : { start: period.start, end: period.end },
    );
    return () => setPerformancePeriod(undefined);
  }, [period, setPerformancePeriod]);

  useEffect(() => {
    setIncidentId(selectedIncidentId ?? undefined);
    return () => setIncidentId(undefined);
  }, [selectedIncidentId, setIncidentId]);

  const loadSnapshot = useCallback(async () => {
    const response = await dashboardAnalyticsApi.getAnalytics(period);
    if (mountedRef.current) {
      setData(response);
      setSelectedIncidentId((current) => {
        if (current && response.diagnostic.incidents.some((incident) => incident.id === current)) {
          return current;
        }
        return response.diagnostic.selectedIncidentId;
      });
    }
    return response;
  }, [period]);

  const refreshInBackground = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await dashboardAnalyticsApi.requestRefresh(period);
      for (let poll = 0; poll < MAX_REFRESH_POLLS; poll += 1) {
        await wait(REFRESH_POLL_INTERVAL_MS);
        await loadSnapshot();
        const status = await dashboardAnalyticsApi.getRefreshStatus();
        if (!status.running) break;
      }
    } catch {
      // Keep the last persisted snapshot visible when a background refresh fails.
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadSnapshot, period]);

  useEffect(() => {
    mountedRef.current = true;
    async function initialize() {
      setLoading(true);
      setError(null);
      try {
        await loadSnapshot();
      } catch (loadError) {
        if (!mountedRef.current) return;
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load dashboard analytics.",
        );
      } finally {
        if (mountedRef.current) setLoading(false);
      }
      if (mountedRef.current) void refreshInBackground();
    }
    void initialize();

    const sweepId = window.setInterval(() => {
      if (!mountedRef.current) return;
      void refreshInBackground();
    }, BACKGROUND_SWEEP_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(sweepId);
    };
  }, [loadSnapshot, refreshInBackground]);

  const handleNavigateRecommendation = (recommendation: PrescriptiveRecommendation) => {
    if (recommendation.destination?.type === "workforce_plan_review" && recommendation.destination.queueId) {
      navigate(`/admin/workforce/queues?queue=${recommendation.destination.queueId}`);
      return;
    }
    if (recommendation.destination?.type === "callback_queue") {
      navigate("/admin/workspace");
      return;
    }
    if (recommendation.destination?.type === "routing_policy_review") {
      navigate("/admin/workforce/queues");
    }
  };

  return (
    <CopilotWorkspace
      title="Analytics"
      subtitle={`Welcome, ${user?.name ?? "there"}. Explore diagnostic, predictive, and prescriptive analytics.`}
      expandedSide={expandedSide}
      onExpandedSideChange={setExpandedSide}
      copilot={
        <EmbeddedCopilotPanel
          onOpenQueue={(queueId) => navigate(`/admin/workforce/queues?queue=${queueId}`)}
        />
      }
    >
      <div className={contentPanelClassName}>
        <div className={`flex shrink-0 items-center justify-between gap-3 px-4 py-3 ${contentPanelHeaderBorderClassName}`}>
          <div className="hidden min-w-0 xl:block">
            <p className="text-[18px] font-semibold text-neutral-900">Analytics</p>
            <p className="mt-0.5 text-sm text-neutral-600">
              Diagnostic, predictive, and prescriptive insights
            </p>
          </div>
          <div className="flex min-w-0 w-full flex-nowrap items-center gap-2 overflow-x-auto xl:w-auto">
            <DashboardViewToggle active="analytics" />
            <PanelExpandButton side="right" />
          </div>
        </div>

        <PanelScrollArea className="px-4 py-4">
          {loading && !data ? (
            <DashboardAnalyticsSkeleton />
          ) : (
            <DashboardAnalyticsPanel
              data={data}
              loading={loading}
              refreshing={refreshing}
              error={error}
              selectedIncidentId={selectedIncidentId}
              onIncidentSelect={setSelectedIncidentId}
              onNavigateRecommendation={handleNavigateRecommendation}
            />
          )}
        </PanelScrollArea>
      </div>
    </CopilotWorkspace>
  );
}
