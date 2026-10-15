import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function FinanceShellSkeleton({
  children,
}: {
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 space-y-2">
        <SkeletonText width={96} height={28} />
        <SkeletonText width={360} />
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl border border-border-default bg-surface">
        <div className="flex min-w-max items-center gap-1.5 px-3 py-2.5">
          <Skeleton height={28} width={88} borderRadius={8} />
          <span className="mx-1 h-4 w-px bg-border-default" aria-hidden />
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} height={28} width={108} borderRadius={8} />
          ))}
          <Skeleton height={28} width={104} borderRadius={8} className="ml-1" />
        </div>
      </div>

      {children}
    </div>
  );
}

export function FinancePageSkeleton() {
  return (
    <FinanceShellSkeleton>
      <SkeletonGrid columns="sm:grid-cols-2 xl:grid-cols-4" className="gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} className="p-4">
            <SkeletonText width={92} height={12} />
            <div className="mt-2">
              <SkeletonText width={88} height={32} />
            </div>
            <div className="mt-2">
              <SkeletonText width="60%" height={12} />
            </div>
          </SkeletonCard>
        ))}
      </SkeletonGrid>

      <div className="mt-6 grid gap-3 rounded-xl border border-border-default bg-surface p-4 sm:grid-cols-[1fr_180px]">
        <Skeleton height={40} borderRadius={8} />
        <Skeleton height={40} borderRadius={8} />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        <div className="border-b border-border-default bg-subtle px-4 py-3">
          <div className="grid grid-cols-[1fr_1fr_1fr_0.7fr_0.7fr_0.8fr_1fr] gap-4">
            {Array.from({ length: 7 }).map((_, index) => (
              <SkeletonText key={index} width="55%" height={12} />
            ))}
          </div>
        </div>
        <div>
          {Array.from({ length: 7 }).map((_, row) => (
            <div
              key={row}
              className="grid grid-cols-[1fr_1fr_1fr_0.7fr_0.7fr_0.8fr_1fr] gap-4 border-b border-border-default/70 px-4 py-3 last:border-0"
            >
              <SkeletonText width={`${74 - row * 3}%`} />
              <SkeletonText width="70%" />
              <SkeletonText width="66%" />
              <Skeleton height={22} width={64} borderRadius={999} />
              <SkeletonText width="58%" />
              <SkeletonText width="62%" />
              <div className="flex justify-end gap-1.5">
                <Skeleton height={32} width={56} borderRadius={8} />
                <Skeleton height={32} width={56} borderRadius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </FinanceShellSkeleton>
  );
}

export function FinanceInvoiceDetailSkeleton() {
  return (
    <FinanceShellSkeleton>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonText width={120} height={28} />
            <Skeleton height={22} width={64} borderRadius={999} />
          </div>
          <SkeletonText width={240} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton height={36} width={88} borderRadius={8} />
          <Skeleton height={36} width={108} borderRadius={8} />
        </div>
      </div>

      <SkeletonCard className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <SkeletonText width={80} height={12} />
              <SkeletonText width={`${70 - index * 4}%`} />
            </div>
          ))}
        </div>
      </SkeletonCard>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        <div className="border-b border-border-default px-5 py-3">
          <SkeletonText width={96} height={16} />
        </div>
        <div className="divide-y divide-border-default/70">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonText width={`${78 - index * 6}%`} />
                <SkeletonText width="42%" height={12} />
              </div>
              <SkeletonText width={72} />
            </div>
          ))}
        </div>
      </div>
    </FinanceShellSkeleton>
  );
}

export function FinanceInvoiceCreateSkeleton() {
  return (
    <FinanceShellSkeleton>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonText width={88} height={12} />
            <SkeletonText width={160} height={24} />
            <SkeletonText width={280} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton height={36} width={88} borderRadius={8} />
            <Skeleton height={36} width={120} borderRadius={8} />
          </div>
        </div>

        <SkeletonCard className="p-5 sm:p-6">
          <SkeletonText width={120} height={16} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonText width={72} height={12} />
                <Skeleton height={40} borderRadius={8} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <SkeletonCard className="p-5 sm:p-6">
            <SkeletonText width={100} height={16} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height={72} borderRadius={8} />
              ))}
            </div>
          </SkeletonCard>
          <SkeletonCard className="p-5 sm:p-6">
            <SkeletonText width={88} height={16} />
            <div className="mt-4 space-y-3">
              <Skeleton height={40} borderRadius={8} />
              <Skeleton height={40} borderRadius={8} />
              <Skeleton height={96} borderRadius={8} />
            </div>
          </SkeletonCard>
        </div>
      </div>
    </FinanceShellSkeleton>
  );
}
