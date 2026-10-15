import { type ReactNode } from "react";

import { useSetPageTitle } from "@/features/layout/page-title-context";

type WorkspaceShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function WorkspaceShell({ title, children }: WorkspaceShellProps) {
  useSetPageTitle(title);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-0 xl:gap-4">
      {/* {subtitle ? <p className="shrink-0 max-w-xl text-sm text-neutral-600">{subtitle}</p> : null} */}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
