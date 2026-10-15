import type { ReactNode } from "react";

import { contentPanelClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

export function ShadowPanel({
  children,
  className,
  innerClassName,
  id,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn("h-full min-h-0 xl:rounded-2xl xl:shadow-xl/50", className)}>
      <div
        className={cn(
          contentPanelClassName,
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
