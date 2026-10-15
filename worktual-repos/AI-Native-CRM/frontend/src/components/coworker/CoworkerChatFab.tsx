import { PanelRightOpen } from "lucide-react";
import { WorktualLogo } from "@/components/brand/WorktualLogo";

/**
 * Left-side Ask CRM FAB overlaid on full-page workspace.
 */
export function CoworkerChatFab({
  onExpand,
  sending = false,
}: {
  onExpand: () => void;
  sending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-3.5 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-neutral-800"
      aria-label="Restore chat"
      title="Ask CRM"
    >
      <WorktualLogo wordmark={false} inverted markClassName="size-6 rounded-md" />
      <span>{sending ? "Thinking…" : "Ask CRM"}</span>
    </button>
  );
}

/** Right-side control that brings the workspace panel back. */
export function CoworkerWorkspaceFab({
  label,
  onExpand,
}: {
  label: string;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-3.5 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-neutral-800"
      aria-label={`Restore ${label}`}
      title={label}
    >
      <PanelRightOpen className="size-5" strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}
