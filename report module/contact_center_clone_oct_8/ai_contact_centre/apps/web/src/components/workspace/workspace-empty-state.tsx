import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type WorkspaceEmptyVariant = "inbox" | "chat" | "customer";

type WorkspaceEmptyStateProps = {
  variant: WorkspaceEmptyVariant;
  title: string;
  description: string;
  className?: string;
  compact?: boolean;
};

function InboxIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect x="28" y="18" width="104" height="84" rx="12" fill="#F5F5F5" stroke="#E5E5E5" />
      <rect x="42" y="34" width="28" height="28" rx="14" fill="#E5E5E5" />
      <rect x="78" y="38" width="40" height="8" rx="4" fill="#D4D4D4" />
      <rect x="78" y="52" width="28" height="6" rx="3" fill="#E5E5E5" />
      <rect x="42" y="74" width="76" height="6" rx="3" fill="#E5E5E5" />
      <rect x="42" y="86" width="52" height="6" rx="3" fill="#F0F0F0" />
    </svg>
  );
}

function ChatIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect x="24" y="22" width="72" height="36" rx="14" fill="#F5F5F5" stroke="#E5E5E5" />
      <rect x="36" y="34" width="40" height="6" rx="3" fill="#D4D4D4" />
      <rect x="36" y="46" width="28" height="6" rx="3" fill="#E5E5E5" />
      <rect x="64" y="66" width="72" height="36" rx="14" fill="#EFEFEF" stroke="#E5E5E5" />
      <rect x="76" y="78" width="40" height="6" rx="3" fill="#D4D4D4" />
      <rect x="76" y="90" width="28" height="6" rx="3" fill="#E5E5E5" />
    </svg>
  );
}

function CustomerIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect x="36" y="16" width="88" height="88" rx="14" fill="#F5F5F5" stroke="#E5E5E5" />
      <circle cx="80" cy="46" r="16" fill="#E5E5E5" />
      <rect x="54" y="72" width="52" height="8" rx="4" fill="#D4D4D4" />
      <rect x="62" y="86" width="36" height="6" rx="3" fill="#E5E5E5" />
    </svg>
  );
}

const ILLUSTRATIONS: Record<WorkspaceEmptyVariant, (props: { className?: string }) => ReactNode> = {
  inbox: InboxIllustration,
  chat: ChatIllustration,
  customer: CustomerIllustration,
};

export function WorkspaceEmptyState({
  variant,
  title,
  description,
  className,
  compact = false,
}: WorkspaceEmptyStateProps) {
  const Illustration = ILLUSTRATIONS[variant];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-12" : "px-6 py-16",
        className,
      )}
    >
      <Illustration className={cn("text-neutral-300", compact ? "h-20 w-28" : "h-28 w-40")} />
      <p className={cn("font-medium text-neutral-800", compact ? "mt-3 text-sm" : "mt-4 text-base")}>
        {title}
      </p>
      <p
        className={cn(
          "max-w-xs text-neutral-600",
          compact ? "mt-1 text-xs leading-relaxed" : "mt-1.5 text-sm leading-relaxed",
        )}
      >
        {description}
      </p>
    </div>
  );
}
