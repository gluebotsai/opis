import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import type { MonitoringChannel } from "@/features/monitoring/types";
import type { WorkspaceChannel } from "@/features/workspace/types";

function toWorkspaceChannel(channel: MonitoringChannel): WorkspaceChannel {
  if (channel === "webchat") return "chat";
  return channel;
}

export function MonitoringChannelIcon({
  channel,
  className,
}: {
  channel: MonitoringChannel;
  className?: string;
}) {
  return <WorkspaceChannelIcon channel={toWorkspaceChannel(channel)} className={className} />;
}
