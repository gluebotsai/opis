import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Matches Template Library card grid while org templates load from the API. */
export function TemplateLibrarySkeleton({
  embedded = false,
  cardCount = 8,
}: {
  embedded?: boolean;
  cardCount?: number;
}) {
  return (
    <div aria-busy="true" aria-label="Loading templates" className="space-y-8">
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface p-2">
        <Skeleton width={120} height={36} borderRadius={8} />
        <Skeleton width={110} height={36} borderRadius={8} />
        <Skeleton
          width="100%"
          height={36}
          borderRadius={8}
          className="min-w-[200px] flex-1"
        />
        <Skeleton width={130} height={36} borderRadius={8} />
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Skeleton width={4} height={20} borderRadius={99} />
          <SkeletonText width={140} height={14} />
          <SkeletonText width={24} height={12} />
        </div>
        <div
          className={`grid gap-5 sm:grid-cols-2 ${embedded ? "" : "lg:grid-cols-3 xl:grid-cols-4"}`}
        >
          {Array.from({ length: cardCount }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-0.5">
                <SkeletonText
                  width={55 + (i % 3) * 12}
                  height={14}
                  className="flex-1"
                />
                <Skeleton width={64} height={20} borderRadius={99} />
              </div>
              <div className="overflow-hidden rounded-xl border border-border-default bg-surface shadow-sm">
                <Skeleton
                  width="100%"
                  height={304}
                  borderRadius={0}
                  className="!w-full"
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
