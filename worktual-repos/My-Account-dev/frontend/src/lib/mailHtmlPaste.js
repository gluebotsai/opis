/** Detect pasted plain-text that is actually HTML source. */
export function looksLikeHtmlSource(value = "") {
  const text = String(value || "").trim();
  if (!text.startsWith("<")) {
    return false;
  }
  return /<\/?[a-z][\w:-]*\b[^>]*>/i.test(text);
}

/**
 * Normalize clipboard / pasted mail HTML (Outlook, Gmail, browsers).
 * Keeps tables, images, links, and inline styles — only strips dangerous/noise nodes.
 */
export function normalizePastedHtml(html = "") {
  let trimmed = String(html || "").trim();
  if (!trimmed) {
    return "";
  }

  const fragmentMatch = trimmed.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
  if (fragmentMatch?.[1]) {
    trimmed = fragmentMatch[1].trim();
  }

  try {
    const doc = new DOMParser().parseFromString(trimmed, "text/html");
    doc
      .querySelectorAll("script, meta, link, noscript, iframe, object, embed, xml")
      .forEach((node) => node.remove());

    // Office residue that often breaks layout in contenteditable
    doc.querySelectorAll("o\\:p, w\\:sdt, w\\:sdtpr").forEach((node) => node.remove());

    // Drop Word conditional comment leftovers left as comments
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }
    comments.forEach((comment) => comment.remove());

    // Prefer the richest root: some clients wrap in a centered table
    const bodyHtml = doc.body?.innerHTML?.trim();
    return bodyHtml || trimmed;
  } catch {
    return trimmed;
  }
}

/** True when the payload looks like a full signature block (replace editor contents). */
export function looksLikeFullSignatureHtml(html = "") {
  const value = String(html || "");
  if (value.length < 120) {
    return false;
  }
  return /<table[\s>]/i.test(value) || /<img[\s>]/i.test(value) || (value.match(/<\/?(div|p|tr|td)\b/gi) || []).length >= 6;
}

export function insertHtmlAtCursor(html) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return true;
}
