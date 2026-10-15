import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Matches ContactsSummaryPanel list area (search + contact rows). */
export function ContactsPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading contacts">
      <div className="shrink-0 pb-3">
        <Skeleton width="100%" height={36} borderRadius={12} />
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-xl px-2 py-3"
          >
            <Skeleton
              width={40}
              height={40}
              borderRadius={999}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <SkeletonText width={35 + (i % 4) * 8} height={14} />
                <Skeleton width={72} height={11} />
              </div>
              <SkeletonText width={55} height={14} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
