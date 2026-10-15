import type { ReactNode } from "react";

import { SegmentTabs } from "@/components/ui/segment-tabs";
import type { ShiftType } from "@/features/workforce/queues/types";

export type QueueShiftTab = {
  type: ShiftType;
  agentCount: number;
};

export function QueueShiftSwitcher({
  shifts,
  value,
  onChange,
}: {
  shifts: QueueShiftTab[];
  value: ShiftType;
  onChange: (shift: ShiftType) => void;
}) {
  return (
    <SegmentTabs
      value={value}
      onChange={onChange}
      options={shifts.map((shift) => ({
        id: shift.type,
        label: shift.type,
        count: shift.agentCount,
      }))}
    />
  );
}

export function QueueShiftPickerGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">{label}</p>
      <ul className="mt-1">{children}</ul>
    </div>
  );
}
