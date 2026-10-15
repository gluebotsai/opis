const SUGGESTION_LABEL =
  /suggested reply(?:\s+for(?:\s+the)?\s+agent(?:\s+to\s+review\s+and\s+send)?)?\s*:?\s*/i;

const COACH_AT_START = /^coach\s+the\s+agent\s*:/i;

/** Keep only the customer-facing draft from inbox suggestion output. */
export function extractCustomerFacingSuggestion(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const labelIndex = trimmed.search(SUGGESTION_LABEL);
  if (labelIndex >= 0) {
    const afterLabel = trimmed
      .slice(labelIndex)
      .replace(SUGGESTION_LABEL, "")
      .trim();
    if (afterLabel) return afterLabel;
  }

  if (COACH_AT_START.test(trimmed)) {
    const lines = trimmed.split("\n");
    const replyStart = lines.findIndex(
      (line, index) => index > 0 && line.trim().length > 0,
    );
    if (replyStart > 0) {
      return lines.slice(replyStart).join("\n").trim();
    }
  }

  return trimmed;
}
