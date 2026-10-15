import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function DealFormPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <SkeletonText width={56} height={14} />
      <div className="mt-2">
        <SkeletonText width={140} height={28} />
      </div>

      <SkeletonCard className="mt-6 p-5">
        <div className="space-y-2">
          <SkeletonText width={64} height={12} />
          <Skeleton height={40} borderRadius={8} />
        </div>

        <SkeletonGrid columns="sm:grid-cols-2" className="mt-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <SkeletonText width={72} height={12} />
              <Skeleton height={40} borderRadius={8} />
            </div>
          ))}
        </SkeletonGrid>

        <div className="mt-4 space-y-2">
          <SkeletonText width={72} height={12} />
          <Skeleton height={96} borderRadius={8} />
        </div>

        <div className="mt-6 flex gap-3">
          <Skeleton height={40} width={108} borderRadius={8} />
          <Skeleton height={40} width={92} borderRadius={8} />
        </div>
      </SkeletonCard>
    </div>
  );
}
