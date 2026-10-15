import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function InboxPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-white">
      <div className="border-b border-[#bfbfbf]/80 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonText width={88} height={20} />
            <SkeletonText width={148} height={12} />
          </div>
          <div className="flex gap-2">
            <Skeleton height={36} width={36} borderRadius={8} />
            <Skeleton height={36} width={36} borderRadius={8} />
            <Skeleton height={36} width={112} borderRadius={8} />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="hidden border-r border-[#e5e5e5] bg-white md:flex md:w-[300px] lg:w-[320px]">
          <div className="w-full p-3 space-y-3">
            <Skeleton height={36} borderRadius={8} />
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-[#e5e5e5] p-3">
                <div className="flex items-start gap-3">
                  <Skeleton height={40} width={40} borderRadius={999} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonText width={`${84 - index * 4}%`} />
                    <SkeletonText width="56%" height={12} />
                    <SkeletonText width="72%" height={12} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-neutral-50 p-4">
          <div className="h-full rounded-xl border border-[#e5e5e5] bg-white p-4">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonText width={220} height={20} />
                  <SkeletonText width={120} height={12} />
                </div>
                <div className="flex gap-2">
                  <Skeleton height={32} width={32} borderRadius={8} />
                  <Skeleton height={32} width={32} borderRadius={8} />
                  <Skeleton height={32} width={32} borderRadius={8} />
                </div>
              </div>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="rounded-xl border border-[#e5e5e5] p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton height={36} width={36} borderRadius={999} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <SkeletonText width={`${88 - index * 5}%`} />
                      <SkeletonText width="40%" height={12} />
                      <Skeleton height={72} borderRadius={8} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        <aside className="hidden w-[300px] border-l border-[#e5e5e5] bg-white xl:block">
          <div className="p-4 space-y-3">
            <SkeletonText width={112} height={18} />
            <Skeleton height={84} borderRadius={8} />
            <Skeleton height={84} borderRadius={8} />
            <Skeleton height={84} borderRadius={8} />
          </div>
        </aside>
      </div>
    </div>
  );
}
