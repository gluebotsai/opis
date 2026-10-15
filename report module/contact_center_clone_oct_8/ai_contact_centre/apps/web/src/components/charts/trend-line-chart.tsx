import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { DASHBOARD_CHART_COLORS } from "@/components/dashboard/dashboard-card-theme";
import { cn } from "@/lib/utils";

export type TrendLinePoint = {
  label: string;
  value: number;
  date?: string;
  series?: string;
};

const SERIES_PALETTE = ["#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#1877f2", "#0d9488"] as const;

export function defaultSeriesColor(name: string, index: number): string {
  const key = name.trim().toLowerCase();
  if (key.includes("whatsapp")) return "#8b5cf6";
  if (key.includes("email")) return "#f59e0b";
  if (key.includes("instagram")) return "#ec4899";
  if (key.includes("facebook")) return "#1877f2";
  if (key.includes("voice") || key.includes("call")) return "#4f46e5";
  if (key.includes("web") || key.includes("chat")) return "#3b82f6";
  return SERIES_PALETTE[index % SERIES_PALETTE.length]!;
}

/** Each series gets a distinct stroke so two channels never share a line color. */
export function resolveSeriesColors(
  names: string[],
  seriesColor: (name: string, index: number) => string = defaultSeriesColor,
): string[] {
  const used = new Set<string>();
  return names.map((name, index) => {
    let color = seriesColor(name, index);
    if (used.has(color)) {
      color =
        SERIES_PALETTE.find((candidate) => !used.has(candidate)) ??
        SERIES_PALETTE[index % SERIES_PALETTE.length]!;
    }
    used.add(color);
    return color;
  });
}

export function groupTrendLineSeries(points: TrendLinePoint[]) {
  const labels: string[] = [];
  const labelIndex = new Map<string, number>();
  for (const point of points) {
    if (!labelIndex.has(point.label)) {
      labelIndex.set(point.label, labels.length);
      labels.push(point.label);
    }
  }
  const seriesNames: string[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    const name = point.series?.trim() ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    seriesNames.push(name);
  }
  const isMulti = seriesNames.length > 1;
  const grid = new Map<string, number[]>();
  if (isMulti) {
    for (const name of seriesNames) {
      grid.set(name, Array.from({ length: labels.length }, () => 0));
    }
    for (const point of points) {
      const name = point.series?.trim() ?? "";
      if (!name) continue;
      const values = grid.get(name);
      const index = labelIndex.get(point.label);
      if (!values || index == null) continue;
      values[index] = point.value;
    }
  }
  return { labels, seriesNames, isMulti, grid };
}

type TrendLineChartProps = {
  points: TrendLinePoint[];
  height?: number;
  formatValue?: (value: number) => string;
  formatAxisValue?: (value: number) => string;
  valueSuffix?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  className?: string;
  emptyText?: string;
  onHoverIndexChange?: (index: number | null) => void;
  color?: string;
  showArea?: boolean;
  seriesColor?: (name: string, index: number) => string;
};

const DEFAULT_WIDTH = 360;
export const CHART_LINE_STROKE = DASHBOARD_CHART_COLORS.line;

/** Catmull-Rom → cubic Bezier for a smooth Order Summary–style curve.
 * Optional y bounds clamp control points so the curve cannot overshoot
 * (convex-hull property) — e.g. stay above the baseline for non-negative data.
 */
export function buildSmoothLinePath(
  coords: Array<{ x: number; y: number }>,
  options?: { minY?: number; maxY?: number },
): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) {
    const only = coords[0]!;
    return `M ${only.x} ${only.y}`;
  }
  if (coords.length === 2) {
    const [a, b] = coords;
    return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y}`;
  }

  const clampY = (y: number) => {
    let next = y;
    if (options?.minY != null) next = Math.max(next, options.minY);
    if (options?.maxY != null) next = Math.min(next, options.maxY);
    return next;
  };

  let path = `M ${coords[0]!.x} ${coords[0]!.y}`;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const p0 = coords[index === 0 ? 0 : index - 1]!;
    const p1 = coords[index]!;
    const p2 = coords[index + 1]!;
    const p3 = coords[index + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

export function niceTicks(maxValue: number, tickCount = 5): number[] {
  if (maxValue <= 0) return [0, 1, 2, 3, 4];
  const rawStep = maxValue / (tickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  const top = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step * 0.001; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

function estimateLabelWidth(text: string): number {
  return Math.max(28, text.length * 7.4);
}

type XAxisLabel = {
  dataIndex: number;
  label: string;
  x: number;
};

/**
 * Build x-axis labels with uniform pixel spacing.
 * Uses a constant data step so date intervals stay regular, then places
 * each label at evenly spaced x positions across the plot.
 */
export function buildXAxisLabels(
  points: Array<{ label: string }>,
  plotLeft: number,
  plotWidth: number,
): XAxisLabel[] {
  const pointCount = points.length;
  if (pointCount <= 0) return [];
  if (pointCount === 1) {
    return [{ dataIndex: 0, label: points[0]!.label, x: plotLeft + plotWidth / 2 }];
  }

  const avgLabelWidth = Math.max(
    56,
    points.reduce((sum, point) => sum + estimateLabelWidth(point.label), 0) / pointCount,
  );
  const minGap = 20;
  const maxByWidth = Math.max(2, Math.floor((plotWidth + minGap) / (avgLabelWidth + minGap)));
  const targetCount = Math.min(pointCount, maxByWidth);

  // Inset by half a label so every tick is middle-anchored with equal visual gaps,
  // while the first/last labels sit flush with the axis ends instead of hanging off.
  const halfLabel = Math.min(avgLabelWidth / 2, plotWidth / 4);
  const labelLeft = plotLeft + halfLabel;
  const labelSpan = Math.max(plotWidth - halfLabel * 2, 0);

  const positionForSlot = (slot: number, count: number) =>
    labelLeft + (count <= 1 ? 0 : (slot / (count - 1)) * labelSpan);

  if (targetCount >= pointCount) {
    return points.map((point, dataIndex) => ({
      dataIndex,
      label: point.label,
      x: positionForSlot(dataIndex, pointCount),
    }));
  }

  // Pick a step that lands on the last point when possible so day gaps stay equal.
  const lastPoint = pointCount - 1;
  let step = Math.max(1, Math.ceil(lastPoint / (targetCount - 1)));
  for (let candidate = step; candidate >= 1; candidate -= 1) {
    const count = Math.floor(lastPoint / candidate) + 1;
    if (lastPoint % candidate === 0 && count >= 2 && count <= targetCount + 1) {
      step = candidate;
      break;
    }
  }

  const indices: number[] = [];
  for (let index = 0; index <= lastPoint; index += step) {
    indices.push(index);
  }
  if (indices[indices.length - 1] !== lastPoint) {
    indices.push(lastPoint);
  }

  // Always place labels on an equal pixel grid (identical gaps), independent of
  // any leftover day remainder on the final segment.
  const labelCount = indices.length;
  return indices.map((dataIndex, slot) => ({
    dataIndex,
    label: points[dataIndex]!.label,
    x: positionForSlot(slot, labelCount),
  }));
}

export function TrendLineChart({
  points,
  height = 220,
  formatValue = (value) => String(value),
  formatAxisValue = formatValue,
  valueSuffix,
  xAxisLabel,
  yAxisLabel,
  className,
  emptyText = "No data yet",
  onHoverIndexChange,
  color = CHART_LINE_STROKE,
  showArea = true,
  seriesColor = defaultSeriesColor,
}: TrendLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

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

  const grouped = useMemo(() => groupTrendLineSeries(points), [points]);
  const isMulti = grouped.isMulti;
  const axisPoints = isMulti ? grouped.labels.map((label) => ({ label })) : points;
  const seriesMeta = useMemo(() => {
    const colors = resolveSeriesColors(grouped.seriesNames, seriesColor);
    return grouped.seriesNames.map((name, index) => ({
      name,
      color: colors[index]!,
      values: grouped.grid.get(name) ?? [],
    }));
  }, [grouped, seriesColor]);
  const paddingTop = 28;
  const paddingBottom = xAxisLabel ? 62 : 44;
  const axisLabelGap = 16;
  const yAxisTitleSpace = yAxisLabel ? 18 : 0;
  const values = isMulti
    ? seriesMeta.flatMap((item) => item.values)
    : points.map((point) => point.value);
  const dataMax = Math.max(...values, 0);
  const ticks = useMemo(() => niceTicks(dataMax), [dataMax]);
  const max = ticks[ticks.length - 1] ?? Math.max(dataMax, 1);
  const min = 0;
  const domainSpan = Math.max(max - min, 1);
  const tickLabels = useMemo(
    () => ticks.map((tick) => formatAxisValue(tick)),
    [formatAxisValue, ticks],
  );
  const paddingLeft = Math.min(
    110,
    Math.max(
      yAxisLabel ? 60 : 40 + axisLabelGap,
      ...tickLabels.map(
        (label) => estimateLabelWidth(label) + axisLabelGap + yAxisTitleSpace,
      ),
    ),
  );
  const paddingRight = 18;
  const plotLeft = paddingLeft;
  const plotRight = width - paddingRight;
  const plotWidth = plotRight - plotLeft;
  const usableHeight = height - paddingTop - paddingBottom;
  const baselineY = height - paddingBottom;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const areaGradientId = useId().replace(/:/g, "");
  const bandGradientId = `${areaGradientId}-band`;

  const hasNegativeValues = values.some((value) => value < 0);

  const coords = useMemo(
    () =>
      axisPoints.map((point, index) => {
        const x =
          plotLeft + (index / Math.max(axisPoints.length - 1, 1)) * plotWidth;
        const value = isMulti ? (seriesMeta[0]?.values[index] ?? 0) : (point as TrendLinePoint).value;
        const normalized = (value - min) / domainSpan;
        const y = paddingTop + usableHeight - normalized * usableHeight;
        return {
          x,
          y,
          label: point.label,
          date: isMulti ? `${index}` : ((point as TrendLinePoint).date ?? `${index}`),
          value,
        };
      }),
    [axisPoints, domainSpan, isMulti, plotLeft, plotWidth, seriesMeta, usableHeight],
  );

  const seriesPaths = useMemo(() => {
    if (!isMulti) return [];
    return seriesMeta.map((item) => {
      const seriesCoords = grouped.labels.map((label, index) => {
        const x =
          plotLeft + (index / Math.max(grouped.labels.length - 1, 1)) * plotWidth;
        const value = item.values[index] ?? 0;
        const normalized = (value - min) / domainSpan;
        const y = paddingTop + usableHeight - normalized * usableHeight;
        return { x, y, label, value };
      });
      const path = buildSmoothLinePath(
        seriesCoords,
        hasNegativeValues ? undefined : { maxY: baselineY },
      );
      return {
        ...item,
        coords: seriesCoords,
        path,
        areaPath: path
          ? `${path} L ${seriesCoords[seriesCoords.length - 1]?.x ?? plotLeft} ${baselineY} L ${
              seriesCoords[0]?.x ?? plotLeft
            } ${baselineY} Z`
          : "",
      };
    });
  }, [
    baselineY,
    domainSpan,
    grouped.labels,
    hasNegativeValues,
    isMulti,
    plotLeft,
    plotWidth,
    seriesMeta,
    usableHeight,
  ]);

  const linePath = buildSmoothLinePath(
    coords,
    hasNegativeValues ? undefined : { maxY: baselineY },
  );
  const areaPath = coords.length
    ? `${linePath} L ${coords[coords.length - 1]?.x ?? plotLeft} ${baselineY} L ${
        coords[0]?.x ?? plotLeft
      } ${baselineY} Z`
    : "";
  const xAxisLabels = useMemo(
    () => buildXAxisLabels(axisPoints, plotLeft, plotWidth),
    [axisPoints, plotLeft, plotWidth],
  );
  const activePoint = hoveredIndex == null ? null : (coords[hoveredIndex] ?? null);
  const bandWidth = Math.min(
    28,
    Math.max(16, (plotWidth / Math.max(axisPoints.length, 1)) * 0.7),
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (coords.length === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = ((event.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      let minDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < coords.length; index += 1) {
        const coord = coords[index];
        if (!coord) continue;
        const distance = Math.abs(coord.x - relativeX);
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
    return <p className="py-6 text-center text-xs text-neutral-400">{emptyText}</p>;
  }

  const tooltipValue = activePoint
    ? `${formatValue(
        isMulti && hoveredIndex != null
          ? seriesMeta.reduce((sum, item) => sum + (item.values[hoveredIndex] ?? 0), 0)
          : activePoint.value,
      )}${valueSuffix ? ` ${valueSuffix}` : ""}`
    : "";
  const tooltipTopY =
    isMulti && hoveredIndex != null
      ? Math.min(
          ...seriesPaths.map((item) => item.coords[hoveredIndex]?.y ?? height),
          paddingTop + 24,
        )
      : activePoint?.y ?? 0;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none overflow-visible"
        style={{ height }}
        role="img"
        aria-label="Trend line chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="55%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={bandGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
          {isMulti
            ? seriesMeta.map((item, index) => (
                <linearGradient
                  key={item.name}
                  id={`${areaGradientId}-s${index}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={item.color} stopOpacity="0.22" />
                  <stop offset="55%" stopColor={item.color} stopOpacity="0.08" />
                  <stop offset="100%" stopColor={item.color} stopOpacity="0" />
                </linearGradient>
              ))
            : null}
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

        {/* Solid x-axis above date labels */}
        <line
          x1={plotLeft}
          x2={plotRight}
          y1={baselineY}
          y2={baselineY}
          stroke="#909090"
          strokeWidth="0.6"
        />

        {activePoint ? (
          <rect
            x={activePoint.x - bandWidth / 2}
            y={paddingTop}
            width={bandWidth}
            height={usableHeight}
            rx={bandWidth / 2}
            ry={bandWidth / 2}
            fill={`url(#${bandGradientId})`}
          />
        ) : null}

        {showArea && !isMulti && areaPath ? <path d={areaPath} fill={`url(#${areaGradientId})`} /> : null}
        {showArea && isMulti
          ? seriesPaths.map((item, index) =>
              item.areaPath ? (
                <path
                  key={`area-${item.name}`}
                  d={item.areaPath}
                  fill={`url(#${areaGradientId}-s${index})`}
                />
              ) : null,
            )
          : null}

        {isMulti
          ? seriesPaths.map((item) =>
              item.path ? (
                <path
                  key={item.name}
                  d={item.path}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2"
                />
              ) : null,
            )
          : linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth="2"
              />
            ) : null}

        {isMulti && hoveredIndex != null
          ? seriesPaths.map((item) => {
              const point = item.coords[hoveredIndex];
              if (!point) return null;
              return (
                <circle
                  key={`hover-${item.name}`}
                  cx={point.x}
                  cy={point.y}
                  r={6}
                  fill={item.color}
                  stroke="#ffffff"
                  strokeWidth="3"
                />
              );
            })
          : activePoint ? (
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={6}
                fill={color}
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

      {activePoint ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(activePoint.x / width) * 100}%`,
            top: `${(tooltipTopY / height) * 100}%`,
            marginTop: -14,
          }}
        >
          <div className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2 text-left shadow-lg">
            {isMulti && hoveredIndex != null ? (
              <>
                <p className="whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900">
                  {activePoint.label}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {seriesPaths.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-center gap-2 whitespace-nowrap text-[12px] leading-tight text-neutral-700"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.name}</span>
                      <span className="font-semibold tabular-nums text-neutral-900">
                        {formatValue(item.values[hoveredIndex] ?? 0)}
                        {valueSuffix ? ` ${valueSuffix}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900">
                  {tooltipValue}
                </p>
                <p className="mt-0.5 whitespace-nowrap text-[12px] leading-tight text-neutral-600">
                  {activePoint.label}
                </p>
              </>
            )}
          </div>
          <div className="mx-auto -mt-px h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-white drop-shadow-sm" />
        </div>
      ) : null}
      {isMulti ? (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {seriesMeta.map((item) => (
            <li key={item.name} className="flex items-center gap-1.5 text-[12px] text-[#212121]">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function trendLineSummary(
  points: TrendLinePoint[],
  summary?: string | number,
): string | number {
  if (summary != null) return summary;
  return points.reduce((sum, point) => sum + point.value, 0);
}
