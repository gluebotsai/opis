import { listRowButtonClassName, listRowDividerClassName } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

function WorkspaceInboxRowSkeleton() {
  return (
    <div className={listRowButtonClassName}>
      <div className="flex items-start gap-2.5">
        <Bone className="min-h-10 w-10 shrink-0 self-stretch rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Bone className="h-3.5 w-32" />
            <Bone className="h-3 w-10" />
          </div>
          <Bone className="h-3 w-full" />
          <Bone className="h-3 w-4/5" />
          <div className="flex items-center gap-2 pt-0.5">
            <Bone className="h-4 w-4 rounded" />
            <Bone className="h-3 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceInboxSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={listRowDividerClassName()}>
          <WorkspaceInboxRowSkeleton />
        </li>
      ))}
    </ul>
  );
}
