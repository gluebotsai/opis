import { cn } from "@/utils/cn";

type CopilotMarkProps = {
  className?: string;
};

/** Co-worker mark used in chat panel headers (CC reference). */
export function CopilotMark({ className }: CopilotMarkProps) {
  return (
    <img
      src="/brand/copilot-logo.png"
      alt="Worktual co-worker"
      className={cn("size-7 shrink-0 rounded-md object-cover", className)}
    />
  );
}
