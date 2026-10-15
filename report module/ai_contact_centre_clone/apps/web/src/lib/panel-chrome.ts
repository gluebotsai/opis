import { cn } from "@/lib/utils";

/** Tailwind `lg` — tablet landscape / small laptop. */
export const LG_MIN_PX = 1024;
/** Tailwind `xl` — desktop agent shell (rounded panels + copilot split). */
export const XL_MIN_PX = 1280;

export const MEDIA_LG = `(min-width: ${LG_MIN_PX}px)`;
export const MEDIA_XL = `(min-width: ${XL_MIN_PX}px)`;

/**
 * Page-level content shell: full-bleed white below xl, desktop card at xl+.
 * KPI tiles, chart cards, dialogs, and bubbles keep their own chrome.
 */
export const contentPanelClassName =
  "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white xl:rounded-2xl xl:border-[0.6px] xl:border-[#bfbfbf] xl:shadow-sm";

/** Toolbar under the app header: no hairline on flat mobile/tablet or single-panel. */
export const contentPanelHeaderBorderClassName =
  "content-panel-header border-b-0 xl:border-b-[0.6px] xl:border-[#bfbfbf]";

export function contentPanel(className?: string) {
  return cn(contentPanelClassName, className);
}
