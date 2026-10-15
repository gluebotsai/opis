import type { CSSProperties } from "react";

type SkeletonProps = {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
};

function toCssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/** Base skeleton block — #e8e8e8 opacity pulse. */
export function Skeleton({
  width,
  height,
  borderRadius = 6,
  className = "",
}: SkeletonProps) {
  const style: CSSProperties = {
    width: toCssSize(width),
    height: toCssSize(height),
    borderRadius: toCssSize(borderRadius),
  };

  return (
    <div
      className={`skeleton-pulse shrink-0 ${className}`.trim()}
      style={style}
      aria-hidden
    />
  );
}
