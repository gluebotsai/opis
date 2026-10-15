import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function ContactsPageSkeleton() {
  return (
    <div className="w-full px-4 py-5 sm:px-6 sm:py-6">
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border-default bg-surface p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(9rem,10rem))]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Skeleton height={40} borderRadius={8} />
        </div>
        <Skeleton height={40} borderRadius={8} />
        <Skeleton height={40} borderRadius={8} />
        <Skeleton height={40} borderRadius={8} />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        <div className="border-b border-border-default bg-subtle px-4 py-3">
          <div className="grid min-w-full grid-cols-[2.5rem_1.2fr_1.2fr_1fr_1fr_1fr_1.1fr_8rem] gap-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <SkeletonText key={index} width={index === 0 ? 18 : "70%"} height={12} />
            ))}
          </div>
        </div>

        <div>
          {Array.from({ length: 8 }).map((_, row) => (
            <div
              key={row}
              className="grid grid-cols-[2.5rem_1.2fr_1.2fr_1fr_1fr_1fr_1.1fr_8rem] gap-4 border-b border-border-default/70 px-4 py-3 last:border-0"
            >
              <Skeleton height={16} width={16} borderRadius={4} />
              <div className="space-y-2">
                <SkeletonText width={`${78 - row * 3}%`} />
                <SkeletonText width="56%" height={12} />
              </div>
              <SkeletonText width={`${80 - row * 4}%`} />
              <SkeletonText width="70%" />
              <SkeletonText width="60%" />
              <SkeletonText width="66%" />
              <SkeletonText width="74%" />
              <div className="flex justify-end gap-2">
                <Skeleton height={32} width={32} borderRadius={8} />
                <Skeleton height={32} width={32} borderRadius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
