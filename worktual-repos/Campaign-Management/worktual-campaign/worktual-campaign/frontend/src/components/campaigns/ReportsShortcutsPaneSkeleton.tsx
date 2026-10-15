import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Dashboard reports co-worker — shortcuts + sample questions pane. */
export function ReportsShortcutsPaneSkeleton() {
  return (
    <div className="space-y-5 p-4" aria-hidden="true">
      <div>
        <Skeleton width={88} height={10} borderRadius={4} />
        <div className="mt-2 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton
              key={i}
              width="100%"
              height={44}
              borderRadius={8}
            />
          ))}
        </div>
      </div>
      <div>
        <Skeleton width={72} height={10} borderRadius={4} />
        <div className="mt-2 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonText key={i} width={85 - i * 5} height={14} />
          ))}
        </div>
      </div>
    </div>
  );
}
