import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

function QueueCardSkeleton() {
  return (
    <div className="h-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
      <div className="flex items-start gap-3">
        <Bone className="size-[38px] shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-4 w-12 rounded-full" />
          </div>
          <Bone className="h-3.5 w-40" />
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <Bone className="h-2.5 w-10" />
          <Bone className="h-4 w-7 rounded-full" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5">
          <Bone className="h-2.5 w-10" />
          <Bone className="mt-1.5 h-3.5 w-20" />
        </div>
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5">
          <Bone className="h-2.5 w-12" />
          <Bone className="mt-1.5 h-3.5 w-16" />
        </div>
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5">
          <Bone className="h-2.5 w-10" />
          <Bone className="mt-1.5 h-3.5 w-24" />
        </div>
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5">
          <Bone className="h-2.5 w-12" />
          <Bone className="mt-1.5 h-3.5 w-20" />
        </div>
        <div className="col-span-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5">
          <div className="flex items-center justify-between">
            <Bone className="h-2.5 w-16" />
            <Bone className="h-2.5 w-4" />
          </div>
          <div className="mt-2 flex gap-1.5">
            <Bone className="size-7 rounded-lg" />
            <Bone className="size-7 rounded-lg" />
            <Bone className="size-7 rounded-lg" />
            <Bone className="size-7 rounded-lg" />
            <Bone className="size-7 rounded-lg" />
          </div>
        </div>
        <div className="col-span-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5">
          <div className="flex items-center justify-between">
            <Bone className="h-2.5 w-10" />
            <Bone className="h-2.5 w-4" />
          </div>
          <Bone className="mt-2 h-3.5 w-16" />
        </div>
      </div>

      <div className="mt-3 border-t-[0.6px] border-[#e5e5e5] pt-2.5">
        <Bone className="h-2.5 w-28" />
      </div>
    </div>
  );
}

export function QueuesListSkeleton({
  rows = 6,
  gridClassName = "grid-cols-1",
}: {
  rows?: number;
  gridClassName?: string;
}) {
  return (
    <ul className={cn("grid gap-4", gridClassName)} aria-busy="true" aria-label="Loading queues">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="min-w-0">
          <QueueCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
