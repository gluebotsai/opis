import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function SalesCalendarGridSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid shrink-0 border-b border-border-default"
        style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
      >
        <div className="border-r border-border-default" />
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="border-r border-border-default px-1 py-2 text-center last:border-r-0"
          >
            <div className="mx-auto space-y-1">
              <SkeletonText width={36} height={12} className="mx-auto" />
              <SkeletonText width={24} height={16} className="mx-auto" />
            </div>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}
        >
          <div className="border-r border-border-default">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="flex h-16 items-start justify-end border-b border-border-default/70 pr-2 pt-1"
              >
                <SkeletonText width={28} height={10} />
              </div>
            ))}
          </div>

          {Array.from({ length: 7 }).map((_, day) => (
            <div
              key={day}
              className="relative border-r border-border-default last:border-r-0"
            >
              {Array.from({ length: 8 }).map((_, hour) => (
                <div
                  key={hour}
                  className="h-16 border-b border-border-default/70 px-1.5 py-1.5"
                >
                  {(day + hour) % 3 === 0 ? (
                    <Skeleton height={40} borderRadius={6} />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SalesCalendarAsideSkeleton() {
  return (
    <>
      <div className="rounded-xl border border-border-default bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <SkeletonText width={120} height={16} />
          <div className="flex gap-1">
            <Skeleton height={28} width={28} borderRadius={8} />
            <Skeleton height={28} width={28} borderRadius={8} />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, index) => (
            <Skeleton key={index} height={28} borderRadius={6} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface p-4">
        <SkeletonText width={160} height={14} />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-1.5 rounded-lg border border-border-default/70 p-2.5">
              <SkeletonText width={`${80 - index * 8}%`} />
              <SkeletonText width="48%" height={12} />
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-border-default pt-4">
          <SkeletonText width={180} height={14} />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="space-y-1.5 rounded-lg border border-border-default/70 p-2.5">
                <SkeletonText width={`${72 - index * 6}%`} />
                <SkeletonText width="42%" height={12} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <Skeleton height={40} borderRadius={8} />
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface p-4 space-y-2">
        <SkeletonText width={120} height={16} />
        <SkeletonText width="92%" height={12} />
        <SkeletonText width="78%" height={12} />
        <SkeletonText width={96} height={14} className="mt-2" />
      </div>
    </>
  );
}
