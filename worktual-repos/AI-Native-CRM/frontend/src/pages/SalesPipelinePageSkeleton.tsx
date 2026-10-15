import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

function DealCardSkeleton() {
  return (
    <article className="rounded-xl border border-border-default/80 bg-surface p-3 shadow-[0_1px_2px_rgba(11,11,16,0.05)]">
      <div className="flex items-start gap-1.5">
        <Skeleton height={14} width={14} borderRadius={4} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonText width="70%" height={12} />
          <SkeletonText width="88%" />
          <SkeletonText width="62%" />
          <div className="mt-2 space-y-1.5">
            <SkeletonText width="78%" height={12} />
            <SkeletonText width="66%" height={12} />
            <SkeletonText width="72%" height={12} />
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border-default/50 pt-2.5">
        <SkeletonText width={72} />
        <Skeleton height={24} width={84} borderRadius={8} />
      </div>
    </article>
  );
}

function KanbanColumnSkeleton({ cards }: { cards: number }) {
  return (
    <div className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border-default/80 bg-subtle/60">
      <div className="relative overflow-hidden rounded-t-xl bg-neutral-800 px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-2">
            <SkeletonText width={96} height={16} />
            <SkeletonText width={120} height={12} />
          </div>
          <Skeleton height={22} width={28} borderRadius={999} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {Array.from({ length: cards }).map((_, index) => (
          <DealCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

export function SalesPipelineKanbanSkeleton() {
  const cardCounts = [3, 2, 3, 2, 1, 2];

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-nowrap items-stretch gap-3 overflow-x-auto overflow-y-hidden px-4 py-4 sm:px-6 sm:py-5">
      {cardCounts.map((cards, index) => (
        <KanbanColumnSkeleton key={index} cards={cards} />
      ))}
      <div className="w-2 shrink-0" aria-hidden />
    </div>
  );
}

export function SalesPipelineTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-default bg-surface shadow-[0_1px_2px_rgba(11,11,16,0.04)]">
      <div className="border-b border-border-default bg-subtle/80 px-5 py-3.5">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_0.8fr_0.7fr] gap-4">
          {Array.from({ length: 7 }).map((_, index) => (
            <SkeletonText key={index} width="60%" height={12} />
          ))}
        </div>
      </div>
      <div>
        {Array.from({ length: 8 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_0.8fr_0.7fr] gap-4 border-b border-border-default/70 px-5 py-4 last:border-0"
          >
            <div className="space-y-2">
              <SkeletonText width={`${82 - row * 3}%`} />
              <SkeletonText width="48%" height={12} />
            </div>
            <SkeletonText width="74%" />
            <SkeletonText width="60%" />
            <SkeletonText width="70%" />
            <Skeleton height={22} width={72} borderRadius={6} />
            <SkeletonText width="70%" />
            <div className="flex justify-center gap-2">
              <Skeleton height={28} width={28} borderRadius={8} />
              <Skeleton height={28} width={28} borderRadius={8} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
