import { PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import type { WorkspaceChannel, WorkspaceConversationDirection } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

type WorkspaceContactMetaRowProps = {
  channel: WorkspaceChannel;
  channelLabel: string;
  queueLabel: string;
  direction?: WorkspaceConversationDirection;
  /** When false, hide channel icon/label and show Incoming/Outgoing instead. */
  showChannel?: boolean;
  className?: string;
};

export function workspaceDirectionMeta(direction: WorkspaceConversationDirection) {
  if (direction === "outbound") {
    return {
      Icon: PhoneOutgoing,
      label: "Outgoing",
      className: "text-violet-600",
    };
  }
  return {
    Icon: PhoneIncoming,
    label: "Incoming",
    className: "text-emerald-600",
  };
}

export function WorkspaceDirectionIcon({
  direction,
  className,
}: {
  direction: WorkspaceConversationDirection;
  className?: string;
}) {
  const { Icon, label, className: directionClassName } = workspaceDirectionMeta(direction);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center", directionClassName, className)}
      title={label}
      aria-label={label}
    >
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}

export function WorkspaceContactMetaRow({
  channel,
  channelLabel,
  queueLabel,
  direction = "inbound",
  showChannel = true,
  className,
}: WorkspaceContactMetaRowProps) {
  const { label } = workspaceDirectionMeta(direction);

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-neutral-600",
        className,
      )}
    >
      <WorkspaceDirectionIcon direction={direction} />
      {showChannel ? (
        <>
          <WorkspaceChannelIcon channel={channel} className="size-4 rounded-[4px]" />
          <span className="shrink-0 font-medium text-sky-600">{channelLabel}</span>
        </>
      ) : (
        <span className="shrink-0 font-medium text-neutral-600">{label}</span>
      )}
      <span className="shrink-0 text-neutral-300" aria-hidden="true">
        ·
      </span>
      <span className="truncate text-neutral-600">{queueLabel}</span>
    </div>
  );
}
