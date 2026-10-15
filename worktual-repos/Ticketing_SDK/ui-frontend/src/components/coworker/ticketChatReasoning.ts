/**
 * Shared helpers for guided create-ticket chat reasoning.
 */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}

export function looksLikePhone(text: string): boolean {
  const digits = text.replace(/\D/g, "");
  return digits.length >= 7 && /[\d+\-().\s]/.test(text);
}

/** True when the utterance is a real issue, not contact/filler mistaken for one. */
export function isUsableIssueDescription(raw: string): boolean {
  const text = raw.trim();
  if (looksLikeEmail(text) || looksLikePhone(text)) return false;
  if (isConversationalFiller(text)) return false;
  const stripped = text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, " ")
    .replace(/(?:\+?\d[\d\-().\s]{6,}\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length < 8) return false;
  if (/no issue description/i.test(stripped)) return false;
  return true;
}

export function extractEmail(text: string): string | null {
  const m = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  return m ? m[0] : null;
}

export function extractPhone(text: string): string | null {
  const m = text.match(/(?:\+?\d[\d\-().\s]{6,}\d)/);
  if (!m) return null;
  return looksLikePhone(m[0]) ? m[0].trim() : null;
}

export type FieldCorrection = {
  field: "email" | "phone" | "contact" | "name" | "issue";
  newValue?: string;
};

/**
 * True when the message is the user asking the co-worker something rather than
 * answering the current guided step (e.g. "how many tickets today").
 * Used as an offline guard; the LLM classifies this normally.
 */
export function looksLikeQuestion(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (text.endsWith("?")) return true;
  const lower = text.toLowerCase();
  if (
    /^(how|what|what's|whats|who|whom|when|where|why|which|can you|could you|do you|does|is there|are there|show|list|tell me)\b/.test(
      lower
    )
  ) {
    return true;
  }
  return /\b(how many|how much|how do i|what can you)\b/.test(lower);
}

/**
 * Conversational control words and acknowledgements. These read like plain
 * words but must never be captured as a field value (e.g. "continue" landing
 * in the customer name).
 */
const FILLER_WORDS = new Set([
  "continue",
  "continu",
  "carry on",
  "go on",
  "next",
  "resume",
  "restart",
  "start",
  "start over",
  "again",
  "retry",
  "back",
  "skip",
  "wait",
  "hold on",
  "cancel",
  "stop",
  "nevermind",
  "never mind",
  "create",
  "create ticket",
  "new ticket",
  "ticket",
  "hi",
  "hey",
  "hello",
  "thanks",
  "thank you",
  "thx",
  "please",
  "help",
  "test",
  "same",
  "same details",
  "use the same details",
  "same as before",
  "as before",
  "idk",
  "dunno",
  "nothing",
  "none",
]);

/** True when the message is conversational filler rather than a field value. */
export function isConversationalFiller(raw: string): boolean {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return true;
  if (FILLER_WORDS.has(cleaned)) return true;
  // "please continue", "ok continue", "just continue" etc.
  const stripped = cleaned.replace(/^(please|just|and|so)\s+/g, "");
  return FILLER_WORDS.has(stripped);
}

/**
 * Cheap check for an obvious person name so we can skip an LLM round-trip on
 * the name step. Conservative: anything questionable goes to the LLM.
 */
export function looksLikePersonName(raw: string): boolean {
  const text = raw.trim();
  if (text.length < 2 || text.length > 60) return false;
  if (looksLikeQuestion(text)) return false;
  if (isConversationalFiller(text)) return false;
  if (looksLikeEmail(text) || looksLikePhone(text)) return false;
  // Never treat create/file ticket phrasing (incl. typos) as a customer name.
  const lower = text
    .toLowerCase()
    .replace(/\btic\s*ket\b/g, "ticket")
    .replace(/\btick\s*et\b/g, "ticket");
  if (/\b(create|craete|creat|file|make|new)\b/.test(lower) && /\b(ticket|case)\b/.test(lower)) {
    return false;
  }
  if (/^(create|file|make|new)\s/.test(lower)) return false;
  const words = text.split(/\s+/);
  if (words.length > 4) return false;
  // Lowercase single tokens ("yeah", "ok") are not obvious names — send to the LLM.
  if (words.length === 1 && text === text.toLowerCase()) return false;
  return words.every((w) => /^[A-Za-z][A-Za-z'’.\-]*$/.test(w));
}

/** True when the message may be fixing a prior field (worth an LLM reason call). */
export function looksLikeCorrectionCandidate(raw: string): boolean {
  if (parseTicketFieldCorrection(raw)) return true;
  const text = raw.trim();
  const lower = text.toLowerCase();
  // Real issue sentences are usually longer / not framed as field edits.
  if (text.length > 48) return false;
  if (
    /^(change|update|edit|fix|correct|wrong|oops|sorry)\b/.test(lower) &&
    /\b(e-?mail|mail|phone|name|contact|number)\b/.test(lower)
  ) {
    return true;
  }
  return /\b(change|fix|update|wrong)\s+(my\s+|the\s+)?(e-?mail|mail|phone|name|contact)\b/.test(
    lower
  );
}

/**
 * Detect "change/fix email" style edits — not "I need to change my email on my account" issues.
 */
export function parseTicketFieldCorrection(raw: string): FieldCorrection | null {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (
    /\b(need|want|unable|can'?t|cannot|help|please)\b/.test(lower) &&
    /\b(account|login|profile|portal|app|system|subscription)\b/.test(lower) &&
    text.length > 28
  ) {
    return null;
  }
  if (
    /\b(change|update)\b.{0,40}\b(on|in|for)\s+(my\s+)?(account|profile|login)\b/.test(
      lower
    ) &&
    text.length > 24
  ) {
    return null;
  }

  const emailInText = extractEmail(text);
  const phoneInText = extractPhone(text);

  const emailFix =
    /^(change|update|edit|fix|correct|modify|replace)\s+(my\s+|the\s+|customer'?s\s+)?(e-?mails?|mails?)\b/.test(
      lower
    ) ||
    /^(wrong|bad|incorrect|typo)\s+(e-?mail|mail)\b/.test(lower) ||
    /\b(e-?mail|mail)\s+(is\s+)?(wrong|incorrect|a\s+typo|bad)\b/.test(lower) ||
    /^(wait|oops|sorry)[,!]?\s*(change|update|fix|wrong)?\s*(the\s+|my\s+)?(e-?mail|mail)\b/.test(
      lower
    ) ||
    lower === "change mail" ||
    lower === "change email" ||
    lower === "edit email" ||
    lower === "fix email" ||
    lower === "wrong email" ||
    lower === "wrong mail";

  const phoneFix =
    /^(change|update|edit|fix|correct|modify|replace)\s+(my\s+|the\s+|customer'?s\s+)?(phone|number|mobile|contact\s*number)\b/.test(
      lower
    ) ||
    /^(wrong|bad|incorrect)\s+(phone|number|mobile)\b/.test(lower) ||
    /\b(phone|number|mobile)\s+(is\s+)?(wrong|incorrect|bad)\b/.test(lower) ||
    lower === "change phone" ||
    lower === "change number" ||
    lower === "wrong phone" ||
    lower === "wrong number";

  const nameFix =
    /^(change|update|edit|fix|correct|modify)\s+(my\s+|the\s+|customer'?s\s+)?(name|customer\s*name)\b/.test(
      lower
    ) ||
    /^(wrong|bad|incorrect)\s+name\b/.test(lower) ||
    lower === "change name" ||
    lower === "fix name" ||
    lower === "wrong name";

  const issueFix =
    /^(change|update|edit|fix|correct|modify)\s+(the\s+|my\s+)?(issue|problem|description|details)\b/.test(
      lower
    ) ||
    lower === "change issue" ||
    lower === "edit issue" ||
    lower === "fix issue";

  const contactFix =
    /^(change|update|edit|fix|correct)\s+(my\s+|the\s+)?contact\b/.test(lower) ||
    lower === "change contact" ||
    lower === "fix contact";

  if (emailFix) {
    return { field: "email", newValue: emailInText || undefined };
  }
  if (phoneFix) {
    return { field: "phone", newValue: phoneInText || undefined };
  }
  if (nameFix) {
    const stripped = text
      .replace(
        /^(change|update|edit|fix|correct|modify)\s+(my\s+|the\s+|customer'?s\s+)?(name|customer\s*name)\s*(to|as|=|:)?\s*/i,
        ""
      )
      .trim();
    const newValue =
      stripped &&
      stripped.toLowerCase() !== lower &&
      stripped.length >= 2 &&
      !/^(to|as)$/i.test(stripped)
        ? stripped
        : undefined;
    return { field: "name", newValue };
  }
  if (issueFix) return { field: "issue" };
  if (contactFix) {
    if (emailInText) return { field: "email", newValue: emailInText };
    if (phoneInText) return { field: "phone", newValue: phoneInText };
    return { field: "contact" };
  }

  if (
    emailInText &&
    /\b(use|instead|actually|rather)\b/.test(lower) &&
    /\b(e-?mail|mail|contact)\b/.test(lower)
  ) {
    return { field: "email", newValue: emailInText };
  }

  return null;
}
