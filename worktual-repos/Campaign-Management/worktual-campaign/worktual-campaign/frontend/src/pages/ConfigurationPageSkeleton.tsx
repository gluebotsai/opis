import {
  Skeleton,
  SkeletonCard,
  SkeletonGrid,
  SkeletonText,
} from "@/components/skeleton";

/** Matches ConfigurationPage channel card grid under page header. */
export function ConfigurationPageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading configuration">
      {Array.from({ length: 2 }).map((_, g) => (
        <section key={g}>
          <Skeleton width={88} height={12} className="mb-3" />
          <SkeletonGrid columns={3} gap="gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard
                key={i}
                padding="p-4"
                className="rounded-2xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <SkeletonText width={50} height={14} />
                  <Skeleton width={64} height={20} borderRadius={999} />
                </div>
                <div className="mt-2">
                  <SkeletonText width={70} height={12} />
                </div>
              </SkeletonCard>
            ))}
          </SkeletonGrid>
        </section>
      ))}
    </div>
  );
}
