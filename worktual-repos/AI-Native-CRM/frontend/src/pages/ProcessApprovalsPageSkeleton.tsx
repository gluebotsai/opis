import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function ProcessApprovalsPageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 space-y-2">
        <SkeletonText width={180} height={28} />
        <SkeletonText width="72%" />
        <SkeletonText width="58%" />
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonCard key={index} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-2">
                <SkeletonText width={220} />
                <SkeletonText width={96} height={12} />
              </div>
              <SkeletonText width={92} height={12} />
            </div>
            <div className="mt-3 space-y-2">
              <SkeletonText width="88%" />
              <SkeletonText width="66%" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Skeleton height={34} width={112} borderRadius={8} />
              <Skeleton height={34} width={88} borderRadius={8} />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
