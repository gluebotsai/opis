import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

function LocationCardSkeleton() {
  return (
    <SkeletonCard className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <SkeletonText width="58%" height={20} />
        <Skeleton height={22} width={48} borderRadius={6} />
      </div>
      <div className="mt-2 space-y-1.5">
        <SkeletonText width="48%" />
        <SkeletonText width="72%" height={12} />
      </div>
      <div className="mt-auto mt-4 grid grid-cols-3 gap-2 border-t border-border-default pt-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-1">
            <SkeletonText width="70%" height={10} />
            <SkeletonText width={28} height={16} />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export function CompanyDetailPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <SkeletonText width={120} height={14} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <SkeletonText width={220} height={32} />
          <SkeletonText width={180} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton height={40} width={112} borderRadius={8} />
          <Skeleton height={40} width={120} borderRadius={8} />
          <Skeleton height={40} width={132} borderRadius={8} />
        </div>
      </div>

      <section className="mt-8">
        <SkeletonText width={96} height={20} />
        <div className="mt-1">
          <SkeletonText width={220} height={12} />
        </div>

        <SkeletonGrid columns="sm:grid-cols-2 lg:grid-cols-3" className="mt-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <LocationCardSkeleton key={index} />
          ))}
        </SkeletonGrid>
      </section>

      <section className="mt-8">
        <SkeletonText width={112} height={20} />
        <div className="mt-1">
          <SkeletonText width={200} height={12} />
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border-default bg-surface">
          <div className="border-b border-border-default bg-subtle px-4 py-3">
            <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr] gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonText key={index} width="55%" height={12} />
              ))}
            </div>
          </div>
          <div>
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr] gap-4 border-b border-border-default/70 px-4 py-3 last:border-0"
              >
                <SkeletonText width={`${78 - row * 4}%`} />
                <SkeletonText width="70%" />
                <SkeletonText width="60%" />
                <SkeletonText width="66%" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
