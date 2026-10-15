import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function ActivitiesPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <SkeletonGrid columns="sm:grid-cols-2 lg:grid-cols-4" className="gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <SkeletonText width={96} height={12} />
                <SkeletonText width={56} height={32} />
              </div>
              <Skeleton height={36} width={36} borderRadius={8} />
            </div>
          </SkeletonCard>
        ))}
      </SkeletonGrid>

      <div className="mt-6 space-y-3 rounded-xl border border-border-default bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={32} width={84} borderRadius={8} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_180px]">
          <Skeleton height={40} borderRadius={8} />
          <Skeleton height={40} borderRadius={8} />
          <Skeleton height={40} borderRadius={8} />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        <div className="border-b border-border-default bg-subtle px-4 py-3">
          <div className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.7fr] gap-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonText key={index} width="55%" height={12} />
            ))}
          </div>
        </div>
        <div>
          {Array.from({ length: 8 }).map((_, row) => (
            <div
              key={row}
              className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.7fr] gap-4 border-b border-border-default/70 px-4 py-3 last:border-0"
            >
              <div className="space-y-2">
                <SkeletonText width={`${82 - row * 3}%`} />
                <SkeletonText width="52%" height={12} />
              </div>
              <SkeletonText width="70%" />
              <Skeleton height={22} width={64} borderRadius={6} />
              <SkeletonText width="66%" />
              <Skeleton height={22} width={72} borderRadius={6} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
