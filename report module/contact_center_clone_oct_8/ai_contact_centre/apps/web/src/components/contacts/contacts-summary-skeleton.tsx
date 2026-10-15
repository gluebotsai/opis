import { listRowButtonClassName, listRowDividerClassName } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

function ContactRowSkeleton() {
  return (
    <div className={cn(listRowButtonClassName, "flex items-start gap-3")}>
      <Bone className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Bone className="h-3.5 w-32" />
        <Bone className="mt-2 h-3.5 w-44" />
        <Bone className="mt-2 h-3 w-56" />
      </div>
      <Bone className="mt-0.5 h-2.5 w-10 shrink-0 rounded" />
    </div>
  );
}

export function ContactsListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul aria-busy="true" aria-label="Loading contacts">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={listRowDividerClassName()}>
          <ContactRowSkeleton />
        </li>
      ))}
    </ul>
  );
}
