import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

function FieldSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <SkeletonText width={88} height={12} />
      <Skeleton height={40} borderRadius={8} />
    </div>
  );
}

export function ContactFormPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 space-y-3">
        <SkeletonText width={140} height={14} />
        <SkeletonText width={160} height={28} />
        <SkeletonText width={280} />
      </div>

      <div className="flex flex-col gap-6">
        <SkeletonCard>
          <SkeletonText width={128} height={20} />
          <div className="mt-1">
            <SkeletonText width={160} height={12} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <FieldSkeleton key={index} />
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCard>
          <SkeletonText width={112} height={20} />
          <div className="mt-1">
            <SkeletonText width={260} height={12} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <FieldSkeleton className="sm:col-span-2" />
            <FieldSkeleton className="sm:col-span-2" />
            <SkeletonText width="70%" height={12} className="sm:col-span-2" />
          </div>
        </SkeletonCard>

        <SkeletonCard>
          <SkeletonText width={104} height={20} />
          <div className="mt-1">
            <SkeletonText width={180} height={12} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <FieldSkeleton key={index} />
            ))}
            <FieldSkeleton className="sm:col-span-2" />
            <div className="space-y-2 sm:col-span-2">
              <SkeletonText width={96} height={12} />
              <Skeleton height={96} borderRadius={8} />
            </div>
          </div>
        </SkeletonCard>

        <SkeletonCard>
          <SkeletonText width={168} height={20} />
          <div className="mt-1">
            <SkeletonText width={300} height={12} />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Skeleton height={16} width={16} borderRadius={4} />
                <SkeletonText width={120} height={14} />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <div className="flex items-center gap-3">
          <Skeleton height={40} width={140} borderRadius={8} />
          <Skeleton height={40} width={96} borderRadius={8} />
        </div>
      </div>
    </div>
  );
}
