import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function ReportsPageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <SkeletonText width={220} height={28} />
          <SkeletonText width="92%" />
          <SkeletonText width="68%" />
        </div>
        <Skeleton height={40} width={144} borderRadius={8} />
      </div>

      <SkeletonGrid columns="sm:grid-cols-2" className="mt-8">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} className="p-5">
            <SkeletonText width={108} height={12} />
            {index < 2 ? (
              <div className="mt-3 space-y-2">
                <SkeletonText width="72%" />
                <SkeletonText width="48%" />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <Skeleton height={14} />
                <Skeleton height={14} width="88%" />
                <Skeleton height={14} width="74%" />
                <Skeleton height={14} width="64%" />
              </div>
            )}
          </SkeletonCard>
        ))}
      </SkeletonGrid>
    </div>
  );
}
