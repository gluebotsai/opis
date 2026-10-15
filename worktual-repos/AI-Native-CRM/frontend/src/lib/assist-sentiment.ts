import type { AssistSentiment } from "@/services/meetingAssist";

export type AssistSentimentDisplay = AssistSentiment | "confused";

const DISPLAY_LABEL: Record<AssistSentimentDisplay, string> = {
  positive: "Positive",
  negative: "Negative",
  neutral: "Neutral",
  confused: "Confused",
};

/** Circle + label colors for live Assist tone row. */
export function assistSentimentStyles(s: AssistSentimentDisplay): {
  label: string;
  dotClass: string;
  iconBgClass: string;
  labelClass: string;
} {
  switch (s) {
    case "positive":
      return {
        label: DISPLAY_LABEL.positive,
        dotClass: "bg-emerald-500",
        iconBgClass: "bg-emerald-50",
        labelClass: "text-emerald-800",
      };
    case "negative":
      return {
        label: DISPLAY_LABEL.negative,
        dotClass: "bg-rose-500",
        iconBgClass: "bg-rose-50",
        labelClass: "text-rose-800",
      };
    case "confused":
      return {
        label: DISPLAY_LABEL.confused,
        dotClass: "bg-amber-500",
        iconBgClass: "bg-amber-50",
        labelClass: "text-amber-900",
      };
    default:
      return {
        label: DISPLAY_LABEL.neutral,
        dotClass: "bg-zinc-400",
        iconBgClass: "bg-subtle",
        labelClass: "text-text-secondary",
      };
  }
}

export function normalizeAssistSentimentDisplay(
  raw: AssistSentiment | null | undefined,
): AssistSentimentDisplay | null {
  if (
    raw === "positive" ||
    raw === "negative" ||
    raw === "neutral" ||
    raw === "confused"
  ) {
    return raw;
  }
  return null;
}

/** Show tone coaching only when the model flagged a non-neutral tone and gave guidance. */
export function shouldShowSentimentCoach(
  sentiment: AssistSentiment | null | undefined,
  hint: string | null | undefined,
): boolean {
  const h = (hint || "").trim();
  if (!h) return false;
  return (
    sentiment === "positive" ||
    sentiment === "negative" ||
    sentiment === "confused"
  );
}
