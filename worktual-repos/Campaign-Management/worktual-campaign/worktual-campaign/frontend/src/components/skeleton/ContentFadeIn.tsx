import type { ReactNode } from "react";

/** Fade-in wrapper for loaded content (180ms opacity 0 → 1). */
export function ContentFadeIn({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`content-fade-in w-full min-w-0 ${className}`.trim()}>{children}</div>
  );
}
