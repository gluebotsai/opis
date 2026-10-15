import { useMemo } from "react";
import type { AnalyticsKpiItem } from "@/services/agent-stream";
import { kpiThemeForLabel, PLOT_COLORS } from "@/components/analytics/kpi-themes";

export type PlotPoint = { label: string; value: number };

export function AnalyticsPlotCard({
  title,
  description,
  kind,
  kpis = [],
  points = [],
}: {
  title: string;
  description?: string;
  kind: "kpi" | "bar" | "line" | "pie";
  kpis?: AnalyticsKpiItem[];
  points?: PlotPoint[];
}) {
  const total = useMemo(
    () => points.reduce((sum, item) => sum + item.value, 0),
    [points],
  );
  const maxValue = useMemo(() => {
    const max = Math.max(...points.map((p) => p.value), 1);
    return max === 0 ? 1 : max;
  }, [points]);

  const stops = useMemo(() => {
    let cursor = 0;
    return points.map((item, index) => {
      const start = total ? (cursor / total) * 100 : 0;
      cursor += item.value;
      const end = total ? (cursor / total) * 100 : 0;
      return `${PLOT_COLORS[index % PLOT_COLORS.length]} ${start}% ${end}%`;
    });
  }, [points, total]);

  const isSingleKpi = kind === "kpi" && kpis.length === 1;

  return (
    <div className="@container rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-2xs">
      <div>
        <p className="text-sm font-semibold text-neutral-900">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[11px] text-neutral-500">{description}</p>
        ) : null}
      </div>

      {kind === "kpi" && kpis.length > 0 ? (
        <div
          className={
            isSingleKpi
              ? "mt-3 grid grid-cols-1 gap-2"
              : "mt-3 grid grid-cols-1 gap-2 @sm:grid-cols-2 @lg:grid-cols-3"
          }
        >
          {kpis.map((kpi) => {
            const theme = kpiThemeForLabel(kpi.label);
            const Icon = theme.icon;
            return (
              <div
                key={kpi.label}
                className={`rounded-xl border p-2.5 ${theme.tileClassName}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={`flex size-7 items-center justify-center rounded-lg ${theme.iconClassName}`}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  {kpi.change ? (
                    <span className="text-[10px] font-medium text-emerald-600">{kpi.change}</span>
                  ) : null}
                </div>
                <p className="mt-2 truncate text-[10px] font-medium uppercase tracking-[0.08em] text-neutral-500">
                  {kpi.label}
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-neutral-900">
                  {kpi.value}
                </p>
                {kpi.hint ? (
                  <p className="mt-0.5 text-[10px] text-neutral-500">{kpi.hint}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {kind === "pie" && points.length > 0 ? (
        <div className="mt-4 flex items-center gap-5">
          <div
            className="relative flex size-24 shrink-0 items-center justify-center rounded-full"
            style={{
              background: total
                ? `conic-gradient(${stops.join(",")})`
                : "conic-gradient(#e5e7eb 0% 100%)",
            }}
          >
            <div className="flex size-16 flex-col items-center justify-center rounded-full bg-white">
              <span className="text-xl font-semibold text-neutral-900">{total}</span>
              <span className="text-[9px] uppercase tracking-wide text-neutral-400">Total</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {points.map((item, index) => {
              const pct = total ? Math.round((item.value / total) * 100) : 0;
              return (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: PLOT_COLORS[index % PLOT_COLORS.length] }}
                  />
                  <span className="truncate text-neutral-600">{item.label}</span>
                  <span className="ml-auto font-medium tabular-nums text-neutral-900">
                    {item.value} {total ? `(${pct}%)` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {kind === "bar" && points.length > 0 ? (
        <div className="mt-4 space-y-3">
          {points.map((item, index) => {
            const color = PLOT_COLORS[index % PLOT_COLORS.length];
            return (
              <div key={`${item.label}-${index}`}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate font-medium text-neutral-600">{item.label}</span>
                  </div>
                  <span className="font-semibold tabular-nums text-neutral-900">{item.value}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width:
                        item.value <= 0
                          ? "0%"
                          : `${Math.max(6, (item.value / maxValue) * 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {kind === "line" && points.length > 0 ? (
        <div className="mt-3">
          {(() => {
            const width = 500;
            const height = 140;
            const paddingX = 12;
            const paddingTop = 18;
            const paddingBottom = 22;
            const usableH = height - paddingTop - paddingBottom;
            const coords = points.map((p, idx) => ({
              x: paddingX + (idx / Math.max(points.length - 1, 1)) * (width - paddingX * 2),
              y: paddingTop + usableH - (p.value / maxValue) * usableH,
              ...p,
            }));
            const pathStr = coords
              .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x} ${c.y}`)
              .join(" ");
            const areaStr = `${pathStr} L ${coords.at(-1)?.x} ${height - paddingBottom} L ${coords[0]?.x} ${height - paddingBottom} Z`;
            const labelStep = points.length <= 7 ? 1 : points.length <= 14 ? 2 : 5;

            return (
              <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full overflow-visible" role="img">
                <defs>
                  <linearGradient id="crm-plot-line-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 0.5, 1].map((pos) => {
                  const y = paddingTop + usableH * pos;
                  return (
                    <line
                      key={pos}
                      x1={paddingX}
                      x2={width - paddingX}
                      y1={y}
                      y2={y}
                      stroke="#e5e7eb"
                      strokeDasharray="4 4"
                    />
                  );
                })}
                <path d={areaStr} fill="url(#crm-plot-line-fill)" />
                <path
                  d={pathStr}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {coords.map((c, idx) => (
                  <g key={idx}>
                    <circle cx={c.x} cy={c.y} r="3.5" fill="#2563eb" stroke="#ffffff" strokeWidth="1.5">
                      <title>{`${c.label}: ${c.value}`}</title>
                    </circle>
                    {c.value > 0 ? (
                      <text
                        x={c.x}
                        y={c.y - 7}
                        textAnchor="middle"
                        className="fill-blue-700 text-[10px] font-semibold tabular-nums"
                      >
                        {c.value}
                      </text>
                    ) : null}
                  </g>
                ))}
                {coords.map((c, idx) =>
                  idx % labelStep === 0 || idx === coords.length - 1 ? (
                    <text
                      key={`lbl-${idx}`}
                      x={c.x}
                      y={height - 4}
                      textAnchor={
                        idx === 0 ? "start" : idx === coords.length - 1 ? "end" : "middle"
                      }
                      className="fill-neutral-400 text-[10px]"
                    >
                      {c.label}
                    </text>
                  ) : null,
                )}
              </svg>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
