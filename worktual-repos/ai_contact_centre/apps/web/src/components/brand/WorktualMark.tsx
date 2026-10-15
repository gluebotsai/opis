import { cn } from "@/lib/utils";

export function WorktualMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/worktual-logo.png"
      alt="Worktual"
      className={cn("h-8 w-auto object-contain", className)}
    />
  );
}
