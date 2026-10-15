import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

export function DashboardAnalyticsSkeleton() {
  return (
    <div className="@container/analytics space-y-6 bg-white">
      <Bone className="h-12 w-full rounded-xl" />

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <Bone className="size-[38px] rounded-xl" />
          <div className="space-y-2">
            <Bone className="h-4 w-40" />
            <Bone className="h-3.5 w-72 max-w-full" />
          </div>
        </div>
        <Bone className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Bone className="h-56 rounded-xl" />
          <Bone className="h-56 rounded-xl" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <Bone className="size-[38px] rounded-xl" />
          <div className="space-y-2">
            <Bone className="h-4 w-44" />
            <Bone className="h-3.5 w-64 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 @[42rem]/analytics:grid-cols-4">
          <Bone className="h-[100px] rounded-2xl" />
          <Bone className="h-[100px] rounded-2xl" />
          <Bone className="h-[100px] rounded-2xl" />
          <Bone className="h-[100px] rounded-2xl" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Bone className="h-52 rounded-xl" />
          <Bone className="h-52 rounded-xl" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <Bone className="size-[38px] rounded-xl" />
          <div className="space-y-2">
            <Bone className="h-4 w-48" />
            <Bone className="h-3.5 w-60 max-w-full" />
          </div>
        </div>
        <Bone className="h-16 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Bone className="h-44 rounded-xl" />
          <Bone className="h-44 rounded-xl" />
          <Bone className="h-44 rounded-xl" />
        </div>
      </section>
    </div>
  );
}
