import { ModuleSplitWorkspaceSkeleton } from "@/components/layout/ModuleSplitWorkspaceSkeleton";
import { ReportsShortcutsPaneSkeleton } from "@/components/campaigns/ReportsShortcutsPaneSkeleton";

/** Dashboard reports co-worker split layout. */
export function ReportsWorkspaceSkeleton() {
  return (
    <ModuleSplitWorkspaceSkeleton
      leftTitleWidth={148}
      rightTitleWidth={72}
      rightPanel={<ReportsShortcutsPaneSkeleton />}
      ariaLabel="Loading reports co-worker"
    />
  );
}
