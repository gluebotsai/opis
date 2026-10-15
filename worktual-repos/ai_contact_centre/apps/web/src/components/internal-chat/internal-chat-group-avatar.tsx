import { Users } from "lucide-react";

import { useAuthenticatedMediaUrl } from "@/features/internal-chat/use-authenticated-media-url";
import { profileAvatarClassName } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

type InternalChatGroupAvatarProps = {
  name: string;
  avatarUrl?: string;
  className?: string;
};

export function InternalChatGroupAvatar({
  name,
  avatarUrl,
  className = "size-10 text-xs",
}: InternalChatGroupAvatarProps) {
  const resolvedAvatarUrl = useAuthenticatedMediaUrl(avatarUrl);

  if (resolvedAvatarUrl) {
    return (
      <img
        src={resolvedAvatarUrl}
        alt=""
        className={cn(className, "shrink-0 rounded-full object-cover ring-1 ring-black/5")}
      />
    );
  }

  if (avatarUrl) {
    return (
      <span
        className={cn(className, "shrink-0 animate-pulse rounded-full bg-neutral-200 ring-1 ring-black/5")}
        aria-hidden
      />
    );
  }

  return (
    <span className={profileAvatarClassName(name, className)} aria-hidden>
      <Users className="size-4" />
    </span>
  );
}
