import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { CampaignMonitorPerformance } from "@/components/campaigns/CampaignMonitorPerformance";
import {
  CampaignMonitoringList,
  type MonitoringTab,
} from "@/components/campaigns/CampaignMonitoringList";
import { OnDemandSendDetailBody } from "@/pages/OnDemandSendDetailPage";
import { PersonalisedCrmSendDetailBody } from "@/pages/PersonalisedCrmSendDetailPage";
import {
  fetchCampaignById,
  type CampaignDetail,
} from "@/services/campaigns.service";
import { parseMonitorTab } from "@/lib/nav-hierarchy";

type Props = {
  /** Controlled tab (e.g. /campaigns?tab=). Uncontrolled if omitted. */
  tab?: MonitoringTab;
  onTabChange?: (tab: MonitoringTab) => void;
};

/**
 * Shared Campaign monitoring: Queues-style list + in-pane performance.
 * URL: /campaigns?tab=live|scheduled|past|on-demand|personalised-crm&id=:id
 */
export function ReportsCampaignMonitoringPane({
  tab: controlledTab,
  onTabChange,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = parseMonitorTab(searchParams.get("tab"));
  const urlId = searchParams.get("id");

  const [internalTab, setInternalTab] = useState<MonitoringTab>(
    urlTab || "live",
  );
  const tab = controlledTab ?? urlTab ?? internalTab;
  const selectedId = urlId;

  const setTab = (next: MonitoringTab) => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", next);
        n.delete("id");
        return n;
      },
      { replace: false },
    );
  };

  const selectCampaign = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!n.get("tab")) n.set("tab", tab);
        if (id) n.set("id", id);
        else n.delete("id");
        return n;
      },
      { replace: false },
    );
  };

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId || tab === "on-demand" || tab === "personalised-crm") {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const row = await fetchCampaignById(selectedId);
        if (!cancelled) setDetail(row);
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          setDetailError(
            e instanceof Error ? e.message : "Failed to load campaign",
          );
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    const poll =
      tab === "live"
        ? window.setInterval(() => {
            void fetchCampaignById(selectedId)
              .then((row) => {
                if (!cancelled) setDetail(row);
              })
              .catch(() => undefined);
          }, 20_000)
        : undefined;
    return () => {
      cancelled = true;
      if (poll) window.clearInterval(poll);
    };
  }, [selectedId, tab]);

  const fromDashboard = searchParams.get("from") === "dashboard";

  if (selectedId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <button
            type="button"
            onClick={() => selectCampaign(null)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
            Back to list
          </button>
          <span className="text-xs capitalize text-neutral-500">
            {tab === "on-demand"
              ? "On-demand"
              : tab === "personalised-crm"
                ? "Personalised CRM"
                : tab}
          </span>
          {fromDashboard ? (
            <Link
              to="/dashboard"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
            >
              Dashboard
            </Link>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "on-demand" ? (
            <OnDemandSendDetailBody runId={selectedId} embedded />
          ) : tab === "personalised-crm" ? (
            <PersonalisedCrmSendDetailBody runId={selectedId} embedded />
          ) : detailLoading ? (
            <p className="p-4 text-sm text-neutral-500">Loading performance…</p>
          ) : detailError ? (
            <p className="p-4 text-sm text-red-600">{detailError}</p>
          ) : detail ? (
            <CampaignMonitorPerformance
              campaign={detail}
              onCampaignChange={setDetail}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {fromDashboard ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <Link
            to="/dashboard"
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={2.25} />
            Back to Dashboard
          </Link>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <CampaignMonitoringList
          tab={tab}
          onTabChange={setTab}
          onSelectCampaign={(id) => selectCampaign(id)}
        />
      </div>
    </div>
  );
}
