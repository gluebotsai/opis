import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

export function MeetingAssistPanelPageSkeleton() {
  return (
    <div className="h-screen overflow-hidden bg-canvas">
      <div className="flex h-full min-h-0">
        <aside className="hidden w-[320px] shrink-0 border-r border-border-default bg-surface xl:block">
          <div className="p-4 space-y-4">
            <Skeleton height={40} borderRadius={8} />
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonText width={`${80 - index * 4}%`} />
                <SkeletonText width="42%" height={12} />
              </div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-subtle/40 p-4">
          <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-xl border border-border-default bg-surface p-4">
              <div className="space-y-3">
                <SkeletonText width={180} height={20} />
                <Skeleton height={160} borderRadius={8} />
                <Skeleton height={160} borderRadius={8} />
                <Skeleton height={160} borderRadius={8} />
              </div>
            </section>

            <section className="rounded-xl border border-border-default bg-surface p-4">
              <div className="space-y-3">
                <SkeletonText width={120} height={20} />
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <SkeletonText width={`${88 - index * 6}%`} />
                    <SkeletonText width="48%" height={12} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
