import type { ReactNode } from "react";

/**
 * Panel card on gray canvas — matches Worktual layout §2/§3 WorkspacePanel pattern.
 */
export function WorkspacePanel({
  children,
  className = "",
  padded = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm ${
        padded ? "p-4 sm:p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
