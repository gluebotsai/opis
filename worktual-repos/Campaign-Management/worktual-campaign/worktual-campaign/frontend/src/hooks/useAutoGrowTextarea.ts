import { useLayoutEffect, type RefObject } from "react";

/** Default max height (~10 lines) before internal scroll. */
export const CHAT_TEXTAREA_MAX_HEIGHT_PX = 200;

/**
 * Grows a textarea with its content instead of showing native scroll arrows.
 * Caps at maxHeightPx; overflow scroll only after the cap.
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx = CHAT_TEXTAREA_MAX_HEIGHT_PX,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }, [ref, value, maxHeightPx]);
}
