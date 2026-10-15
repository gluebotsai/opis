import type { AnalyticsKpiItem } from "@/services/agent-stream";

export function AnalyticsKpiGrid({
  title,
  kpis,
}: {
  title: string;
  kpis: AnalyticsKpiItem[];
}) {
  if (kpis.length === 0) return null;

  return (
    <div className="@container mt-2 w-full border-t border-neutral-200/80 pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-caption">{title}</p>
      <div
        className={
          kpis.length === 1
            ? "mt-2 flex items-baseline justify-between gap-3 rounded-lg border border-border-default bg-white px-3 py-2.5"
            : "mt-2 grid grid-cols-1 gap-2 @sm:grid-cols-2"
        }
      >
        {kpis.map((kpi) =>
          kpis.length === 1 ? (
            <div key={kpi.label} className="flex w-full items-baseline justify-between gap-3">
              <span className="text-xs text-text-caption">{kpi.label}</span>
              <span className="text-lg font-semibold tabular-nums text-text-primary">
                {kpi.value}
              </span>
            </div>
          ) : (
            <div
              key={kpi.label}
              className="rounded-lg border border-border-default bg-white px-3 py-2"
            >
              <p className="text-xs text-text-caption">{kpi.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {kpi.value}
              </p>
              {kpi.hint ? <p className="mt-0.5 text-[11px] text-text-caption">{kpi.hint}</p> : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
