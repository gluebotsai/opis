import { Skeleton, SkeletonText } from "@/components/skeleton";
import { ContactsPageSkeleton } from "@/pages/ContactsPageSkeleton";

/** Audience module — co-worker chat + people list pane. */
export function AudienceWorkspaceSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 bg-[#f3f4f6] p-4 sm:p-5"
      aria-busy="true"
      aria-label="Loading audience"
    >
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_minmax(260px,0.42fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex h-11 shrink-0 items-center border-b border-neutral-100 px-4">
            <Skeleton width={148} height={12} borderRadius={6} />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
              >
                <div className="w-[70%] space-y-2 rounded-2xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5">
                  <SkeletonText width={85} height={14} />
                  <SkeletonText width={50} height={14} />
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-neutral-100 px-3 py-3">
            <Skeleton width="100%" height={44} borderRadius={12} />
          </div>
        </div>

        <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm lg:flex">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-100 px-4">
            <Skeleton width={72} height={12} borderRadius={6} />
            <div className="flex gap-2">
              <Skeleton width={56} height={28} borderRadius={8} />
              <Skeleton width={56} height={28} borderRadius={8} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <ContactsPageSkeleton />
          </div>
        </aside>
      </div>
    </div>
  );
}
