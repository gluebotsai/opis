import { useEffect } from "react";
import { AlertTriangle, ArrowLeftRight, Plus, X } from "lucide-react";

import { listRowDividerClassName } from "@/components/ui/list-row";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { QueueShiftPickerGroup } from "@/components/workforce/queue-shift-block";
import { cn } from "@/lib/utils";

export type QueueAgentPickerItem = {
  id: string;
  name: string;
  subtitle: string;
  currentQueueId?: string | null;
  currentQueueName?: string | null;
  currentQueueStatus?: "active" | "inactive" | null;
};

export type QueueAgentPickerPayload = {
  shift?: string;
  queueName?: string;
  available: QueueAgentPickerItem[];
  elsewhere: QueueAgentPickerItem[];
};

export function otherQueueSubtitle(item: Pick<QueueAgentPickerItem, "currentQueueName" | "currentQueueStatus">) {
  if (!item.currentQueueName) return null;
  const statusLabel = item.currentQueueStatus === "inactive" ? "Inactive" : "Active";
  return `On ${item.currentQueueName} · ${statusLabel}`;
}

export function queueAgentPickMessage(
  item: QueueAgentPickerItem,
  shift?: string,
  moving = false,
) {
  const shiftLabel = shift?.trim() || "this";
  if (moving && item.currentQueueName) {
    return `Move ${item.name} from ${item.currentQueueName} onto this queue for the ${shiftLabel} shift.`;
  }
  return `Add ${item.name} to the ${shiftLabel} shift.`;
}

export function QueueAgentPickerList({
  available,
  elsewhere,
  disabled = false,
  onAdd,
  onMove,
}: {
  available: QueueAgentPickerItem[];
  elsewhere: QueueAgentPickerItem[];
  disabled?: boolean;
  onAdd: (item: QueueAgentPickerItem) => void;
  onMove: (item: QueueAgentPickerItem) => void;
}) {
  if (available.length === 0 && elsewhere.length === 0) {
    return <p className="py-2 text-sm text-neutral-400">No more eligible agents for this shift.</p>;
  }

  return (
    <div className="space-y-4">
      {available.length > 0 ? (
        <QueueShiftPickerGroup label="Available">
          {available.map((agent) => (
            <li key={agent.id} className={listRowDividerClassName()}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAdd(agent)}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2.5 text-left hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-neutral-900">
                    {agent.name}
                  </span>
                  <span className="block truncate text-sm text-neutral-600">{agent.subtitle}</span>
                </span>
                <Plus className="size-4 shrink-0 text-neutral-900" />
              </button>
            </li>
          ))}
        </QueueShiftPickerGroup>
      ) : null}
      {elsewhere.length > 0 ? (
        <QueueShiftPickerGroup label="On another queue">
          {elsewhere.map((agent) => (
            <li key={agent.id} className={listRowDividerClassName()}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onMove(agent)}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2.5 text-left hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-neutral-900">
                    {agent.name}
                  </span>
                  <span className="block truncate text-sm text-neutral-600">
                    {otherQueueSubtitle(agent) ?? agent.subtitle}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-neutral-900">
                  <ArrowLeftRight className="size-3.5" />
                  Move
                </span>
              </button>
            </li>
          ))}
        </QueueShiftPickerGroup>
      ) : null}
    </div>
  );
}

export function QueueMoveAgentDialog({
  agent,
  destinationName,
  onClose,
  onConfirm,
}: {
  agent: QueueAgentPickerItem | null;
  destinationName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!agent) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agent, onClose]);

  if (!agent) return null;

  const sourceName = agent.currentQueueName ?? "another queue";
  const sourceIsLive = agent.currentQueueStatus === "active";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="move-agent-title"
        aria-describedby="move-agent-description"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                sourceIsLive ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-700",
              )}
            >
              {sourceIsLive ? (
                <AlertTriangle className="size-5" />
              ) : (
                <ArrowLeftRight className="size-5" />
              )}
            </span>
            <div>
              <h2 id="move-agent-title" className="text-base font-semibold text-neutral-900">
                Move {agent.name}?
              </h2>
              <p id="move-agent-description" className="mt-1 text-sm text-neutral-600">
                Move {agent.name} from {sourceName} to {destinationName}? A person can only belong to
                one queue.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100"
          >
            <X className="size-4" />
          </button>
        </div>

        {sourceIsLive ? (
          <StatusBanner tone="warning" className="mt-4">
            {sourceName} is live. {agent.name} will stop getting work there after you save.
          </StatusBanner>
        ) : (
          <p className="mt-4 text-sm text-neutral-600">
            {sourceName} is inactive. They will leave that queue when you save.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Move agent</Button>
        </div>
      </div>
    </div>
  );
}
