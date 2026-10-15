const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Hide cc-core / nurture voice session ids from contact activity copy. */
export function sanitizeActivityDisplayText(text: string): string {
  if (!text) return text;
  return text
    .replace(new RegExp(`\\s*[—-]\\s*session\\s+${UUID}`, "gi"), "")
    .replace(new RegExp(`\\bsession\\s+${UUID}`, "gi"), "")
    .replace(new RegExp(`^Session id:\\s*${UUID}\\s*$`, "gim"), "")
    .replace(new RegExp(`\\bSession id:\\s*${UUID}`, "gi"), "")
    .replace(new RegExp(`^${UUID}\\s*$`, "gim"), "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * A call a rep typed in themselves, rather than one the CRM placed or the
 * voice bot made. CallLogDialog writes this exact subject shape, and a real
 * gateway call always carries a transcript source ("audio_cc"), so the pair
 * separates the three kinds. Same subject-matching convention as the nurture
 * check in CallActivityDetails.
 */
export function isManuallyLoggedCall(input: {
  type: string;
  subject: string;
  transcriptSource?: string | null;
}): boolean {
  if (input.type !== "call") return false;
  if (input.transcriptSource?.trim()) return false;
  return /^outbound call\s+[—-]/i.test(input.subject.trim());
}
