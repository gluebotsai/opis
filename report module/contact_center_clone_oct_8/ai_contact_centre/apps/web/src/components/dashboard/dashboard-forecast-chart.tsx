import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  buildSmoothLinePath,
  buildXAxisLabels,
  niceTicks,
} from "@/components/charts/trend-line-chart";
import { ExpandableChartCard } from "@/components/dashboard/dashboard-charts";
import { DASHBOARD_CHART_COLORS } from "@/components/dashboard/dashboard-card-theme";
import { cn } from "@/lib/utils";

type ForecastPoint = {
  label: string;
  actual?: number;
  forecast?: number;
};

const ACTUAL_COLOR = DASHBOARD_CHART_COLORS.line;
const FORECAST_COLOR = DASHBOARD_CHART_COLORS.lineSecondary;
const DEFAULT_WIDTH = 360;

function estimateLabelWidth(text: string): number {
  return Math.max(28, text.length * 7.4);
}

function ForecastLegend() {
  return (
    <div className="flex shrink-0 items-center gap-3 text-[12px] font-medium text-neutral-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: ACTUAL_COLOR }} />
        Actual
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: FORECAST_COLOR }} />
        Forecast
      </span>
    </div>
  );
}

function ForecastDualLineChart({
  points,
  unit = "",
  height = 200,
  expanded = false,
  xAxisLabel,
  yAxisLabel,
  onHoverIndexChange,
}: {
  points: ForecastPoint[];
  unit?: string;
  height?: number;
  expanded?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  onHoverIndexChange?: (index: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const areaGradientId = useId().replace(/:/g, "");
  const bandGradientId = `${areaGradientId}-band`;

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

  const formatValue = useCallback(
    (value: number) => {
      const rounded = Math.round(value * 10) / 10;
      return unit ? `${rounded}${unit}` : String(rounded);
    },
    [unit],
  );

  const allValues = useMemo(
    () =>
      points.flatMap((point) =>
        [point.actual, point.forecast].filter((value): value is number => value != null),
      ),
    [points],
  );

  const paddingTop = 28;
  const paddingBottom = xAxisLabel ? 62 : 44;
  const axisLabelGap = 16;
  const yAxisTitleSpace = yAxisLabel ? 18 : 0;
  const dataMax = Math.max(...allValues, 0);
  const ticks = useMemo(() => niceTicks(dataMax), [dataMax]);
  const max = ticks[ticks.length - 1] ?? Math.max(dataMax, 1);
  const min = 0;
  const domainSpan = Math.max(max - min, 1);
  const tickLabels = useMemo(
    () => ticks.map((tick) => formatValue(tick)),
    [formatValue, ticks],
  );
  const paddingLeft = Math.min(
    110,
    Math.max(
      yAxisLabel ? 60 : 40 + axisLabelGap,
      ...tickLabels.map((label) => estimateLabelWidth(label) + axisLabelGap + yAxisTitleSpace),
    ),
  );
  const paddingRight = 18;
  const plotLeft = paddingLeft;
  const plotRight = width - paddingRight;
  const plotWidth = plotRight - plotLeft;
  const usableHeight = height - paddingTop - paddingBottom;
  const baselineY = height - paddingBottom;
  const xAxisLabels = useMemo(
    () => buildXAxisLabels(points, plotLeft, plotWidth),
    [plotLeft, plotWidth, points],
  );

  const coords = useMemo(
    () =>
      points.map((point, index) => {
        const x = plotLeft + (index / Math.max(points.length - 1, 1)) * plotWidth;
        const actualY =
          point.actual == null
            ? null
            : paddingTop + usableHeight - ((point.actual - min) / domainSpan) * usableHeight;
        const forecastY =
          point.forecast == null
            ? null
            : paddingTop + usableHeight - ((point.forecast - min) / domainSpan) * usableHeight;
        return { x, label: point.label, actualY, forecastY, point };
      }),
    [domainSpan, min, plotLeft, plotWidth, points, usableHeight],
  );

  const actualCoords = coords.filter((coord) => coord.actualY != null).map((coord) => ({
    x: coord.x,
    y: coord.actualY!,
  }));
  const forecastCoords = coords.filter((coord) => coord.forecastY != null).map((coord) => ({
    x: coord.x,
    y: coord.forecastY!,
  }));

  const actualPath = buildSmoothLinePath(actualCoords, { maxY: baselineY });
  const forecastPath = buildSmoothLinePath(forecastCoords, { maxY: baselineY });
  const actualAreaPath =
    actualCoords.length > 0
      ? `${actualPath} L ${actualCoords[actualCoords.length - 1]?.x ?? plotLeft} ${baselineY} L ${
          actualCoords[0]?.x ?? plotLeft
        } ${baselineY} Z`
      : "";

  const dividerIndex = points.findIndex((point) => point.actual == null && point.forecast != null);
  const dividerX =
    dividerIndex >= 0 && coords[dividerIndex]
      ? coords[dividerIndex].x
      : null;

  const active = hoveredIndex == null ? null : (coords[hoveredIndex] ?? null);
  const bandWidth = Math.min(28, Math.max(16, (plotWidth / Math.max(points.length, 1)) * 0.7));

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (coords.length === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = ((event.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      let minDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < coords.length; index += 1) {
        const distance = Math.abs((coords[index]?.x ?? 0) - relativeX);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = index;
        }
      }
      setHoveredIndex(nearest);
      onHoverIndexChange?.(nearest);
    },
    [coords, onHoverIndexChange, width],
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredIndex(null);
    onHoverIndexChange?.(null);
  }, [onHoverIndexChange]);

  if (points.length === 0) {
    return <p className="py-6 text-center text-xs text-neutral-400">No forecast data yet</p>;
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none overflow-visible"
        style={{ height: expanded ? 360 : height }}
        role="img"
        aria-label="Forecast comparison chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity="0.28" />
            <stop offset="55%" stopColor={ACTUAL_COLOR} stopOpacity="0.12" />
            <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={bandGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity="0.18" />
            <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {ticks.map((tick, tickIndex) => {
          const y = paddingTop + usableHeight - ((tick - min) / domainSpan) * usableHeight;
          const isBaseline = tick === min;
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
                x={plotLeft - axisLabelGap}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#212121"
                fontSize="12"
                fontFamily="inherit"
              >
                {tickLabels[tickIndex]}
              </text>
            </g>
          );
        })}

        <line
          x1={plotLeft}
          x2={plotRight}
          y1={baselineY}
          y2={baselineY}
          stroke="#909090"
          strokeWidth="0.6"
        />

        {dividerX != null ? (
          <line
            x1={dividerX}
            x2={dividerX}
            y1={paddingTop}
            y2={baselineY}
            stroke="#858f96"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
        ) : null}

        {active ? (
          <rect
            x={active.x - bandWidth / 2}
            y={paddingTop}
            width={bandWidth}
            height={usableHeight}
            rx={bandWidth / 2}
            ry={bandWidth / 2}
            fill={`url(#${bandGradientId})`}
          />
        ) : null}

        {actualAreaPath ? <path d={actualAreaPath} fill={`url(#${areaGradientId})`} /> : null}

        {forecastPath ? (
          <path
            d={forecastPath}
            fill="none"
            stroke={FORECAST_COLOR}
            strokeWidth="2"
          />
        ) : null}

        {actualPath ? (
          <path d={actualPath} fill="none" stroke={ACTUAL_COLOR} strokeWidth="2" />
        ) : null}

        {actualCoords.map((coord) => (
          <circle
            key={`actual-${coord.x}-${coord.y}`}
            cx={coord.x}
            cy={coord.y}
            r={active?.actualY != null && active.x === coord.x ? 6 : 3.5}
            fill={ACTUAL_COLOR}
            stroke="#ffffff"
            strokeWidth={active?.actualY != null && active.x === coord.x ? 3 : 2}
          />
        ))}

        {active?.forecastY != null ? (
          <circle
            cx={active.x}
            cy={active.forecastY}
            r={6}
            fill={FORECAST_COLOR}
            stroke="#ffffff"
            strokeWidth="3"
          />
        ) : null}

        {xAxisLabels.map((axisLabel) => {
          const isActive = hoveredIndex === axisLabel.dataIndex;
          return (
            <text
              key={`x-${axisLabel.dataIndex}-${axisLabel.label}`}
              x={axisLabel.x}
              y={baselineY + axisLabelGap}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill="#212121"
              fontSize="12"
              fontFamily="inherit"
              fontWeight={isActive ? 600 : 500}
            >
              {axisLabel.label}
            </text>
          );
        })}

        {xAxisLabel ? (
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
        ) : null}

        {yAxisLabel ? (
          <text
            x={12}
            y={paddingTop + usableHeight / 2}
            textAnchor="middle"
            fill="#212121"
            fontSize="12"
            fontWeight="600"
            fontFamily="inherit"
            transform={`rotate(-90 12 ${paddingTop + usableHeight / 2})`}
          >
            {yAxisLabel}
          </text>
        ) : null}

        <rect
          x={plotLeft}
          y={paddingTop}
          width={plotWidth}
          height={usableHeight}
          fill="transparent"
          className="cursor-crosshair"
        />
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(active.x / width) * 100}%`,
            top: `${((active.actualY ?? active.forecastY ?? baselineY) / height) * 100}%`,
            marginTop: -14,
          }}
        >
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2 text-left shadow-lg">
            {active.point.actual != null ? (
              <p className="whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900">
                Actual {formatValue(active.point.actual)}
              </p>
            ) : null}
            {active.point.forecast != null ? (
              <p
                className={cn(
                  "whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900",
                  active.point.actual != null && "mt-0.5",
                )}
              >
                Forecast {formatValue(active.point.forecast)}
              </p>
            ) : null}
            <p className="mt-0.5 whitespace-nowrap text-[12px] leading-tight text-neutral-600">
              {active.label}
            </p>
          </div>
          <div className="mx-auto -mt-px h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-white drop-shadow-sm" />
        </div>
      ) : null}
    </div>
  );
}

function ForecastSummary({
  points,
  hoveredIndex,
  unit = "",
  highlightLabel,
  highlightSeries,
}: {
  points: ForecastPoint[];
  hoveredIndex: number | null;
  unit?: string;
  highlightLabel?: string;
  highlightSeries?: "actual" | "forecast";
}) {
  const formatValue = (value: number) => {
    const rounded = Math.round(value * 10) / 10;
    return unit ? `${rounded}${unit}` : String(rounded);
  };

  const valueForPoint = (point: ForecastPoint | null | undefined) => {
    if (!point) return undefined;
    if (highlightSeries === "forecast" && point.forecast != null) return point.forecast;
    if (highlightSeries === "actual" && point.actual != null) return point.actual;
    return point.actual ?? point.forecast;
  };

  const active = hoveredIndex == null ? null : (points[hoveredIndex] ?? null);
  const highlighted = highlightLabel
    ? points.find((point) => point.label === highlightLabel) ?? null
    : null;
  const latestActual = [...points].reverse().find((point) => point.actual != null)?.actual;
  const nextForecast = points.find((point) => point.forecast != null && point.actual == null)?.forecast
    ?? points.find((point) => point.forecast != null)?.forecast;

  const displayValue = active
    ? (active.actual ?? active.forecast)
    : highlighted
      ? valueForPoint(highlighted)
      : latestActual ?? nextForecast;
  const displayHint = active?.label ?? highlighted?.label ?? "\u00A0";

  if (displayValue == null) {
    return null;
  }

  return (
    <div className="flex h-10 min-w-[3.5rem] flex-col items-end justify-center text-right">
      <p className="text-xl font-bold leading-none tabular-nums text-neutral-900">
        {formatValue(displayValue)}
      </p>
      <p className="mt-0.5 h-3.5 text-[10px] font-medium leading-none text-neutral-600">
        {displayHint}
      </p>
    </div>
  );
}

export function DashboardForecastChart({
  title,
  subtitle,
  info,
  points,
  unit = "",
  xAxisLabel = "Date",
  yAxisLabel,
  highlightLabel,
  highlightSeries,
}: {
  title: string;
  subtitle?: string;
  info?: string;
  points: ForecastPoint[];
  unit?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  highlightLabel?: string;
  highlightSeries?: "actual" | "forecast";
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const headerAside: ReactNode = (
    <ForecastSummary
      points={points}
      hoveredIndex={hoveredIndex}
      unit={unit}
      highlightLabel={highlightLabel}
      highlightSeries={highlightSeries}
    />
  );

  const chart = (expanded: boolean) => (
    <ForecastDualLineChart
      points={points}
      unit={unit}
      height={expanded ? 360 : 200}
      expanded={expanded}
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
      titleAside={<ForecastLegend />}
      headerAside={headerAside}
    >
      {chart}
    </ExpandableChartCard>
  );
}
