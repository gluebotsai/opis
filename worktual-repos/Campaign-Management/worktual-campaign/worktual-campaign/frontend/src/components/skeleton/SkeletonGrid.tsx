import type { ReactNode } from "react";

type SkeletonGridProps = {
  columns?: 1 | 2 | 3 | 4;
  /** Optional hint for consumers; layout is driven by children. */
  rows?: number;
  children: ReactNode;
  className?: string;
  gap?: string;
};

const COL_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

/** Grid layout matching common app card grids. */
export function SkeletonGrid({
  columns = 2,
  children,
  className = "",
  gap = "gap-3",
}: SkeletonGridProps) {
  return (
    <div className={`grid ${COL_CLASS[columns]} ${gap} ${className}`.trim()}>
      {children}
    </div>
  );
}
