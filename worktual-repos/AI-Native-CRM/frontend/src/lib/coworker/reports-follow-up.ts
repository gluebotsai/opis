const REPORTS_SOURCES = new Set(["reports_b2b", "reports_b2b_kg"]);
const TRAILING_PARAGRAPH = /<p\b[^>]*>[\s\S]*?<\/p>/gi;

type ReportsSourceCarrier = {
  audit?: { source?: string };
  plan?: { source?: unknown };
};

/** Reports replies are the only chat messages that carry this source. */
export function isReportsAnalyticsSource(
  analytics: ReportsSourceCarrier | undefined,
): boolean {
  const audit = String(analytics?.audit?.source || "");
  const plan = String(analytics?.plan?.source || "");
  return REPORTS_SOURCES.has(audit) || REPORTS_SOURCES.has(plan);
}

/** Lift a trailing question paragraph. A wrapped question is still one `<p>`. */
export function splitTrailingQuestion(html: string): {
  body: string;
  followUp: string;
} {
  const raw = (html || "").trim();
  if (!raw) return { body: "", followUp: "" };
  const matches = [...raw.matchAll(TRAILING_PARAGRAPH)];
  const last = matches.at(-1);
  if (!last || last.index == null) return { body: raw, followUp: "" };
  const after = raw.slice(last.index + last[0].length).trim();
  if (after) return { body: raw, followUp: "" };
  const text = last[0]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text.endsWith("?")) return { body: raw, followUp: "" };
  return {
    body: raw.slice(0, last.index).trim(),
    followUp: last[0].trim(),
  };
}

/**
 * Move the trailing question under a reports card.
 * Any other reply, or a reports reply with no card, keeps its text intact.
 */
export function reportsCardFollowUp(
  text: string,
  analytics: ReportsSourceCarrier | undefined,
  cardShown: boolean,
): { body: string; followUp: string } {
  const raw = (text || "").trim();
  if (!cardShown || !isReportsAnalyticsSource(analytics)) {
    return { body: raw, followUp: "" };
  }
  return splitTrailingQuestion(raw);
}
