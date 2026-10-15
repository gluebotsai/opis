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

export function stripLeadingSubjectFromBody(
  body: string,
  subject?: string | null,
): string {
  if (!subject?.trim() || !body.trim()) return body;
  const normalizedSubject = subject.trim();
  let text = body.trim();
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
  text = decodeHtmlEntities(text);
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
  if (isHtmlEmailBody(text)) {
    return { mode: "html", content: text };
  }
  if (hasHtmlArtifacts(text)) {
    let cleaned = htmlToPlainText(text);
    cleaned = formatPlainEmailForDisplay(cleaned, subject);
    return { mode: "plain", content: cleaned || text };
  }
  return { mode: "plain", content: formatPlainEmailForDisplay(text, subject) };
}

export function shouldPreferHtmlBody(plain: string, html: string): boolean {
  if (!html.trim()) return false;
  if (!plain.trim()) return true;
  if (hasHtmlArtifacts(plain)) return true;
  if (hasEncodedHtmlEntities(plain)) return true;
  if (isHtmlEmailBody(html)) return true;
  const stripped = htmlToPlainText(html);
  return stripped.length > plain.length * 1.35;
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
}
a { color: #2563eb; text-decoration: underline; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
`;

/** Ensure partial HTML snippets render with readable defaults inside the iframe. */
export function wrapEmailHtmlForDisplay(html: string): string {
  const sanitized = sanitizeEmailHtml(html);
  if (/<html[\s>]/i.test(sanitized)) return sanitized;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EMAIL_IFRAME_BASE_STYLES}</style></head><body>${sanitized}</body></html>`;
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

type MimePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: MimePart[];
};

function decodePart(data: string | undefined): string {
  if (!data) return "";
  try {
    return decodeBase64Url(data);
  } catch {
    return "";
  }
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function collectParts(
  payload: MimePart,
  acc: { plain: string[]; html: string[] },
): void {
  const mime = payload.mimeType?.toLowerCase() ?? "";

  if (mime.startsWith("text/plain") && payload.body?.data) {
    const text = decodePart(payload.body.data);
    if (text.trim()) acc.plain.push(text);
    return;
  }

  if (mime.startsWith("text/html") && payload.body?.data) {
    const html = decodePart(payload.body.data);
    if (html.trim()) acc.html.push(html);
    return;
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      collectParts(part, acc);
    }
    return;
  }

  if (payload.body?.data && mime && !mime.startsWith("multipart/")) {
    const raw = decodePart(payload.body.data);
    if (!raw.trim()) return;
    if (mime.includes("html") || isHtmlEmailBody(raw)) {
      acc.html.push(raw);
    } else {
      acc.plain.push(raw);
    }
  }
}

/** Prefer the richest body from Gmail MIME (HTML when plain is degraded). */
export function extractEmailBodyFromPayload(payload: MimePart): string {
  const acc = { plain: [] as string[], html: [] as string[] };
  collectParts(payload, acc);

  const plain = acc.plain.join("\n\n").trim();
  const html = acc.html[0]?.trim() ?? "";

  if (plain && html) {
    return shouldPreferHtmlBody(plain, html) ? html : plain;
  }
  if (plain) return plain;
  if (html) return html;
  return "";
}

export { decodeBase64Url };
