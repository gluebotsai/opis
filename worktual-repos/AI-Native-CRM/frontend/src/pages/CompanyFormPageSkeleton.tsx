import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <SkeletonText width={96} height={12} />
      <Skeleton height={44} borderRadius={8} />
    </div>
  );
}

/** Field skeletons matching the company edit form card. */
export function CompanyFormFieldsSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2"
      aria-busy="true"
      aria-label="Loading company"
    >
      <div className="sm:col-span-2">
        <FieldSkeleton />
      </div>
      {Array.from({ length: 6 }).map((_, index) => (
        <FieldSkeleton key={index} />
      ))}
      <div className="mt-2 flex gap-3">
        <Skeleton height={40} width={88} borderRadius={8} />
        <Skeleton height={40} width={88} borderRadius={8} />
      </div>
    </div>
  );
}
