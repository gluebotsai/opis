import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { listAssignableAgents } from "@/features/internal-chat/mock-data";
import {
  memberById,
  presenceDotClass,
  presenceLabel,
} from "@/features/internal-chat/internal-chat-utils";
import type { InternalChatMember, InternalChatRoom } from "@/features/internal-chat/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

type InternalChatManageMembersPanelProps = {
  room: InternalChatRoom;
  members: InternalChatMember[];
  currentUserId: string;
  onClose: () => void;
  onSave: (memberIds: string[]) => void;
  onRename: (name: string) => void;
};

export function InternalChatManageMembersPanel({
  room,
  members,
  currentUserId,
  onClose,
  onSave,
  onRename,
}: InternalChatManageMembersPanelProps) {
  const [groupName, setGroupName] = useState(room.name);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    room.memberIds.filter((id) => id !== currentUserId),
  );

  const agents = listAssignableAgents(members, currentUserId);

  useEffect(() => {
    setGroupName(room.name);
    setSelectedIds(room.memberIds.filter((id) => id !== currentUserId));
  }, [room.id, room.memberIds, room.name, currentUserId]);

  function toggleMember(userId: string) {
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  function handleSave() {
    onRename(groupName);
    onSave(selectedIds);
    onClose();
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l-[0.6px] border-[#bfbfbf] bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf] px-4 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Manage group</h3>
          <p className="mt-0.5 text-sm text-neutral-600">Members and group name</p>
        </div>
        <IconButton variant="ghostIcon" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </IconButton>
      </div>

      <PanelScrollArea className="min-h-0 flex-1 px-4 py-4">
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Group name</span>
          <input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 px-3 text-sm text-neutral-900 outline-none focus:border-neutral-300 focus:bg-white"
          />
        </label>

        <div className="mt-5">
          <p className="text-xs font-medium text-neutral-600">Current members</p>
          <ul className="mt-2">
            {room.memberIds.map((userId) => {
              const member = memberById(members, userId);
              if (!member) return null;
              const isSelf = userId === currentUserId;
              return (
                <li
                  key={userId}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5",
                    listRowDividerClassName(),
                  )}
                >
                  <span
                    className={profileAvatarClassName(member.name, "size-9 text-[10px]")}
                    aria-hidden
                  >
                    {profileInitials(member.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-900">
                        {member.name}
                        {isSelf ? " (you)" : ""}
                      </span>
                      <span
                        className={cn("size-2 rounded-full", presenceDotClass(member.presence))}
                        title={presenceLabel(member.presence)}
                      />
                    </span>
                    <span className="block truncate text-xs text-neutral-600">
                      {member.title ?? (member.role === "admin" ? "Admin" : "Agent")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-neutral-600">Add or remove agents</p>
          <ul className="mt-2">
            {agents.map((agent) => {
              const checked = selectedIds.includes(agent.userId);
              return (
                <li key={agent.userId} className={listRowDividerClassName()}>
                  <button
                    type="button"
                    onClick={() => toggleMember(agent.userId)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition",
                      checked ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <span
                      className={profileAvatarClassName(agent.name, "size-8 text-[10px]")}
                      aria-hidden
                    >
                      {profileInitials(agent.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                      {agent.name}
                    </span>
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                        checked
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 bg-white",
                      )}
                    >
                      {checked ? "✓" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </PanelScrollArea>

      <div className="flex shrink-0 justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
        <Button variant="outline" onClick={onClose} className="h-9">
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!groupName.trim() || selectedIds.length === 0}
          className="h-9"
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
