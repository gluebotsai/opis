import {
  Skeleton,
  SkeletonCard,
  SkeletonGrid,
  SkeletonText,
} from "@/components/skeleton";

function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton width={56} height={11} />
      <SkeletonText width={70} height={14} />
    </div>
  );
}

/** Matches ContactDetailPage header + card grid (nav chrome stays real). */
export function ContactDetailSkeleton() {
  return (
    <div
      className="min-h-full bg-subtle/40 px-4 py-6 pb-28 sm:px-6 sm:py-8 sm:pb-28"
      aria-busy="true"
      aria-label="Loading contact"
    >
      <Skeleton width={100} height={14} />

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton width={200} height={28} />
          <Skeleton width={140} height={14} />
          <Skeleton width={120} height={12} />
        </div>
        <Skeleton width={72} height={36} borderRadius={8} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SkeletonCard padding="p-5" className="rounded-2xl shadow-sm">
          <SkeletonText width={40} height={14} />
          <SkeletonGrid columns={2} className="mt-4" gap="gap-4">
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
          </SkeletonGrid>
        </SkeletonCard>

        <SkeletonCard padding="p-5" className="rounded-2xl shadow-sm">
          <SkeletonText width={40} height={14} />
          <SkeletonGrid columns={2} className="mt-4" gap="gap-4">
            <FieldSkeleton />
            <FieldSkeleton />
          </SkeletonGrid>
        </SkeletonCard>

        <SkeletonCard
          padding="p-5"
          className="rounded-2xl shadow-sm lg:col-span-2"
        >
          <div className="space-y-2">
            <SkeletonText width={35} height={14} />
            <SkeletonText width={55} height={12} />
          </div>
          <SkeletonGrid columns={4} className="mt-4" gap="gap-4">
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
          </SkeletonGrid>
        </SkeletonCard>
      </div>
    </div>
  );
}
