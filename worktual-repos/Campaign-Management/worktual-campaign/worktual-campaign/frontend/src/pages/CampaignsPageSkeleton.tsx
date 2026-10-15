import { SkeletonText } from "@/components/skeleton";

/** Matches CampaignMonitoringList table (Name · date · Status). */
export function CampaignsPageSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border-default bg-surface"
      aria-busy="true"
      aria-label="Loading campaigns"
    >
      <div className="border-b border-border-default bg-subtle px-4 py-3">
        <div className="grid grid-cols-3 gap-4">
          <SkeletonText width={40} height={12} />
          <SkeletonText width={50} height={12} />
          <SkeletonText width={40} height={12} />
        </div>
      </div>
      <ul>
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="grid grid-cols-3 gap-4 border-b border-border-default px-4 py-3 last:border-0"
          >
            <SkeletonText width={60 + (i % 3) * 8} height={14} />
            <SkeletonText width={70} height={14} />
            <SkeletonText width={40} height={14} />
          </li>
        ))}
      </ul>
    </div>
  );
}
