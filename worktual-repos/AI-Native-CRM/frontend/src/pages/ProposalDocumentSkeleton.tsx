import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

/**
 * Document-shaped loading state for proposal create / open.
 * Visual only — no status captions in the UI.
 */
export function ProposalDocumentSkeleton({
  label = "Loading",
}: {
  /** Screen-reader label only; never shown as visible text. */
  label?: string;
}) {
  return (
    <div
      className="crm-fade-in px-4 py-5 sm:px-6"
      aria-busy="true"
      aria-label={label}
    >
      <div className="mx-auto w-full max-w-6xl rounded-xl border border-border-default bg-white p-6 sm:p-8 shadow-sm">
        {/* Letterhead */}
        <div className="flex flex-col items-center gap-2 border-b border-border-default/60 pb-6">
          <Skeleton height={40} width={120} borderRadius={8} />
          <SkeletonText width={180} height={12} />
          <SkeletonText width={240} height={10} />
        </div>

        {/* Cover title block */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <SkeletonText width={220} height={20} />
          <SkeletonText width={40} height={12} />
          <SkeletonText width={160} height={16} />
          <SkeletonText width={96} height={12} />
        </div>

        {/* Hero */}
        <div className="mt-8">
          <Skeleton height={180} width="100%" borderRadius={10} />
        </div>

        {/* Body sections */}
        <div className="mt-10 space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <SkeletonText width={`${40 + i * 8}%`} height={18} />
              <SkeletonText width="100%" />
              <SkeletonText width="92%" />
              <SkeletonText width="78%" />
              <div className="pt-1 space-y-2">
                <SkeletonText width="88%" />
                <SkeletonText width="70%" />
              </div>
            </div>
          ))}
        </div>

        {/* Footer stripe */}
        <div className="mt-12 space-y-3">
          <Skeleton height={8} width="100%" borderRadius={4} />
          <div className="flex justify-center">
            <SkeletonText width={160} height={10} />
          </div>
        </div>
      </div>
    </div>
  );
}
