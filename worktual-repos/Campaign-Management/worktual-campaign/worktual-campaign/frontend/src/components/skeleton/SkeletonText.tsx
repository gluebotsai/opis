import { Skeleton } from "./Skeleton";

type SkeletonTextProps = {
  /** Width as percent of parent (e.g. 60 → 60%). */
  width?: number;
  height?: number;
  className?: string;
};

/** Skeleton line sized for body text. */
export function SkeletonText({
  width = 100,
  height = 14,
  className = "",
}: SkeletonTextProps) {
  return (
    <Skeleton
      width={`${width}%`}
      height={height}
      borderRadius={6}
      className={className}
    />
  );
}
