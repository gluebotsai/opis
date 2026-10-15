import { cn } from "@/lib/utils";

export const MESSAGE_BUBBLE_SHELL =
  "min-w-0 break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed";

/** Centered system lines in the conversation thread (hold, connected, typing). */
export const THREAD_SYSTEM_LINE = "text-[14px] leading-5 text-neutral-600";

export function messageBubbleClassName({
  outgoing,
  panelExpanded = false,
  className,
}: {
  outgoing: boolean;
  /** When true (left copilot panel expanded), user bubbles use 70% width. */
  panelExpanded?: boolean;
  className?: string;
}) {
  return cn(
    MESSAGE_BUBBLE_SHELL,
    outgoing
      ? cn(
          "rounded-tr-sm bg-[#111111] text-white",
          panelExpanded ? "max-w-[70%]" : "max-w-[90%]",
        )
      : "max-w-[90%] rounded-tl-none bg-neutral-100 text-neutral-800",
    className,
  );
}
