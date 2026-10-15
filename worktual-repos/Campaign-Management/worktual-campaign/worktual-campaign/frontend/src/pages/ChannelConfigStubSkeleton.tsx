import { Skeleton, SkeletonCard, SkeletonText } from "@/components/skeleton";

/** Matches ChannelConfigStubPage content card under header. */
export function ChannelConfigStubSkeleton() {
  return (
    <div className="mt-6" aria-busy="true" aria-label="Loading channel">
      <SkeletonCard padding="p-5" className="rounded-2xl">
        <div className="space-y-2">
          <SkeletonText width={85} height={14} />
          <SkeletonText width={60} height={14} />
        </div>
        <div className="mt-2">
          <Skeleton width={120} height={12} />
        </div>
        <ul className="mt-4 divide-y divide-border-default">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <div className="space-y-2">
                <SkeletonText width={45} height={14} />
                <SkeletonText width={35} height={12} />
              </div>
            </li>
          ))}
        </ul>
      </SkeletonCard>
    </div>
  );
}
