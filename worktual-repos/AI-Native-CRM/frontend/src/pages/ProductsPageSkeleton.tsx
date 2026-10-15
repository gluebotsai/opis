import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function ProductsPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid gap-3 rounded-xl border border-border-default bg-surface p-4 sm:grid-cols-[1fr_160px_180px]">
        <Skeleton height={40} borderRadius={8} />
        <Skeleton height={40} borderRadius={8} />
        <Skeleton height={40} borderRadius={8} />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        <div className="border-b border-border-default bg-subtle px-4 py-3">
          <div className="grid grid-cols-[3.5rem_1.4fr_1fr_0.8fr_1fr_0.8fr_0.7fr] gap-4">
            {Array.from({ length: 7 }).map((_, index) => (
              <SkeletonText key={index} width={index === 0 ? 18 : "55%"} height={12} />
            ))}
          </div>
        </div>
        <div>
          {Array.from({ length: 8 }).map((_, row) => (
            <div
              key={row}
              className="grid grid-cols-[3.5rem_1.4fr_1fr_0.8fr_1fr_0.8fr_0.7fr] gap-4 border-b border-border-default/70 px-4 py-3 last:border-0"
            >
              <Skeleton height={40} width={40} borderRadius={8} />
              <div className="space-y-2">
                <SkeletonText width={`${80 - row * 3}%`} />
                <SkeletonText width="48%" height={12} />
              </div>
              <SkeletonText width="70%" />
              <SkeletonText width="62%" />
              <SkeletonText width="74%" />
              <SkeletonText width="58%" />
              <Skeleton height={22} width={64} borderRadius={999} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
