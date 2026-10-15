import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Expand, Info } from "lucide-react";
import { Modal, Tooltip } from "antd";

import {
  niceTicks,
  TrendLineChart,
  groupTrendLineSeries,
  trendLineSummary,
} from "@/components/charts/trend-line-chart";
import { DASHBOARD_CHART_COLORS } from "@/components/dashboard/dashboard-card-theme";
import { agentPresenceLabel } from "@/components/monitoring/monitoring-utils";
import { InteractiveDonutChart } from "@/components/charts/interactive-donut-chart";
import { cn } from "@/lib/utils";

/** Enterprise chart palette — used for graphs only, not KPI cards. */
export const CHART_BAR_COLORS = ["#2563eb", "#0d9488", "#4f46e5", "#7c3aed", "#0284c7"] as const;

const CHART_PLOT_HEIGHT = { collapsed: 200, expanded: 360 } as const;

function useChartPlotSize(expanded: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  const height = expanded ? CHART_PLOT_HEIGHT.expanded : CHART_PLOT_HEIGHT.collapsed;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return {
    containerRef,
    width,
    height,
    paddingTop: 28,
    paddingBottom: 62,
    paddingLeft: 60,
    paddingRight: 18,
  };
}

export const CHART_LINE_COLOR = DASHBOARD_CHART_COLORS.line;

export const CHART_CHANNEL_COLORS = {
  voice: "#3b82f6",
  chat: "#3b82f6",
  email: "#f59e0b",
  whatsapp: "#8b5cf6",
} as const;

/** Same series order as the channel pie (plus extras used for additional slices). */
export const CHART_PIE_SERIES = [
  CHART_CHANNEL_COLORS.chat,
  CHART_CHANNEL_COLORS.email,
  CHART_CHANNEL_COLORS.whatsapp,
  "#ec4899",
  "#1877f2",
] as const;

type DashboardKpiCardProps = {
  label: string;
  value: string | number;
  caption: string;
  /** Shown on hover via the info icon next to the title. */
  info?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  trend?: { label: string; positive: boolean };
  className?: string;
};

export function DashboardKpiCard({
  label,
  value,
  caption,
  info,
  icon: Icon,
  iconClassName = "bg-neutral-100 text-neutral-600",
  trend,
  className,
}: DashboardKpiCardProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[136px] min-w-0 flex-col rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-none",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <p className="min-w-0 text-sm font-semibold text-neutral-800">{label}</p>
          {info ? (
            <Tooltip
              title={<span className="text-[12px] leading-relaxed">{info}</span>}
              placement="top"
              color="#171717"
              mouseEnterDelay={0.2}
            >
              <button
                type="button"
                className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
                aria-label={`About ${label}`}
                data-export-ignore="true"
              >
                <Info className="size-3.5" strokeWidth={2.25} aria-hidden />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {Icon ? (
          <div
            className={cn(
              "flex size-[38px] shrink-0 items-center justify-center rounded-xl",
              iconClassName,
            )}
          >
            <Icon className="size-[18px]" strokeWidth={2.25} aria-hidden />
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center py-1">
        <p className="text-[22px] font-bold leading-none tracking-tight tabular-nums text-neutral-900">
          {value}
        </p>
      </div>

      <div
        className={cn(
          "flex min-w-0 items-center justify-between gap-2",
          !trend && "justify-start",
        )}
      >
        <p className="min-w-0 truncate text-sm leading-snug text-neutral-600">{caption}</p>
        {trend ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold",
              trend.positive ? "text-emerald-600" : "text-rose-500",
            )}
          >
            <span
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-full",
                trend.positive ? "bg-emerald-50" : "bg-rose-50",
              )}
            >
              {trend.positive ? (
                <ArrowUpRight className="size-2.5" strokeWidth={2.5} aria-hidden />
              ) : (
                <ArrowDownRight className="size-2.5" strokeWidth={2.5} aria-hidden />
              )}
            </span>
            {trend.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChartInfoButton({ label, info }: { label: string; info: string }) {
  return (
    <Tooltip
      title={<span className="text-[12px] leading-relaxed">{info}</span>}
      placement="top"
      color="#171717"
      mouseEnterDelay={0.2}
    >
      <button
        type="button"
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
        aria-label={`About ${label}`}
        data-html2canvas-ignore
        data-export-ignore="true"
      >
        <Info className="size-3.5" strokeWidth={2.25} aria-hidden />
      </button>
    </Tooltip>
  );
}

export function ExpandableChartCard({
  title,
  subtitle,
  info,
  className,
  titleAside,
  headerAside,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shown on hover via the info icon next to the title. */
  info?: string;
  className?: string;
  titleAside?: ReactNode;
  headerAside?: ReactNode;
  children: (expanded: boolean) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  const titleRow = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex min-w-0 items-start gap-1">
        <p className="min-w-0 text-sm font-bold capitalize text-neutral-900">{title}</p>
        {info ? <ChartInfoButton label={title} info={info} /> : null}
      </div>
      {titleAside}
    </div>
  );

  const heading = (
    <div className="min-w-0">
      {titleRow}
      {subtitle ? <p className="mt-0.5 text-sm text-neutral-600">{subtitle}</p> : null}
    </div>
  );

  return (
    <>
      <div className={cn("flex h-full flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4", className)}>
        <div className="mb-3 flex items-start justify-between gap-2">
          {heading}
          <div className="flex shrink-0 items-start gap-2">
            {headerAside}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex size-7 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              aria-label={`Expand ${title}`}
              title="Expand"
              data-html2canvas-ignore
              data-export-ignore="true"
            >
              <Expand className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
        {children(false)}
      </div>

      <Modal
        open={expanded}
        onCancel={() => setExpanded(false)}
        footer={null}
        width="min(960px, calc(100vw - 32px))"
        title={
          <div className="flex items-start justify-between gap-3 pr-6">
            {heading}
            {headerAside}
          </div>
        }
        centered
        styles={{ body: { paddingTop: 12, paddingBottom: 20 } }}
      >
        <div className="min-h-0">{children(true)}</div>
      </Modal>
    </>
  );
}

type BarChartItem = {
  label: string;
  value: number;
};

function truncateOutcomeLabel(label: string, maxChars = 14): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

const BAR_X_CHAR_WIDTH = 7.4;
const BAR_X_LABEL_GAP = 8;
const BAR_X_STAGGER_SLOT = 64;
const BAR_X_STAGGER_EXTRA = 18;

function barXLabelPlan(slotWidth: number, count: number) {
  const stagger = count > 3 && slotWidth < BAR_X_STAGGER_SLOT;
  const available = Math.max(20, (stagger ? slotWidth * 1.7 : slotWidth) - BAR_X_LABEL_GAP);
  return {
    stagger,
    maxChars: Math.max(3, Math.floor(available / BAR_X_CHAR_WIDTH)),
    extraBottom: stagger ? BAR_X_STAGGER_EXTRA : 0,
  };
}

function barValueFits(text: string, slotWidth: number) {
  return text.length * BAR_X_CHAR_WIDTH + 4 <= slotWidth;
}

function OutcomeInfographicBars({
  items,
  maxValue,
  expanded = false,
  xAxisLabel = "Disposition",
  yAxisLabel = "Conversations",
  formatValue = (value) => String(value),
  formatAxisValue,
}: {
  items: BarChartItem[];
  maxValue?: number;
  expanded?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  formatValue?: (value: number) => string;
  formatAxisValue?: (value: number) => string;
}) {
  const plot = useChartPlotSize(expanded);
  const { containerRef, width, paddingTop, paddingLeft, paddingRight } = plot;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const plotLeft = paddingLeft;
  const plotRight = width - paddingRight;
  const plotTop = paddingTop;
  const plotWidth = plotRight - plotLeft;
  const slotWidth = plotWidth / Math.max(items.length, 1);
  const xLabels = barXLabelPlan(slotWidth, items.length);
  const height = plot.height + xLabels.extraBottom;
  const paddingBottom = plot.paddingBottom + xLabels.extraBottom;
  const plotBottom = height - paddingBottom;
  const plotHeight = plotBottom - plotTop;
  const dataMax = maxValue ?? Math.max(...items.map((item) => item.value), 0);
  const ticks = niceTicks(dataMax);
  const yMax = ticks[ticks.length - 1] ?? Math.max(dataMax, 1);
  const barWidth = Math.min(expanded ? 28 : 22, slotWidth * 0.28);
  const points = items.map((item, index) => {
    const x = plotLeft + slotWidth * index + slotWidth / 2;
    const ratio = yMax > 0 ? item.value / yMax : 0;
    const barHeight = item.value > 0 ? Math.max(2, ratio * plotHeight) : 0;
    return {
      item,
      x,
      y: plotBottom - barHeight,
      barHeight,
      color: CHART_PIE_SERIES[index % CHART_PIE_SERIES.length],
    };
  });
  const hoveredPoint = hoveredIndex == null ? null : points[hoveredIndex];

  return (
    <div
      ref={containerRef}
      className="relative w-full min-w-0"
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none overflow-visible"
        style={{ height }}
        role="img"
        aria-label={`${xAxisLabel} ${yAxisLabel} chart`}
      >
        {ticks.map((tick) => {
          const y = plotBottom - (tick / yMax) * plotHeight;
          return (
            <g key={tick}>
              {tick !== 0 ? (
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y}
                  y2={y}
                  stroke="#858f96"
                  strokeWidth="1"
                  strokeDasharray="3 5"
                />
              ) : null}
              <text
                x={plotLeft - 16}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#212121"
                fontSize="12"
                fontFamily="inherit"
              >
                {formatAxisValue ? formatAxisValue(tick) : String(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          stroke="#909090"
          strokeWidth="0.6"
        />

        {points.map(({ item, x, y, barHeight, color }, index) => {
          const isActive = hoveredIndex == null || hoveredIndex === index;
          const opacity = isActive ? 1 : 0.28;
          const valueText = formatValue(item.value);
          return (
          <g
            key={item.label}
            className="cursor-default"
            onMouseEnter={() => setHoveredIndex(index)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            tabIndex={0}
            style={{ opacity, transition: "opacity 120ms ease" }}
          >
            {barHeight > 0 ? (
              <rect
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
              />
            ) : null}
            <rect
              x={x - slotWidth / 2}
              y={plotTop}
              width={slotWidth}
              height={plotHeight}
              fill="transparent"
            />
            {barValueFits(valueText, slotWidth) ? (
              <text
                x={x}
                y={Math.max(plotTop - 4, y - 7)}
                textAnchor="middle"
                fill="#171717"
                fontSize="12"
                fontWeight="700"
                fontFamily="inherit"
              >
                {valueText}
              </text>
            ) : null}
            <text
              x={x}
              y={plotBottom + (xLabels.stagger && index % 2 === 1 ? 32 : 16)}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill="#212121"
              fontSize="12"
              fontWeight={hoveredIndex === index ? 600 : 500}
              fontFamily="inherit"
            >
              {truncateOutcomeLabel(item.label, xLabels.maxChars)}
            </text>
          </g>
          );
        })}

        <text
          x={(plotLeft + plotRight) / 2}
          y={height - 5}
          textAnchor="middle"
          fill="#212121"
          fontSize="12"
          fontWeight="600"
          fontFamily="inherit"
        >
          {xAxisLabel}
        </text>
        <text
          x={12}
          y={(plotTop + plotBottom) / 2}
          textAnchor="middle"
          fill="#212121"
          fontSize="12"
          fontWeight="600"
          fontFamily="inherit"
          transform={`rotate(-90 12 ${(plotTop + plotBottom) / 2})`}
        >
          {yAxisLabel}
        </text>
      </svg>

      {hoveredPoint ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`,
            marginTop: -14,
          }}
        >
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2 text-left shadow-lg">
            <p className="whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900">
              {formatValue(hoveredPoint.item.value)}
            </p>
            <p className="mt-0.5 whitespace-nowrap text-[12px] leading-tight text-neutral-600">
              {hoveredPoint.item.label}
            </p>
          </div>
          <div className="mx-auto -mt-px h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-white drop-shadow-sm" />
        </div>
      ) : null}
    </div>
  );
}

export function DashboardBarChart({
  title,
  subtitle,
  info,
  items,
  maxValue,
  xAxisLabel,
  yAxisLabel,
  formatValue,
  formatAxisValue,
}: {
  title: string;
  subtitle?: string;
  info?: string;
  items: BarChartItem[];
  maxValue?: number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  formatValue?: (value: number) => string;
  formatAxisValue?: (value: number) => string;
}) {
  const chart = (expanded: boolean) =>
    items.length === 0 ? (
      <p className="py-6 text-center text-xs text-neutral-400">No data yet</p>
    ) : (
      <div
        className={cn(
          "flex flex-1 items-center justify-center",
          expanded ? "py-2" : "min-h-[190px]",
        )}
      >
        <div className={cn("w-full min-w-0", expanded ? "max-w-3xl" : "max-w-2xl")}>
          <OutcomeInfographicBars
            items={items}
            maxValue={maxValue}
            expanded={expanded}
            xAxisLabel={xAxisLabel}
            yAxisLabel={yAxisLabel}
            formatValue={formatValue}
            formatAxisValue={formatAxisValue}
          />
        </div>
      </div>
    );

  return (
    <ExpandableChartCard
      title={title}
      subtitle={subtitle}
      info={info}
      className="flex h-full min-w-0 flex-col"
    >
      {chart}
    </ExpandableChartCard>
  );
}

type SparkPoint = { date?: string; label: string; value: number; series?: string };

export function DashboardSparklineChart({
  title,
  subtitle,
  info,
  points,
  summary,
  color = CHART_LINE_COLOR,
  formatValue = (value) => String(value),
  formatAxisValue,
  xAxisLabel,
  yAxisLabel,
}: {
  title: string;
  subtitle?: string;
  info?: string;
  points: SparkPoint[];
  /** Overrides the default sum shown in the top-right corner. */
  summary?: string | number;
  color?: string;
  formatValue?: (value: number) => string;
  formatAxisValue?: (value: number) => string;
  xAxisLabel?: string;
  yAxisLabel?: string;
}) {
  const grouped = groupTrendLineSeries(points);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = trendLineSummary(points, summary);
  const hoveredPoint = hoveredIndex == null ? null : (points[hoveredIndex] ?? null);
  const hoveredTotal =
    grouped.isMulti && hoveredIndex != null
      ? grouped.seriesNames.reduce(
          (sum, name) => sum + (grouped.grid.get(name)?.[hoveredIndex] ?? 0),
          0,
        )
      : hoveredPoint?.value;
  const displayValue =
    hoveredIndex != null && hoveredTotal != null
      ? formatValue(hoveredTotal)
      : typeof total === "number"
        ? formatValue(total)
        : total;
  const displayHint =
    grouped.isMulti && hoveredIndex != null
      ? (grouped.labels[hoveredIndex] ?? "\u00A0")
      : (hoveredPoint?.label ?? "\u00A0");

  const summaryDisplay = (
    <div className="flex h-10 min-w-[3.5rem] flex-col items-end justify-center text-right">
      <p className="text-xl font-bold leading-none tabular-nums text-neutral-900">
        {displayValue}
      </p>
      <p className="mt-0.5 h-3.5 text-[10px] font-medium leading-none text-neutral-600">
        {displayHint}
      </p>
    </div>
  );

  const chart = (expanded: boolean) => (
    <TrendLineChart
      points={points}
      height={expanded ? 360 : 200}
      formatValue={formatValue}
      formatAxisValue={formatAxisValue}
      color={color}
      xAxisLabel={xAxisLabel}
      yAxisLabel={yAxisLabel}
      onHoverIndexChange={setHoveredIndex}
    />
  );

  return (
    <ExpandableChartCard
      title={title}
      subtitle={subtitle}
      info={info}
      headerAside={summaryDisplay}
      className="flex h-full min-w-0 flex-col"
    >
      {chart}
    </ExpandableChartCard>
  );
}

type ChannelSlice = { label: string; value: number; color: string };

export function DashboardChannelChart({
  title,
  subtitle,
  info,
  channels,
  emptyText = "No channel coverage yet",
}: {
  title: string;
  subtitle?: string;
  info?: string;
  channels: ChannelSlice[];
  emptyText?: string;
}) {
  const total = channels.reduce((sum, channel) => sum + channel.value, 0);
  const hasConfiguredChannels = channels.length > 0;
  const [activeChannelIndex, setActiveChannelIndex] = useState<number | null>(null);

  const chart = (expanded: boolean) =>
    !hasConfiguredChannels ? (
      <p className="py-6 text-center text-xs text-neutral-400">{emptyText}</p>
    ) : (
      <div
        className={cn(
          "flex min-h-[188px] flex-1 items-center justify-center gap-4",
          expanded
            ? "flex-row gap-12 py-4"
            : "flex-row gap-6",
        )}
      >
        <InteractiveDonutChart
          slices={channels.map((channel) => ({
            label: channel.label,
            value: channel.value,
            color: channel.color,
          }))}
          size={expanded ? 256 : 140}
          ringWidth={expanded ? 28 : 22}
          explodeDistance={expanded ? 14 : 8}
          activeIndex={activeChannelIndex}
          onActiveIndexChange={setActiveChannelIndex}
        />

        <div
          className={cn(
            "grid w-max shrink-0 grid-cols-[8px_max-content_max-content] items-center gap-x-2.5",
            expanded ? "gap-y-3 text-sm" : "gap-y-2 text-sm",
          )}
        >
          {channels.map((channel, index) => {
            const pct = total ? Math.round((channel.value / total) * 100) : 0;
            return (
              <div
                key={channel.label}
                className="contents"
                onMouseEnter={() => channel.value > 0 && setActiveChannelIndex(index)}
                onMouseLeave={() => setActiveChannelIndex(null)}
              >
                <span
                  className="size-2 shrink-0 self-center rounded-full transition-opacity"
                  style={{
                    backgroundColor: channel.color,
                    opacity:
                      channel.value === 0
                        ? 0.35
                        : activeChannelIndex == null || activeChannelIndex === index
                          ? 1
                          : 0.45,
                  }}
                />
                <span
                  className="cursor-default text-left text-neutral-900 transition-opacity"
                  style={{
                    opacity:
                      activeChannelIndex == null || activeChannelIndex === index ? 1 : 0.5,
                  }}
                >
                  {channel.label}
                </span>
                <span
                  className="cursor-default justify-self-end whitespace-nowrap text-right font-semibold tabular-nums text-neutral-900 transition-opacity"
                  style={{
                    opacity:
                      activeChannelIndex == null || activeChannelIndex === index ? 1 : 0.5,
                  }}
                >
                  {channel.value} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );

  return (
    <ExpandableChartCard
      title={title}
      subtitle={subtitle}
      info={info}
      className="@container flex h-full min-w-0 flex-col"
    >
      {chart}
    </ExpandableChartCard>
  );
}

const FUNNEL_MAX_WIDTH = 168;
const FUNNEL_MIN_WIDTH = 44;
const FUNNEL_BODY_H = 14;
const FUNNEL_RY = 11;
const FUNNEL_LAYER_OVERLAP = 3;
const FUNNEL_WIDTH_POWER = 0.32;
const FUNNEL_LAYER_MIN_STEP = 10;
const FUNNEL_ABSOLUTE_MIN_WIDTH = 38;

function funnelDiskWidths(slices: PresenceMixSlice[], maxPercent: number): number[] {
  if (maxPercent <= 0) return slices.map(() => FUNNEL_MIN_WIDTH);

  const widths = slices.map((slice) => {
    const ratio = Math.max(slice.percent / maxPercent, 0);
    const curved = Math.pow(ratio, FUNNEL_WIDTH_POWER);
    return FUNNEL_MIN_WIDTH + curved * (FUNNEL_MAX_WIDTH - FUNNEL_MIN_WIDTH);
  });

  for (let index = 1; index < widths.length; index += 1) {
    widths[index] = Math.max(widths[index]!, widths[index - 1]! + FUNNEL_LAYER_MIN_STEP);
  }

  return widths.map((width) =>
    Math.round(Math.min(Math.max(width, FUNNEL_ABSOLUTE_MIN_WIDTH), FUNNEL_MAX_WIDTH)),
  );
}

function coinMetrics(width: number) {
  const ry = Math.max(FUNNEL_RY, width * 0.075);
  const bodyH = FUNNEL_BODY_H;
  const height = ry * 2 + bodyH;
  return { ry, bodyH, height };
}

const ON_DUTY_PRESENCE_STATES = [
  "not_ready",
  "ready",
  "busy",
  "away",
  "break",
] as const;

const PRESENCE_STATE_COLORS: Record<string, string> = {
  not_ready: CHART_PIE_SERIES[0],
  ready: CHART_PIE_SERIES[1],
  busy: CHART_PIE_SERIES[2],
  away: CHART_PIE_SERIES[3],
  break: CHART_PIE_SERIES[4],
  offline: "#CBD5E1",
};

function presenceMixColor(state: string, index: number): string {
  return (
    PRESENCE_STATE_COLORS[state] ??
    CHART_PIE_SERIES[index % CHART_PIE_SERIES.length] ??
    CHART_CHANNEL_COLORS.voice
  );
}

function mixPresenceColor(color: string, mix: "white" | "black", amount: number): string {
  return `color-mix(in srgb, ${color} ${100 - amount}%, ${mix})`;
}

function FunnelCoin3D({ width, color, uid }: { width: number; color: string; uid: string }) {
  const { ry, bodyH, height } = coinMetrics(width);
  const rx = width / 2;
  const topY = ry;
  const bottomY = topY + bodyH;
  const sideId = `${uid}-side`;
  const sideVerticalId = `${uid}-side-v`;
  const topId = `${uid}-top`;
  const rimId = `${uid}-rim`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={sideId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={mixPresenceColor(color, "black", 46)} />
          <stop offset="18%" stopColor={mixPresenceColor(color, "black", 22)} />
          <stop offset="42%" stopColor={mixPresenceColor(color, "white", 6)} />
          <stop offset="58%" stopColor={color} />
          <stop offset="82%" stopColor={mixPresenceColor(color, "black", 18)} />
          <stop offset="100%" stopColor={mixPresenceColor(color, "black", 48)} />
        </linearGradient>
        <linearGradient id={sideVerticalId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={mixPresenceColor(color, "white", 12)} stopOpacity="0.55" />
          <stop offset="45%" stopColor={color} stopOpacity="0" />
          <stop offset="100%" stopColor={mixPresenceColor(color, "black", 55)} stopOpacity="0.72" />
        </linearGradient>
        <radialGradient id={topId} cx="42%" cy="32%" r="72%">
          <stop offset="0%" stopColor={mixPresenceColor(color, "white", 52)} />
          <stop offset="45%" stopColor={mixPresenceColor(color, "white", 12)} />
          <stop offset="78%" stopColor={color} />
          <stop offset="100%" stopColor={mixPresenceColor(color, "black", 18)} />
        </radialGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={mixPresenceColor(color, "white", 22)} />
          <stop offset="100%" stopColor={mixPresenceColor(color, "black", 28)} />
        </linearGradient>
      </defs>

      {/* Cylinder wall */}
      <path
        d={`M 0 ${topY} A ${rx} ${ry} 0 0 1 ${width} ${topY} L ${width} ${bottomY} A ${rx} ${ry} 0 0 1 0 ${bottomY} Z`}
        fill={`url(#${sideId})`}
      />
      <path
        d={`M 0 ${topY} A ${rx} ${ry} 0 0 1 ${width} ${topY} L ${width} ${bottomY} A ${rx} ${ry} 0 0 1 0 ${bottomY} Z`}
        fill={`url(#${sideVerticalId})`}
      />

      {/* Bottom rim (visible underside) */}
      <ellipse cx={rx} cy={bottomY} rx={rx} ry={ry} fill={mixPresenceColor(color, "black", 38)} />

      {/* Top face */}
      <ellipse cx={rx} cy={topY} rx={rx} ry={ry} fill={`url(#${topId})`} />
      <ellipse
        cx={rx}
        cy={topY}
        rx={rx}
        ry={ry}
        fill="none"
        stroke={`url(#${rimId})`}
        strokeWidth={1.2}
        opacity="0.55"
      />
    </svg>
  );
}

type PresenceMixSlice = {
  state: string;
  label: string;
  seconds: number;
  percent: number;
};

/** Reserved funnel viz — kept in codebase, not currently rendered in the UI. */
export function PresenceMixFunnel3D({
  slices,
  maxPercent,
}: {
  slices: PresenceMixSlice[];
  maxPercent: number;
}) {
  const baseId = useId().replace(/:/g, "");
  const colorIndexByState = new Map(slices.map((slice, index) => [slice.state, index]));
  const pyramidSlices = [...slices].sort(
    (left, right) => left.percent - right.percent || left.state.localeCompare(right.state),
  );
  const diskWidths = funnelDiskWidths(pyramidSlices, maxPercent);

  return (
    <div className="flex shrink-0 flex-col items-center justify-center px-2 py-1">
      <div className="flex flex-col items-center">
        {pyramidSlices.map((slice, index) => {
          const color = presenceMixColor(slice.state, colorIndexByState.get(slice.state) ?? index);
          const width = diskWidths[index] ?? FUNNEL_MIN_WIDTH;

          return (
            <div
              key={slice.state}
              title={`${slice.label} ${slice.percent}%`}
              className="relative"
              style={{
                marginTop: index === 0 ? 0 : -FUNNEL_LAYER_OVERLAP,
                zIndex: pyramidSlices.length - index,
              }}
            >
              <FunnelCoin3D width={width} color={color} uid={`${baseId}-${slice.state}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function presenceMixForChart(slices: PresenceMixSlice[]): PresenceMixSlice[] {
  const byState = new Map(slices.map((slice) => [slice.state, slice]));
  const filled = ON_DUTY_PRESENCE_STATES.map((state) => {
    const existing = byState.get(state);
    return {
      state,
      label: existing?.label ?? agentPresenceLabel(state),
      seconds: existing?.seconds ?? 0,
      percent: 0,
    };
  });
  const totalSeconds = filled.reduce((sum, slice) => sum + slice.seconds, 0);
  if (totalSeconds <= 0) return [];

  return filled.map((slice) => ({
    ...slice,
    percent: Math.round((slice.seconds / totalSeconds) * 1000) / 10,
  }));
}

function presenceMixNiceMax(maxPercent: number): number {
  if (maxPercent <= 0) return 100;
  if (maxPercent <= 20) return 20;
  if (maxPercent <= 40) return 40;
  if (maxPercent <= 60) return 60;
  if (maxPercent <= 80) return 80;
  return 100;
}

function PresenceMixInfographicBars({
  slices,
  expanded = false,
}: {
  slices: PresenceMixSlice[];
  expanded?: boolean;
}) {
  const plot = useChartPlotSize(expanded);
  const { containerRef, width, paddingTop, paddingLeft, paddingRight } = plot;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maxPercent = Math.max(...slices.map((slice) => slice.percent), 0);
  const yMax = presenceMixNiceMax(maxPercent);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) =>
    Math.round((yMax / tickCount) * index * 10) / 10,
  );
  const plotLeft = paddingLeft;
  const plotRight = width - paddingRight;
  const plotTop = paddingTop;
  const plotWidth = plotRight - plotLeft;
  const slotWidth = plotWidth / Math.max(slices.length, 1);
  const xLabels = barXLabelPlan(slotWidth, slices.length);
  const height = plot.height + xLabels.extraBottom;
  const paddingBottom = plot.paddingBottom + xLabels.extraBottom;
  const plotBottom = height - paddingBottom;
  const plotHeight = plotBottom - plotTop;
  const barWidth = Math.min(expanded ? 28 : 22, slotWidth * 0.28);

  const points = slices.map((slice, index) => {
    const x = plotLeft + slotWidth * index + slotWidth / 2;
    const ratio = yMax > 0 ? slice.percent / yMax : 0;
    const barHeight = slice.percent > 0 ? Math.max(2, ratio * plotHeight) : 0;
    const y = plotBottom - barHeight;
    return { slice, x, y, barHeight, color: presenceMixColor(slice.state, index) };
  });

  const hoveredPoint = hoveredIndex == null ? null : points[hoveredIndex];

  return (
    <div
      ref={containerRef}
      className="relative w-full min-w-0"
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none overflow-visible"
        style={{ height }}
        role="img"
        aria-label="Agent presence mix chart"
      >
      {ticks.map((tick) => {
        const y = plotBottom - (tick / yMax) * plotHeight;
        const isBaseline = tick === 0;
        return (
          <g key={tick}>
            {!isBaseline ? (
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={y}
                y2={y}
                stroke="#858f96"
                strokeWidth="1"
                strokeDasharray="3 5"
              />
            ) : null}
            <text
              x={plotLeft - 16}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#212121"
              fontSize="12"
              fontFamily="inherit"
            >
              {tick}
            </text>
          </g>
        );
      })}

      <line
        x1={plotLeft}
        x2={plotRight}
        y1={plotBottom}
        y2={plotBottom}
        stroke="#909090"
        strokeWidth="0.6"
      />

      {points.map(({ slice, x, y, barHeight, color }, index) => {
        const valueText = `${slice.percent}%`;
        const isActive = hoveredIndex == null || hoveredIndex === index;
        const opacity = isActive ? 1 : 0.28;
        return (
          <g
            key={slice.state}
            className="cursor-default"
            onMouseEnter={() => setHoveredIndex(index)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            tabIndex={0}
            style={{ opacity, transition: "opacity 120ms ease" }}
          >
            {barHeight > 0 ? (
              <rect
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
              />
            ) : null}
            <rect
              x={x - slotWidth / 2}
              y={plotTop}
              width={slotWidth}
              height={plotHeight}
              fill="transparent"
            />
            {barValueFits(valueText, slotWidth) ? (
              <text
                x={x}
                y={Math.max(plotTop - 4, y - 7)}
                textAnchor="middle"
                fill="#171717"
                fontSize="12"
                fontWeight="700"
                fontFamily="inherit"
              >
                {valueText}
              </text>
            ) : null}
            <text
              x={x}
              y={plotBottom + (xLabels.stagger && index % 2 === 1 ? 32 : 16)}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill="#212121"
              fontSize="12"
              fontFamily="inherit"
              fontWeight={hoveredIndex === index ? 600 : 500}
            >
              {truncateOutcomeLabel(slice.label, xLabels.maxChars)}
            </text>
          </g>
        );
      })}

      <text
        x={(plotLeft + plotRight) / 2}
        y={height - 5}
        textAnchor="middle"
        fill="#212121"
        fontSize="12"
        fontWeight="600"
        fontFamily="inherit"
      >
        Presence state
      </text>
      <text
        x={12}
        y={(plotTop + plotBottom) / 2}
        textAnchor="middle"
        fill="#212121"
        fontSize="12"
        fontWeight="600"
        fontFamily="inherit"
        transform={`rotate(-90 12 ${(plotTop + plotBottom) / 2})`}
      >
        Time share (%)
      </text>
      </svg>

      {hoveredPoint ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`,
            marginTop: -14,
          }}
        >
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2 text-left shadow-lg">
            <p className="whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900">
              {hoveredPoint.slice.percent}%
            </p>
            <p className="mt-0.5 whitespace-nowrap text-[12px] leading-tight text-neutral-600">
              {hoveredPoint.slice.label}
            </p>
          </div>
          <div className="mx-auto -mt-px h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-white drop-shadow-sm" />
        </div>
      ) : null}
    </div>
  );
}

export function DashboardPresenceMixChart({
  title,
  subtitle,
  info,
  slices,
  emptyText = "No presence history for this period",
}: {
  title: string;
  subtitle?: string;
  info?: string;
  slices: PresenceMixSlice[];
  emptyText?: string;
}) {
  const activeSlices = presenceMixForChart(slices);

  const chart = (expanded: boolean) =>
    activeSlices.length === 0 ? (
      <p className="py-6 text-center text-xs text-neutral-400">{emptyText}</p>
    ) : (
      <div
        className={cn(
          "flex flex-1 items-center justify-center",
          expanded ? "py-2" : "min-h-[190px]",
        )}
      >
        <div className={cn("w-full min-w-0", expanded ? "max-w-3xl" : "max-w-2xl")}>
          <PresenceMixInfographicBars slices={activeSlices} expanded={expanded} />
        </div>
      </div>
    );

  return (
    <ExpandableChartCard
      title={title}
      subtitle={subtitle}
      info={info}
      className="@container flex h-full min-w-0 flex-col"
    >
      {chart}
    </ExpandableChartCard>
  );
}
