import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

function FieldSkeleton({ labelWidth = 72 }: { labelWidth?: number }) {
  return (
    <div className="space-y-1.5">
      <SkeletonText width={labelWidth} height={12} />
      <SkeletonText width={`${58 + (labelWidth % 20)}%`} />
    </div>
  );
}

export function DealDetailPageSkeleton() {
  return (
    <div className="min-h-full bg-subtle" aria-busy="true" aria-label="Loading deal">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-0 lg:flex-row">
        <aside className="w-full shrink-0 border-b border-border-default bg-subtle lg:w-[340px] lg:border-r lg:border-b-0">
          <div className="sticky top-0 max-h-dvh space-y-4 overflow-y-auto p-4 sm:p-5">
            <SkeletonText width={72} height={14} />

            <SkeletonCard className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SkeletonText width={160} height={18} />
                <Skeleton height={22} width={72} borderRadius={6} />
              </div>
              <div className="mt-5 space-y-3">
                <FieldSkeleton labelWidth={64} />
                <FieldSkeleton labelWidth={80} />
                <FieldSkeleton labelWidth={96} />
                <FieldSkeleton labelWidth={56} />
              </div>
            </SkeletonCard>

            <SkeletonCard className="p-4">
              <SkeletonText width={64} height={16} />
              <div className="mt-4 space-y-3">
                <FieldSkeleton labelWidth={48} />
                <FieldSkeleton labelWidth={40} />
                <FieldSkeleton labelWidth={48} />
              </div>
            </SkeletonCard>

            <SkeletonCard className="p-4">
              <SkeletonText width={72} height={16} />
              <div className="mt-4 space-y-3">
                <FieldSkeleton labelWidth={56} />
                <FieldSkeleton labelWidth={64} />
              </div>
            </SkeletonCard>
          </div>
        </aside>

        <div className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText width={220} height={28} />
              <SkeletonText width={180} height={14} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton height={40} width={112} borderRadius={8} />
              <Skeleton height={40} width={72} borderRadius={8} />
              <Skeleton height={40} width={88} borderRadius={8} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} className="px-4 py-3">
                <SkeletonText width={72} height={12} />
                <div className="mt-2">
                  <SkeletonText width={96} height={24} />
                </div>
              </SkeletonCard>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2 border-b border-border-default pb-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} height={32} width={84} borderRadius={8} />
            ))}
          </div>

          <SkeletonCard className="mt-5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SkeletonText width={112} height={18} />
              <Skeleton height={36} width={120} borderRadius={8} />
            </div>
            <div className="mt-5 space-y-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-start gap-3">
                  <Skeleton height={32} width={32} borderRadius={999} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonText width={`${78 - index * 8}%`} />
                    <SkeletonText width="42%" height={12} />
                    <Skeleton height={56} borderRadius={8} />
                  </div>
                </div>
              ))}
            </div>
          </SkeletonCard>
        </div>
      </div>
    </div>
  );
}
