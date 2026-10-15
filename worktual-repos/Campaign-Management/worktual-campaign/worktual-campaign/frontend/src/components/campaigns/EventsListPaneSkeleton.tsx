import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Matches EventsTrackingPane — Track / Draft tabs + event rows. */
export function EventsListPaneSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-hidden="true">
      <div className="flex shrink-0 gap-1 border-b border-neutral-100 px-2 pb-2">
        <Skeleton width={56} height={28} borderRadius={8} />
        <Skeleton width={52} height={28} borderRadius={8} />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden px-1 pt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-neutral-100 bg-neutral-50/80 px-3 py-3"
          >
            <SkeletonText width={55 + (i % 3) * 10} height={14} />
            <SkeletonText width={80} height={11} className="mt-2" />
            <SkeletonText width={65} height={11} className="mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
