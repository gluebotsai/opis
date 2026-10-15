import { ModuleSplitWorkspaceSkeleton } from "@/components/layout/ModuleSplitWorkspaceSkeleton";
import { EventsListPaneSkeleton } from "@/components/campaigns/EventsListPaneSkeleton";

/** Events tracking — co-worker chat + events list/detail pane. */
export function EventsTrackingSkeleton() {
  return (
    <ModuleSplitWorkspaceSkeleton
      leftTitleWidth={108}
      rightTitleWidth={56}
      rightPanel={<EventsListPaneSkeleton />}
      ariaLabel="Loading events tracking"
    />
  );
}
