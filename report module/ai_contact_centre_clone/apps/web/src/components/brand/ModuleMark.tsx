import { CopilotMark } from "@/components/brand/CopilotMark";
import { cn } from "@/lib/utils";

type ModuleMarkProps = {
  compact?: boolean;
  className?: string;
};

/** Full wordmark when expanded; square brand mark when sidebar is collapsed. */
export function ModuleMark({ compact = false, className }: ModuleMarkProps) {
  if (compact) {
    return <CopilotMark alt="Worktual" className={className} />;
  }

  return (
    <img
      src="/brand/worktual-logo.png"
      alt="Worktual"
      className={cn("h-8 w-auto object-contain", className)}
    />
  );
}
