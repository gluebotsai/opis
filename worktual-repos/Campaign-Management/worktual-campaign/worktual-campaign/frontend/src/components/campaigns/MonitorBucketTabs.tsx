import { useNavigate } from "react-router-dom";
import type { MonitoringTab } from "@/lib/campaign-monitoring-summary";

type Props = {
  active: MonitoringTab;
  counts?: Partial<Record<"live" | "scheduled" | "past", number>> | null;
  onDemandCount?: number;
  personalisedCrmCount?: number;
  compact?: boolean;
  onMonitoringTab?: (tab: MonitoringTab) => void;
};

/**
 * Campaign Monitor tabs: Live / Scheduled / Past / On-demand / Personalised CRM.
 * All stay on /campaigns?tab=… (same monitoring panel).
 */
export function MonitorBucketTabs({
  active,
  counts,
  onDemandCount = 0,
  personalisedCrmCount = 0,
  compact,
  onMonitoringTab,
}: Props) {
  const navigate = useNavigate();
  const pill = compact ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm";

  const go = (t: MonitoringTab) => {
    if (onMonitoringTab) onMonitoringTab(t);
    else navigate(`/campaigns?tab=${t}`);
  };

  return (
    <div
      className={
        compact ? "mb-3 flex flex-wrap gap-1.5" : "mb-4 flex flex-wrap gap-2"
      }
    >
      {(["live", "scheduled", "past"] as const).map((t) => {
        const count = counts?.[t] ?? 0;
        const selected = active === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => go(t)}
            className={`inline-flex items-center gap-1.5 rounded-full capitalize ${pill} ${
              selected
                ? "bg-black text-white"
                : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
            }`}
          >
            {t}
            {count > 0 ? (
              <span className={selected ? "text-white/80" : "text-neutral-500"}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => go("on-demand")}
        className={`inline-flex items-center gap-1.5 rounded-full ${pill} ${
          active === "on-demand"
            ? "bg-black text-white"
            : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
        }`}
      >
        On-demand
        {onDemandCount > 0 ? (
          <span
            className={
              active === "on-demand" ? "text-white/80" : "text-neutral-500"
            }
          >
            {onDemandCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => go("personalised-crm")}
        className={`inline-flex items-center gap-1.5 rounded-full ${pill} ${
          active === "personalised-crm"
            ? "bg-black text-white"
            : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
        }`}
      >
        Personalised CRM
        {personalisedCrmCount > 0 ? (
          <span
            className={
              active === "personalised-crm" ? "text-white/80" : "text-neutral-500"
            }
          >
            {personalisedCrmCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
