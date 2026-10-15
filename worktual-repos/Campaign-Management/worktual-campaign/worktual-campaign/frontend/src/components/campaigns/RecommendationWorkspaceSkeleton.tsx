import { SkeletonText } from "@/components/skeleton";

/** Chat-pane placeholder while recommendation agent session connects. */
export function RecommendationWorkspaceSkeleton() {
  return (
    <div
      className="mx-auto flex max-w-3xl flex-col gap-3"
      aria-busy="true"
      aria-label="Connecting"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
        >
          <div className="w-[70%] space-y-2 rounded-2xl border border-border-default bg-surface px-3.5 py-2.5">
            <SkeletonText width={90} height={14} />
            <SkeletonText width={55} height={14} />
          </div>
        </div>
      ))}
    </div>
  );
}
