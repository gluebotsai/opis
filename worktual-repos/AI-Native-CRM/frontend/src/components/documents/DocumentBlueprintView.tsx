import { useEffect, useMemo, useRef } from "react";

export type BlueprintSlot = { key: string; label: string };

export type DocumentBlueprint = {
  version: number;
  html: string;
  css: string;
  /** Exact PDF page images — skip proposal chrome and keep letterhead in-body. */
  mode?: "page-clone" | string;
  chrome?: boolean;
  /** Mergeable layout used for live invoices when mode is page-clone. */
  fillHtml?: string;
  fillCss?: string;
  theme?: {
    primary?: string;
    secondary?: string;
    fonts?: string;
    background?: string;
  };
  slots?: BlueprintSlot[];
};

export type BlueprintAsset = {
  id: string;
  kind: "logo" | "image";
  mime: string;
  dataBase64: string;
};

export type BlueprintSection = {
  key?: string;
  title: string;
  body: string;
  tableRows?: Array<{ cells: string[] }>;
};

function defaultTableColumns(key: string): string[] {
  const k = String(key || "").toLowerCase();
  if (/monthly|mrc|recurring/.test(k)) {
    return ["Charges", "Requested Solution", "Recommended Solution"];
  }
  if (/one_time|otc|one-time/.test(k)) {
    return ["Charges / Solutions", "Requested Solution", "Recommended Solution"];
  }
  if (/usage|campaign/.test(k)) {
    return ["Channel", "Included Free", "Beyond Free Limit"];
  }
  if (/compare|wins|whats_added|comparison|commercial/.test(k)) {
    return ["Dimension", "Requested Solution", "Recommended Solution"];
  }
  return [];
}

function tableRowsFromPlainBody(
  body: string,
  colCount: number,
): Array<{ cells: string[] }> {
  const count = Math.max(1, colCount);
  const lines = String(body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter(
    (line) => /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line),
  );
  if (!bullets.length) return [];
  const delimiter = /\s+[—–]\s+|:\s+/;
  const splitable = bullets.filter((line) =>
    delimiter.test(
      line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""),
    ),
  );
  if (count >= 3 && splitable.length < bullets.length) return [];
  return bullets.map((line) => {
    const text = line
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    const parts = text.split(delimiter);
    const cells =
      count >= 3 ? [parts[0] || text, parts.slice(1).join(": ") || ""] : [text];
    while (cells.length < count) cells.push("");
    return { cells: cells.slice(0, count) };
  });
}

function stripCoverMetadataHtml(html: string): string {
  return html.replace(
    /(<section[^>]*data-slot="cover_overview"[^>]*>)([\s\S]*?)(<\/section>)/i,
    (_full, open: string, inner: string, close: string) => {
      let next = inner.replace(
        /(<h2[^>]*data-slot-title[^>]*>)([\s\S]*?)(<\/h2>)/i,
        (_m, hOpen: string, title: string, hClose: string) => {
          const cleaned = title.replace(/commercial proposal overview/i, "Overview");
          return `${hOpen}${cleaned}${hClose}`;
        },
      );
      next = next.replace(
        /<p>(?:<strong>)?(?:ZIFO Commercial Proposal|Document Title:|Prepared For:|Date:|Quotation Validity:)[\s\S]*?<\/p>/gi,
        "",
      );
      next = next.replace(
        /(?:ZIFO Commercial Proposal|Document Title:[\s\S]*?|Prepared For:[\s\S]*?|Date:\s*[\w\s,]+|Quotation Validity:[\s\S]*?)(?:<br\s*\/?>)/gi,
        "",
      );
      return `${open}${next}${close}`;
    },
  );
}

function isFrozenProposalHtml(html: string): boolean {
  return (
    /proposal-doc/i.test(html) ||
    /cover-block/i.test(html) ||
    /class="[^"]*cover-title/i.test(html)
  );
}

function documentTitleFromBlueprintTokens(
  tokens: Record<string, string>,
): string {
  const explicit = String(tokens.documentTitle || "").trim();
  if (explicit) return explicit;
  if (String(tokens.quoteNumber || "").trim()) return "Quotation";
  return "Commercial Proposal";
}

function applyQuoteDocumentCoverTitle(
  html: string,
  tokens: Record<string, string>,
): string {
  const title = documentTitleFromBlueprintTokens(tokens);
  if (!String(tokens.quoteNumber || "").trim() || title === "Commercial Proposal") {
    return html;
  }
  return html.replace(
    /(<h1[^>]*class="[^"]*(?:cover-title|bp-cover-title)[^"]*"[^>]*>)\s*Commercial Proposal\s*(<\/h1>)/gi,
    `$1${escapeHtml(title)}$2`,
  );
}

function fillFrozenProposalCover(
  html: string,
  tokens: Record<string, string>,
): string {
  const replacements: Array<[string, string]> = [
    ["{{vendorName}}", tokens.vendorName || ""],
    ["{{customerName}}", tokens.customerName || tokens.companyName || ""],
    ["{{companyName}}", tokens.companyName || tokens.customerName || ""],
    ["{{date}}", tokens.date || ""],
    ["{{documentTitle}}", documentTitleFromBlueprintTokens(tokens)],
    ["{{dealTitle}}", tokens.dealTitle || ""],
    ["{{productScope}}", tokens.productScope || ""],
  ];
  let next = html;
  for (const [token, value] of replacements) {
    if (!value) continue;
    next = next.split(token).join(escapeHtml(value));
  }
  return next;
}

function ensureTemplateCover(html: string, tokens: Record<string, string>): string {
  if (isFrozenProposalHtml(html)) {
    return fillFrozenProposalCover(html, tokens);
  }
  const vendor = escapeHtml(tokens.vendorName || "");
  const customer = escapeHtml(tokens.customerName || tokens.companyName || "");
  const date = escapeHtml(tokens.date || "");
  const scope = String(tokens.productScope || "").trim();
  const scopeLooksLikeDeal =
    !scope ||
    (customer && scope.toLowerCase().includes(String(tokens.customerName || "").toLowerCase()));
  const coverMatch = html.match(
    /<header\b[^>]*class="[^"]*bp-playbook-cover[^"]*"[^>]*>[\s\S]*?<\/header>/i,
  );
  const coverHasUnfilledTokens = coverMatch
    ? /\{\{(vendorName|customerName|companyName|date|documentTitle)\}\}/.test(coverMatch[0])
    : true;
  if (coverMatch && /bp-cover-title/i.test(coverMatch[0]) && !coverHasUnfilledTokens) {
    return html.replace(
      /<div class="bp-cover-scope">([\s\S]*?)<\/div>/i,
      (full) => (scopeLooksLikeDeal ? "" : full),
    );
  }
  const coverInner = [
    vendor ? `<div class="bp-cover-brand">${vendor}</div>` : "",
    `<h1 class="bp-cover-title">${escapeHtml(documentTitleFromBlueprintTokens(tokens))}</h1>`,
    customer
      ? `<div class="bp-cover-prepared">Prepared for <strong>${customer}</strong></div>`
      : "",
    date ? `<div class="bp-cover-date">${date}</div>` : "",
    !scopeLooksLikeDeal
      ? `<div class="bp-cover-scope">${escapeHtml(scope)}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (coverMatch) {
    return html.replace(
      /<header\b[^>]*class="[^"]*bp-playbook-cover[^"]*"[^>]*>[\s\S]*?<\/header>/i,
      `<header class="bp-playbook-cover bp-cover-left">${coverInner}</header>`,
    );
  }
  return `<header class="bp-playbook-cover bp-cover-left">${coverInner}</header>\n${html}`;
}

function cleanOverviewCopy(
  slotKey: string,
  title: string,
  body: string,
): { title: string; body: string } {
  const isOverview =
    /cover_overview|^overview$/i.test(slotKey) ||
    /commercial proposal overview/i.test(title);
  if (!isOverview) return { title, body };
  const next = String(body || "")
    .replace(/^\s*ZIFO Commercial Proposal\s*/im, "")
    .replace(/^Document Title:.*$/gim, "")
    .replace(/^Prepared For:.*$/gim, "")
    .replace(/^Date:.*$/gim, "")
    .replace(/^Quotation Validity:.*$/gim, "")
    .replace(/^\s*Overview\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    title: /commercial proposal overview/i.test(title) ? "Overview" : title,
    body: next,
  };
}

function fallbackRowsFromDocument(
  slotKey: string,
  colCount: number,
  allSections: BlueprintSection[],
): Array<{ cells: string[] }> {
  const corpus = allSections.map((s) => `${s.title}\n${s.body}`).join("\n");
  const count = Math.max(3, colCount);
  const k = String(slotKey || "").toLowerCase();
  const seats = corpus.match(
    /(\d+)\s+(?:sales\s+)?(?:representatives?|users?|seats?)/i,
  );
  const contacts = corpus.match(/(\d+)\s+active contact/i);
  const crm = /\bcrm\b/i.test(corpus) || Boolean(seats);
  const tally = /\btally\b/i.test(corpus);
  const pipeline = /pipeline/i.test(corpus);
  const followUp = /follow-?up|activity/i.test(corpus);
  const requestedStandalone = /standalone crm/i.test(corpus);
  const pad = (cells: string[]) => {
    const next = [...cells];
    while (next.length < count) next.push("");
    return next.slice(0, count);
  };
  const scope: string[][] = [];
  if (crm) {
    scope.push([
      "Intelligent CRM",
      seats
        ? `${seats[1]} users — ${requestedStandalone ? "standalone CRM" : "as requested"}`
        : "Standalone CRM as requested",
      "Unified customer profiles (recommended)",
    ]);
  }
  if (tally) {
    scope.push([
      "Tally integration",
      /two-way/i.test(corpus)
        ? "Two-way Tally integration"
        : "Tally integration as requested",
      "Automated two-way Tally synchronization",
    ]);
  }
  if (pipeline) {
    scope.push([
      "Sales pipeline",
      "Lead to closure tracking",
      "End-to-end pipeline with unified profiles",
    ]);
  }
  if (followUp) {
    scope.push([
      "Activity & follow-up",
      "Structured sales representative activity",
      "Activity plus unified customer intelligence",
    ]);
  }
  if (contacts) {
    scope.push([
      "Contact records",
      `${contacts[1]} active contacts in CRM`,
      "Unified profiles across sales and finance",
    ]);
  }
  if (/usage|campaign/.test(k)) {
    return [
      pad([
        "Marketing campaigns",
        "Not requested in this BRD",
        "Optional with the recommended platform",
      ]),
    ].map((cells) => ({ cells }));
  }
  if (/one_time|otc|one-time/.test(k)) {
    const rows: string[][] = [];
    if (crm) {
      rows.push([
        "CRM implementation",
        "Configuration for requested CRM",
        "CRM setup on the unified platform",
      ]);
    }
    if (tally) {
      rows.push([
        "Tally integration",
        /two-way/i.test(corpus)
          ? "Two-way Tally integration"
          : "Tally integration as requested",
        "Two-way Tally on the recommended path",
      ]);
    }
    return (rows.length ? rows : scope).map((cells) => ({ cells: pad(cells) }));
  }
  if (/monthly|mrc|recurring|compare|wins|whats_added|comparison|commercial/.test(k)) {
    return scope.map((cells) => ({ cells: pad(cells) }));
  }
  return [];
}

function realTableColumns(columns: string[]): string[] {
  const next = (columns || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  if (!next.length) return [];
  if (next.every((c) => /^col(?:umn)?\s*\d+$/i.test(c))) return [];
  return next;
}

function isUsableRunningChrome(text: string): boolean {
  const raw = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || raw.length > 56) return false;
  if (raw.split(/\s+/).length > 8) return false;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(raw)) return false;
  const boilerplate =
    /\b(confidential|proprietary|copyright|page\s*\d+|internal use)\b|proposal\s*\|/i.test(
      raw,
    );
  const sentence =
    /^(this|that|the|our|an?)\s+\S|[.!?…]\s*$|\benables\b|\bintegrated approach\b|\bconnect customer\b/i.test(
      raw,
    );
  if (sentence && !boilerplate) return false;
  return true;
}

function stripSectionChromeHeader(html: string): string {
  return html.replace(
    /<div class="chrome-header">([\s\S]*?)<\/div>/gi,
    (_full, inner: string) => {
      const text = String(inner)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || !isUsableRunningChrome(text)) return "";
      return _full;
    },
  );
}

function applyCoverAlignClass(html: string, css = ""): string {
  if (!/\bcover-block\b/i.test(html)) return html;
  const classMatch = /\bcover-align-(left|center|right)\b/i.exec(html);
  let align: "left" | "center" | "right" | null = null;
  if (classMatch) {
    const v = classMatch[1].toLowerCase();
    if (v === "left" || v === "center" || v === "right") align = v;
  }
  if (!align) {
    const styles = [
      css,
      ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] || ""),
    ].join("\n");
    const rule = (sel: string) =>
      new RegExp(
        `${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^{}]+)\\}`,
        "i",
      ).exec(styles)?.[1] || "";
    const textAlign = (block: string) => {
      const m = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\b/i.exec(block);
      const v = m?.[1]?.toLowerCase();
      return v === "left" || v === "center" || v === "right" ? v : null;
    };
    align = textAlign(rule(".proposal-doc .cover-block"));
    if (!align) {
      const votes = [
        textAlign(rule(".proposal-doc .cover-brand")),
        textAlign(rule(".proposal-doc .cover-title")),
        textAlign(rule(".proposal-doc .cover-prepared")),
        textAlign(rule(".proposal-doc .cover-date")),
      ].filter((v): v is "left" | "center" | "right" => Boolean(v));
      const centerN = votes.filter((v) => v === "center").length;
      const leftN = votes.filter((v) => v === "left").length;
      const rightN = votes.filter((v) => v === "right").length;
      if (centerN >= leftN && centerN >= rightN && centerN > 0) align = "center";
      else if (rightN > leftN && rightN > centerN) align = "right";
      else if (leftN > 0) align = "left";
      else align = "center";
    }
  }
  const alignClass = `cover-align-${align}`;
  return html.replace(
    /<div([^>]*class=")([^"]*\bcover-block\b[^"]*)("[^>]*)>/i,
    (_full, pre: string, classes: string, post: string) => {
      const cleaned = classes
        .replace(/\bcover-align-(?:left|center|right)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `<div${pre}${cleaned} ${alignClass}${post}>`;
    },
  );
}

function injectSectionTable(
  inner: string,
  slotKey: string,
  section: BlueprintSection | undefined,
  allSections: BlueprintSection[],
): string {
  const fromThead = (() => {
    const thead = inner.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || "";
    return [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
  })();
  const columns = realTableColumns(
    fromThead.length > 0 ? fromThead : defaultTableColumns(slotKey),
  );
  if (!columns.length) return inner;
  const stored = (section?.tableRows || []).filter((row) =>
    (row.cells || []).some((cell) => String(cell || "").trim()),
  );
  const fromBody = tableRowsFromPlainBody(section?.body || "", columns.length);
  const fallback = fallbackRowsFromDocument(slotKey, columns.length, allSections);
  const rows = stored.length ? stored : fromBody.length ? fromBody : fallback;
  if (!rows.length) return inner;
  const colCount = columns.length;
  const heads = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");
  const bodyRows = rows
    .map((row) => {
      const cells = Array.isArray(row.cells) ? [...row.cells] : [];
      while (cells.length < colCount) cells.push("");
      return `<tr>${cells
        .slice(0, colCount)
        .map((cell) => `<td>${escapeHtml(String(cell || ""))}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  if (/<table\b/i.test(inner)) {
    if (/<tbody\b[^>]*>\s*<tr/i.test(inner) && /<td\b/i.test(inner)) return inner;
    if (/<tbody\b/i.test(inner)) {
      return inner.replace(
        /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/i,
        `$1${bodyRows}$3`,
      );
    }
    return inner;
  }
  return `${inner}<table class="bp-table" data-slot-table="${escapeHtml(slotKey)}"><thead><tr>${heads}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn JSON-escaped \\n / \\t into real whitespace (AI often double-escapes). */
export function normalizeDocumentText(raw: string): string {
  let s = raw ?? "";
  for (let i = 0; i < 4; i++) {
    if (!/\\[nrt]/.test(s)) break;
    s = s
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\n");
  }
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function formatInlineHtml(text: string): string {
  // Raw <img> from OCR/AI → markdown before escape so logos render.
  const withMdImgs = text.replace(
    /<img\b[^>]*\bsrc=["'](asset:[a-z0-9_-]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^"'\s>]+)["'][^>]*\/?>/gi,
    (m, src: string) => {
      const altMatch = m.match(/\balt=["']([^"']*)["']/i);
      const alt = altMatch?.[1] || "";
      return `![${alt}](${String(src).replace(/\s+/g, "")})`;
    },
  );
  let s = escapeHtml(withMdImgs).replace(/‹br›/g, "<br/>");
  s = s
    .replace(/\$\\rightarrow\$/gi, "→")
    .replace(/\$\s*ightarrow\s*\$/gi, "→")
    .replace(/\\rightarrow/gi, "→")
    .replace(/\\downarrow/gi, "↓");
  // ![alt](url) → <img> (logo/hero often land in section bodies as markdown)
  s = s.replace(
    /!\[([^\]]*)\]\((asset:[a-z0-9_-]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^)\s]+)\)/gi,
    (_m, alt: string, src: string) => {
      const cleanSrc = src.replace(/\s+/g, "");
      const safeAlt = String(alt || "").replace(/"/g, "");
      const cls = /asset:logo|logo/i.test(cleanSrc + safeAlt)
        ? "bp-inline-logo"
        : /asset:hero|hero/i.test(cleanSrc + safeAlt)
          ? "bp-inline-hero"
          : "bp-inline-img";
      return `<img class="${cls}" src="${cleanSrc}" alt="${safeAlt}" />`;
    },
  );
  // **bold** / __bold__, then *italic* / _italic_, then strip leftover markers
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\*\*/g, "").replace(/__/g, "");
  return s;
}

/**
 * Convert section body text into safe, human-readable HTML
 * (paragraphs, lists, bold, pipe tables — no raw \\n or ** markers).
 */
function isPipeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  // Keep sparse spreadsheet rows (`| Label | | |`) inside the table.
  // Counting only non-empty cells dropped those rows and showed raw pipes.
  if (t.startsWith("|") && t.endsWith("|")) {
    return t.split("|").length >= 3;
  }
  const cells = t.split("|").filter((c) => c.trim().length > 0);
  return cells.length >= 2;
}

function isPipeSeparatorRow(line: string): boolean {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!t) return false;
  return /^[\s|:-]+$/.test(t) && /[-:]/.test(t);
}

function parsePipeCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function formatPipeTableHtml(
  rows: string[],
  formatInline: (text: string) => string,
): string {
  if (rows.length === 0) return "";
  let header: string[] | null = null;
  let bodyStart = 0;
  if (rows.length >= 2 && isPipeSeparatorRow(rows[1]!)) {
    header = parsePipeCells(rows[0]!);
    bodyStart = 2;
  }
  const bodyRows = rows
    .slice(bodyStart)
    .filter((r) => !isPipeSeparatorRow(r))
    .map(parsePipeCells);
  const parts: string[] = ['<table class="bp-table">'];
  if (header) {
    parts.push("<thead><tr>");
    for (const cell of header) {
      parts.push(`<th>${formatInline(cell)}</th>`);
    }
    parts.push("</tr></thead>");
  }
  parts.push("<tbody>");
  for (const cells of bodyRows) {
    if (!cells.length) continue;
    parts.push("<tr>");
    for (const cell of cells) {
      parts.push(`<td>${formatInline(cell)}</td>`);
    }
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("");
}

export function formatSectionBodyHtml(raw: string): string {
  const text = normalizeDocumentText(raw).trim();
  if (!text) return "";

  const lines = text.split("\n");
  const parts: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraLines: string[] = [];
  let tableLines: string[] = [];

  const closeList = () => {
    if (!listType) return;
    parts.push(`</${listType}>`);
    listType = null;
  };
  const flushPara = () => {
    if (!paraLines.length) return;
    parts.push(
      `<p>${paraLines.map((l) => formatInlineHtml(l)).join("<br/>")}</p>`,
    );
    paraLines = [];
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    parts.push(formatPipeTableHtml(tableLines, formatInlineHtml));
    tableLines = [];
  };
  const openList = (type: "ul" | "ol") => {
    if (listType === type) return;
    closeList();
    listType = type;
    parts.push(`<${type}>`);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      flushTable();
      closeList();
      continue;
    }
    if (isPipeTableRow(trimmed)) {
      flushPara();
      closeList();
      tableLines.push(trimmed);
      continue;
    }
    flushTable();
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushPara();
      openList("ul");
      parts.push(`<li>${formatInlineHtml(bullet[1]!)}</li>`);
      continue;
    }
    if (numbered) {
      flushPara();
      openList("ol");
      parts.push(`<li>${formatInlineHtml(numbered[1]!)}</li>`);
      continue;
    }
    closeList();
    // Heading-like markdown #### Title → plain bold line
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushPara();
      parts.push(`<p><strong>${formatInlineHtml(heading[1]!)}</strong></p>`);
      continue;
    }
    paraLines.push(trimmed);
  }
  flushPara();
  flushTable();
  closeList();
  return dedupeRepeatedHtmlBlocks(parts.join(""));
}

const SLOT_BODY_OPEN =
  /(<div[^>]*(?:data-slot-body|bp-slot-body)[^>]*>)([\s\S]*?)(<\/div>)/i;

function dedupeRepeatedHtmlBlocks(html: string): string {
  const listsCollapsed = html.replace(
    /<(ul|ol)>([\s\S]*?)<\/\1>/gi,
    (_m, tag: string, inner: string) => {
      const seen = new Set<string>();
      const items = [...inner.matchAll(/<li>[\s\S]*?<\/li>/gi)]
        .map((m) => m[0])
        .filter((item) => {
          const key = item.replace(/\s+/g, " ").trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return `<${tag}>${items.join("")}</${tag}>`;
    },
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of listsCollapsed.split(/(?=<p\b|<ul\b|<ol\b)/i)) {
    const key = part.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join("");
}

/** Drop leftover template paragraphs so the filled body is not shown twice. */
function keepStructuralRemainder(rest: string): string {
  return rest
    .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi, "")
    .replace(/<ol\b[^>]*>[\s\S]*?<\/ol>/gi, "")
    .replace(
      /<div\b[^>]*(?:bp-body|bp-slot-body|data-slot-body)[^>]*>[\s\S]*?<\/div>/gi,
      "",
    );
}

export function injectLearnedSectionBody(inner: string, bodyHtml: string): string {
  const html = String(bodyHtml || "").trim();
  if (!html) return inner;
  const wrapped = `<div class="bp-body bp-slot-body" data-slot-body>${html}</div>`;
  if (SLOT_BODY_OPEN.test(inner)) {
    const filled = inner.replace(
      SLOT_BODY_OPEN,
      (_m, open: string, _old: string, close: string) => `${open}${html}${close}`,
    );
    return filled.replace(
      /(<div[^>]*(?:data-slot-body|bp-slot-body)[^>]*>[\s\S]*?<\/div>)([\s\S]*)/i,
      (_m, slot: string, rest: string) => `${slot}${keepStructuralRemainder(rest)}`,
    );
  }
  if (/<h[12]\b/i.test(inner)) {
    return inner.replace(
      /(<h[12]\b[^>]*>[\s\S]*?<\/h[12]>)([\s\S]*)/i,
      (_m, heading: string, rest: string) =>
        `${heading}${wrapped}${keepStructuralRemainder(rest)}`,
    );
  }
  return `${wrapped}${keepStructuralRemainder(inner)}`;
}

export function formatSectionTitleHtml(raw: string): string {
  return formatInlineHtml(
    normalizeDocumentText(raw)
      .replace(/^#{1,6}\s+/, "")
      .trim(),
  );
}

/** Plain text for list/detail views: real line breaks, no markdown markers. */
export function toReadablePlainText(raw: string): string {
  let s = normalizeDocumentText(raw);
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1$2");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*/g, "").replace(/__/g, "");
  return s.trim();
}

const BODY_BASE_CSS = `
.proposal-blueprint{background:#fff;color:#111}
.proposal-blueprint .bp-body p,.proposal-blueprint .bp-slot-body p{margin:0 0 .7em}
.proposal-blueprint .bp-body p:last-child{margin-bottom:0}
.proposal-blueprint .bp-body ul,.proposal-blueprint .bp-body ol,
.proposal-blueprint .proposal-doc ul,.proposal-blueprint .proposal-doc ol{margin:.35em 0 .85em;padding-left:1.35em}
.proposal-blueprint .bp-body li,.proposal-blueprint .proposal-doc li{margin:.22em 0;line-height:1.45}
.proposal-blueprint .bp-body strong{font-weight:700}
.proposal-blueprint .bp-body em{font-style:italic}
.proposal-blueprint .bp-body p.sec-subh,
.proposal-blueprint .proposal-doc p.sec-subh{font-weight:700;margin:.9em 0 .3em;line-height:1.3}
.proposal-blueprint .proposal-doc[contenteditable="true"]{outline:none;cursor:text}
.proposal-blueprint .proposal-doc[contenteditable="true"]:focus{
  outline:2px solid rgba(37,99,235,.35);outline-offset:6px
}
.proposal-blueprint .bp-table{width:100%;max-width:100%;border-collapse:collapse;margin:.5em 0 1em;font-size:inherit;table-layout:fixed}
.proposal-blueprint .bp-table th,.proposal-blueprint .bp-table td{padding:.4em .55em;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
.proposal-blueprint .bp-table th:first-child,.proposal-blueprint .bp-table td:first-child{width:38%}
.proposal-blueprint .bp-table th:nth-child(n+3),.proposal-blueprint .bp-table td:nth-child(n+3){width:14%;white-space:nowrap;text-align:right}
.proposal-blueprint .bp-table th:nth-child(2),.proposal-blueprint .bp-table td:nth-child(2){width:10%;white-space:nowrap;text-align:center}
.proposal-blueprint .bp-table th:last-child,.proposal-blueprint .bp-table td:last-child{text-align:right}
.proposal-blueprint .proposal-doc .bp-table th,
.proposal-blueprint .proposal-doc .bp-table td{width:auto;white-space:normal}
.proposal-blueprint .proposal-doc table.grid,
.proposal-blueprint .proposal-doc table.bp-table{
  display:table !important;
  table-layout:fixed !important;
  width:100% !important;
  max-width:100% !important;
}
.proposal-blueprint .proposal-doc table.grid thead,
.proposal-blueprint .proposal-doc table.bp-table thead{
  display:table-header-group !important;
}
.proposal-blueprint .proposal-doc table.grid tbody,
.proposal-blueprint .proposal-doc table.bp-table tbody{
  display:table-row-group !important;
}
.proposal-blueprint .proposal-doc table.grid tr,
.proposal-blueprint .proposal-doc table.bp-table tr{
  display:table-row !important;
}
.proposal-blueprint .proposal-doc table.grid th,
.proposal-blueprint .proposal-doc table.grid td,
.proposal-blueprint .proposal-doc table.bp-table th,
.proposal-blueprint .proposal-doc table.bp-table td{
  display:table-cell !important;
}
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta){
  border-collapse:collapse;
}
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) th,
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) td{
  border-width:1px;
  border-style:solid;
}
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta),
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta) th,
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta) td{
  border:none !important;
  outline:none !important;
  box-shadow:none !important;
}
.proposal-blueprint .proposal-doc table.cover-meta{
  width:100% !important;
  max-width:100% !important;
  table-layout:fixed !important;
  margin-left:0 !important;
  margin-right:0 !important;
}
.proposal-blueprint .proposal-doc .cover-meta td{text-align:left}
.proposal-blueprint .proposal-doc .cover-meta td:first-child{white-space:nowrap}
.proposal-blueprint .bp-cover{margin-bottom:1.25rem}
.proposal-blueprint .bp-playbook-cover{color:inherit;padding:0 0 1rem}
.proposal-blueprint header.bp-playbook-cover .bp-cover-brand{
  font-size:1.3rem;font-weight:700;line-height:1.25;letter-spacing:0
}
.proposal-blueprint header.bp-playbook-cover .bp-cover-title,
.proposal-blueprint .bp-playbook-cover:not(.cover-block) .bp-cover-title{
  font-size:24px;font-weight:700;line-height:1.25;margin:.35rem 0 .4rem
}
.proposal-blueprint header.bp-playbook-cover .bp-cover-prepared{color:#333;font-size:.95rem;margin-top:.35rem}
.proposal-blueprint header.bp-playbook-cover .bp-cover-date{color:#595959;font-size:.9rem;margin-top:.1rem}
.proposal-blueprint .bp-section h2,
.proposal-blueprint .bp-playbook-root .bp-h2{
  font-size:14px;font-weight:700;line-height:1.3;margin:12px 0 8px
}
.proposal-blueprint img.bp-inline-logo{display:block;max-height:56px;width:auto;margin:0 0 .75em}
.proposal-blueprint img.bp-inline-hero{display:block;width:100%;max-height:220px;object-fit:cover;margin:.35em 0 1em}
.proposal-blueprint img.bp-inline-img{display:block;max-width:100%;height:auto;margin:.35em 0 .85em}
.proposal-blueprint img.bp-hero{display:block;width:100%;max-width:100%;margin:12px auto 0}
.proposal-blueprint .bp-hero-banner{margin:12px auto 0}
.proposal-blueprint .proposal-doc section.sec{text-align:left;padding-left:0;padding-right:0;margin-left:0;margin-right:0}
.proposal-blueprint .proposal-doc .cover-block.cover-align-center,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-date,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-date{text-align:center}
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-logo,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center img.cover-logo{display:block;margin:0 auto .75rem;max-height:56px;width:auto}
.proposal-blueprint .proposal-doc .cover-block.cover-align-left,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-date,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-date{text-align:left;margin-left:0;margin-right:0}
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-logo,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left img.cover-logo{display:block;margin:0 0 .75rem;max-height:56px;width:auto}
`.trim();

/**
 * Screen preview must not simulate print pages. Uploaded templates often set
 * min-height:220mm on the cover and page-break-before on every section, which
 * shows up as a huge blank gap in the browser.
 */
const SCREEN_FLOW_OVERRIDE_CSS = `
.proposal-blueprint .bp-cover-page,
.proposal-blueprint .bp-cover{
  page-break-after:auto !important;
  break-after:auto !important;
  min-height:0 !important;
  height:auto !important;
}
.proposal-blueprint .bp-section{
  page-break-before:auto !important;
  break-before:auto !important;
  page-break-after:auto !important;
  break-after:auto !important;
}
`.trim();

/** On-screen A4 sheets. The cover shares the first page with the sections that follow. */
const PROPOSAL_PAGE_SHEET_CSS = `
@media screen {
  .proposal-blueprint:has(.proposal-doc){
    background:transparent;
    padding:10px 8px 18px;
  }
  .proposal-blueprint .proposal-doc{
    width:100% !important;
    max-width:100% !important;
    margin:0 auto !important;
    padding:0 !important;
    background:transparent !important;
    container-type:inline-size;
  }
  .proposal-blueprint .proposal-doc .proposal-page-stage{
    display:block;
  }
  .proposal-blueprint .proposal-doc .proposal-sheet{
    background:#fff;
    box-shadow:0 1px 4px rgba(15,23,42,.18);
    margin:0 auto 12px;
    padding:16mm 14mm 20mm;
    box-sizing:border-box;
    min-height:calc(100cqi * 297 / 210);
    height:auto;
    overflow:visible;
    position:relative;
  }
  .proposal-blueprint .proposal-doc .cover-block,
  .proposal-blueprint .proposal-doc section.sec{
    min-height:0 !important;
    height:auto !important;
    margin:0;
    padding:0;
    box-shadow:none;
    background:transparent;
  }
  .proposal-blueprint .proposal-doc section.sec + section.sec{
    margin-top:8mm;
  }
  .proposal-blueprint .proposal-doc .product-tags{
    padding-left:0 !important;
  }
  .proposal-blueprint .proposal-doc .product-tags.layout-centered_wrap li{
    white-space:nowrap;
  }
  .proposal-blueprint .proposal-doc{
    counter-reset:proposal-page;
  }
  .proposal-blueprint .proposal-doc .proposal-sheet{
    counter-increment:proposal-page;
  }
  .proposal-blueprint .proposal-doc .proposal-sheet::after{
    content:counter(proposal-page);
    position:absolute;
    right:12mm;
    bottom:8mm;
    font-size:9pt;
    color:#6b7280;
  }
}
@media print {
  .proposal-blueprint .proposal-doc .proposal-sheet{
    box-shadow:none !important;
    margin:0 !important;
    page-break-after:always;
    break-after:page;
  }
  .proposal-blueprint .proposal-doc .proposal-sheet:last-child{
    page-break-after:auto;
    break-after:auto;
  }
}
`.trim();

const PRINT_FLOW_OVERRIDE_CSS = `
@media print{
  .proposal-blueprint .bp-cover-page{
    page-break-after:always !important;
    break-after:page !important;
  }
  .proposal-blueprint .bp-cover{
    page-break-after:always !important;
    break-after:page !important;
  }
  .proposal-blueprint .bp-section{
    page-break-before:auto !important;
    break-before:auto !important;
  }
  .proposal-blueprint .bp-section h2{page-break-after:avoid;break-after:avoid}
  .proposal-blueprint .bp-table{page-break-inside:auto}
}
`.trim();

const PAGE_CLONE_TEXT_PREVIEW_CSS = `
.proposal-blueprint .pdf-text{position:absolute;white-space:pre;line-height:1;overflow:hidden;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;}
.proposal-blueprint .pdf-shape{position:absolute;box-sizing:border-box;}
`.trim();

/** Lock absolute pdf-text boxes so longer copy cannot spill into neighbors. */
function repairPageClonePreviewText(pageHtml: string): string {
  if (!pageHtml || !/pdf-text/i.test(pageHtml)) return pageHtml;
  return pageHtml.replace(
    /(<span\b[^>]*\bclass="[^"]*\bpdf-text\b[^"]*"[^>]*\bstyle=")([^"]*)(")/gi,
    (_full, open: string, style: string, close: string) => {
      let next = style;
      // Strip bad height locks from the earlier overlap fix.
      next = next.replace(/(?:^|;)\s*height:\s*1\.\d+em;?/gi, ";");
      const minWidth = /(?:^|;)\s*min-width:\s*([\d.]+)%/i.exec(next);
      if (minWidth) {
        const w = minWidth[1];
        next = next.replace(/(?:^|;)\s*min-width:\s*[\d.]+%;?/i, ";");
        if (!/(?:^|;)\s*width:\s*[\d.]+%/i.test(next)) {
          next += `width:${w}%;max-width:${w}%;`;
        } else if (!/(?:^|;)\s*max-width:\s*/i.test(next)) {
          next += `max-width:${w}%;`;
        }
      }
      next = next.replace(/;;+/g, ";").replace(/^;|;$/g, "");
      return `${open}${next}${close}`;
    },
  );
}

function stabilizeTemplateCss(css: string): string {
  let next = css || "";
  next = next.replace(
    /font-family\s*:\s*Calibri\s*,\s*Arial/gi,
    "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif",
  );
  next = next.replace(
    /font-family\s*:\s*Calibri\b/gi,
    "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif",
  );
  // Soften print-only layout rules so they don't dominate the screen cascade
  // before our SCREEN_FLOW overrides (still kept for @media print / PDF).
  next = next.replace(
    /(\.proposal-blueprint\s+\.bp-cover\s*\{)([^}]*)\}/gi,
    (_full, open: string, body: string) => {
      const cleaned = body
        .replace(/min-height\s*:\s*[^;]+;?/gi, "")
        .replace(/height\s*:\s*[^;]+;?/gi, "")
        .replace(/page-break-after\s*:\s*[^;]+;?/gi, "")
        .replace(/break-after\s*:\s*[^;]+;?/gi, "");
      return `${open}${cleaned}}`;
    },
  );
  next = next.replace(
    /(\.proposal-blueprint\s+\.bp-section\s*\{)([^}]*)\}/gi,
    (_full, open: string, body: string) => {
      const cleaned = body
        .replace(/page-break-before\s*:\s*[^;]+;?/gi, "")
        .replace(/break-before\s*:\s*[^;]+;?/gi, "")
        .replace(/page-break-after\s*:\s*[^;]+;?/gi, "")
        .replace(/break-after\s*:\s*[^;]+;?/gi, "");
      return `${open}${cleaned}}`;
    },
  );
  return neutralizePlaceholderTableChrome(applyStoredTableHeaderFill(next));
}

/** Paint a measured --c-th onto white headers. Skip brand stand-ins. */
function applyStoredTableHeaderFill(css: string): string {
  const token = css.match(/--c-th\s*:\s*(#[0-9a-fA-F]{3,8})/i);
  if (!token) return css;
  const hex = token[1] || "";
  if (/^#(?:fff|ffffff)$/i.test(hex) || PLACEHOLDER_HEADER_RE.test(hex)) return css;
  const thBackgrounds = [...css.matchAll(/\bth\s*\{[^}]*background\s*:\s*([^;}]+)/gi)].map(
    (m) => m[1].trim(),
  );
  const hasDarkFill = thBackgrounds.some(
    (v) =>
      /var\(--c-th\)/i.test(v) ||
      (/^#/i.test(v) && !/^#(?:fff|ffffff)$/i.test(v) && !PLACEHOLDER_HEADER_RE.test(v)),
  );
  if (hasDarkFill) return css;
  return `${css}\n.proposal-doc table.grid th,.proposal-doc .bp-table th{background:var(--c-th);color:#fff;}`;
}

/** Hexes used when learning did not measure a table color. Do not paint these. */
const PLACEHOLDER_HEADER_RE = /#(?:0b3d4a|0f2942|1d4ed8|1f3864)\b/i;

function neutralizePlaceholderTableChrome(css: string): string {
  let next = css;
  let paintsPlaceholder = false;
  for (const match of next.matchAll(/\bth\s*\{[^}]*background\s*:\s*(#[0-9a-fA-F]{3,8})/gi)) {
    if (PLACEHOLDER_HEADER_RE.test(match[1] || "")) paintsPlaceholder = true;
  }
  const token = next.match(/--c-th\s*:\s*(#[0-9a-fA-F]{3,8})/i);
  if (token && PLACEHOLDER_HEADER_RE.test(token[1] || "")) paintsPlaceholder = true;
  if (paintsPlaceholder) {
    next += `\n.proposal-blueprint .proposal-doc table.grid th,.proposal-blueprint .proposal-doc .bp-table th{background:transparent !important;background-color:transparent !important;color:inherit !important;}`;
  }
  if (
    paintsPlaceholder &&
    /(?:th|td):last-child\s*\{[^}]*background\s*:\s*#(?:000|000000)\b/i.test(css)
  ) {
    next += `\n.proposal-blueprint .proposal-doc table.grid.emphasize th:last-child,.proposal-blueprint .proposal-doc table.grid.emphasize td:last-child,.proposal-blueprint .proposal-doc .bp-table.emphasize th:last-child,.proposal-blueprint .proposal-doc .bp-table.emphasize td:last-child{background:#000 !important;background-color:#000 !important;color:#fff !important;}`;
  }
  return next;
}

const DOC_CHROME_CSS = `
.doc-chrome-root{position:relative;background:#fff}
.doc-chrome-header{
  position:sticky;top:0;z-index:10;
  background:#fff;text-align:center;
  padding:12px 16px 10px;
  border-bottom:1px solid rgba(0,0,0,.08);
}
.doc-chrome-footer{
  position:sticky;bottom:0;z-index:10;
  background:#fff;text-align:center;
  padding:10px 16px 12px;
  border-top:1px solid rgba(0,0,0,.08);
}
.doc-chrome-logo{display:block;margin:0 auto;max-height:32px;width:auto}
.doc-chrome-vendor{font-family:'Times New Roman',Times,serif;font-weight:700;font-size:12px;margin:0}
.doc-chrome-address{font-size:10px;color:#333;margin-top:4px;line-height:1.35}
.doc-chrome-stripe{display:block;width:100%;height:6px;object-fit:cover;margin:0 0 8px}
.doc-chrome-stripe-fallback{
  height:5px;margin:0 0 8px;
  background:linear-gradient(90deg,#E7372B 0 20%,#8067A8 20% 40%,#663534 40% 60%,#337FBD 60% 80%,#B4D068 80% 100%);
}
.doc-chrome-meta{font-size:10px;color:#333;line-height:1.4}
.doc-chrome-body{padding:8px 16px 16px}
@media print{
  .doc-chrome-header{
    position:fixed;top:0;left:0;right:0;
    border-bottom:none;padding:8px 14mm 6px;
  }
  .doc-chrome-footer{
    position:fixed;bottom:0;left:0;right:0;
    border-top:none;padding:6px 14mm 10px;
  }
  .doc-chrome-body{
    padding:28mm 0 22mm;
  }
}
`.trim();

const LAYOUT_SLOT_KEYS = new Set([
  "cover",
  "footer",
  "header",
  "letterhead",
]);

function isLayoutSlotKey(key: string | null | undefined): boolean {
  return LAYOUT_SLOT_KEYS.has((key || "").trim().toLowerCase());
}

const SLOT_SECTION_ALIASES: Record<string, string[]> = {
  commercials: ["commercials", "line_items", "items"],
  line_items: ["line_items", "commercials", "items"],
  items: ["items", "line_items", "commercials"],
  body: ["body", "line_items", "commercials"],
  features: ["features", "overview", "key_features"],
  overview: ["overview", "features"],
  conclusion: ["conclusion", "next_steps", "closing"],
  closing: ["closing", "conclusion", "next_steps"],
  tax_note: ["tax_note", "taxes", "tax"],
  payment: ["payment", "payment_terms", "payment_details"],
  payment_terms: ["payment_terms", "payment", "payment_details"],
};

function resolveSectionForSlot(
  byKey: Map<string, BlueprintSection>,
  slotKey: string,
): { section: BlueprintSection; matchedKey: string } | null {
  const primary = String(slotKey || "").trim().toLowerCase();
  if (!primary || isLayoutSlotKey(primary)) return null;
  const lowerMap = new Map(
    [...byKey.entries()].map(([k, section]) => [
      k.toLowerCase(),
      { key: k, section },
    ]),
  );
  const candidates = SLOT_SECTION_ALIASES[primary] ?? [primary];
  let fallback: { section: BlueprintSection; matchedKey: string } | null = null;
  for (const candidate of candidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (!hit) continue;
    const body = (hit.section.body || "").trim();
    if (body) return { section: hit.section, matchedKey: hit.key };
    if (!fallback) fallback = { section: hit.section, matchedKey: hit.key };
  }
  return fallback;
}

/** Drop OCR'd cover/footer slots — real cover is letterhead + bp-cover + footer. */
function stripLayoutSectionSlots(html: string): string {
  return (html || "").replace(
    /<section\b[^>]*\bdata-slot="(cover|footer|header|letterhead)"[^>]*>[\s\S]*?<\/section>/gi,
    "",
  );
}

/** Strip letterhead/footer from body — chrome is provided by the view chrome bars. */
function stripInBodyPageChrome(html: string): string {
  return (html || "")
    .replace(
      /<header\b[^>]*class="[^"]*\bbp-letterhead\b[^"]*"[^>]*>[\s\S]*?<\/header>/gi,
      "",
    )
    .replace(
      /<header\b[^>]*class="[^"]*\bbp-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/gi,
      "",
    )
    .replace(
      /<footer\b[^>]*class="[^"]*\bbp-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/gi,
      "",
    )
    .replace(
      /<div\b[^>]*class="[^"]*\bbp-run-header\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    )
    .replace(
      /<div\b[^>]*class="[^"]*\bbp-run-footer\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    )
    .replace(/<div class="bp-page-break"[^>]*>\s*<\/div>/gi, "");
}

function matchBalancedElement(
  html: string,
  openRe: RegExp,
): { full: string } | null {
  const flags = openRe.flags.includes("g") ? openRe.flags : `${openRe.flags}g`;
  const re = new RegExp(openRe.source, flags);
  const open = re.exec(html);
  if (!open || open.index < 0) return null;
  const start = open.index;
  const openTag = open[0];
  const tagMatch = openTag.match(/^<\s*([a-z0-9]+)/i);
  if (!tagMatch?.[1]) return null;
  const tag = tagMatch[1].toLowerCase();
  if (/\/\s*>$/.test(openTag)) return { full: openTag };
  const openToken = new RegExp(`<\\s*${tag}\\b[^>]*>`, "gi");
  const closeToken = new RegExp(`</\\s*${tag}\\s*>`, "gi");
  let depth = 1;
  let i = start + openTag.length;
  while (i < html.length && depth > 0) {
    openToken.lastIndex = i;
    closeToken.lastIndex = i;
    const nextOpen = openToken.exec(html);
    const nextClose = closeToken.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      if (!/\/\s*>$/.test(nextOpen[0])) depth += 1;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      i = nextClose.index + nextClose[0].length;
      if (depth === 0) return { full: html.slice(start, i) };
    }
  }
  return null;
}

function repairBlueprintHtml(html: string): string {
  let next = (html || "").trim();
  next = next.replace(/^(?:\s*<\/(?:div|section|header|footer)>\s*)+/i, "");
  next = next.replace(/<div class="bp-page-break"[^>]*>\s*<\/div>/gi, "");
  return next;
}

/**
 * Cover visuals alone on page 1 (title + hero). Logo/footer chrome is outside
 * the HTML so it can repeat on every scroll/print page without doubling.
 * Exact page clones and invoice letterheads keep their in-body chrome.
 */
function pinChromeToCoverPage(html: string, keepInBodyChrome = false): string {
  if (keepInBodyChrome) {
    return repairBlueprintHtml(stripLayoutSectionSlots(html));
  }
  let next = repairBlueprintHtml(stripInBodyPageChrome(stripLayoutSectionSlots(html)));
  if (/bp-cover-page/i.test(next)) {
    return stripInBodyPageChrome(next);
  }

  const cover =
    matchBalancedElement(
      next,
      /<div\b[^>]*class="[^"]*\bbp-cover\b[^"]*"[^>]*>/i,
    )?.full || "";

  if (!cover) return next;

  next = repairBlueprintHtml(next.replace(cover, ""));
  const coverPage = `<div class="bp-cover-page">${cover}</div>`;

  if (/<section\b/i.test(next)) {
    next = next.replace(/<section\b/i, `${coverPage}<section`);
  } else {
    next = `${coverPage}${next}`;
  }
  return next;
}

export function blueprintUsesExternalChrome(
  blueprint: DocumentBlueprint | null | undefined,
): boolean {
  if (!blueprint) return true;
  if (blueprint.chrome === false || blueprint.mode === "page-clone") return false;
  if (
    blueprint.mode === "playbook-layout" ||
    blueprint.mode === "playbook-template" ||
    blueprint.mode === "spreadsheet-layout"
  ) {
    return false;
  }
  const html = blueprint.html || "";
  if (/proposal-doc/i.test(html)) return false;
  if (/bp-page-clone|bp-letterhead|bp-inv-banner|bp-playbook-root/i.test(html)) {
    return false;
  }
  return true;
}

/** Template preview + live proposals keep exact page images.
 * Live invoices use fillHtml when the page-clone stored a mergeable layout. */
export function resolveBlueprintForView(
  blueprint: DocumentBlueprint,
  variant: "exact" | "fillable" = "exact",
): DocumentBlueprint {
  if (
    variant === "fillable" &&
    blueprint.mode === "page-clone" &&
    (blueprint.fillHtml || "").trim()
  ) {
    return {
      ...blueprint,
      html: blueprint.fillHtml!.trim(),
      css: (blueprint.fillCss || blueprint.css || "").trim(),
      mode: undefined,
      chrome: false,
    };
  }
  return blueprint;
}

/** Title-case company labels for cover lines. */
export function formatCompanyDisplayName(name: string | null | undefined): string {
  const raw = (name || "").trim();
  if (!raw) return "";
  if (raw === raw.toUpperCase() && /[A-Z]/.test(raw)) return raw;
  return raw.replace(/\w\S*/g, (w) => {
    if (/^[A-Z0-9]{2,8}$/.test(w)) return w;
    if (w.length <= 2 && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

export function renderBlueprintHtml(input: {
  blueprint: DocumentBlueprint;
  assets?: BlueprintAsset[];
  sections: BlueprintSection[];
  tokens: Record<string, string>;
}): string {
  const keepInBodyChrome = !blueprintUsesExternalChrome(input.blueprint);
  let html = pinChromeToCoverPage(input.blueprint.html, keepInBodyChrome);
  html = repairPageClonePreviewText(html);
  const css = `${stabilizeTemplateCss(input.blueprint.css || "")}\n${BODY_BASE_CSS}\n${SCREEN_FLOW_OVERRIDE_CSS}\n${PROPOSAL_PAGE_SHEET_CSS}\n${PRINT_FLOW_OVERRIDE_CSS}\n${PAGE_CLONE_TEXT_PREVIEW_CSS}`;

  const applyTokensEscaped = (text: string) => {
    let out = text;
    for (const [key, value] of Object.entries(input.tokens)) {
      const token = key.startsWith("{{") ? key : `{{${key}}}`;
      out = out.split(token).join(escapeHtml(value));
    }
    return out;
  };
  const applyTokensPlain = (text: string) => {
    let out = text;
    for (const [key, value] of Object.entries(input.tokens)) {
      const token = key.startsWith("{{") ? key : `{{${key}}}`;
      out = out.split(token).join(value);
    }
    return out;
  };

  html = applyTokensEscaped(html);

  const byKey = new Map<string, BlueprintSection>();
  for (const s of input.sections) {
    if (s.key && !isLayoutSlotKey(s.key)) byKey.set(s.key, s);
  }

  const usedKeys = new Set<string>();
  html = html.replace(
    /<section([^>]*?)data-slot="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/gi,
    (_full, pre, slotKey, post, inner) => {
      if (isLayoutSlotKey(slotKey)) return "";
      const resolved = resolveSectionForSlot(byKey, String(slotKey));
      let next = inner as string;
      if (resolved) {
        usedKeys.add(resolved.matchedKey);
        const section = resolved.section;
        const title = applyTokensPlain(section.title || "");
        const body = applyTokensPlain(section.body || "");
        const cleaned = cleanOverviewCopy(String(slotKey), title, body);
        next = next.replace(
          /(<[^>]*data-slot-title[^>]*>)([\s\S]*?)(<\/h2>)/i,
          (_m, open: string, _old: string, close: string) =>
            `${open}${formatSectionTitleHtml(cleaned.title)}${close}`,
        );
        next = injectLearnedSectionBody(
          next,
          formatSectionBodyHtml(cleaned.body),
        );
        next = injectSectionTable(next, String(slotKey), section, input.sections);
        return `<section${pre}data-slot="${slotKey}"${post}>${next}</section>`;
      }
      if (
        /^(tax|tax_summary|totals|summary|features|scope|commercials|conclusion|overview|body|closing)$/i.test(
          String(slotKey),
        ) ||
        !String(inner || "").replace(/<[^>]+>/g, "").trim()
      ) {
        return "";
      }
      return `<section${pre}data-slot="${slotKey}"${post}>${next}</section>`;
    },
  );

  const leftovers = input.sections.filter((s) => {
    if (!s.key || isLayoutSlotKey(s.key) || usedKeys.has(s.key)) return false;
    // Title-only / empty shells must not reappear after an alias fill.
    return Boolean((s.body || "").trim());
  });
  // Exact PDF page clones are the full visual — do not append section text under pages.
  if (
    leftovers.length > 0 &&
    input.blueprint.mode !== "page-clone" &&
    !/bp-page-clone/i.test(html) &&
    !/proposal-doc/i.test(html)
  ) {
    const extra = leftovers
      .map((s) => {
        const title = applyTokensPlain(s.title || "");
        const body = applyTokensPlain(s.body || "");
        const shell =
          `<section class="bp-section" data-slot="${escapeHtml(s.key || "section")}">` +
          `<h2 data-slot-title>${formatSectionTitleHtml(title)}</h2>` +
          `<div class="bp-body" data-slot-body>${formatSectionBodyHtml(body)}</div>` +
          `</section>`;
        return injectSectionTable(shell, s.key || "section", s, input.sections);
      })
      .join("\n");
    if (/<footer\b/i.test(html)) {
      html = html.replace(/<footer\b/i, `${extra}\n<footer`);
    } else {
      html = `${html}\n${extra}`;
    }
  }

  // Final pass — catch tokens introduced via section bodies / leftovers.
  html = applyTokensEscaped(html);
  const keepUploadedDesign =
    input.blueprint.mode === "spreadsheet-layout" ||
    input.blueprint.mode === "page-clone" ||
    input.blueprint.chrome === false;
  if (!keepUploadedDesign) {
    html = ensureTemplateCover(html, input.tokens);
    html = applyQuoteDocumentCoverTitle(html, input.tokens);
  }
  html = stripCoverMetadataHtml(html);
  html = applyCoverAlignClass(html, css);
  html = stripSectionChromeHeader(html);

  for (const asset of input.assets ?? []) {
    const ref = `asset:${asset.id}`;
    const dataUri = `data:${asset.mime};base64,${asset.dataBase64}`;
    html = html.split(ref).join(dataUri);
  }

  return `<div class="proposal-blueprint"><style>${css}</style>${html}</div>`;
}

function sectionHasProposalCopy(section: HTMLElement): boolean {
  const heading = (section.querySelector("h1, h2")?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = (section.innerText || "").replace(/\s+/g, " ").trim();
  const withoutHeading = heading
    ? text.replace(heading, "").trim()
    : text;
  const filledCells = [...section.querySelectorAll("td")].filter((td) =>
    (td.textContent || "").trim(),
  ).length;
  return withoutHeading.length >= 40 || filledCells >= 2;
}

type SheetOrigin = { parent: HTMLElement; node: HTMLElement };
const sheetOrigins = new WeakMap<HTMLElement, SheetOrigin[]>();

function unwrapProposalSheets(doc: HTMLElement) {
  const origins = sheetOrigins.get(doc);
  if (origins) {
    for (const item of origins) item.parent.appendChild(item.node);
    sheetOrigins.delete(doc);
  }
  for (const section of doc.querySelectorAll("section.sec")) {
    (section as HTMLElement).hidden = false;
  }
  const stage = doc.querySelector(":scope > .proposal-page-stage");
  if (!stage) {
    delete doc.dataset.sheeted;
    return;
  }
  const header = stage.querySelector(".chrome-header");
  const cover = stage.querySelector(".cover-block");
  const footer = stage.querySelector(".chrome-footer");
  if (header) doc.insertBefore(header, doc.firstChild);
  if (cover) {
    const afterHeader = doc.querySelector(":scope > .chrome-header");
    doc.insertBefore(cover, afterHeader ? afterHeader.nextSibling : doc.firstChild);
  }
  if (footer) doc.appendChild(footer);
  stage.remove();
  delete doc.dataset.sheeted;
}

function isHeadingBlock(el: HTMLElement): boolean {
  return /^H[1-3]$/.test(el.tagName);
}

function blockHasCopy(el: HTMLElement): boolean {
  if (el.querySelector("table, img, svg")) return true;
  return (el.innerText || "").replace(/\s+/g, "").length > 0;
}

function layoutProposalSheets(doc: HTMLElement) {
  unwrapProposalSheets(doc);
  const cover = doc.querySelector(":scope > .cover-block") as HTMLElement | null;
  const header = doc.querySelector(":scope > .chrome-header") as HTMLElement | null;
  const footer = doc.querySelector(":scope > .chrome-footer") as HTMLElement | null;
  const sections = [
    ...doc.querySelectorAll(":scope > section.sec"),
  ] as HTMLElement[];
  if (!cover && !sections.length) return;

  const stage = document.createElement("div");
  stage.className = "proposal-page-stage";
  doc.appendChild(stage);

  const makeSheet = () => {
    const sheet = document.createElement("div");
    sheet.className = "proposal-sheet";
    stage.appendChild(sheet);
    return sheet;
  };

  const filled = sections.filter(sectionHasProposalCopy);
  for (const empty of sections.filter((section) => !filled.includes(section))) {
    empty.remove();
  }

  const origins: SheetOrigin[] = [];
  const blocks: HTMLElement[] = [];
  for (const section of filled) {
    for (const child of [...section.children]) {
      if (!(child instanceof HTMLElement)) continue;
      origins.push({ parent: section, node: child });
      if (blockHasCopy(child)) blocks.push(child);
    }
    section.hidden = true;
  }
  sheetOrigins.set(doc, origins);

  const pageHeightPx = Math.max(320, (doc.clientWidth * 297) / 210);
  let bodySheet = makeSheet();
  if (header) bodySheet.appendChild(header);
  if (cover) bodySheet.appendChild(cover);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    const pair = Boolean(block && isHeadingBlock(block) && next);
    const before = bodySheet.childElementCount;
    bodySheet.appendChild(block!);
    if (pair && next) bodySheet.appendChild(next);
    const tooTall = bodySheet.scrollHeight > pageHeightPx + 32;
    if (tooTall && before > 0) {
      bodySheet.removeChild(block!);
      if (pair && next?.parentElement === bodySheet) bodySheet.removeChild(next);
      bodySheet = makeSheet();
      bodySheet.appendChild(block!);
      if (pair && next) bodySheet.appendChild(next);
    }
    if (pair) i += 1;
  }
  if (footer) {
    const last = stage.lastElementChild;
    if (last) last.appendChild(footer);
  }
  doc.dataset.sheeted = "1";
}

type Props = {
  blueprint: DocumentBlueprint;
  assets?: BlueprintAsset[];
  sections: BlueprintSection[];
  tokens?: Record<string, string>;
  className?: string;
  editable?: boolean;
  onHtmlCommit?: (html: string) => void;
};

/**
 * Renders a stored HTML brand blueprint with section slots filled.
 * Proposal docs use sticky logo/footer chrome; exact page clones and invoice
 * letterheads keep layout inside the blueprint (no rainbow stripe).
 */
export function DocumentBlueprintView({
  blueprint,
  assets,
  sections,
  tokens = {},
  className,
  variant = "exact",
  editable = false,
  onHtmlCommit,
}: Props & { variant?: "exact" | "fillable" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);
  const resolved = useMemo(
    () => resolveBlueprintForView(blueprint, variant),
    [blueprint, variant],
  );
  const html = useMemo(
    () =>
      renderBlueprintHtml({
        blueprint: resolved,
        assets,
        sections,
        tokens,
      }),
    [resolved, assets, sections, tokens],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || editingRef.current) return;
    if (host.innerHTML !== html) host.innerHTML = html;
    const doc = host.querySelector(".proposal-doc") as HTMLElement | null;
    if (!doc) return;
    doc.contentEditable = editable ? "true" : "false";
    doc.spellcheck = editable;
    let pageWidth = -1;
    const runLayout = (force = false) => {
      if (editingRef.current) return;
      if (doc.clientWidth < 40) return;
      if (!force && Math.abs(doc.clientWidth - pageWidth) < 4 && doc.dataset.sheeted === "1") return;
      pageWidth = doc.clientWidth;
      layoutProposalSheets(doc);
    };
    runLayout(true);
    const frame = requestAnimationFrame(() => runLayout(true));
    const ro = new ResizeObserver(() => runLayout(false));
    ro.observe(doc);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [html, editable]);

  useEffect(() => {
    if (!editable) return;
    const host = hostRef.current;
    if (!host) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const doc = host.querySelector(".proposal-doc") as HTMLElement | null;
      if (target?.closest?.(".proposal-doc")) editingRef.current = true;
      if (doc) unwrapProposalSheets(doc);
    };
    const onFocusOut = (event: FocusEvent) => {
      const doc = host.querySelector(".proposal-doc") as HTMLElement | null;
      if (!doc) return;
      const next = event.relatedTarget as Node | null;
      if (next && doc.contains(next)) return;
      unwrapProposalSheets(doc);
      editingRef.current = false;
      onHtmlCommit?.(doc.outerHTML);
      layoutProposalSheets(doc);
    };
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, [editable, onHtmlCommit]);

  const vendor = tokens.vendorName?.trim() || "Our company";
  const address = tokens.sellerAddress?.trim() || "";
  const logo = (assets ?? []).find((a) => a.id === "logo");
  const footer = (assets ?? []).find((a) => a.id === "footer");
  const logoUri = logo
    ? `data:${logo.mime};base64,${logo.dataBase64}`
    : null;
  const footerUri = footer
    ? `data:${footer.mime};base64,${footer.dataBase64}`
    : null;
  // Logo asset already includes the wordmark — don't redraw the vendor name.
  const showVendorText = !logoUri;
  const useChrome = blueprintUsesExternalChrome(resolved);

  if (!useChrome) {
    const pagedProposal = /proposal-doc/i.test(resolved.html || html);
    return (
      <div
        ref={hostRef}
        className={
          pagedProposal
            ? `${className ? `${className} ` : ""}overflow-visible rounded-none border-0 bg-transparent shadow-none`
            : className
              ? `${className} overflow-hidden rounded-xl border border-border-default bg-white shadow-sm`
              : "overflow-hidden rounded-xl border border-border-default bg-white shadow-sm"
        }
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div
      className={
        className
          ? `${className} doc-chrome-root overflow-hidden rounded-xl border border-border-default bg-white shadow-sm`
          : "doc-chrome-root overflow-hidden rounded-xl border border-border-default bg-white shadow-sm"
      }
    >
      <style>{DOC_CHROME_CSS}</style>

      <header className="doc-chrome-header">
        {logoUri ? (
          <img src={logoUri} alt="" className="doc-chrome-logo" />
        ) : null}
        {showVendorText ? (
          <div className="doc-chrome-vendor">{vendor}</div>
        ) : null}
        {address ? (
          <div className="doc-chrome-address">{address}</div>
        ) : null}
      </header>

      <div
        className="doc-chrome-body"
        // Blueprint HTML is generated by our AI/backend pipeline; slot text is escapeHtml'd.
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <footer className="doc-chrome-footer">
        {footerUri ? (
          <img src={footerUri} alt="" className="doc-chrome-stripe" />
        ) : (
          <div className="doc-chrome-stripe-fallback" />
        )}
        <div className="doc-chrome-meta">Prepared by {vendor}</div>
      </footer>
    </div>
  );
}
