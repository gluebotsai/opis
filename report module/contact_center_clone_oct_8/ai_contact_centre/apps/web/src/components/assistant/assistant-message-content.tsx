import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { type PlotChartData } from "@/components/assistant/plot-chart-card";

const ALLOWED_TAGS = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "ins",
  "sub",
  "sup",
  "mark",
  "small",
  "br",
  "span",
  "div",
  "a",
  "img",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "col",
  "colgroup",
  "hr",
  "center",
  "font",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "details",
  "summary",
  "plot-chart",
]);

const REMOVE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "svg",
  "canvas",
  "meta",
  "link",
  "head",
]);

function looksLikeHtml(content: string) {
  return /<\s*\w+/i.test(content);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function leftoverMarkdownToHtml(text: string) {
  const withBold = escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return withBold
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function toAssistantHtml(content: string) {
  const html = looksLikeHtml(content) ? content : leftoverMarkdownToHtml(content);
  return html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function sanitizeAssistantHtml(html: string) {
  if (typeof window === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1. Remove non-content / dangerous tags completely along with their children
  const badElements = doc.querySelectorAll(
    "script, style, iframe, object, embed, noscript, svg, canvas, meta, link, head",
  );
  badElements.forEach((el) => el.remove());

  // 2. Sanitize remaining DOM tree
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        const tag = element.tagName.toLowerCase();

        if (REMOVE_TAGS.has(tag)) {
          element.remove();
          continue;
        }

        if (tag === "img") {
          const src = (element.getAttribute("src") || "").trim();
          if (!/^(https?:\/\/|data:image\/)/i.test(src)) {
            element.remove();
            continue;
          }
        }

        if (!ALLOWED_TAGS.has(tag)) {
          const fragment = doc.createDocumentFragment();
          while (element.firstChild) {
            fragment.appendChild(element.firstChild);
          }
          element.replaceWith(fragment);
          walk(fragment);
          continue;
        }

        // Sanitize attributes per tag
        const attrs = Array.from(element.attributes);
        for (const attr of attrs) {
          const attrName = attr.name.toLowerCase();
          if (tag === "a" && attrName === "href") {
            const val = attr.value.trim();
            if (/^(https?:\/\/|mailto:|tel:)/i.test(val)) {
              element.setAttribute("href", val);
              element.setAttribute("target", "_blank");
              element.setAttribute("rel", "noopener noreferrer");
            } else {
              element.removeAttribute("href");
            }
          } else if (tag === "img" && attrName === "src") {
            const val = attr.value.trim();
            if (/^(https?:\/\/|data:image\/)/i.test(val)) {
              element.setAttribute("src", val);
            } else {
              element.removeAttribute("src");
            }
          } else if (
            (tag === "td" || tag === "th") &&
            (attrName === "colspan" || attrName === "rowspan" || attrName === "scope")
          ) {
            // Keep table span / header scope attributes
          } else if (attrName === "class") {
            const kept = attr.value
              .split(/\s+/)
              .filter((name) =>
                name === "assistant-table-wrap" ||
                name === "assistant-list-wrap" ||
                name === "assistant-list-desc",
              );
            if (kept.length) element.setAttribute("class", kept.join(" "));
            else element.removeAttribute("class");
          } else if (attrName === "title" || attrName === "alt") {
            // Keep helpful text attributes
          } else if (attrName === "style") {
            // Keep basic layout styles if safe (e.g. text-align, margin, padding)
            let styleVal = attr.value;
            if (/position\s*:\s*fixed/i.test(styleVal) || /expression/i.test(styleVal)) {
              element.removeAttribute("style");
            } else {
              styleVal = styleVal
                .replace(
                  /(?:^|;)\s*(?:color|-webkit-text-fill-color|background(?:-color)?|caret-color)\s*:[^;]*/gi,
                  "",
                )
                .replace(/^;+|;+$/g, "")
                .trim();
              if (styleVal) {
                element.setAttribute("style", styleVal);
              } else {
                element.removeAttribute("style");
              }
            }
          } else if (attrName === "color" || attrName === "bgcolor") {
            element.removeAttribute(attr.name);
          } else {
            element.removeAttribute(attr.name);
          }
        }
      }
      walk(child);
    }
  };

  walk(doc.body);
  for (const anchor of Array.from(doc.body.querySelectorAll("a"))) {
    if (anchor.getAttribute("href")) continue;
    const fragment = doc.createDocumentFragment();
    while (anchor.firstChild) fragment.appendChild(anchor.firstChild);
    anchor.replaceWith(fragment);
  }
  formatNamedListItems(doc);
  wrapAssistantBlocks(doc, "table", "assistant-table-wrap");
  wrapAssistantBlocks(doc, "ul, ol", "assistant-list-wrap", (el) => Boolean(el.closest("li")));
  lockAssistantTableColumns(doc);
  return doc.body.innerHTML;
}

const ASSISTANT_COL_MIN = 256;

function setAssistantTableWidth(table: HTMLTableElement, cols: HTMLTableColElement[]) {
  const explicit = cols
    .map((col) => Number.parseFloat(col.style.width))
    .filter((width) => Number.isFinite(width));
  table.style.tableLayout = "auto";
  table.style.width = "";
  if (explicit.length === 0) {
    table.style.minWidth = "";
    return;
  }
  const total = explicit.reduce((sum, width) => sum + width, 0);
  const unset = cols.length - explicit.length;
  table.style.minWidth = `${Math.max(total + unset * ASSISTANT_COL_MIN, cols.length * ASSISTANT_COL_MIN)}px`;
}

function lockAssistantTableColumns(doc: Document) {
  for (const table of Array.from(doc.body.querySelectorAll("table"))) {
    const headers = headerCells(table);
    if (headers.length === 0) continue;
    let colgroup = table.querySelector("colgroup");
    if (!colgroup) {
      colgroup = doc.createElement("colgroup");
      table.insertBefore(colgroup, table.firstChild);
    }
    colgroup.replaceChildren();
    for (const _header of headers) {
      const col = doc.createElement("col");
      col.style.minWidth = `${ASSISTANT_COL_MIN}px`;
      colgroup.appendChild(col);
    }
    table.style.tableLayout = "auto";
    table.style.width = "";
    table.style.minWidth = "";
  }
}

function wrapAssistantBlocks(
  doc: Document,
  selector: string,
  className: string,
  skip?: (el: Element) => boolean,
) {
  for (const el of Array.from(doc.body.querySelectorAll(selector))) {
    if (el.parentElement?.classList.contains(className)) continue;
    if (skip?.(el)) continue;
    const wrap = doc.createElement("div");
    wrap.className = className;
    el.replaceWith(wrap);
    wrap.appendChild(el);
  }
}

function formatNamedListItems(doc: Document) {
  for (const li of Array.from(doc.body.querySelectorAll("li"))) {
    if (li.querySelector("ul, ol, table, .assistant-list-desc")) continue;
    if (li.querySelectorAll("strong, b").length > 1) continue;
    const label = li.firstElementChild;
    if (!label || (label.tagName !== "STRONG" && label.tagName !== "B")) continue;

    const rest: ChildNode[] = [];
    let node = label.nextSibling;
    while (node) {
      rest.push(node);
      node = node.nextSibling;
    }
    if (rest.length === 0) continue;
    const firstRest = rest[0];
    if (firstRest?.nodeType === Node.TEXT_NODE) {
      firstRest.textContent = (firstRest.textContent ?? "").replace(/^\s*[:–—-]\s*/, "");
    }
    const desc = doc.createElement("span");
    desc.className = "assistant-list-desc";
    for (const child of rest) desc.appendChild(child);
    if (!desc.textContent?.trim()) {
      desc.remove();
      continue;
    }
    li.appendChild(desc);
  }
}

export function extractPlotData(content: string): { text: string; plot: PlotChartData | null } {
  if (!content) return { text: "", plot: null };

  const match = content.match(
    /<(?:plot-chart|div)\s+(?:data|data-chart)=(?:'([^']+)'|"([^"]+)"|([^\s>]+))[\s\S]*?\/?>/i,
  );
  if (match) {
    const rawData = match[1] || match[2] || match[3];
    if (rawData) {
      try {
        const decoded = rawData
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        const parsed = JSON.parse(decoded) as PlotChartData;
        const cleanText = stripInternalToolDump(content.replace(match[0], "").trim());
        return { text: cleanText, plot: parsed };
      } catch {
        // ignore
      }
    }
  }

  const codeBlockMatch = content.match(
    /```(?:json)?\s*(\{\s*"type"\s*:\s*"(?:plot|chart)"[\s\S]*?\})\s*```/i,
  );
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]) as PlotChartData;
      const cleanText = stripInternalToolDump(content.replace(codeBlockMatch[0], "").trim());
      return { text: cleanText, plot: parsed };
    } catch {
      // ignore
    }
  }

  // Cards are rendered only from explicit structured tool results / payloads.
  // Never infer metrics from prose: it can duplicate cards and misread units.
  return { text: stripInternalToolDump(content), plot: null };
}

/** Hide SQL + presentation JSON the model sometimes pastes as chat text. */
export function stripInternalToolDump(content: string): string {
  const raw = content.trim();
  if (!raw) return "";

  const hasHtml = /<(p|strong|ul|ol|li|div|br)\b/i.test(raw);
  const hasSql = /\b(select|with)\b[\s\S]{8,}\bfrom\b/i.test(raw);
  const hasChartJson = /"chart_type"\s*:/i.test(raw) || /"chartType"\s*:/i.test(raw);
  const hasPresentationKeys =
    /"label_column"\s*:/i.test(raw) || /"value_column"\s*:/i.test(raw);

  if (hasSql && (hasChartJson || hasPresentationKeys)) return "";
  if (hasSql && !hasHtml && raw.length > 60) return "";
  if (raw.startsWith("{") && (hasChartJson || hasPresentationKeys)) return "";

  return raw
    .replace(/\n?\s*\{\s*"chart_type"\s*:[\s\S]*\}\s*$/i, "")
    .replace(/\n?\s*\{\s*"chartType"\s*:[\s\S]*\}\s*$/i, "")
    .replace(/(?:^|\n)(?:line|bar|pie|kpi)\b[^\n]*(?:Hour of Day|Handled conversations|Inbound conversations|Contacts)\s*$/gim, "")
    .trim();
}

function headerCells(table: HTMLTableElement) {
  const headRow =
    table.tHead?.rows[0] ??
    table.querySelector("tr");
  return headRow ? Array.from(headRow.cells) : [];
}

function enhanceAssistantTables(root: HTMLElement) {
  const cleanups: Array<() => void> = [];

  for (const table of Array.from(root.querySelectorAll("table"))) {
    const headers = headerCells(table);
    if (headers.length === 0) continue;

    let colgroup = table.querySelector("colgroup");
    if (!colgroup) {
      colgroup = table.ownerDocument.createElement("colgroup");
      table.insertBefore(colgroup, table.firstChild);
    }
    colgroup.replaceChildren();
    const cols = headers.map(() => {
      const col = table.ownerDocument.createElement("col");
      col.style.minWidth = `${ASSISTANT_COL_MIN}px`;
      colgroup!.appendChild(col);
      return col;
    });
    setAssistantTableWidth(table, cols);

    for (const cell of Array.from(table.querySelectorAll("th, td"))) {
      const text = cell.textContent?.trim() ?? "";
      if (text) cell.setAttribute("title", text);
    }

    headers.forEach((th, index) => {
      if (th.querySelector(".assistant-col-resize")) return;
      th.classList.add("assistant-col-head");
      const handle = table.ownerDocument.createElement("span");
      handle.className = "assistant-col-resize";
      handle.setAttribute("aria-hidden", "true");
      th.appendChild(handle);

      const onPointerDown = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = cols[index]?.getBoundingClientRect().width || ASSISTANT_COL_MIN;
        handle.classList.add("is-dragging");
        handle.setPointerCapture(event.pointerId);

        const onPointerMove = (moveEvent: PointerEvent) => {
          const col = cols[index];
          if (!col) return;
          const next = Math.max(ASSISTANT_COL_MIN, startWidth + (moveEvent.clientX - startX));
          col.style.width = `${next}px`;
          setAssistantTableWidth(table, cols);
        };
        const onPointerUp = () => {
          handle.classList.remove("is-dragging");
          handle.releasePointerCapture(event.pointerId);
          handle.removeEventListener("pointermove", onPointerMove);
          handle.removeEventListener("pointerup", onPointerUp);
          handle.removeEventListener("pointercancel", onPointerUp);
        };

        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerUp);
      };

      handle.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => handle.removeEventListener("pointerdown", onPointerDown));
    });
  }

  return () => {
    for (const stop of cleanups) stop();
  };
}

export function AssistantMessageContent({
  content,
  inverted = false,
}: {
  content: string;
  inverted?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { text: cleanContent } = useMemo(() => extractPlotData(content), [content]);
  const html = useMemo(
    () => sanitizeAssistantHtml(toAssistantHtml(cleanContent)),
    [cleanContent, inverted],
  );

  useEffect(() => {
    if (!rootRef.current || !html) return;
    return enhanceAssistantTables(rootRef.current);
  }, [html]);

  if (!html) return null;

  return (
    <div
      ref={rootRef}
      className={cn("assistant-message-html", inverted && "is-inverted")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
