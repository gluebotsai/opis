import { kpiCardClassName, kpiCardMdClassName } from "@/components/ui/kpi-card";
import { dashboardCardClassName } from "@/components/dashboard/dashboard-card-theme";
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

function DashboardKpiCardSkeleton() {
  return (
    <div className={cn(kpiCardClassName, kpiCardMdClassName)}>
      <div className="flex items-start justify-between gap-2">
        <Bone className="h-3.5 w-20" />
        <Bone className="size-7 shrink-0 rounded-md" />
      </div>
      <Bone className="mt-2 h-6 w-14" />
      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <Bone className="h-3 w-20" />
        <Bone className="h-3.5 w-10 rounded-full" />
      </div>
    </div>
  );
}

function DashboardSparklineChartSkeleton() {
  return (
    <div className={dashboardCardClassName}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <Bone className="h-4 w-36" />
          <Bone className="h-3 w-44" />
        </div>
        <Bone className="h-6 w-10" />
      </div>
      <Bone className="h-[88px] w-full rounded-lg" />
      <div className="mt-2 flex justify-between gap-2">
        <Bone className="h-2.5 w-10" />
        <Bone className="h-2.5 w-10" />
        <Bone className="h-2.5 w-10" />
        <Bone className="h-2.5 w-10" />
        <Bone className="h-2.5 w-10" />
      </div>
    </div>
  );
}

function DashboardChannelChartSkeleton() {
  return (
    <div className={cn("flex h-full flex-col", dashboardCardClassName)}>
      <div className="mb-3 space-y-1.5">
        <Bone className="h-4 w-32" />
        <Bone className="h-3 w-48" />
      </div>
      <div className="flex items-center justify-center py-2">
        <Bone className="size-28 rounded-full" />
      </div>
      <div className="mt-3 space-y-2">
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex items-center gap-2">
            <Bone className="size-2.5 rounded-full" />
            <Bone className="h-3 flex-1" />
            <Bone className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPresenceMixSkeleton() {
  return (
    <div className={cn("flex h-full flex-col", dashboardCardClassName)}>
      <div className="mb-3 space-y-1.5">
        <Bone className="h-4 w-40" />
        <Bone className="h-3 w-56" />
      </div>
      <div className="flex flex-1 items-end justify-center gap-2.5 py-2 sm:gap-3">
        {(["h-[100px]", "h-[68px]", "h-[50px]", "h-[40px]", "h-[18px]"] as const).map((heightClass) => (
          <div key={heightClass} className="flex w-12 flex-col items-center">
            <Bone className="mb-1 h-3 w-8" />
            <Bone className={cn("w-9 rounded-t-md", heightClass)} />
            <Bone className="mt-1 h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardBarChartSkeleton() {
  return (
    <div className={cn("flex h-full flex-col", dashboardCardClassName)}>
      <div className="mb-3 space-y-1.5">
        <Bone className="h-4 w-36" />
        <Bone className="h-3 w-44" />
      </div>
      <div className="flex flex-1 items-end justify-center gap-5 py-2">
        {(["h-[100px]", "h-[58px]", "h-[12px]", "h-[30px]"] as const).map((heightClass) => (
          <div key={heightClass} className="flex w-16 flex-col items-center">
            <Bone className="mb-1 h-3 w-7" />
            <Bone className={cn("w-9", heightClass)} />
            <Bone className="mt-2 h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Matches description-only section headers in the loaded panel. */
function DashboardSectionHeaderSkeleton() {
  return <Bone className="h-4 w-72 max-w-full" />;
}

export function DashboardOverviewSkeleton() {
  return (
    <div className="@container/kpis space-y-6 bg-white" aria-busy="true" aria-label="Loading dashboard">
      <section className="space-y-4">
        <DashboardSectionHeaderSkeleton />
        <div className="grid grid-cols-2 items-stretch gap-x-4 gap-y-4 @[42rem]/kpis:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <DashboardKpiCardSkeleton key={index} />
          ))}
        </div>
        <div className="grid grid-cols-2 items-stretch gap-x-4 gap-y-4">
          <DashboardKpiCardSkeleton />
          <DashboardKpiCardSkeleton />
        </div>
      </section>

      <section className="space-y-3">
        <DashboardSectionHeaderSkeleton />
        <div className="grid grid-cols-1 gap-4 @[42rem]/kpis:grid-cols-2">
          <DashboardSparklineChartSkeleton />
          <DashboardSparklineChartSkeleton />
        </div>
      </section>

      <section className="@container/breakdowns min-w-0 space-y-4">
        <DashboardSectionHeaderSkeleton />
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,347px),1fr))] items-stretch gap-4 [&>*]:min-w-0">
          <DashboardChannelChartSkeleton />
          <DashboardChannelChartSkeleton />
        </div>
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 @[56rem]/breakdowns:grid-cols-2 [&>*]:min-w-0">
          <DashboardPresenceMixSkeleton />
          <DashboardBarChartSkeleton />
        </div>
      </section>
    </div>
  );
}
