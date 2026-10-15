import type { ReactNode } from "react";
import {
  WORKTUAL_MOBILE_TAB_PILL,
  WORKTUAL_MOBILE_TAB_SHELL,
} from "@/lib/worktual-control-tokens";
import type { PanelExpand } from "./types";

function splitLayout(expand: PanelExpand, balance: "create" | "agent") {
  if (expand === "chat") {
    return {
      row: "flex min-h-0 w-full min-w-0 flex-1 flex-row gap-2 sm:gap-3",
      chat: "flex min-h-0 min-w-0 flex-[1.35] flex-col basis-0",
      draft: "flex min-h-0 min-w-0 flex-1 flex-col basis-0 min-w-[16rem]",
    };
  }
  if (expand === "draft") {
    return {
      row: "flex min-h-0 w-full min-w-0 flex-1 flex-row gap-2 sm:gap-3",
      chat: "flex min-h-0 min-w-0 shrink-0 flex-col lg:w-[min(100%,20rem)] lg:max-w-[22rem]",
      draft: "flex min-h-0 min-w-0 flex-1 flex-col basis-0",
    };
  }
  if (balance === "agent") {
    return {
      row: "flex min-h-0 w-full min-w-0 flex-1 flex-row gap-2 sm:gap-3",
      chat: "flex min-h-0 min-w-0 flex-[35] flex-col basis-0",
      draft: "flex min-h-0 min-w-0 flex-[65] flex-col basis-0",
    };
  }
  return {
    row: "flex min-h-0 w-full min-w-0 flex-1 flex-row gap-2 sm:gap-3",
    chat: "flex min-h-0 min-w-0 flex-[1.05] flex-col basis-0 lg:max-w-[min(52%,28rem)] lg:shrink-0",
    draft: "flex min-h-0 min-w-0 flex-1 flex-col basis-0 min-w-[18rem]",
  };
}

export function CoworkerWorkspace({
  expand = "default",
  balance = "create",
  chat,
  draft,
  /** Full-page workspace + left FAB overlay when expand=draft. */
  workspaceFullCollapse = false,
  collapsedChat,
  /** Full-width chat + right FAB overlay when expand=chatFull. */
  collapsedWorkspace,
  mobileTab,
  onMobileTab,
  draftTabLabel = "Draft",
}: {
  expand?: PanelExpand;
  /**
   * create: chat-weighted hybrid drafts (~52/48 flex).
   * agent: ~35% chat / 65% workspace (flex ratio on lg+).
   */
  balance?: "create" | "agent";
  chat: ReactNode;
  draft: ReactNode;
  workspaceFullCollapse?: boolean;
  /** Left FAB overlay when workspace is fully expanded. */
  collapsedChat?: ReactNode;
  /** Right FAB overlay when the workspace panel is minimized. */
  collapsedWorkspace?: ReactNode;
  mobileTab: "chat" | "draft";
  onMobileTab: (tab: "chat" | "draft") => void;
  /** Mobile tab label for the right pane (e.g. Workspace on agent shells). */
  draftTabLabel?: string;
}) {
  const workspaceFull =
    expand === "draft" &&
    workspaceFullCollapse &&
    collapsedChat != null;
  const chatFull = expand === "chatFull" && collapsedWorkspace != null;

  const layout = splitLayout(expand, balance);

  if (workspaceFull) {
    return (
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2 sm:gap-3">
        <div className={WORKTUAL_MOBILE_TAB_SHELL}>
          {(
            [
              { id: "chat" as const, label: "Chat" },
              { id: "draft" as const, label: draftTabLabel },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onMobileTab(tab.id)}
              className={`${WORKTUAL_MOBILE_TAB_PILL} ${
                mobileTab === tab.id
                  ? "bg-black text-white"
                  : "text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
            mobileTab === "draft" ? "flex" : "hidden"
          } lg:flex`}
        >
          {draft}
        </div>

        <div
          className={`min-h-0 min-w-0 ${
            mobileTab === "chat" ? "flex flex-1 flex-col" : "hidden"
          } lg:hidden`}
        >
          {chat}
        </div>

        <div className="pointer-events-none absolute bottom-5 left-5 z-20 hidden lg:block">
          <div className="pointer-events-auto">{collapsedChat}</div>
        </div>
      </div>
    );
  }

  if (chatFull) {
    return (
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2 sm:gap-3">
        <div className={WORKTUAL_MOBILE_TAB_SHELL}>
          {(
            [
              { id: "chat" as const, label: "Chat" },
              { id: "draft" as const, label: draftTabLabel },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onMobileTab(tab.id)}
              className={`${WORKTUAL_MOBILE_TAB_PILL} ${
                mobileTab === tab.id
                  ? "bg-black text-white"
                  : "text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 ${
            mobileTab === "chat" ? "flex" : "hidden"
          } lg:flex`}
        >
          {chat}
        </div>

        <div
          className={`min-h-0 min-w-0 p-2 ${
            mobileTab === "draft" ? "flex flex-1 flex-col" : "hidden"
          } lg:hidden`}
        >
          {draft}
        </div>

        <div className="pointer-events-none absolute right-5 bottom-24 z-20 hidden lg:block">
          <div className="pointer-events-auto">{collapsedWorkspace}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2 sm:gap-3">
      <div className={WORKTUAL_MOBILE_TAB_SHELL}>
        {(
          [
            { id: "chat" as const, label: "Chat" },
            { id: "draft" as const, label: draftTabLabel },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onMobileTab(tab.id)}
            className={`${WORKTUAL_MOBILE_TAB_PILL} ${
              mobileTab === tab.id
                ? "bg-black text-white"
                : "text-neutral-500 hover:bg-neutral-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={`${layout.row} min-h-0 w-full min-w-0 overflow-hidden p-2 max-lg:flex-col`}>
        <div
          className={`${layout.chat} min-h-0 overflow-hidden ${
            mobileTab === "chat" ? "flex" : "hidden"
          } max-lg:w-full max-lg:max-w-none lg:flex`}
        >
          {chat}
        </div>
        <div
          className={`${layout.draft} min-h-0 min-w-0 overflow-hidden ${
            mobileTab === "draft" ? "flex flex-1 flex-col" : "hidden"
          } max-lg:min-h-[min(560px,62vh)] max-lg:min-w-0 max-lg:w-full lg:flex`}
        >
          {draft}
        </div>
      </div>
    </div>
  );
}
