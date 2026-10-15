import { Skeleton } from "./Skeleton";

export function SkeletonText({
  width = "100%",
  height = 14,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return <Skeleton width={width} height={height} borderRadius={6} className={className} />;
}
