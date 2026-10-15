import {
  CHIP_BASE,
  TONE_INFO,
  TONE_NEUTRAL,
  TONE_SUCCESS,
} from "@/lib/ui-tones";

export const EXPANSION_SIGNAL_LABELS: Record<string, string> = {
  watch: "Renewal watch",
  opportunity: "Expansion opportunity",
};

/** Expansion & Revenue Matcher Agent — upsell/cross-sell signal badge (informational only). */
export function expansionSignalPillClass(signal: string): string {
  switch (signal) {
    case "opportunity":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "watch":
      return `${CHIP_BASE} ${TONE_INFO}`;
    default:
      return `${CHIP_BASE} ${TONE_NEUTRAL}`;
  }
}
