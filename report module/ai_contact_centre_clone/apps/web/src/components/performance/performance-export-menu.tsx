import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { CalendarClock, Download, LoaderCircle, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ScheduledReportsUi } from "@/components/performance/scheduled-reports-ui";

type ExportKind = "png" | "csv" | "pdf";

type PerformanceExportMenuProps = {
  disabled?: boolean;
  exporting?: ExportKind | null;
  ariaLabel?: string;
  /** Show schedule create/manage UI. */
  enableScheduleUi?: boolean;
  scheduleAudience?: "admin" | "agent";
  onScheduleModeChange?: (mode: "create" | "manage" | null) => void;
  onDownloadReport: () => void;
};

export function PerformanceExportMenu({
  disabled = false,
  exporting = null,
  ariaLabel = "Report actions",
  enableScheduleUi = false,
  scheduleAudience = "admin",
  onScheduleModeChange,
  onDownloadReport,
}: PerformanceExportMenuProps) {
  const [scheduleMode, setScheduleMode] = useState<"create" | "manage" | null>(null);

  function updateScheduleMode(mode: "create" | "manage" | null) {
    setScheduleMode(mode);
    onScheduleModeChange?.(mode);
  }

  const items: MenuProps["items"] = [
    {
      key: "download",
      label: (
        <span className="inline-flex items-center gap-2 text-xs text-neutral-700">
          <Download className="size-3.5 text-neutral-900" aria-hidden />
          Download report
        </span>
      ),
      disabled: Boolean(disabled || exporting),
    },
    ...(enableScheduleUi
      ? [
          { type: "divider" as const },
          {
            key: "schedule",
            label: (
              <span className="inline-flex items-center gap-2 text-xs text-neutral-700">
                <CalendarClock className="size-3.5 text-neutral-900" aria-hidden />
                Schedule report
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Dropdown
        menu={{
          items,
          onClick: ({ key }) => {
            if (key === "download") onDownloadReport();
            if (key === "schedule") updateScheduleMode("manage");
          },
        }}
        trigger={["click"]}
        placement="bottomRight"
      >
        <span className="inline-flex">
          <Button
            variant="panelIcon"
            className="text-neutral-700 hover:text-neutral-950"
            disabled={disabled || Boolean(exporting)}
            aria-label={ariaLabel}
          >
            {exporting ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <MoreHorizontal aria-hidden />
            )}
          </Button>
        </span>
      </Dropdown>

      {enableScheduleUi ? (
        <ScheduledReportsUi
          audience={scheduleAudience}
          mode={scheduleMode}
          onClose={() => updateScheduleMode(null)}
          onOpenCreate={() => updateScheduleMode("create")}
        />
      ) : null}
    </>
  );
}
