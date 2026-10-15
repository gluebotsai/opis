/**
 * Helpers for outbound CRM mail — encoding and HTML that look less like bulk spam.
 */

import {
  htmlToPlainText,
  isHtmlEmailBody,
  sanitizeEmailHtml,
} from "@/lib/email-body";

/** Quoted-printable encode a UTF-8 string for MIME bodies. */
export function encodeQuotedPrintable(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  let out = "";
  let lineLen = 0;

  const push = (chunk: string) => {
    if (lineLen + chunk.length > 75) {
      out += "=\r\n";
      lineLen = 0;
    }
    out += chunk;
    lineLen += chunk.length;
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      out += "\r\n";
      lineLen = 0;
      i++;
      continue;
    }
    if (b === 0x0a) {
      out += "\r\n";
      lineLen = 0;
      continue;
    }
    // Safe printable ASCII except = and trailing space/tab handled below
    if (
      (b >= 33 && b <= 60) ||
      (b >= 62 && b <= 126) ||
      b === 0x09 ||
      b === 0x20
    ) {
      // Encode trailing space/tab before soft break or EOL later — encode space/tab always at EOL risk
      push(String.fromCharCode(b));
      continue;
    }
    push(`=${b.toString(16).toUpperCase().padStart(2, "0")}`);
  }

  // Encode trailing whitespace on each line
  return out
    .split("\r\n")
    .map((line) =>
      line.replace(/[ \t]+$/g, (ws) =>
        [...ws]
          .map((ch) =>
            `=${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
          )
          .join(""),
      ),
    )
    .join("\r\n");
}

/** Escape text for HTML email bodies. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EMAIL_BODY_SHELL_OPEN = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a;">`;
const EMAIL_BODY_SHELL_CLOSE = `</body>
</html>`;

/**
 * Plain text → simple HTML. Auto-links http(s) URLs (common for meeting links).
 */
export function plainTextToSimpleHtml(plain: string): string {
  const escaped = escapeHtml(plain);
  const withBreaks = escaped.replace(/\r\n|\r|\n/g, "<br>\n");
  const withLinks = withBreaks.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>',
  );
  return `${EMAIL_BODY_SHELL_OPEN}
${withLinks}
${EMAIL_BODY_SHELL_CLOSE}`;
}

/** Wrap a sanitized HTML fragment in a full email document shell. */
export function wrapHtmlEmailFragment(fragment: string): string {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return `${EMAIL_BODY_SHELL_OPEN}\n${EMAIL_BODY_SHELL_CLOSE}`;
  }
  if (/<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `${EMAIL_BODY_SHELL_OPEN}
${trimmed}
${EMAIL_BODY_SHELL_CLOSE}`;
}

/**
 * Build plain + HTML parts for outbound MIME / Graph.
 * Composer HTML is preserved; plain text is derived for multipart/alternative.
 */
export function toOutboundEmailBodies(body: string): {
  plain: string;
  html: string;
} {
  const trimmed = body.trim();
  if (!trimmed) {
    return { plain: "", html: plainTextToSimpleHtml("") };
  }

  if (isHtmlEmailBody(trimmed)) {
    const sanitized = sanitizeEmailHtml(trimmed);
    return {
      plain: htmlToPlainText(sanitized) || "(HTML message)",
      html: wrapHtmlEmailFragment(sanitized),
    };
  }

  return {
    plain: trimmed,
    html: plainTextToSimpleHtml(trimmed),
  };
}

/** RFC 2047 encode MIME header values that contain non-ASCII (Subject, names). */
export function encodeMimeHeaderValue(value: string): string {
  const trimmed = value.replace(/[\r\n]+/g, " ").trim();
  if (!trimmed) return "";
  // ASCII-only and free of specials that need quoting — leave as-is.
  if (/^[\x20-\x7E]+$/.test(trimmed)) {
    return trimmed;
  }
  const b64 = Buffer.from(trimmed, "utf8").toString("base64");
  // Encoded-word body must be a multiple of 4 base64 chars (RFC 2047).
  // ~60 keeps each word under the 75-octet limit including the charset wrapper.
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 60) {
    chunks.push(`=?UTF-8?B?${b64.slice(i, i + 60)}?=`);
  }
  return chunks.join(" ");
}

/** RFC 2047 encode display names that contain non-ASCII. */
export function encodeMimeDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/^[\x20-\x7E]+$/.test(trimmed) && !/[[\],:;<>@\\"]/.test(trimmed)) {
    return trimmed;
  }
  return encodeMimeHeaderValue(trimmed);
}

/**
 * Repair common UTF-8→Latin-1 mojibake, then prefer ASCII punctuation in subjects
 * so Gmail threading (subject match) is not broken by encoded garbage.
 */
export function normalizeEmailSubject(subject: string): string {
  let text = subject.replace(/[\r\n]+/g, " ");

  // Direct replacements for double-encoded UTF-8 punctuation
  text = text
    .replace(/Ã¢Â€Â”/g, "-")
    .replace(/Ã¢Â€Â“/g, "-")
    .replace(/Ã¢Â€Â˜/g, "'")
    .replace(/Ã¢Â€Â™/g, "'")
    .replace(/Ã¢Â€Âœ/g, '"')
    .replace(/Ã¢Â€Â/g, '"')
    .replace(/Ã¢â€Â”/g, "-")
    .replace(/Ã¢â€Â“/g, "-")
    .replace(/Ã¢â€Â™/g, "'")
    .replace(/â€”/g, "-")
    .replace(/â€“/g, "-")
    .replace(/â€˜/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"');

  // Generic Latin-1 misread of UTF-8 (Ã¢… patterns)
  if (/Ã¢|Ã‚|â€/.test(text)) {
    try {
      const bytes = Uint8Array.from(
        Array.from(text, (ch) => ch.charCodeAt(0) & 0xff),
      );
      const repaired = Buffer.from(bytes).toString("utf8");
      if (repaired && !repaired.includes("\uFFFD") && repaired !== text) {
        text = repaired;
      }
    } catch {
      // keep text
    }
  }

  return text
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function formatFromHeader(email: string, displayName?: string | null): string {
  const addr = email.trim();
  const name = displayName?.trim();
  if (!name) return addr;
  return `${encodeMimeDisplayName(name)} <${addr}>`;
}

/** Soften generic CRM subjects that look automated. */
export function defaultOutboundSubject(recipientLabel: string): string {
  const label = recipientLabel.trim() || "you";
  return `Message for ${label}`;
}
