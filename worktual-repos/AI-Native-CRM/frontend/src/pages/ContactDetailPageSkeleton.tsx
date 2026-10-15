import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { Skeleton } from "@/components/skeleton/Skeleton";

const lineWidths = ["82%", "64%", "76%", "58%", "70%"];

export function ContactDetailPageSkeleton() {
  return (
    <div className="w-full px-4 py-5 sm:px-6 sm:py-6">
      <div className="space-y-4">
        <Skeleton height={40} borderRadius={16} />
        <Skeleton height={40} borderRadius={16} />
      </div>

      <div className="mt-4 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SkeletonText width={112} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Skeleton height={28} width={224} borderRadius={12} />
            <Skeleton height={24} width={96} borderRadius={999} />
            <Skeleton height={24} width={80} borderRadius={999} />
          </div>
          <div className="mt-3">
            <SkeletonText width={256} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Skeleton height={40} width={128} borderRadius={8} />
            <Skeleton height={40} width={128} borderRadius={8} />
            <Skeleton height={40} width={128} borderRadius={8} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Skeleton height={40} width={112} borderRadius={8} />
          <Skeleton height={40} width={112} borderRadius={8} />
          <Skeleton height={40} width={96} borderRadius={8} />
        </div>
      </div>

      <SkeletonGrid columns="lg:grid-cols-2">
        <SkeletonCard>
          <SkeletonText width={144} height={20} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonText width={80} height={12} />
                <SkeletonText width={lineWidths[index % lineWidths.length]} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCard>
          <SkeletonText width={144} height={20} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonText width={80} height={12} />
                <SkeletonText width={lineWidths[(index + 2) % lineWidths.length]} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCard className="lg:col-span-2">
          <SkeletonText width={112} height={20} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonText width={80} height={12} />
                <SkeletonText width={lineWidths[index % lineWidths.length]} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCard className="lg:col-span-2">
          <SkeletonText width={160} height={20} />
          <div className="mt-2">
            <SkeletonText width={160} height={12} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonText width={64} height={12} />
                <SkeletonText width={lineWidths[(index + 1) % lineWidths.length]} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCard className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <SkeletonText width={80} height={20} />
              <SkeletonText width={192} height={12} />
            </div>
            <Skeleton height={40} width={96} borderRadius={8} />
          </div>
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonText width={lineWidths[index % lineWidths.length]} />
                  <SkeletonText width={96} height={12} />
                </div>
                <SkeletonText width={112} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCard className="lg:col-span-2">
          <SkeletonText width={128} height={20} />
          <div className="mt-5 space-y-4">
            <Skeleton height={96} />
            <Skeleton height={80} />
          </div>
        </SkeletonCard>

        <SkeletonCard className="lg:col-span-2">
          <SkeletonText width={160} height={20} />
          <div className="mt-5 space-y-5">
            {lineWidths.map((width, index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton height={32} width={32} borderRadius={999} />
                <div className="flex-1 space-y-2">
                  <SkeletonText width={width} />
                  <SkeletonText width={96} height={12} />
                  <Skeleton height={56} borderRadius={8} />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCard>
      </SkeletonGrid>
    </div>
  );
}
