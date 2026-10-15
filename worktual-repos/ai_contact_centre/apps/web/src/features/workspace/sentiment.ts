export type SentimentLabel =
  | "very_positive"
  | "positive"
  | "neutral"
  | "negative"
  | "very_negative";

export type SentimentAxis = {
  label: SentimentLabel;
  score: number;
  confidence?: number;
  rationale?: string;
};

export type ConversationSentiment = {
  customer: SentimentAxis;
  agent: SentimentAxis;
  updatedAt: string;
  messageId?: string;
  summary?: string;
};

export const SENTIMENT_LABEL_TEXT: Record<SentimentLabel, string> = {
  very_positive: "Very positive",
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  very_negative: "Very negative",
};

export const SENTIMENT_LABEL_SHORT: Record<SentimentLabel, string> = {
  very_positive: "Very pos",
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  very_negative: "Very neg",
};

export function sentimentChipClassName(label: SentimentLabel): string {
  switch (label) {
    case "very_positive":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "positive":
      return "border-green-200 bg-green-50 text-green-700";
    case "neutral":
      return "border-neutral-200 bg-white text-neutral-600";
    case "negative":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "very_negative":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-neutral-200 bg-white text-neutral-600";
  }
}

export function sentimentDotClassName(label: SentimentLabel): string {
  switch (label) {
    case "very_positive":
      return "bg-emerald-500";
    case "positive":
      return "bg-green-500";
    case "neutral":
      return "bg-neutral-300";
    case "negative":
      return "bg-amber-500";
    case "very_negative":
      return "bg-red-500";
    default:
      return "bg-neutral-300";
  }
}

export const SENTIMENT_CHART_COLORS: Record<SentimentLabel, string> = {
  very_positive: "#10b981",
  positive: "#22c55e",
  neutral: "#d4d4d8",
  negative: "#f59e0b",
  very_negative: "#ef4444",
};

export function sentimentChartColor(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "_") as SentimentLabel;
  return SENTIMENT_CHART_COLORS[normalized] ?? "#94a3b8";
}

export const SENTIMENT_LABEL_SCORE: Record<SentimentLabel, number> = {
  very_negative: 10,
  negative: 30,
  neutral: 50,
  positive: 70,
  very_positive: 90,
};

export function sentimentLabelKey(label: string): SentimentLabel | null {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "_") as SentimentLabel;
  return normalized in SENTIMENT_LABEL_TEXT ? normalized : null;
}

export function sentimentLabelFromScore(score: number): SentimentLabel {
  if (score >= 81) return "very_positive";
  if (score >= 61) return "positive";
  if (score >= 41) return "neutral";
  if (score >= 21) return "negative";
  return "very_negative";
}

export function sentimentMixSummary(items: Array<{ label: string; value: number }>): {
  score: number;
  label: SentimentLabel;
  total: number;
} {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return { score: 50, label: "neutral", total: 0 };
  }

  const weighted = items.reduce((sum, item) => {
    const key = sentimentLabelKey(item.label);
    const midpoint = key ? SENTIMENT_LABEL_SCORE[key] : 50;
    return sum + midpoint * item.value;
  }, 0);

  const score = Math.round(weighted / total);
  return { score, label: sentimentLabelFromScore(score), total };
}

export function sentimentScoreClassName(label: SentimentLabel): string {
  switch (label) {
    case "very_positive":
      return "text-emerald-700";
    case "positive":
      return "text-green-700";
    case "neutral":
      return "text-neutral-600";
    case "negative":
      return "text-amber-700";
    case "very_negative":
      return "text-red-700";
    default:
      return "text-neutral-600";
  }
}
