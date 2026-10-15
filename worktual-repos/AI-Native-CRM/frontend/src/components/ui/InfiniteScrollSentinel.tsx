import { forwardRef } from "react";

export const InfiniteScrollSentinel = forwardRef<HTMLDivElement>(
  function InfiniteScrollSentinel(_props, ref) {
    return <div ref={ref} className="h-8 w-full" aria-hidden />;
  },
);
