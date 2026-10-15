import { X } from "lucide-react";
import { useEffect } from "react";

import { IconButton } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import {
  memberById,
  presenceDotClass,
  presenceLabel,
} from "@/features/internal-chat/internal-chat-utils";
import type { InternalChatMember } from "@/features/internal-chat/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

type InternalChatGroupMembersDialogProps = {
  open: boolean;
  memberIds: string[];
  members: InternalChatMember[];
  currentUserId: string;
  onClose: () => void;
};

export function InternalChatGroupMembersDialog({
  open,
  memberIds,
  members,
  currentUserId,
  onClose,
}: InternalChatGroupMembersDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const memberCount = memberIds.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">Group members</h2>
              <p className="mt-1 text-sm text-neutral-600">
                {memberCount} {memberCount === 1 ? "person" : "people"} in this group
              </p>
            </div>
            <IconButton variant="ghostIcon" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </IconButton>
          </div>
        </div>

        <ul className="max-h-[min(60vh,420px)] overflow-y-auto px-4 py-2">
          {memberIds.map((userId) => {
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
                      className={cn("size-2 shrink-0 rounded-full", presenceDotClass(member.presence))}
                      title={presenceLabel(member.presence)}
                    />
                    <span
                      className={cn(
                        "shrink-0 text-[11px]",
                        member.presence === "offline" ? "text-neutral-400" : "text-emerald-600",
                      )}
                    >
                      {presenceLabel(member.presence)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-600">
                    {member.title ?? (member.role === "admin" ? "Admin" : "Agent")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
