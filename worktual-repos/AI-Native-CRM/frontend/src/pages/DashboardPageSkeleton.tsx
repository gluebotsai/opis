import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { REPORT_SURFACE_CLASS } from "@/components/home/ReportDashboardLayout";

export function DashboardPageSkeleton() {
  return (
    <div className="w-full min-w-0 bg-white px-4 py-4 sm:px-5 sm:py-5">
        <div className="mx-auto max-w-[1400px] space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <SkeletonText width={180} height={28} />
              <SkeletonText width={140} height={14} />
            </div>
            <div className="flex gap-2">
              <Skeleton height={36} width={132} borderRadius={12} />
              <Skeleton height={36} width={220} borderRadius={12} />
            </div>
          </div>

          <Skeleton height={40} width={280} borderRadius={12} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className={`${REPORT_SURFACE_CLASS} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <SkeletonText width={92} height={12} />
                  <Skeleton height={36} width={36} borderRadius={12} />
                </div>
                <div className="mt-4 space-y-2">
                  <SkeletonText width={108} height={32} />
                  <SkeletonText width="70%" height={12} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className={`${REPORT_SURFACE_CLASS} p-4`}>
                <SkeletonText width={160} height={16} />
                <Skeleton height={220} borderRadius={12} className="mt-4" />
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}
