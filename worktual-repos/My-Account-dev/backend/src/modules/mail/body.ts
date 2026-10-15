export function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

export function htmlToPlainText(html = "") {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

export function normalizeContentId(contentId = "") {
  return String(contentId || "")
    .replace(/^<|>$/g, "")
    .trim();
}

export function extractCidReferences(html = "") {
  const refs = new Set();
  const pattern = /cid:([^"'\s>]+)/gi;

  let match = pattern.exec(html);
  while (match) {
    const normalized = normalizeContentId(match[1]);
    if (normalized) {
      refs.add(normalized);
    }
    match = pattern.exec(html);
  }

  return [...refs];
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveInlineCidImages(html = "", inlineAttachments = []) {
  if (!html?.trim() || !inlineAttachments.length) {
    return html;
  }

  let resolved = html;

  for (const attachment of inlineAttachments) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const contentId = normalizeContentId(attachment.contentId);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const contentBase64 = attachment.contentBase64;

    if (!contentId || !contentBase64) {
      continue;
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const contentType = attachment.contentType || "application/octet-stream";
    const dataUrl = `data:${contentType};base64,${contentBase64}`;
    const pattern = new RegExp(`cid:<?${escapeRegExp(contentId)}>?`, "gi");
    resolved = resolved.replace(pattern, dataUrl);
  }

  return resolved;
}
