import { cn } from "@/lib/utils";

type CopilotMarkProps = {
  className?: string;
  alt?: string;
};

/** 28px logo inside a 38px black filled box. */
export function CopilotMark({ className, alt = "Worktual co-worker" }: CopilotMarkProps) {
  return (
    <span
      className={cn(
        "flex size-[38px] shrink-0 items-center justify-center rounded-md border-[0.6px] border-black bg-black",
        className,
      )}
    >
      <img src="/brand/copilot-logo.png" alt={alt} className="size-7 rounded-sm object-cover" />
    </span>
  );
}
