import { ArrowRight, Check } from "lucide-react";

import { listRowDividerClassName } from "@/components/ui/list-row";

export type QueueStaffingAction = {
  id: string;
  label: string;
  message: string;
};

export type QueueStaffingActionsPayload = {
  currentShift?: string;
  otherShifts?: string[];
  actions: QueueStaffingAction[];
};

export function QueueStaffingActionList({
  payload,
  disabled = false,
  onPick,
}: {
  payload: QueueStaffingActionsPayload;
  disabled?: boolean;
  onPick: (message: string) => void;
}) {
  if (payload.actions.length === 0) return null;

  return (
    <ul className="overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
      {payload.actions.map((action) => {
        const done = action.id === "done";
        return (
          <li key={action.id} className={listRowDividerClassName()}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(action.message)}
              className="flex h-[38px] w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="truncate">{action.label}</span>
              {done ? (
                <Check className="size-4 shrink-0 text-neutral-900" />
              ) : (
                <ArrowRight className="size-4 shrink-0 text-neutral-900" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
