import type { ReactNode } from "react";

export function SkeletonCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border-default bg-surface p-6 ${className}`.trim()}
    >
      {children}
    </section>
  );
}
