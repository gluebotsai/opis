import { listRowDividerClassName } from "@/components/ui/list-row";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

function RoomListRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <Bone className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Bone className="h-3.5 w-28" />
          <Bone className="h-3 w-8" />
        </div>
        <Bone className="h-3 w-full max-w-[12rem]" />
      </div>
    </div>
  );
}

function RoomListPanelSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Bone className="size-11 shrink-0 rounded-full" />
            <div className="space-y-2">
              <Bone className="h-3.5 w-24" />
              <Bone className="h-3 w-16" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Bone className="h-7 w-16 rounded-lg" />
            <Bone className="h-7 w-20 rounded-lg" />
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-2.5 px-3 py-3">
        <Bone className="h-[38px] w-full rounded-lg" />
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 4 }, (_, index) => (
            <Bone key={index} className="h-[38px] w-full rounded-lg" />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className={listRowDividerClassName("4")}
          >
            <RoomListRowSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubbleSkeleton({ outgoing = false }: { outgoing?: boolean }) {
  return (
    <div className={cn("flex w-full", outgoing ? "justify-end" : "justify-start")}>
      <div className="space-y-1.5">
        {!outgoing ? <Bone className="h-3 w-20" /> : null}
        <Bone
          className={cn(
            "rounded-2xl",
            outgoing ? "h-10 w-36 rounded-br-md" : "h-10 w-44 rounded-bl-md",
          )}
        />
      </div>
    </div>
  );
}

function ThreadPanelSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex shrink-0 items-center gap-3 border-b-[0.6px] border-[#bfbfbf] px-4 py-3.5 sm:px-5">
        <Bone className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-3.5 w-32" />
          <Bone className="h-3 w-24" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-5 sm:px-5">
        <MessageBubbleSkeleton />
        <MessageBubbleSkeleton outgoing />
        <MessageBubbleSkeleton />
        <MessageBubbleSkeleton outgoing />
        <MessageBubbleSkeleton />
      </div>

      <div className="shrink-0 px-4 py-3 sm:px-5">
        <Bone className="h-11 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function InternalChatPanelsSkeleton() {
  return (
    <div
      className="grid h-full min-h-0 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(220px,34%)_minmax(0,1fr)] xl:grid-cols-[minmax(260px,28%)_minmax(0,1fr)] xl:gap-4"
      aria-busy="true"
      aria-label="Loading internal chat"
    >
      <WorkspacePanel>
        <RoomListPanelSkeleton />
      </WorkspacePanel>
      <WorkspacePanel>
        <ThreadPanelSkeleton />
      </WorkspacePanel>
    </div>
  );
}
