import { forwardRef, type ReactNode, type UIEvent } from "react";
import { cn } from "@/utils/cn";

type PanelScrollAreaProps = {
  children: ReactNode;
  className?: string;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
};

/** Scroll region for co-worker / content panels. */
export const PanelScrollArea = forwardRef<HTMLDivElement, PanelScrollAreaProps>(
  function PanelScrollArea({ children, className, onScroll }, ref) {
    return (
      <div
        ref={ref}
        onScroll={onScroll}
        className={cn(
          "chat-scroll scroll-overlay min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
