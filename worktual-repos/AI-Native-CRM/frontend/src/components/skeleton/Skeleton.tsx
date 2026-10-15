import type { CSSProperties } from "react";

type Size = number | string;

export type SkeletonProps = {
  width?: Size;
  height?: Size;
  borderRadius?: Size;
  className?: string;
};

function toCssSize(value: Size | undefined, fallback: string): string {
  if (value == null) return fallback;
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 6,
  className = "",
}: SkeletonProps) {
  const style: CSSProperties = {
    width: toCssSize(width, "100%"),
    height: toCssSize(height, "16px"),
    borderRadius: toCssSize(borderRadius, "6px"),
  };

  return (
    <div
      aria-hidden
      className={`crm-skeleton ${className}`.trim()}
      style={style}
    />
  );
}
