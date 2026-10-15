import { Skeleton, SkeletonText } from "@/components/skeleton";

/** Content-area placeholders for CampaignTemplateEditPage (header/composer stay). */
export function CampaignTemplateEditSkeleton({
  variant = "both",
}: {
  variant?: "chat" | "preview" | "both";
}) {
  const chat = (
    <div className="space-y-3" aria-busy="true" aria-label="Loading template chat">
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

  const preview = (
    <div className="space-y-3" aria-busy="true" aria-label="Loading template preview">
      <SkeletonText width={50} height={14} />
      <SkeletonText width={35} height={12} />
      <Skeleton
        width="100%"
        height={280}
        borderRadius={8}
        className="!block w-full"
      />
      <div className="space-y-2">
        <SkeletonText width={80} height={14} />
        <SkeletonText width={65} height={14} />
        <SkeletonText width={45} height={14} />
      </div>
    </div>
  );

  if (variant === "chat") return chat;
  if (variant === "preview") return preview;
  return (
    <>
      {chat}
      {preview}
    </>
  );
}
