import { MessageSquarePlus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { IconButton } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import {
  presenceDotClass,
  presenceLabel,
} from "@/features/internal-chat/internal-chat-utils";
import type { InternalChatMember } from "@/features/internal-chat/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

type InternalChatNewChatDialogProps = {
  open: boolean;
  members: InternalChatMember[];
  currentUserId: string;
  onClose: () => void;
  onStartChat: (targetUserId: string) => void | Promise<void>;
};

export function InternalChatNewChatDialog({
  open,
  members,
  currentUserId,
  onClose,
  onStartChat,
}: InternalChatNewChatDialogProps) {
  const [search, setSearch] = useState("");

  const teammates = useMemo(
    () => members.filter((member) => member.userId !== currentUserId),
    [members, currentUserId],
  );

  const filteredTeammates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return teammates;
    return teammates.filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        member.title?.toLowerCase().includes(query),
    );
  }, [search, teammates]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div className="relative flex max-h-[min(560px,90vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="size-4 text-neutral-700" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900">New chat</h2>
          </div>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search teammates…"
              autoFocus
              className="h-10 w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 pr-3 pl-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-600 focus:border-neutral-300 focus:bg-white"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {filteredTeammates.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-neutral-600">
              No teammates found.
            </li>
          ) : (
            filteredTeammates.map((member) => (
              <li key={member.userId} className={listRowDividerClassName("4")}>
                <button
                  type="button"
                  onClick={() => {
                    void onStartChat(member.userId);
                    onClose();
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-neutral-50"
                >
                  <div className="relative shrink-0">
                    <span
                      className={profileAvatarClassName(member.name, "size-10 text-xs")}
                      aria-hidden
                    >
                      {profileInitials(member.name)}
                    </span>
                    <span
                      className={cn(
                        "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-white",
                        presenceDotClass(member.presence),
                      )}
                      title={presenceLabel(member.presence)}
                    />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900">
                      {member.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-neutral-600">
                      {member.title ?? (member.role === "admin" ? "Admin" : "Agent")}
                      <span className="text-neutral-300"> · </span>
                      {presenceLabel(member.presence)}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
