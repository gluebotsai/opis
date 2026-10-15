import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function CompaniesPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <SkeletonText width={140} height={32} />
          <SkeletonText width={180} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton height={36} width={240} borderRadius={8} />
          <Skeleton height={36} width={120} borderRadius={8} />
        </div>
      </div>

      <SkeletonGrid columns="sm:grid-cols-2 lg:grid-cols-3" className="mt-8">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} className="p-5">
            <div className="flex items-start gap-3">
              <Skeleton height={44} width={44} borderRadius={12} />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonText width={`${76 - index * 4}%`} height={20} />
                <SkeletonText width={92} height={12} />
                <SkeletonText width={120} />
              </div>
            </div>
          </SkeletonCard>
        ))}
      </SkeletonGrid>
    </div>
  );
}
