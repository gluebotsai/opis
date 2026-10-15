import { listRowButtonClassName, listRowDividerClassName } from "@/components/ui/list-row";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

function AgentRowSkeleton() {
  return (
    <div className={cn(listRowButtonClassName, "flex items-center gap-3")}>
      <Bone className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Bone className="h-3.5 w-28" />
          <Bone className="h-4 w-12 rounded-full" />
        </div>
        <Bone className="h-3 w-36" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Bone className="h-5 w-14 rounded-full" />
        <Bone className="size-3.5 rounded" />
      </div>
    </div>
  );
}

/** Matches Live Monitoring agents panel: header → tabs → search/filters → list rows. */
export function MonitoringPanelSkeleton() {
  return (
    <div
      className={contentPanelClassName}
      aria-busy="true"
      aria-label="Loading live monitoring"
    >
      <div className={`shrink-0 px-3 pt-3 pb-0 xl:px-4 xl:pt-3.5 xl:pb-3 ${contentPanelHeaderBorderClassName}`}>
        <Bone className="h-[38px] w-full rounded-lg" />
      </div>

      <div className="shrink-0 space-y-4 px-3 pt-3 pb-3 xl:p-4">
        <div className="flex w-full min-w-0 items-center gap-2">
          <Bone className="h-[38px] min-w-0 flex-1 rounded-lg" />
          <Bone className="h-[38px] w-36 shrink-0 rounded-lg sm:w-40" />
          <Bone className="size-[38px] shrink-0 rounded-lg" />
        </div>
        <div className="flex w-max gap-1 overflow-hidden">
          {Array.from({ length: 7 }, (_, index) => (
            <Bone
              key={index}
              className={cn("h-7 shrink-0 rounded-full", index === 0 ? "w-12" : "w-[4.25rem]")}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul>
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className={listRowDividerClassName()}>
              <AgentRowSkeleton />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
