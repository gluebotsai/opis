/**
 * Shared semantic UI tones — match Products / deal-stages brand palette.
 * Prefer these over ad-hoc emerald/amber/sky Tailwind chips.
 */

export const CHIP_BASE =
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium";

export const TONE_SUCCESS = "bg-[#e8f8ef] text-text-success";
export const TONE_WARNING = "bg-[#fff8e8] text-text-warning";
export const TONE_DANGER = "bg-[#fdecea] text-text-danger";
export const TONE_INFO = "bg-[#e8f1fc] text-text-info";
export const TONE_NEUTRAL = "bg-neutral-100 text-text-caption";
export const TONE_MUTED = "bg-neutral-100 text-text-secondary";
export const TONE_ACCENT = "bg-neutral-100 text-neutral-900";
export const TONE_CAUTION = "bg-[#fef3e8] text-text-caution";

/** Success toast / create confirmation banner. */
export const SUCCESS_FLASH_CLASS =
  "rounded-lg border border-[#b7e4c7] bg-[#e8f8ef] px-4 py-2.5 text-sm text-text-success";

/** Row highlight after create. */
export const CREATE_HIGHLIGHT_ROW_CLASS =
  "bg-[#e8f8ef]/80 ring-1 ring-inset ring-[#0e8f50]/25";

/** Secondary / back link styling (match Products). */
export const BACK_LINK_CLASS =
  "inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline";

export const PAGE_H1_CLASS =
  "text-xl font-semibold tracking-tight text-text-primary";

export const SECTION_H2_CLASS =
  "text-base font-semibold tracking-tight text-text-primary";

export function chipClass(...tones: string[]): string {
  return [CHIP_BASE, ...tones].filter(Boolean).join(" ");
}
