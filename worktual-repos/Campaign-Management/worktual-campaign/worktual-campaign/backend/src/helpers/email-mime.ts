/**
 * RFC 2045 MIME for campaign HTML sent via Gmail/SMTP.
 * HTML is UTF-8 base64 — never 7bit (Gmail shows a blank body for 8-bit HTML).
 */

const BASE64_LINE = 76;

export function encodeRfc2047Header(value: string): string {
  const flat = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (!flat) return "";
  if (/^[\x20-\x7e]*$/.test(flat)) return flat;
  const b64 = Buffer.from(flat, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

export function wrapBase64(b64: string, width = BASE64_LINE): string {
  const src = String(b64 || "").replace(/\s+/g, "");
  if (!src) return "";
  const lines: string[] = [];
  for (let i = 0; i < src.length; i += width) {
    lines.push(src.slice(i, i + width));
  }
  return lines.join("\r\n");
}

export function encodeUtf8Base64Body(html: string): string {
  return wrapBase64(Buffer.from(String(html ?? ""), "utf8").toString("base64"));
}

export function toCrLf(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\r\n");
}

export function buildCampaignEmailMime(args: {
  from: { email: string; name: string | null };
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
}): string {
  const fromLine = args.from.name
    ? `"${args.from.name.replace(/[\r\n"]/g, " ").trim()}" <${args.from.email}>`
    : args.from.email;
  const html = String(args.html || "").trim() || `<p>${args.subject || "Campaign"}</p>`;
  const lines = [
    `From: ${fromLine}`,
    `To: ${args.to}`,
    `Subject: ${encodeRfc2047Header(args.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (args.replyTo) {
    lines.push(`Reply-To: ${String(args.replyTo).replace(/\r?\n/g, " ")}`);
  }
  lines.push("", encodeUtf8Base64Body(html));
  return lines.join("\r\n");
}
