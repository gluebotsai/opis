import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function WorkspaceAccordion({
  title,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  compact = false,
  fillHeight = true,
  className,
  contentClassName,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  compact?: boolean;
  fillHeight?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  function toggle() {
    const next = !open;
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  }

  return (
    <div
      className={cn(
        "border-b-[0.6px] border-[#bfbfbf] last:border-b-0",
        open && fillHeight && "flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex w-full shrink-0 items-center justify-between text-left font-semibold text-neutral-900 hover:bg-neutral-50",
          compact ? "px-3 py-2 text-[11px]" : "px-4 py-3 text-xs",
        )}
      >
        {title}
        <ChevronDown
          className={cn("size-4 text-neutral-400 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div
          className={cn(
            compact ? "px-3 pb-2.5" : "px-4 pb-3",
            fillHeight && "flex min-h-0 flex-1 flex-col overflow-hidden",
            contentClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
