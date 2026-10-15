/**
 * Worktual-aligned chrome (worktual-ui-system).
 * Buttons/inputs 38px rounded-lg; KPI panels rounded-2xl; charts rounded-xl.
 */
export const WORKTUAL_CONTROL_RADIUS = "rounded-lg";

export const WORKTUAL_HAIRLINE = "border-[0.6px] border-[#bfbfbf]";

export const WORKTUAL_HEADER_CONTROL = `inline-flex h-[38px] items-center ${WORKTUAL_CONTROL_RADIUS} ${WORKTUAL_HAIRLINE} bg-white px-3 text-sm font-medium text-neutral-700`;

export const WORKTUAL_SEGMENT_SHELL = `inline-flex h-[38px] items-center ${WORKTUAL_CONTROL_RADIUS} ${WORKTUAL_HAIRLINE} bg-neutral-50/90 p-0.5`;

export const WORKTUAL_TAB_TRACK = `grid h-[38px] grid-flow-col auto-cols-fr items-stretch ${WORKTUAL_CONTROL_RADIUS}`;

export const WORKTUAL_TAB_BUTTON =
  `inline-flex h-[38px] min-w-0 w-full items-center justify-center gap-1.5 ${WORKTUAL_CONTROL_RADIUS} px-2 text-sm font-medium transition-colors`;

export const WORKTUAL_ICON_BUTTON = `inline-flex size-[38px] items-center justify-center ${WORKTUAL_CONTROL_RADIUS} ${WORKTUAL_HAIRLINE} bg-white text-neutral-900 hover:bg-neutral-100 [&_svg]:size-[18px]`;

/** Horizontal group of 38px header icon buttons — 8px gap. */
export const WORKTUAL_HEADER_ICON_GROUP =
  "flex shrink-0 items-center gap-2";

export const WORKTUAL_ICON_BUTTON_COMPOSER = `inline-flex size-[38px] shrink-0 items-center justify-center ${WORKTUAL_CONTROL_RADIUS} text-neutral-600 hover:bg-neutral-200/80 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-[18px]`;

export const WORKTUAL_SEND_BUTTON =
  `inline-flex size-[38px] shrink-0 items-center justify-center ${WORKTUAL_CONTROL_RADIUS} bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] transition-transform hover:bg-neutral-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-neutral-200/90 disabled:text-neutral-400 disabled:shadow-none [&_svg]:size-[18px]`;

/** Mobile chat/workspace switcher — same radius as dashboard tab tracks. */
export const WORKTUAL_MOBILE_TAB_SHELL = `flex shrink-0 gap-1 ${WORKTUAL_CONTROL_RADIUS} ${WORKTUAL_HAIRLINE} bg-white p-1 lg:hidden`;

export const WORKTUAL_MOBILE_TAB_PILL = `flex-1 ${WORKTUAL_CONTROL_RADIUS} px-3 py-2 text-sm font-medium transition-colors`;

export const WORKTUAL_PANEL_RADIUS = "rounded-2xl";

export const WORKTUAL_CHART_RADIUS = "rounded-xl";

/** KPI tiles, chart shells, and bordered dashboard sections. */
export const WORKTUAL_CARD_RADIUS = WORKTUAL_PANEL_RADIUS;

export const WORKTUAL_KPI_ICON_TILE =
  "inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl";

export const WORKTUAL_KPI_CARD =
  `flex min-h-[136px] h-full flex-col ${WORKTUAL_PANEL_RADIUS} ${WORKTUAL_HAIRLINE} bg-white px-4 py-4 shadow-none transition-colors hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300`;

/** Fluid KPI grid — container queries only (safe in narrow workspace columns). */
export const WORKTUAL_KPI_ROW =
  "grid grid-cols-1 gap-4 @[32rem]/kpis:grid-cols-2 @[42rem]/kpis:grid-cols-3";

/** Narrow/medium — single flowing grid before 3+3+2 row layout kicks in. */
export const WORKTUAL_KPI_ROW_FLUID =
  "grid grid-cols-1 gap-4 @[32rem]/kpis:grid-cols-2";

/** Wide overview rows — fixed column counts inside @container/kpis. */
export const WORKTUAL_KPI_ROW_TRIPLE = "grid grid-cols-3 gap-4";

export const WORKTUAL_KPI_ROW_PAIR = "grid grid-cols-2 gap-4";

export const WORKTUAL_CHART_CARD =
  `${WORKTUAL_CHART_RADIUS} ${WORKTUAL_HAIRLINE} bg-white p-4 shadow-none`;

export const WORKTUAL_REPORT_SURFACE =
  `${WORKTUAL_PANEL_RADIUS} ${WORKTUAL_HAIRLINE} bg-white shadow-none`;

export const WORKTUAL_SURFACE_SECTION =
  `${WORKTUAL_CHART_RADIUS} ${WORKTUAL_HAIRLINE} bg-surface`;

export const WORKTUAL_SURFACE_ROW =
  `${WORKTUAL_CHART_RADIUS} border-[0.6px] border-[#e5e5e5]`;

/** Tabs + tab body — shared shell (Reports / My performance panels). */
export const WORKTUAL_DASHBOARD_CLUSTER =
  `${WORKTUAL_PANEL_RADIUS} flex flex-col gap-4 overflow-hidden bg-white p-4 shadow-none`;

export const WORKTUAL_WORKSPACE_PANEL =
  `flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ${WORKTUAL_PANEL_RADIUS} ${WORKTUAL_HAIRLINE} bg-white shadow-none`;
