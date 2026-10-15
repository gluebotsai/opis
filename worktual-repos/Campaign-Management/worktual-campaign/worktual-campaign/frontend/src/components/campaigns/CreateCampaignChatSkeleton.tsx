import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Matches CreateCampaignChatWorkspace + ModuleSplitWorkspace while draft resolves. */
export function CreateCampaignChatSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 bg-[#f3f4f6] p-4 sm:p-5"
      aria-busy="true"
      aria-label="Loading chat"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton width={36} height={36} borderRadius={8} />
          <div className="min-w-0 space-y-2">
            <SkeletonText width={45} height={14} />
            <SkeletonText width={30} height={12} />
          </div>
        </div>
        <Skeleton width={72} height={32} borderRadius={8} />
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex h-11 shrink-0 items-center border-b border-neutral-100 px-4">
            <Skeleton width={120} height={12} borderRadius={6} />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
                >
                  <div className="w-[70%] space-y-2 rounded-2xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5">
                    <SkeletonText width={90} height={14} />
                    <SkeletonText width={60} height={14} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="shrink-0 border-t border-neutral-100 px-3 py-3 sm:px-4">
            <Skeleton
              width="100%"
              height={44}
              borderRadius={12}
              className="mx-auto max-w-3xl"
            />
          </div>
        </div>
        <div className="hidden min-h-0 w-[min(100%,22rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm lg:flex">
          <div className="flex h-11 shrink-0 items-center border-b border-neutral-100 px-4">
            <Skeleton width={140} height={12} borderRadius={6} />
          </div>
          <div className="space-y-3 px-4 py-4">
            <Skeleton height={8} borderRadius={99} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="space-y-2 rounded-xl border border-neutral-100 px-3 py-2.5"
              >
                <SkeletonText width={40} height={10} />
                <SkeletonText width={70} height={14} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
