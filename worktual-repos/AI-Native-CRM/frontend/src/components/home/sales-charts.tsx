import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_HANDLED_LINE,
  CHART_LINE_AREA,
  CHART_PIE_SERIES,
} from "@/components/analytics/chart-colors";
import type { ChartSlice } from "@/services/home";

/** Aging urgency: cooler → hotter as deals age. */
const AGING_FILLS = ["#a3a3a3", "#866300", "#c47a00", "#c73e32"];

function EmptyChart({ message = "No data yet." }: { message?: string }) {
  return <p className="text-sm text-text-caption">{message}</p>;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

const tooltipStyle = {
  borderRadius: 8,
  border: "none",
  background: "#171717",
  color: "#fff",
  fontSize: 12,
  lineHeight: 1.4,
} as const;

/**
 * Pipeline by stage — vertical bars (Worktual chart spec).
 */
export function StageFunnel({
  slices,
  formatValue,
}: {
  slices: ChartSlice[];
  formatValue?: (n: number) => string;
}) {
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return <EmptyChart message="No funnel data yet." />;
  }

  const total = slices.reduce((s, x) => s + x.value, 0);
  const max = Math.max(1, ...slices.map((s) => s.value));

  return (
    <div className="flex h-[200px] items-stretch gap-2">
      {slices.map((slice, i) => {
        const display = formatValue
          ? formatValue(slice.value)
          : compactNumber(slice.value);
        const share = total > 0 ? Math.round((slice.value / total) * 100) : 0;
        const barPct =
          slice.value > 0 ? Math.max(8, Math.round((slice.value / max) * 100)) : 0;
        const color = CHART_PIE_SERIES[i % CHART_PIE_SERIES.length];
        return (
          <div
            key={slice.id}
            className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${slice.label}: ${display} (${share}%)`}
          >
            <p className="shrink-0 text-[12px] font-semibold tabular-nums text-neutral-900">
              {display}
            </p>
            <div className="flex min-h-0 w-full flex-1 items-end justify-center">
              <div
                className="w-[22px] max-w-full rounded-t-sm"
                style={{ height: `${barPct}%`, background: color }}
              />
            </div>
            <p className="w-full shrink-0 truncate text-center text-[12px] text-[#212121]">
              {slice.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Won revenue over months — area + line (PDF §27). */
export function WonRevenueLine({
  slices,
  height = 220,
  variant = "default",
  formatValue,
}: {
  slices: ChartSlice[];
  height?: number;
  variant?: "default" | "reports";
  formatValue?: (n: number) => string;
}) {
  void variant;
  if (slices.length === 0) {
    return <EmptyChart message="No closed-won trend yet." />;
  }

  const allZero = slices.every((s) => s.value === 0);
  const gradientId = "wonRevenueFill";
  const stroke = CHART_HANDLED_LINE;
  const fillTop = 0.35;
  const fillBottom = 0.04;

  return (
    <div className="w-full" style={{ height }}>
      {allZero ? (
        <div className="flex h-full flex-col justify-end">
          <EmptyChart message="No won revenue in the last 6 months." />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={slices}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_LINE_AREA} stopOpacity={fillTop} />
                <stop offset="100%" stopColor={CHART_LINE_AREA} stopOpacity={fillBottom} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke={CHART_GRID}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: CHART_AXIS }}
              axisLine={{ stroke: "#909090", strokeWidth: 0.6 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: CHART_AXIS }}
              axisLine={false}
              tickLine={false}
              width={56}
              tickFormatter={(n: number) =>
                formatValue ? formatValue(n) : compactNumber(n)
              }
            />
            <Tooltip
              formatter={(value) => {
                const n = typeof value === "number" ? value : Number(value);
                return formatValue ? formatValue(n) : compactNumber(n);
              }}
              labelFormatter={(label) => String(label)}
              contentStyle={tooltipStyle}
            />
            <Area
              type="monotone"
              dataKey="value"
              name="Won revenue"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={{ r: 3, fill: stroke, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/**
 * Aging as a heat strip — color intensifies with age buckets
 * (distinct from deal-size histogram).
 */
export function AgingHeatStrip({ slices }: { slices: ChartSlice[] }) {
  const max = Math.max(1, ...slices.map((s) => s.value));
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return <EmptyChart />;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-36 items-end gap-1.5 sm:gap-2">
        {slices.map((slice, i) => {
          const h = Math.max(8, Math.round((slice.value / max) * 100));
          const fill = AGING_FILLS[i % AGING_FILLS.length];
          return (
            <div
              key={slice.id}
              className="flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              <span className="text-[10px] font-medium tabular-nums text-text-caption">
                {slice.value > 0 ? slice.value : ""}
              </span>
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  className="w-full max-w-14 rounded-sm transition-[height] duration-500"
                  style={{ height: `${h}%`, backgroundColor: fill }}
                  title={`${slice.label} days: ${slice.value}`}
                />
              </div>
              <span className="w-full truncate text-center text-[10px] text-text-caption">
                {slice.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-caption">
        Cooler → hotter as deals age
      </p>
    </div>
  );
}

/** Deal-size histogram — rounded columns, peer distribution. */
export function DealSizeHistogram({ slices }: { slices: ChartSlice[] }) {
  const max = Math.max(1, ...slices.map((s) => s.value));
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return <EmptyChart />;
  }

  return (
    <div className="flex h-44 items-end justify-around gap-4 px-2">
      {slices.map((slice) => {
        const h = Math.max(10, Math.round((slice.value / max) * 100));
        return (
          <div
            key={slice.id}
            className="flex w-full max-w-20 flex-col items-center gap-2"
          >
            <span className="text-xs font-semibold tabular-nums text-text-primary">
              {slice.value}
            </span>
            <div className="flex h-32 w-full items-end justify-center">
              <div
                className="w-12 rounded-md bg-neutral-900/90 transition-[height] duration-500 sm:w-14"
                style={{ height: `${h}%` }}
                title={`${slice.label}: ${slice.value}`}
              />
            </div>
            <span className="text-center text-[11px] font-medium capitalize text-text-secondary">
              {slice.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function compactSliceValue(n: number): string {
  if (n >= 1000) {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return String(n);
}

/** Lollipop chart — ranked reasons / owners (distinct from thick bars). */
export function LollipopBars({
  slices,
  tone = "brand",
  formatValue,
  onSelect,
  selectedId,
}: {
  slices: ChartSlice[];
  tone?: "brand" | "danger";
  formatValue?: (n: number) => string;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  const max = Math.max(1, ...slices.map((s) => s.value));
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return <EmptyChart />;
  }

  const stem =
    tone === "danger" ? "bg-[#c73e32]/50" : "bg-neutral-400";
  const head =
    tone === "danger" ? "bg-[#c73e32]" : "bg-neutral-900";

  return (
    <ul className="space-y-4">
      {slices.map((slice) => {
        const pct = Math.max(6, Math.round((slice.value / max) * 100));
        const display = formatValue
          ? formatValue(slice.value)
          : compactSliceValue(slice.value);
        const selected = selectedId != null && slice.id === selectedId;
        const label = (
          <span
            className={`truncate capitalize ${
              selected
                ? "font-semibold text-text-primary"
                : "text-text-secondary"
            }`}
          >
            {slice.label}
          </span>
        );
        return (
          <li key={slice.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(slice.id)}
                  className="min-w-0 truncate text-left hover:text-text-primary"
                  aria-pressed={selected}
                >
                  {label}
                </button>
              ) : (
                label
              )}
              <span className="shrink-0 tabular-nums font-medium text-text-primary">
                {display}
              </span>
            </div>
            <div className="relative h-3">
              <div
                className={`absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full ${stem}`}
                style={{ width: `${pct}%` }}
              />
              <div
                className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ${head}`}
                style={{ left: `${pct}%` }}
                title={`${slice.label}: ${display}`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Ranked horizontal bars (Team owner pipeline). */
export function RankedBars({
  slices,
}: {
  slices: ChartSlice[];
}) {
  const max = Math.max(1, ...slices.map((s) => s.value));
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return <EmptyChart />;
  }

  return (
    <div className="flex h-[200px] items-stretch gap-2">
      {slices.map((slice, i) => {
        const pct = Math.max(8, Math.round((slice.value / max) * 100));
        const display =
          slice.value >= 1000
            ? new Intl.NumberFormat(undefined, {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(slice.value)
            : String(slice.value);
        const color = CHART_PIE_SERIES[i % CHART_PIE_SERIES.length];
        return (
          <div
            key={slice.id}
            className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${slice.label}: ${display}`}
          >
            <p className="shrink-0 text-[12px] font-semibold tabular-nums text-neutral-900">
              {display}
            </p>
            <div className="flex min-h-0 w-full flex-1 items-end justify-center">
              <div
                className="w-[22px] max-w-full rounded-t-sm"
                style={{ height: `${pct}%`, background: color }}
              />
            </div>
            <p className="w-full shrink-0 truncate text-center text-[12px] capitalize text-[#212121]">
              {slice.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Won vs lost donut. */
export function OutcomeDonut({ slices }: { slices: ChartSlice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return <EmptyChart message="No outcome data yet." />;
  }

  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg viewBox="0 0 120 120" className="size-36 shrink-0">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-neutral-100)"
          strokeWidth="14"
        />
        {slices.map((slice, i) => {
          if (slice.value <= 0) return null;
          const len = (slice.value / total) * c;
          const el = (
            <circle
              key={slice.id}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={CHART_PIE_SERIES[i % CHART_PIE_SERIES.length]}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
        <text
          x="60"
          y="56"
          textAnchor="middle"
          className="fill-[var(--clr-text-primary)] text-[18px] font-semibold"
        >
          {total}
        </text>
        <text
          x="60"
          y="74"
          textAnchor="middle"
          className="fill-[var(--clr-text-caption)] text-[10px]"
        >
          closed
        </text>
      </svg>
      <ul className="w-full space-y-2.5 text-sm">
        {slices.map((slice, i) => (
          <li key={slice.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-text-secondary">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{
                  background: CHART_PIE_SERIES[i % CHART_PIE_SERIES.length],
                }}
              />
              {slice.label}
            </span>
            <span className="tabular-nums font-medium text-text-primary">
              {slice.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
