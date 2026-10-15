import type { ReactNode } from "react";

import { contentPanel } from "@/lib/panel-chrome";

export function WorkspacePanel({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={contentPanel(className)}>
      {children}
    </div>
  );
}
