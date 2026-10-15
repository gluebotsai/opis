import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

type InteractiveDonutChartProps = {
  slices: DonutSlice[];
  /** Outer diameter in px */
  size?: number;
  /** Inner hole as a fraction of the ring outer radius (0–1) */
  holeRatio?: number;
  /** Ring thickness in px. Matches bar width when set (22 compact / 28 expanded). */
  ringWidth?: number;
  /** Extra spacing used to position the hover value badge */
  explodeDistance?: number;
  className?: string;
  emptyColor?: string;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
};

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  // 0° at 12 o'clock, clockwise (matches CSS conic-gradient)
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function donutSegmentPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep <= 0.001) return "";

  if (sweep >= 359.999) {
    return [
      `M ${cx} ${cy - outerR}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx} ${cy + outerR}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx} ${cy - outerR}`,
      `M ${cx} ${cy - innerR}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx} ${cy + innerR}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx} ${cy - innerR}`,
      "Z",
    ].join(" ");
  }

  const largeArc = sweep > 180 ? 1 : 0;
  const outerStart = polar(cx, cy, outerR, startAngle);
  const outerEnd = polar(cx, cy, outerR, endAngle);
  const innerEnd = polar(cx, cy, innerR, endAngle);
  const innerStart = polar(cx, cy, innerR, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

export function InteractiveDonutChart({
  slices,
  size = 96,
  holeRatio = 2 / 3,
  ringWidth,
  explodeDistance = 10,
  className,
  emptyColor = "#e5e7eb",
  activeIndex,
  onActiveIndexChange,
}: InteractiveDonutChartProps) {
  const [internalActiveIndex, setInternalActiveIndex] = useState<number | null>(null);
  const hoveredIndex = activeIndex === undefined ? internalActiveIndex : activeIndex;
  const setHoveredIndex = (index: number | null) => {
    setInternalActiveIndex(index);
    onActiveIndexChange?.(index);
  };

  const total = useMemo(
    () => slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0),
    [slices],
  );

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2;
  const innerR =
    ringWidth != null ? Math.max(8, outerR - ringWidth) : outerR * holeRatio;
  const hoverThickness = size >= 200 ? 6 : 3;

  const prepared = useMemo(() => {
    const active = slices
      .map((slice, index) => ({ ...slice, index }))
      .filter((slice) => slice.value > 0);

    if (active.length === 0 || total <= 0) return [];

    const gapDeg = active.length > 1 ? 1.8 : 0;
    let cursor = 0;

    return active.map((slice) => {
      const span = (slice.value / total) * 360;
      const startAngle = cursor + gapDeg / 2;
      const endAngle = cursor + span - gapDeg / 2;
      cursor += span;
      const midAngle = (startAngle + endAngle) / 2;
      return {
        ...slice,
        startAngle,
        endAngle,
        midAngle,
        path: donutSegmentPath(cx, cy, outerR, innerR, startAngle, endAngle),
      };
    });
  }, [cx, cy, innerR, outerR, slices, total]);

  const hovered =
    hoveredIndex == null ? null : prepared.find((slice) => slice.index === hoveredIndex) ?? null;

  const badge =
    hovered == null
      ? null
      : (() => {
          const radialTip = polar(cx, cy, outerR + explodeDistance, hovered.midAngle);
          const label = String(hovered.value);
          const badgeW = Math.max(28, label.length * 7.5 + 14);
          const badgeH = 20;
          const badgeX = Math.min(
            size - badgeW / 2 - 2,
            Math.max(badgeW / 2 + 2, radialTip.x),
          );
          return { badgeX, label, badgeW, badgeH };
        })();

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="overflow-visible"
        role="img"
        aria-label="Donut chart"
      >
        {prepared.length === 0 ? (
          <path d={donutSegmentPath(cx, cy, outerR, innerR, 0, 359.999)} fill={emptyColor} />
        ) : (
          prepared.map((slice) => {
            const isHovered = hoveredIndex === slice.index;
            return (
              <g
                key={`${slice.label}-${slice.index}`}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${slice.label}: ${slice.value}`}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setHoveredIndex(slice.index)}
                onFocus={() => setHoveredIndex(slice.index)}
                onBlur={() => setHoveredIndex(null)}
              >
                {/* Fixed, generous hit target keeps small slices easy to hover. */}
                <path
                  d={slice.path}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={8}
                  pointerEvents="all"
                />
                {/* Extend only the outer edge; the inner hole and angular gaps stay fixed. */}
                <path
                  d={donutSegmentPath(
                    cx,
                    cy,
                    outerR + hoverThickness,
                    outerR - 0.25,
                    slice.startAngle,
                    slice.endAngle,
                  )}
                  fill={slice.color}
                  pointerEvents="none"
                  style={{
                    opacity: isHovered ? 1 : 0,
                    transition: "opacity 140ms ease-out",
                  }}
                />
                <path
                  d={slice.path}
                  fill={slice.color}
                  pointerEvents="none"
                  style={{
                    transition: "opacity 160ms ease-out",
                    opacity: hoveredIndex == null || isHovered ? 1 : 0.62,
                  }}
                >
                  <title>
                    {slice.label}: {slice.value}
                  </title>
                </path>
              </g>
            );
          })
        )}

        {badge && hovered ? (
          <g
            style={{
              transform: `translate(${badge.badgeX}px, 0px)`,
              transition: "transform 140ms ease-out",
              pointerEvents: "none",
            }}
          >
            <rect
              x={-badge.badgeW / 2}
              y={-16}
              width={badge.badgeW}
              height={badge.badgeH}
              rx={6}
              ry={6}
              fill={hovered.color}
              className="drop-shadow-sm"
            />
            <text
              x={0}
              y={-16 + badge.badgeH / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#ffffff"
              fontSize="11"
              fontWeight="600"
              fontFamily="inherit"
            >
              {badge.label}
            </text>
          </g>
        ) : null}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            "font-semibold tabular-nums text-neutral-900",
            size >= 200 ? "text-5xl" : size >= 140 ? "text-3xl" : "text-xl",
          )}
        >
          {total}
        </span>
        <span
          className={cn(
            "uppercase tracking-wide text-neutral-600",
            size >= 200 ? "text-[11px]" : "text-[9px]",
          )}
        >
          Total
        </span>
      </div>
    </div>
  );
}
