import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Matches CreateContactChatWorkspace chrome while draft resolves. */
export function CreateContactChatSkeleton() {
  return (
    <div
      className="flex h-[calc(100dvh-3.5rem)] flex-col bg-subtle"
      aria-busy="true"
      aria-label="Loading chat"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton width={36} height={36} borderRadius={8} />
          <div className="min-w-0 space-y-2">
            <SkeletonText width={40} height={14} />
            <SkeletonText width={25} height={12} />
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_280px]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
              >
                <div className="w-[65%] space-y-2 rounded-2xl border border-border-default bg-surface px-3.5 py-2.5">
                  <SkeletonText width={85} height={14} />
                  <SkeletonText width={50} height={14} />
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-border-default bg-surface px-3 py-3">
            <Skeleton width="100%" height={44} borderRadius={22} />
          </div>
        </div>
        <aside className="hidden border-l border-border-default bg-surface p-4 lg:block">
          <Skeleton width={96} height={12} />
          <div className="mt-3 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton width={48} height={12} />
                <SkeletonText width={70} height={14} />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
