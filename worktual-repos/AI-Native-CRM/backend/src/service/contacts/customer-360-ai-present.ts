/**
 * Presentation cleanup for CDP ai_insights / customer_recommendations on Customer 360.
 * CDP jobs sometimes store pipeline debug text in explanation — never show that to reps.
 */

const DEBUG_LINE =
  /Model returned|affinities=\{|currency=None|\bpredicted_ltv=|\bconfidence=/i;

const INTERNAL_AFFINITY = /scheduled_score_backfill|score_backfill|backfill/i;

function cleanCopy(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || DEBUG_LINE.test(s)) return null;
  s = s.replace(/\bscheduled_score_backfill\b/gi, "recent engagement");
  s = s.replace(/\s+None\b/g, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || null;
}

export function sanitizeCustomer360Insight(input: {
  type: string;
  score: number | null;
  summary: string | null;
  explanation: string | null;
}): { summary: string | null; explanation: string | null } {
  let summary = cleanCopy(input.summary);
  let explanation = cleanCopy(input.explanation);
  if (summary && INTERNAL_AFFINITY.test(input.summary ?? "")) {
    summary = summary.replace(/Top affinity/i, "Top signal");
  }
  if (
    input.type === "future_value" &&
    summary &&
    /^Predicted LTV\s+[\d.]+$/i.test(summary)
  ) {
    summary = `${summary} (estimated)`;
  }
  if (summary && explanation && summary === explanation) {
    explanation = null;
  }
  return { summary, explanation };
}

export function sanitizeCustomer360Recommendation(input: {
  type: string;
  text: string | null;
}): string | null {
  return cleanCopy(input.text);
}

/** Recommendations duplicate insight types — keep the insight row only. */
export function filterDuplicateRecommendations<
  T extends { type: string },
  R extends { type: string },
>(insights: T[], recommendations: R[]): R[] {
  const seen = new Set(insights.map((row) => row.type));
  return recommendations.filter((row) => !seen.has(row.type));
}
