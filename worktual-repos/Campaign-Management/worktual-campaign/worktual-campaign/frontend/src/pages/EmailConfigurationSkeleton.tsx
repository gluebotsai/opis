import { Skeleton, SkeletonCard, SkeletonText } from "@/components/skeleton";

/** Matches EmailConfigurationPage sections under back-link header. */
export function EmailConfigurationSkeleton() {
  return (
    <div
      className="px-4 py-6 sm:px-6 sm:py-8"
      aria-busy="true"
      aria-label="Loading email configuration"
    >
      <Skeleton width={100} height={14} />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton width={180} height={28} />
          <SkeletonText width={70} height={14} />
        </div>
        <Skeleton width={88} height={28} borderRadius={999} />
      </div>

      <SkeletonCard className="mt-4">
        <SkeletonText width={40} height={14} />
        <div className="mt-0.5">
          <SkeletonText width={65} height={12} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton width={72} height={12} />
              <Skeleton width="100%" height={38} borderRadius={8} />
            </div>
          ))}
        </div>
        <Skeleton width={112} height={36} borderRadius={8} className="mt-3" />
      </SkeletonCard>

      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonCard key={i} className="mt-4">
          <SkeletonText width={45} height={14} />
          <div className="mt-0.5">
            <SkeletonText width={80} height={12} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton width={64} height={12} />
                <Skeleton width="100%" height={38} borderRadius={8} />
              </div>
            ))}
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}
