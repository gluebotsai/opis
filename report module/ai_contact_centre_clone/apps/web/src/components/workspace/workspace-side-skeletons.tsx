import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

export function WorkspaceChatPanelSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white"
      aria-busy="true"
      aria-label="Loading conversation"
    >
      <div className="flex shrink-0 items-center gap-3 border-b-[0.6px] border-[#bfbfbf] px-4 py-3.5">
        <Bone className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-3.5 w-36" />
          <Bone className="h-3 w-24" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-8 w-20 rounded-lg" />
          <Bone className="h-8 w-20 rounded-lg" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-5 py-5">
        <div className="flex justify-start">
          <div className="w-full max-w-md space-y-3 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-4">
            <div className="flex items-center gap-2">
              <Bone className="size-7 rounded-full" />
              <Bone className="h-3.5 w-28" />
            </div>
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-5/6" />
            <Bone className="h-3 w-2/3" />
          </div>
        </div>
        <div className="flex justify-end">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-neutral-100 p-4">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-3/4" />
          </div>
        </div>
        <div className="flex justify-start">
          <div className="w-full max-w-xs space-y-2 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-4">
            <Bone className="h-3 w-5/6" />
            <Bone className="h-3 w-2/3" />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
        <Bone className="h-11 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function WorkspaceCustomerPanelSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white"
      aria-busy="true"
      aria-label="Loading customer panel"
    >
      <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] px-3 pt-3 pb-3">
        <div className="flex w-full gap-0.5">
          <Bone className="h-[38px] flex-1 rounded-lg" />
          <Bone className="h-[38px] flex-1 rounded-lg" />
          <Bone className="h-[38px] flex-1 rounded-lg" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-4">
        <div className="flex items-center gap-3">
          <Bone className="size-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3.5 w-32" />
            <Bone className="h-3 w-24" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Bone className="h-16 rounded-xl" />
          <Bone className="h-16 rounded-xl" />
        </div>

        <div className="space-y-2.5 rounded-xl border-[0.6px] border-[#bfbfbf] p-3">
          <Bone className="h-3 w-20" />
          <Bone className="h-3 w-full" />
          <Bone className="h-3 w-5/6" />
          <Bone className="h-3 w-2/3" />
        </div>

        <div className="space-y-2.5">
          <Bone className="h-3 w-28" />
          <Bone className="h-14 w-full rounded-xl" />
          <Bone className="h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
