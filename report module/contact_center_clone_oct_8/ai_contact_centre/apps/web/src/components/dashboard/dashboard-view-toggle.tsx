import { FileBarChart2, LineChart } from "lucide-react";
import { useNavigate } from "react-router";

import { useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { SegmentTabs, type SegmentTabOption } from "@/components/ui/segment-tabs";
import { cn } from "@/lib/utils";

export type DashboardView = "reports" | "analytics";

const PATH_BY_VIEW: Record<DashboardView, string> = {
  reports: "/admin/dashboard",
  analytics: "/admin/dashboard/analytics",
};

export function DashboardViewToggle({ active }: { active: DashboardView }) {
  const navigate = useNavigate();
  const panels = useCopilotWorkspacePanels();
  // Copilot is left / content is right: left-expanded shrinks the dashboard chrome.
  const iconOnly = Boolean(panels && !panels.copilotMinimized && panels.expandedSide === "left");

  const options: Array<SegmentTabOption<DashboardView>> = [
    {
      id: "reports",
      label: "Reports",
      leading: iconOnly
        ? (isActive) => (
            <FileBarChart2
              className={cn("size-3.5 shrink-0", isActive ? "text-white" : "text-neutral-600")}
              aria-hidden
            />
          )
        : undefined,
    },
    {
      id: "analytics",
      label: "Analytics",
      leading: iconOnly
        ? (isActive) => (
            <LineChart
              className={cn("size-3.5 shrink-0", isActive ? "text-white" : "text-neutral-600")}
              aria-hidden
            />
          )
        : undefined,
    },
  ];

  return (
    <SegmentTabs
      value={active}
      options={options}
      onChange={(view) => {
        if (view === active) return;
        navigate(PATH_BY_VIEW[view]);
      }}
      fitContent
      equalWidth
      hideLabels={iconOnly}
      className="shrink-0"
      buttonClassName={iconOnly ? "px-2.5" : undefined}
    />
  );
}
