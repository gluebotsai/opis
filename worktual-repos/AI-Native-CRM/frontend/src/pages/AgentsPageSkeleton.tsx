import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

function AgentCardSkeleton() {
  return (
    <SkeletonCard className="overflow-hidden p-0 shadow-sm">
      <div className="border-b border-border-default/80 bg-subtle/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <Skeleton height={36} width={36} borderRadius={8} />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonText width={160} height={20} />
            <SkeletonText width="92%" height={12} />
            <SkeletonText width="72%" height={12} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <SkeletonText width={140} height={12} />
            <SkeletonText width={96} height={36} />
          </div>
          <div className="w-full max-w-[11rem] space-y-2">
            <Skeleton height={8} borderRadius={999} />
            <SkeletonText width="80%" height={10} />
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <SkeletonText width={72} height={12} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border border-border-default/70 bg-subtle/30 px-2.5 py-2.5 space-y-2"
            >
              <SkeletonText width="70%" height={12} />
              <SkeletonText width={40} height={20} />
            </div>
          ))}
        </div>

        <div className="mt-4">
          <SkeletonText width={80} height={12} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-default/70 px-3 py-2"
              >
                <SkeletonText width="55%" height={12} />
                <SkeletonText width={28} height={16} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonCard>
  );
}

export function AgentsPageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <SkeletonText width={280} height={12} />
      </div>

      <SkeletonGrid columns="md:grid-cols-2 xl:grid-cols-2" className="mt-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <AgentCardSkeleton key={index} />
        ))}
      </SkeletonGrid>

      <div className="mt-8 space-y-2">
        <SkeletonText width="88%" height={12} />
        <SkeletonText width="64%" height={12} />
      </div>
    </div>
  );
}
