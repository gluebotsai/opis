import { Skeleton, SkeletonCard, SkeletonText } from "@/components/skeleton";

/** Matches DashboardOverviewPanel layout (Worktual right-panel chrome). */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <SkeletonText width={55} height={14} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard
            key={i}
            className="!min-h-[136px] !rounded-xl !border-[0.6px] !border-[#bfbfbf] !p-4 !shadow-none"
          >
            <div className="flex items-start justify-between gap-2">
              <SkeletonText width={40} height={14} />
              <Skeleton width={38} height={38} borderRadius={12} />
            </div>
            <div className="mt-3">
              <SkeletonText width={45} height={22} />
            </div>
            <div className="mt-2">
              <SkeletonText width={70} height={14} />
            </div>
          </SkeletonCard>
        ))}
      </section>

      <SkeletonCard className="!rounded-xl !border-[0.6px] !border-[#bfbfbf] !p-4 !shadow-none">
        <div className="flex items-start gap-3">
          <Skeleton width={38} height={38} borderRadius={12} />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonText width={35} height={14} />
            <SkeletonText width={85} height={14} />
            <SkeletonText width={40} height={11} />
          </div>
        </div>
      </SkeletonCard>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard
            key={i}
            className="!rounded-xl !border-[0.6px] !border-[#bfbfbf] !p-4 !shadow-none"
          >
            <SkeletonText width={40} height={14} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <SkeletonText width={50} height={22} />
              <SkeletonText width={40} height={22} />
            </div>
          </SkeletonCard>
        ))}
      </section>

      <SkeletonCard className="!rounded-xl !border-[0.6px] !border-[#bfbfbf] !p-4 !shadow-none sm:!p-5">
        <SkeletonText width={35} height={14} />
        <div className="mt-1">
          <SkeletonText width={60} height={14} />
        </div>
        <div className="mt-4">
          <Skeleton width="100%" height={220} borderRadius={8} className="!block" />
        </div>
      </SkeletonCard>

      <SkeletonCard className="!rounded-xl !border-[0.6px] !border-[#bfbfbf] !p-4 !shadow-none sm:!p-5">
        <SkeletonText width={45} height={14} />
        <div className="mt-4 space-y-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border-t border-neutral-200 py-3 first:border-0"
            >
              <SkeletonText width={30} height={12} />
              <Skeleton width={48} height={12} />
              <Skeleton width={48} height={12} />
              <Skeleton width={48} height={12} />
            </div>
          ))}
        </div>
      </SkeletonCard>

      <SkeletonCard className="!overflow-hidden !rounded-xl !border-[0.6px] !border-[#bfbfbf] !p-0 !shadow-none">
        <div className="border-b border-[0.6px] border-[#bfbfbf] px-4 py-3">
          <SkeletonText width={35} height={14} />
        </div>
        <div className="space-y-0 px-4 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border-t border-neutral-200 py-3 first:border-0"
            >
              <SkeletonText width={45} height={14} />
              <Skeleton width={64} height={12} />
              <Skeleton width={96} height={12} />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
