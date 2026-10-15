import { Clock, Layers } from "lucide-react";

import { PanelLoader } from "@/components/ui/panel-loader";
import { formatConversationTime } from "@/features/workspace/workspace-utils";

type OmniChannelSummaryContentProps = {
  summary: string | null;
  updatedAt: string | null;
  loading: boolean;
};

export function OmniChannelSummaryText({ summary }: { summary: string }) {
  return (
    <div
      className="panel-scroll-native max-h-72 overflow-y-auto overscroll-contain pr-2"
      tabIndex={0}
      aria-label="Omni channel summary content"
    >
      <p className="whitespace-pre-wrap text-left text-sm font-medium leading-[1.7] tracking-[0.01em] break-words text-neutral-700">
        {summary.trim()}
      </p>
    </div>
  );
}

export function OmniChannelSummaryContent({
  summary,
  updatedAt,
  loading,
}: OmniChannelSummaryContentProps) {
  if (loading) {
    return <PanelLoader label="Loading summary…" />;
  }

  if (!summary?.trim()) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50/60 px-4 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-200/80">
          <Layers className="size-4 text-neutral-400" aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-medium text-neutral-700">No summary yet</p>
        <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-neutral-600">
          A cross-channel summary is generated after conversations are resolved.
        </p>
      </div>
    );
  }

  return (
    <article className="overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
      <div className="px-3.5 py-3.5">
        <OmniChannelSummaryText summary={summary} />
        {updatedAt ? (
          <footer className="mt-3.5 flex items-center gap-1.5 border-t-[0.6px] border-[#bfbfbf] pt-3">
            <Clock className="size-3 shrink-0 text-neutral-600" aria-hidden="true" />
            <span className="text-[12px] font-medium text-neutral-600">
              Updated {formatConversationTime(updatedAt)}
            </span>
          </footer>
        ) : null}
      </div>
    </article>
  );
}
