import {
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from "@/components/skeleton";

/** Matches CampaignMonitorDetailPage layout: header + channel cards + aside. */
export function CampaignMonitorDetailSkeleton() {
  return (
    <div
      className="flex h-[calc(100dvh-3.5rem)] flex-col bg-subtle"
      aria-busy="true"
      aria-label="Loading campaign"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-default bg-surface px-3 sm:px-4">
        <Skeleton width={36} height={36} borderRadius={8} />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonText width={40} height={14} />
          <SkeletonText width={55} height={12} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_280px]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Skeleton width={40} height={40} borderRadius={8} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <SkeletonText width={30} height={14} />
                      <SkeletonText width={55} height={12} />
                    </div>
                    <Skeleton width={88} height={36} borderRadius={8} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <SkeletonText width={90} height={14} />
                    <SkeletonText width={70} height={14} />
                  </div>
                </SkeletonCard>
              ))}
            </div>
          </div>
          {/* Composer chrome stays — empty bar placeholder matching height */}
          <div className="shrink-0 border-t border-border-default bg-surface px-3 py-3 sm:px-4">
            <Skeleton
              width="100%"
              height={44}
              borderRadius={22}
              className="max-w-3xl mx-auto"
            />
          </div>
        </div>

        <aside className="hidden min-h-0 overflow-y-auto border-l border-border-default bg-surface p-4 lg:block">
          <Skeleton width={120} height={12} />
          <dl className="mt-3 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton width={64} height={12} />
                <SkeletonText width={70 + (i % 3) * 8} height={14} />
              </div>
            ))}
          </dl>
          <div className="mt-6">
            <Skeleton width={140} height={12} />
            <div className="mt-3 h-44">
              <Skeleton
                width="100%"
                height="100%"
                borderRadius={8}
                className="!block h-full w-full"
              />
            </div>
            <ul className="mt-2 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <Skeleton width={48} height={12} />
                  <Skeleton width={32} height={12} />
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
