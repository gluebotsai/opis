import {
  WORKTUAL_CONTROL_RADIUS,
  WORKTUAL_HEADER_ICON_GROUP,
  WORKTUAL_ICON_BUTTON,
  WORKTUAL_ICON_BUTTON_COMPOSER,
} from "@/lib/worktual-control-tokens";

/** Shared chat + workspace panel header — keep heights aligned in split agent layouts. */
export const COWORKER_PANEL_HEADER_CLASS =
  "flex h-16 shrink-0 items-center gap-2 border-b border-[#bfbfbf]/80 px-4";

/** Square icon control — matches Worktual 38px header controls. */
export const COWORKER_ICON_BTN_CLASS = WORKTUAL_ICON_BUTTON;

/** Chat/workspace header icon toolbar — 8px gap between controls. */
export const COWORKER_HEADER_ACTIONS_CLASS = WORKTUAL_HEADER_ICON_GROUP;

export const COWORKER_ICON_BTN_COMPOSER_CLASS = WORKTUAL_ICON_BUTTON_COMPOSER;

export const COWORKER_AVATAR_CLASS = `flex size-[38px] shrink-0 items-center justify-center ${WORKTUAL_CONTROL_RADIUS} bg-[#111111] text-xs font-semibold tracking-wide text-white`;

/** Scrollable workspace body. Parent coworker panes use overflow-hidden + a fixed height. */
export const COWORKER_WORKSPACE_SCROLL =
  "h-full min-h-0 overflow-y-auto overscroll-contain";

/**
 * Messages and the composer, when the chat panel is the wide one.
 * A ceiling: the column stays the panel width until it would pass 798px.
 */
export const COWORKER_CHAT_READING_COLUMN =
  "mx-auto w-full min-w-0 max-w-[798px]";
