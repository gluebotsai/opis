import { ModuleSplitWorkspaceSkeleton } from "@/components/layout/ModuleSplitWorkspaceSkeleton";
import { CampaignsPageSkeleton } from "@/pages/CampaignsPageSkeleton";

/** Campaign monitoring — co-worker + campaign list pane. */
export function MonitoringWorkspaceSkeleton() {
  return (
    <ModuleSplitWorkspaceSkeleton
      leftTitleWidth={148}
      rightTitleWidth={120}
      rightPanel={<CampaignsPageSkeleton />}
      ariaLabel="Loading campaign monitoring"
    />
  );
}
