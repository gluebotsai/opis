import type { ReactNode } from "react";

type SkeletonCardProps = {
  children: ReactNode;
  className?: string;
  /** Match dominant card chrome: rounded-xl + border + bg-surface + p-4 */
  padding?: "p-3" | "p-4" | "p-5" | "sm:p-5";
};

/**
 * Card chrome matching real surfaces:
 * `rounded-xl border border-border-default bg-surface p-4`
 */
export function SkeletonCard({
  children,
  className = "",
  padding = "p-4",
}: SkeletonCardProps) {
  const pad =
    padding === "sm:p-5"
      ? "p-4 sm:p-5"
      : padding === "p-5"
        ? "p-5"
        : padding === "p-3"
          ? "p-3"
          : "p-4";

  return (
    <div
      className={`rounded-xl border border-border-default bg-surface ${pad} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
