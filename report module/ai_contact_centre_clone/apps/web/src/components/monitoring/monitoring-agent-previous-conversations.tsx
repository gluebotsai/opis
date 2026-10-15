import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { WorkspaceContactMetaRow } from "@/components/workspace/workspace-contact-meta-row";
import { monitoringApi } from "@/features/monitoring/api";
import { mapAgentPastConversation } from "@/features/monitoring/map-monitoring-snapshot";
import type { AgentPastConversation } from "@/features/monitoring/types";
import type { WorkspaceChannel } from "@/features/workspace/types";
import { listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { channelLabel } from "@/components/monitoring/monitoring-utils";
import { formatRelativeTime } from "./monitoring-shared";

function toWorkspaceChannel(channel: AgentPastConversation["channel"]): WorkspaceChannel {
  if (channel === "webchat") return "chat";
  return channel;
}

function AgentPastConversationItem({
  row,
  onSelect,
}: {
  row: AgentPastConversation;
  onSelect: () => void;
}) {
  return (
    <li className={listRowDividerClassName()}>
      <button
        type="button"
        onClick={onSelect}
        className="w-full cursor-pointer rounded-xl px-1 py-2 text-left transition-colors hover:bg-neutral-50"
      >
        <div className="flex items-center gap-2.5">
          <div className={profileAvatarClassName(row.id, "size-10 shrink-0 text-xs")}>
            {profileInitials(row.customer)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold leading-5 text-neutral-900">{row.customer}</p>
              <span className={listRowTimestampClassName}>
                {formatRelativeTime(row.endedAt)}
              </span>
            </div>
            <WorkspaceContactMetaRow
              className="mt-0.5"
              channel={toWorkspaceChannel(row.channel)}
              channelLabel={channelLabel(row.channel)}
              queueLabel={row.intent ? `${row.intent} · ${row.queue}` : row.queue}
            />
          </div>
        </div>
      </button>
    </li>
  );
}

export function MonitoringAgentPreviousConversations({
  agentId,
  onSelect,
}: {
  agentId: string;
  onSelect: (row: AgentPastConversation) => void;
}) {
  const [rows, setRows] = useState<AgentPastConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void monitoringApi
      .getAgentPreviousConversations(agentId)
      .then((result) => {
        if (cancelled) return;
        setRows((result.conversations ?? []).map(mapAgentPastConversation));
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Unable to load previous conversations");
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-1 py-6 text-sm text-neutral-600">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Loading previous conversations…
      </div>
    );
  }

  if (error) {
    return <p className="px-1 py-6 text-center text-sm text-red-600">{error}</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="px-1 py-6 text-center">
        <p className="text-sm font-medium text-neutral-800">No previous conversations</p>
        <p className="mt-1 text-sm text-neutral-600">No closed conversations for this agent yet.</p>
      </div>
    );
  }

  return (
    <ul>
      {rows.map((row) => (
        <AgentPastConversationItem key={row.id} row={row} onSelect={() => onSelect(row)} />
      ))}
    </ul>
  );
}
