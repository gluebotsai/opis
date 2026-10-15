/** Coworker chat display HTML. Wording stays as the model sent it. */

const SUGGESTIONS_RE = /<suggestions>[\s\S]*?<\/suggestions>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\/?>/g;

const CHAT_HTML_TAGS = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "br",
  "span",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "b",
]);

const CHAT_HTML_BLOCKS = new Set(["p", "ul", "ol", "table"]);

function tagNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    names.push(match[2].toLowerCase());
  }
  return names;
}

export function isCoworkerChatHtml(text: string | null | undefined): boolean {
  const raw = (text || "").replace(SUGGESTIONS_RE, "").trim();
  if (!raw || !raw.includes("<")) return false;
  if (/<\s*(script|style)\b/i.test(raw)) return false;
  const names = tagNames(raw);
  if (!names.length || names.some((name) => !CHAT_HTML_TAGS.has(name))) return false;
  return names.some((name) => CHAT_HTML_BLOCKS.has(name));
}

/** Drop attributes and comments. Keep allowed tags and the text inside them. */
export function normalizeCoworkerChatHtml(text: string): string {
  const suggestions = (text || "").match(/<suggestions>[\s\S]*?<\/suggestions>/i);
  let body = (text || "").replace(SUGGESTIONS_RE, "");
  body = body.replace(COMMENT_RE, "");
  body = body.replace(TAG_RE, (_match, slash: string, name: string) => {
    const tag = name.toLowerCase();
    if (tag === "br") return "<br>";
    return slash ? `</${tag}>` : `<${tag}>`;
  });
  body = body.trim();
  if (suggestions) return `${body}\n${suggestions[0]}`.trim();
  return body;
}

function splitListLabel(li: Element, doc: Document) {
  const nodes = [...li.childNodes].filter(
    (node) => !(node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()),
  );
  const first = nodes[0];
  if (!first || first.nodeType !== Node.ELEMENT_NODE) return;
  const tag = (first as Element).tagName;
  if (tag !== "STRONG" && tag !== "B") return;
  const labels = li.querySelectorAll("strong, b");
  if (labels.length !== 1) return;
  const desc = doc.createElement("span");
  desc.className = "assistant-list-desc";
  while (first.nextSibling) desc.appendChild(first.nextSibling);
  const lead = desc.firstChild;
  if (lead?.nodeType === Node.TEXT_NODE && lead.textContent) {
    lead.textContent = lead.textContent.replace(/^\s*:\s*/, "");
  }
  if (!desc.textContent?.trim() && desc.childElementCount === 0) return;
  li.appendChild(desc);
}

/** Drop markdown bold so a recap reads as Name: Pooja, never Name:**. */
export function unwrapMarkdownEmphasis(text: string): string {
  let raw = text || "";
  raw = raw.replace(/\*\*([^*]+)\*\*/g, "$1");
  raw = raw.replace(/([A-Za-z][A-Za-z0-9 /_-]{0,40}):\*\*/g, "$1:");
  return raw.replace(/\*\*/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineHtml(value: string): string {
  const parts = value.split(/(\*\*[^*]+\*\*)/g);
  return parts
    .map((part) => {
      const bold = part.match(/^\*\*([^*]+)\*\*$/);
      if (bold) return `<strong>${escapeHtml(bold[1])}</strong>`;
      return escapeHtml(part);
    })
    .join("");
}

function isTitleLine(line: string): boolean {
  const text = line.replace(/^\*\*(.+)\*\*$/, "$1").replace(/^#{1,6}\s+/, "").trim();
  return Boolean(text) && text.length < 140 && !/[.?!]$/.test(text);
}

function titleHtml(line: string): string {
  const text = line.replace(/^\*\*(.+)\*\*$/, "$1").replace(/^#{1,6}\s+/, "").trim();
  return `<p><strong>${escapeHtml(text)}</strong></p>`;
}

function subtitleLabel(label: string): string {
  const words = label.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A dense "label: value label: value" run becomes a subtitle per repeated
 * label and one point per value. The words stay the same.
 */
function structureLabeledFacts(text: string): string | null {
  const re = /(?:^|\s)([A-Za-z][A-Za-z0-9_-]{1,32}):\s+/g;
  const matches = [...text.matchAll(re)];
  if (matches.length < 2) return null;
  const items: Array<{ label: string; value: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const valueStart = (matches[i].index ?? 0) + matches[i][0].length;
    const valueEnd = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const value = text.slice(valueStart, valueEnd).trim();
    if (!value) return null;
    items.push({ label: matches[i][1], value });
  }
  const repeated = items.some(
    (item) =>
      items.filter((other) => other.label.toLowerCase() === item.label.toLowerCase()).length > 1,
  );
  if (!repeated && items.length < 3) return null;

  const chunks: string[] = [];
  const intro = text.slice(0, matches[0].index ?? 0).trim();
  if (intro) chunks.push(`<p>${inlineHtml(intro)}</p>`);

  if (repeated) {
    let index = 0;
    while (index < items.length) {
      const label = items[index].label;
      const values: string[] = [];
      while (
        index < items.length &&
        items[index].label.toLowerCase() === label.toLowerCase()
      ) {
        values.push(items[index].value);
        index += 1;
      }
      chunks.push(`<p><strong>${escapeHtml(subtitleLabel(label))}</strong></p>`);
      chunks.push(`<ul>${values.map((value) => `<li>${inlineHtml(value)}</li>`).join("")}</ul>`);
    }
  } else {
    chunks.push(
      `<ul>${items
        .map(
          (item) =>
            `<li><strong>${escapeHtml(subtitleLabel(item.label))}</strong>: ${inlineHtml(item.value)}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  return chunks.join("");
}

function expandDenseParagraphs(html: string): string {
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (full, inner: string) => {
    const text = inner
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    return structureLabeledFacts(text) ?? full;
  });
}

/**
 * Display-only. Turns a plain or markdown brief into the chat HTML contract
 * without changing the words. Messages with links stay untouched.
 */
function peelTrailingQuestion(text: string): { body: string; question: string } {
  const match = text.match(/(?:^|\n|\s)([A-Z][^?\n]{12,}\?)\s*$/);
  if (!match || match.index == null) return { body: text, question: "" };
  const question = match[1].trim();
  const body = text.slice(0, match.index).trim();
  if (!body) return { body: text, question: "" };
  return { body, question };
}

export function plainSpeechToChatHtml(text: string): string {
  const raw = unwrapMarkdownEmphasis((text || "").trim());
  if (!raw) return raw;
  if (isCoworkerChatHtml(raw)) return expandDenseParagraphs(raw);
  if (/\[[^\]]+\]\([^)]+\)/.test(raw) || /https?:\/\//.test(raw)) return raw;

  const peeled = peelTrailingQuestion(raw);
  const source = peeled.question ? peeled.body : raw;
  const parts: string[] = [];
  for (const block of source.split(/\n{2,}/)) {
    const lines = block
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((line) => /^[-*•]\s+/.test(line))) {
      const items = lines.map((line) => {
        const body = line.replace(/^[-*•]\s+/, "");
        const labeled = body.match(/^([^:]{1,48}):\s+(.+)$/);
        if (labeled && !labeled[1].includes("**")) {
          return `<li><strong>${escapeHtml(labeled[1])}</strong>: ${inlineHtml(labeled[2])}</li>`;
        }
        return `<li>${inlineHtml(body)}</li>`;
      });
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (lines.length === 1 && /^next step$/i.test(lines[0].replace(/\*/g, ""))) {
      parts.push("<p><strong>Next step</strong></p>");
      continue;
    }
    if (lines.length > 1 && /^next step$/i.test(lines[0].replace(/\*/g, ""))) {
      parts.push("<p><strong>Next step</strong></p>");
      parts.push(`<p>${lines.slice(1).map((line) => inlineHtml(line)).join(" ")}</p>`);
      continue;
    }
    if (lines.length === 1 && isTitleLine(lines[0])) {
      parts.push(titleHtml(lines[0]));
      continue;
    }
    if (lines.length > 1 && isTitleLine(lines[0])) {
      parts.push(titleHtml(lines[0]));
      parts.push(`<p>${lines.slice(1).map((line) => inlineHtml(line)).join(" ")}</p>`);
      continue;
    }
    const paragraph = lines.map((line) => inlineHtml(line)).join(" ");
    const plain = lines.join(" ");
    parts.push(structureLabeledFacts(plain) ?? `<p>${paragraph}</p>`);
  }
  if (peeled.question) parts.push(`<p>${inlineHtml(peeled.question)}</p>`);
  const html = parts.join("");
  return isCoworkerChatHtml(html) ? expandDenseParagraphs(html) : raw;
}

/** Wrap top-level lists and tables, and stack a single leading label over its value. */
export function decorateAssistantMessageHtml(text: string): string {
  const safe = normalizeCoworkerChatHtml(text)
    .replace(SUGGESTIONS_RE, "")
    .trim();
  if (!safe || typeof DOMParser === "undefined") return safe;
  const doc = new DOMParser().parseFromString(`<div>${safe}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return safe;
  for (const el of [...root.children]) {
    const tag = el.tagName;
    if (tag !== "UL" && tag !== "OL" && tag !== "TABLE") continue;
    const wrap = doc.createElement("div");
    wrap.className = tag === "TABLE" ? "assistant-table-wrap" : "assistant-list-wrap";
    el.replaceWith(wrap);
    wrap.appendChild(el);
    if (tag === "UL" || tag === "OL") {
      for (const li of el.querySelectorAll(":scope > li")) splitListLabel(li, doc);
    }
  }
  return root.innerHTML;
}
