/** Detect marketing / MIME HTML bodies stored or synced as raw HTML. */
export function isHtmlEmailBody(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  const t = text.trim();
  if (/<!doctype html/i.test(t)) return true;
  if (/<html[\s>]/i.test(t)) return true;
  if (/<body[\s>]/i.test(t)) return true;
  if (/<!--\s*\[if\b/i.test(t)) return true;
  if (/<style[\s>]/i.test(t)) return true;
  if (/<table[\s>]/i.test(t) && /<style[\s>]/i.test(t)) return true;
  return /<(p|div|br|a|span|img|table|tbody|tr|td|th|h[1-6]|center|font|button|meta|link|head)\b/i.test(
    t,
  );
}

/** Plain-text bodies that still contain HTML comment/tag debris (common in Gmail text parts). */
export function hasHtmlArtifacts(text: string): boolean {
  return (
    /<!--[\s\S]*?-->/.test(text) ||
    /<\/?[a-z][\s/>]/i.test(text) ||
    /<https?:\/\/[^>\s]+>/i.test(text)
  );
}

export function hasEncodedHtmlEntities(text: string): boolean {
  return /&(?:#\d+|#x[\da-f]+|[a-z]{2,8});/i.test(text);
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

/**
 * Recover common UTF-8 text that was decoded as Latin-1/Windows-1252,
 * e.g. "Ã¢Â€Â”" -> "—" or "Ã‚Â·" -> "·".
 */
export function normalizeEmailDisplayText(text: string): string {
  const decodedEntities = decodeHtmlEntities(text);
  const directRepair = decodedEntities
    .replace(/Ã¢Â€Â”/g, "—")
    .replace(/Ã¢Â€Â“/g, "–")
    .replace(/Ã¢Â€Â˜/g, "‘")
    .replace(/Ã¢Â€Â™/g, "’")
    .replace(/Ã¢Â€Âœ/g, "“")
    .replace(/Ã¢Â€Â/g, "”")
    // Single-step cp1252 mojibake of UTF-8 punctuation
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€˜/g, "‘")
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€/g, "”")
    .replace(/Ã¢â€Â”/g, "—")
    .replace(/Ã¢â€Â“/g, "–")
    .replace(/Ã¢â€Â™/g, "’")
    .replace(/Ã‚Â·/g, "·")
    .replace(/Ã‚Â /g, " ")
    .replace(/Ã‚Â/g, "")
    .replace(/Â /g, " ")
    .replace(/Â/g, "");

  if (directRepair !== decodedEntities) {
    return directRepair;
  }

  // Common double-encoding signatures from UTF-8 bytes interpreted as Latin-1.
  // Examples:
  // - "Ã¢Â€Â”" -> "—"
  // - "Ã‚Â·" -> "·"
  // - "â€“" / "â€”" -> "–" / "—"
  if (!/(Ã¢|Ã‚|ÃÂ|â€“|â€”|â€|Â)/.test(decodedEntities)) {
    return decodedEntities;
  }

  try {
    const bytes = Uint8Array.from(
      Array.from(decodedEntities, (char) => char.charCodeAt(0) & 0xff),
    );
    const repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const replacementCount = (repaired.match(/\uFFFD/g) ?? []).length;
    if (replacementCount === 0 && repaired !== decodedEntities) {
      return repaired;
    }
    return decodedEntities;
  } catch {
    return decodedEntities;
  }
}

/** Clean subject for compose/display: fix mojibake, prefer ASCII dashes. */
export function normalizeEmailSubjectForCompose(subject: string): string {
  return normalizeEmailDisplayText(subject)
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function stripLeadingSubjectFromBody(
  body: string,
  subject?: string | null,
): string {
  if (!subject?.trim() || !body.trim()) return body;
  const normalizedSubject = subject.trim();
  const text = body.trim();
  if (text.startsWith(normalizedSubject)) {
    return text.slice(normalizedSubject.length).trim();
  }
  const decoded = decodeHtmlEntities(text);
  if (decoded.startsWith(normalizedSubject)) {
    return decoded.slice(normalizedSubject.length).trim();
  }
  return text;
}

/** Normalize plain-text bodies for inbox display (decode entities, drop duplicate subject). */
export function formatPlainEmailForDisplay(
  raw: string,
  subject?: string | null,
): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  text = normalizeEmailDisplayText(text);
  text = stripLeadingSubjectFromBody(text, subject);
  text = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<https?:\/\/[^>\s]+>/gi, (match) => match.slice(1, -1))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text;
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain compose text → simple HTML paragraphs for the rich editor / outbound mail. */
export function plainTextToEmailHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (isHtmlEmailBody(trimmed)) return trimmed;
  if (/<(p|div|br|b|i|strong|em|ul|ol|li|u|a)\b/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtmlText(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Convert HTML to readable plain text (fallback when iframe is not used). */
export function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<https?:\/\/[^>\s]+>/gi, (match) => `${match.slice(1, -1)}\n`)
    .replace(/<[^>]+>/g, " ");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const HTML_QUOTE_START = [
  /(<div[^>]*\bclass="[^"]*\bgmail_quote\b[^"]*"[^>]*>)/i,
  /(<div[^>]*\bid="divRplyFwdMsg"[^>]*>)/i,
  /(<blockquote\b[^>]*\bclass="[^"]*gmail_quote[^"]*"[^>]*>)/i,
  /(<blockquote\b[^>]*>)/i,
];

const ATTR_LINE_RE =
  /^[ \t\u00A0\u202F]*>?[ \t]*On\b[\s\S]{5,320}?\bwrote:\s*$/i;

/** Restore newlines in mashed Gmail plain replies (`wrote: > … > On …`). */
export function normalizeMashedEmailQuotes(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/wrote:\s*>/gi, "wrote:\n>")
    .replace(/>\s+(On\b[\s\S]{5,200}?\bwrote:)/gi, "\n\n$1")
    .replace(/\s+(On\b[\s\S]{5,200}?\bwrote:)/gi, "\n\n$1")
    .replace(/>(\s*>)+\s*/g, ">\n>")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drop leading `>` / `|` quote markers so activity feeds stay readable. */
export function stripEmailQuoteMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      while (/^[ \t]*(?:>|[|])[ \t]?/.test(out)) {
        out = out.replace(/^[ \t]*(?:>|[|])[ \t]?/, "");
      }
      return out.replace(/[ \t]*>+\s*$/g, "").trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isAttributionOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (ATTR_LINE_RE.test(t)) return true;
  // "On … wrote:" with almost no message body after it
  const m = t.match(/^(On\b[\s\S]{5,320}?\bwrote:)\s*/i);
  if (!m) return false;
  const rest = t.slice(m[0].length).trim();
  return rest.length < 8;
}

const NEXT_ATTR_RE =
  /\n[ \t\u00A0\u202F]*>?[ \t]*On[\s\S]{5,320}?\bwrote:\s*/i;

/**
 * Peel the newest human reply from a plain-text thread for activity cards.
 * Quote-only bodies (start with `On … wrote:`) use the first quoted message as main.
 */
export function peelActivityThread(text: string): {
  main: string;
  quoted: string | null;
} {
  let body = normalizeMashedEmailQuotes(normalizeEmailDisplayText(text));
  body = body
    .replace(/\n*Sent via Gmail[^\n]*/gi, "")
    .replace(/\n*Sent via Microsoft[^\n]*/gi, "")
    .replace(/\n*Cc:\s*[^\n]+/gi, "")
    .replace(/\n*\(Mailto fallback:[^\n]*\)/gi, "")
    .trim();
  if (!body) return { main: "", quoted: null };

  const leadingAttr = body.match(
    /^[ \t\u00A0\u202F]*>?[ \t]*On[\s\S]{5,320}?\bwrote:\s*/i,
  );
  if (leadingAttr) {
    const rest = body.slice(leadingAttr[0].length);
    const next = rest.match(NEXT_ATTR_RE);
    const firstMsg = (
      next?.index != null ? rest.slice(0, next.index) : rest
    ).trim();
    const older = next?.index != null ? rest.slice(next.index).trim() : "";
    return {
      main: stripEmailQuoteMarkers(firstMsg) || stripEmailQuoteMarkers(body),
      quoted: older ? stripEmailQuoteMarkers(older) : null,
    };
  }

  const midAttr = body.match(NEXT_ATTR_RE);
  if (midAttr?.index != null && midAttr.index > 0) {
    const main = stripEmailQuoteMarkers(body.slice(0, midAttr.index).trim());
    const quoted = stripEmailQuoteMarkers(body.slice(midAttr.index).trim());
    if (main && !isAttributionOnly(main)) {
      return { main, quoted: quoted || null };
    }
  }

  const lines = body.split("\n");
  const firstQuote = lines.findIndex((l) => /^>\s?/.test(l) || /^\|\s?/.test(l));
  if (firstQuote > 0) {
    return {
      main: stripEmailQuoteMarkers(
        lines.slice(0, firstQuote).join("\n").trim(),
      ),
      quoted:
        stripEmailQuoteMarkers(lines.slice(firstQuote).join("\n").trim()) ||
        null,
    };
  }

  return { main: stripEmailQuoteMarkers(body), quoted: null };
}

function splitHtmlQuotedHistory(html: string): { main: string; quoted: string | null } {
  let cut = -1;
  for (const re of HTML_QUOTE_START) {
    const match = html.match(re);
    if (match?.index != null && match.index > 24 && (cut < 0 || match.index < cut)) {
      cut = match.index;
    }
  }
  if (cut > 0) {
    const main = html.slice(0, cut).trim();
    const quoted = htmlToPlainText(html.slice(cut)).trim();
    if (main && quoted && !isAttributionOnly(htmlToPlainText(main))) {
      return { main, quoted };
    }
  }

  const plain = splitPlainQuotedHistory(htmlToPlainText(html));
  if (plain.quoted || plain.main) return plain;
  return { main: html, quoted: null };
}

function splitPlainQuotedHistory(text: string): { main: string; quoted: string | null } {
  const peeled = peelActivityThread(text);
  if (peeled.main || peeled.quoted) return peeled;

  let body = normalizeMashedEmailQuotes(text);
  body = normalizeEmailDisplayText(body);
  body = body
    .replace(/\n*Sent via Gmail[^\n]*/gi, "")
    .replace(/\n*Sent via Microsoft[^\n]*/gi, "")
    .replace(/\n*Cc:\s*[^\n]+/gi, "")
    .replace(/\n*\(Mailto fallback:[^\n]*\)/gi, "")
    .trim();

  // Whole body is a quote (draft leftover / reply with no new text).
  if (
    /^On\b[\s\S]{5,320}?\bwrote:\s*/i.test(body) &&
    (/\n>/.test(body) || />/.test(body) || /\bwrote:/i.test(body))
  ) {
    return { main: "", quoted: body };
  }

  const markers: RegExp[] = [
    // Gmail/Outlook attribution — do not require `wrote:` at end of line
    // (CRM send often keeps `wrote: > …` on one line).
    /\n[ \t\u00A0\u202F]*>?[ \t]*On[\s\S]{5,320}?\bwrote:\s*/i,
    /\n_{3,}\s*\n/,
    /\n-{3,}\s*\n/,
    /\nFrom:\s.+\nSent:\s/i,
    /\nFrom:\s.+\nDate:\s/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
  ];

  let cut = -1;
  for (const pattern of markers) {
    const match = body.match(pattern);
    if (match?.index != null && match.index > 0 && (cut < 0 || match.index < cut)) {
      cut = match.index;
    }
  }

  if (cut < 0) {
    const lines = body.split("\n");
    const firstQuote = lines.findIndex((l) => /^>\s?/.test(l) || /^\|\s?/.test(l));
    if (firstQuote > 0) {
      return {
        main: lines.slice(0, firstQuote).join("\n").trim(),
        quoted: lines.slice(firstQuote).join("\n").trim() || null,
      };
    }
    return { main: body, quoted: null };
  }

  const main = body.slice(0, cut).trim();
  const quoted = body.slice(cut).trim();
  if (!quoted) return { main: body, quoted: null };
  return { main: main || body.slice(0, 280).trim(), quoted };
}

/** Split the new message from quoted thread history (Gmail ··· collapse). */
export function splitQuotedEmailHistory(raw: string | null | undefined): {
  main: string;
  quoted: string | null;
} {
  if (!raw?.trim()) return { main: "", quoted: null };
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (isHtmlEmailBody(text)) return splitHtmlQuotedHistory(text);
  return splitPlainQuotedHistory(text);
}

/**
 * Inbox reading pane. Designed HTML stays intact for the same iframe the
 * contact Emails tab uses. Plain replies still collapse quoted history.
 */
export function readingPaneEmailParts(raw: string | null | undefined): {
  main: string;
  quoted: string | null;
} {
  const text = raw?.replace(/\r\n/g, "\n").trim() ?? "";
  if (!text) return { main: "", quoted: null };
  const decoded = hasEncodedHtmlEntities(text) ? decodeHtmlEntities(text) : text;
  if (isHtmlEmailBody(decoded)) return { main: text, quoted: null };
  return splitQuotedEmailHistory(text);
}

/** Drop mailbox sync headers that sit in front of the HTML the customer received. */
export function extractHtmlDocument(text: string): string {
  const doctype = text.search(/<!doctype html/i);
  const htmlTag = text.search(/<html[\s>]/i);
  const starts = [doctype, htmlTag].filter((index) => index >= 0);
  if (starts.length > 0) return text.slice(Math.min(...starts));
  const fragment = text.search(
    /<(?:div|table|p|center|img|span|font|body|style)\b/i,
  );
  if (fragment > 0 && /^from:/im.test(text.slice(0, fragment))) {
    return text.slice(fragment);
  }
  return text;
}

/** Choose HTML iframe vs cleaned plain text for a stored body. */
export function prepareEmailBodyForDisplay(
  raw: string,
  subject?: string | null,
): { mode: "html" | "plain"; content: string } {
  const text = raw.trim();
  if (!text) {
    return {
      mode: "plain",
      content: "No message body was logged for this activity.",
    };
  }
  // Entity-encoded Gmail HTML (&lt;div…&gt;) must decode before detection.
  const decoded = hasEncodedHtmlEntities(text) ? decodeHtmlEntities(text) : text;
  if (isHtmlEmailBody(decoded)) {
    return { mode: "html", content: extractHtmlDocument(decoded) };
  }
  if (hasHtmlArtifacts(decoded)) {
    const cleaned = formatPlainEmailForDisplay(
      htmlToPlainText(decoded),
      subject,
    );
    return {
      mode: "plain",
      content:
        cleaned ||
        "No message body was logged for this activity.",
    };
  }
  return {
    mode: "plain",
    content: formatPlainEmailForDisplay(decoded, subject),
  };
}

/**
 * Compact preview for contact/deal activity feeds: latest reply only,
 * quoted thread history split out (caller can collapse it).
 *
 * Always returns plain text (never nested HTML) so activity rows stay readable.
 */
export function prepareActivityEmailPreview(
  raw: string,
  subject?: string | null,
): { main: string; quoted: string | null } {
  const prepared = prepareEmailBodyForDisplay(raw, subject);
  if (!prepared.content.trim()) {
    return {
      main: "No message body was logged for this activity.",
      quoted: null,
    };
  }

  const plainSource =
    prepared.mode === "html"
      ? htmlToPlainText(prepared.content)
      : prepared.content;

  const peeled = peelActivityThread(
    formatPlainEmailForDisplay(plainSource, subject),
  );
  let main = formatPlainEmailForDisplay(peeled.main, subject).trim();
  let quoted = peeled.quoted
    ? formatPlainEmailForDisplay(peeled.quoted, null).trim()
    : "";

  // Attribution-only "main" → peel again from the combined thread.
  if (!main || isAttributionOnly(main)) {
    const again = peelActivityThread(
      [main, quoted].filter(Boolean).join("\n\n") || plainSource,
    );
    main = formatPlainEmailForDisplay(again.main, subject).trim();
    quoted = again.quoted
      ? formatPlainEmailForDisplay(again.quoted, null).trim()
      : "";
  }

  if (quoted && quoted === main) quoted = "";

  return {
    main: main || "No message body was logged for this activity.",
    quoted: quoted || null,
  };
}

/** One-line list preview (activities table, etc.). */
export function emailBodyPreviewLine(
  raw: string | null | undefined,
  subject?: string | null,
  maxLen = 140,
): string {
  if (!raw?.trim()) return "";
  const { main } = prepareActivityEmailPreview(raw, subject);
  const flat = main.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen - 1).trimEnd()}…`;
}

/** Strip scripts and inline handlers before rendering inbound HTML. */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

const EMAIL_IFRAME_BASE_STYLES = `
body {
  margin: 0;
  padding: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #1a1a1a;
  word-break: break-word;
  max-width: 42rem;
}
a { color: #2563eb; text-decoration: underline; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
blockquote, .gmail_quote {
  margin: 0.75rem 0 0;
  padding-left: 0.75rem;
  border-left: 2px solid #d4d4d8;
  color: #52525b;
  font-size: 13px;
}
`;

/** Ensure partial HTML snippets render with readable defaults inside the iframe. */
export function wrapEmailHtmlForDisplay(html: string): string {
  const sanitized = sanitizeEmailHtml(html);
  if (/<html[\s>]/i.test(sanitized)) return sanitized;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EMAIL_IFRAME_BASE_STYLES}</style></head><body>${sanitized}</body></html>`;
}
