import { type ReactNode } from "react";
import {
  ContentPanelShell,
  CopilotChatShell,
  CopilotWorkspace,
} from "@/components/assistant/copilot-workspace";

export type SplitExpand = "none" | "left" | "right";

type ModuleSplitWorkspaceProps = {
  /** Optional bar above the two cards (back, title, actions). */
  toolbar?: ReactNode;
  left: ReactNode;
  /**
   * Pinned chat composer (dashboard pattern). When set, `left` is only the
   * scrollable message column — bar stays aligned on resize.
   */
  leftFooter?: ReactNode;
  /** Omit to show chat full width (no right column). */
  right?: ReactNode;
  leftTitle?: string;
  rightTitle?: string;
  /** Extra controls in left card header (beside expand / minimize). */
  leftHeaderActions?: ReactNode;
  rightHeaderActions?: ReactNode;
  className?: string;
  /**
   * Desktop column weights — kept for API compatibility.
   * Wider side follows CopilotWorkspace expand (60/40).
   */
  leftFr?: number;
  rightFr?: number;
  onRestart?: () => void;
};

/**
 * Shared co-worker split — CC CopilotWorkspace chrome.
 * Left = chat shell (minimize / expand); right = content panel.
 * With no `right`, chat fills the workspace.
 */
export function ModuleSplitWorkspace({
  toolbar,
  left,
  leftFooter,
  right,
  leftTitle = "Your Worktual co-worker",
  rightTitle = "Overview",
  leftHeaderActions,
  rightHeaderActions,
  className = "",
  onRestart,
}: ModuleSplitWorkspaceProps) {
  const chat = (
    <CopilotChatShell
      title={leftTitle}
      onRestart={onRestart}
      headerActions={leftHeaderActions}
      footer={leftFooter}
    >
      {left}
    </CopilotChatShell>
  );

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-3 bg-[#f3f4f6] p-4 sm:p-5 ${className}`}
    >
      {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      {right ? (
        <CopilotWorkspace
          fillHeight
          constrainWidth={false}
          className="min-h-0 flex-1"
          copilot={chat}
        >
          <ContentPanelShell
            title={rightTitle}
            headerActions={rightHeaderActions}
            fillHeight={false}
          >
            {right}
          </ContentPanelShell>
        </CopilotWorkspace>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">{chat}</div>
      )}
    </div>
  );
}
