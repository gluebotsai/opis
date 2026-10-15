import { useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { cn } from "@/lib/utils";
import {
  QUEUE_DRAFT_CHANNELS,
  type QueueDraftChannel,
} from "@/features/workforce/queues/types";

export const QUEUE_CHANNEL_OPTIONS: Array<{
  id: QueueDraftChannel;
  label: string;
  icon: string;
}> = [
  { id: "calls", label: "Calls", icon: "calls" },
  { id: "email", label: "Email", icon: "email" },
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "whatsapp", label: "WhatsApp", icon: "whatsapp" },
  { id: "instagram", label: "Instagram", icon: "instagram" },
  { id: "facebook", label: "Facebook", icon: "facebook" },
];

export type QueueChannelPickerPayload = {
  agentId?: string;
  agentName: string;
  shift?: string;
  channels?: QueueDraftChannel[];
};

export function queueChannelPickMessage(
  agentName: string,
  channels: QueueDraftChannel[] | ["all"],
  shift?: string,
) {
  const shiftLabel = shift?.trim() || "this";
  const name = agentName.trim() || "this agent";
  if (channels.length === 1 && channels[0] === "all") {
    return `${name} should handle all channels on the ${shiftLabel} shift.`;
  }
  const selected = channels.filter((item): item is QueueDraftChannel => item !== "all");
  if (selected.length === 0 || selected.length === QUEUE_DRAFT_CHANNELS.length) {
    return `${name} should handle all channels on the ${shiftLabel} shift.`;
  }
  if (selected.length === 1) {
    return `${name} should handle ${selected[0]} on the ${shiftLabel} shift.`;
  }
  if (selected.length === 2) {
    return `${name} should handle ${selected[0]} and ${selected[1]} on the ${shiftLabel} shift.`;
  }
  const last = selected[selected.length - 1];
  const head = selected.slice(0, -1).join(", ");
  return `${name} should handle ${head}, and ${last} on the ${shiftLabel} shift.`;
}

export function QueueChannelPickerList({
  payload,
  disabled = false,
  onPick,
}: {
  payload: QueueChannelPickerPayload;
  disabled?: boolean;
  onPick: (message: string) => void;
}) {
  const [selected, setSelected] = useState<QueueDraftChannel[]>([]);
  const options = payload.channels?.length
    ? QUEUE_CHANNEL_OPTIONS.filter((item) => payload.channels?.includes(item.id))
    : QUEUE_CHANNEL_OPTIONS;

  function toggle(id: QueueDraftChannel) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((channel) => {
          const active = selected.includes(channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => toggle(channel.id)}
              className={cn(
                "inline-flex h-[38px] items-center gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] px-2.5 text-sm font-medium transition",
                active ? "bg-neutral-100 text-neutral-900" : "bg-white text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <WorkspaceChannelIcon channel={channel.icon} className="size-6 rounded-lg shadow-none" />
              {channel.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onPick(queueChannelPickMessage(payload.agentName, ["all"], payload.shift))}
        >
          All channels
        </Button>
        <Button
          type="button"
          disabled={disabled || selected.length === 0}
          onClick={() => onPick(queueChannelPickMessage(payload.agentName, selected, payload.shift))}
        >
          Save channels
        </Button>
      </div>
    </div>
  );
}
