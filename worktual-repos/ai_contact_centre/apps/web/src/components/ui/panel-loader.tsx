import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type PanelLoaderProps = {
  label?: string;
  className?: string;
  inline?: boolean;
};

export function PanelLoader({
  label = "Loading…",
  className,
  inline = false,
}: PanelLoaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-neutral-600",
        inline ? "py-3" : "flex-1 min-h-0 h-full w-full px-4 py-12",
        className,
      )}
    >
      <LoaderCircle className="size-4 animate-spin text-neutral-900" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
