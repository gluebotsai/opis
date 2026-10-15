import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Form event editor — agent/manual tabs + live preview split. */
export function CreateEventEditorSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 bg-[#f3f4f6] p-4 sm:p-5"
      aria-busy="true"
      aria-label="Loading form editor"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton width={36} height={36} borderRadius={8} />
          <div className="min-w-0 space-y-2">
            <SkeletonText width={45} height={14} />
            <SkeletonText width={30} height={12} />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton width={88} height={32} borderRadius={8} />
          <Skeleton width={96} height={32} borderRadius={8} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_minmax(280px,0.45fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-100 px-4">
            <Skeleton width={48} height={28} borderRadius={8} />
            <Skeleton width={56} height={28} borderRadius={8} />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
              >
                <div className="w-[75%] space-y-2 rounded-2xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5">
                  <SkeletonText width={90} height={14} />
                  <SkeletonText width={55} height={14} />
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-neutral-100 px-3 py-3">
            <Skeleton width="100%" height={44} borderRadius={12} />
          </div>
        </div>

        <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm lg:flex">
          <div className="flex h-11 shrink-0 items-center border-b border-neutral-100 px-4">
            <Skeleton width={64} height={12} borderRadius={6} />
          </div>
          <div className="min-h-0 flex-1 space-y-4 p-6">
            <SkeletonText width={60} height={20} />
            <SkeletonText width={90} height={12} />
            <Skeleton width="100%" height={40} borderRadius={8} />
            <Skeleton width="100%" height={40} borderRadius={8} />
            <Skeleton width="100%" height={40} borderRadius={8} />
            <Skeleton width="100%" height={44} borderRadius={10} className="mt-4" />
          </div>
        </aside>
      </div>
    </div>
  );
}
