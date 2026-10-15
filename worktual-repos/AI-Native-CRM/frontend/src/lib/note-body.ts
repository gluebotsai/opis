import { htmlToPlainText, sanitizeEmailHtml } from "@/lib/email-body";

export type NoteAttachment = {
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
};

export type NotePayload = {
  v: 1;
  html: string;
  attachments: NoteAttachment[];
};

const NOTE_PREFIX = "WT_NOTE_V1:";

export const NOTE_MAX_ATTACHMENTS = 5;
export const NOTE_MAX_FILE_BYTES = 5 * 1024 * 1024;

export function isEncodedNoteBody(raw: string | null | undefined): boolean {
  return Boolean(raw?.startsWith(NOTE_PREFIX));
}

function escapeNoteHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function headingLabel(raw: string): string {
  const label = raw.replace(/:$/, "").trim().toLowerCase();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : raw;
}

const SECTION_HEADING_RE =
  /^(open questions|themes|focus areas|next(?: best)? (?:action|step)|recommended(?: next)? action|summary|situation|customer (?:situation|context)|recommended approach|status|objections|company|engagement|opportunity|person|profile|why|highlights|risks|outcome|reason|change|detail|prepared by)\:?\s*$/i;
const INLINE_FIELD_RE =
  /^(themes|focus areas|next(?: best)? (?:action|step)|recommended(?: next)? action|status|company|engagement)\:\s+(.+)$/i;

function formatInlineNote(value: string): string {
  return escapeNoteHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_match, label: string, href: string) => {
        const blank = href.startsWith("/")
          ? ""
          : ' target="_blank" rel="noopener noreferrer"';
        return `<a href="${href}"${blank}>${label}</a>`;
      },
    )
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

function isBulletLine(line: string): boolean {
  return /^\s*[-*•]\s+\S/.test(line);
}

function isOrderedLine(line: string): boolean {
  return /^\s*\d+[.)]\s+\S/.test(line);
}

function parsePipeCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function isPipeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  return parsePipeCells(t).length >= 2;
}

function isPipeSeparatorRow(line: string): boolean {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!t) return false;
  return /^[\s|:-]+$/.test(t) && /[-:]/.test(t);
}

function formatMarkdownTableHtml(rows: string[]): string {
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
  const parts: string[] = [
    '<div class="note-table-wrap"><table class="note-table">',
  ];
  if (header) {
    parts.push("<thead><tr>");
    for (const cell of header) {
      parts.push(`<th>${formatInlineNote(cell)}</th>`);
    }
    parts.push("</tr></thead>");
  }
  parts.push("<tbody>");
  for (const cells of bodyRows) {
    if (!cells.length) continue;
    parts.push("<tr>");
    for (const cell of cells) {
      parts.push(`<td>${formatInlineNote(cell)}</td>`);
    }
    parts.push("</tr>");
  }
  parts.push("</tbody></table></div>");
  return parts.join("");
}

function parseFixedWidthTableRow(
  text: string,
  columnCount: number,
): { row: string; rest: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("|") || columnCount < 1) return null;
  const cells: string[] = [];
  let pos = 1;
  while (cells.length < columnCount && pos <= trimmed.length) {
    const pipe = trimmed.indexOf("|", pos);
    if (pipe < 0) return null;
    cells.push(trimmed.slice(pos, pipe).trim());
    pos = pipe + 1;
  }
  if (cells.length < columnCount) return null;
  return {
    row: `|${cells.join("|")}|`,
    rest: trimmed.slice(pos).trimStart(),
  };
}

function readSeparatorRow(text: string): { row: string; rest: string } | null {
  const trimmed = text.trimStart();
  const match = trimmed.match(/^(\|(?:\s*:?\s*-+\s*:?\s*\|)+)/);
  if (!match) return null;
  return {
    row: match[1]!.trim(),
    rest: trimmed.slice(match[1]!.length).trimStart(),
  };
}

function extractCollapsedMarkdownTable(line: string): {
  prefix: string;
  rows: string[];
  suffix: string;
} | null {
  const sepMatch = line.match(/\|(?:\s*:?\s*-+\s*:?\s*\|)+/);
  if (!sepMatch || sepMatch.index == null) return null;
  const beforeSep = line.slice(0, sepMatch.index).trimEnd();
  const headerMatch = beforeSep.match(/(\|(?:[^|]+\|)+)\s*$/);
  if (!headerMatch) return null;
  const headerRow = headerMatch[1]!.trim();
  const tableStart = beforeSep.length - headerMatch[1]!.length;
  const prefix = line.slice(0, tableStart).trim();
  const columnCount = parsePipeCells(headerRow).length;
  if (columnCount < 2) return null;

  const rows: string[] = [headerRow];
  let rest = line.slice(tableStart).trimStart();
  if (!rest.startsWith(headerRow)) return null;
  rest = rest.slice(headerRow.length).trimStart();
  const separator = readSeparatorRow(rest);
  if (!separator || !isPipeSeparatorRow(separator.row)) return null;
  rows.push(separator.row);
  rest = separator.rest;

  while (rest.startsWith("|")) {
    const next = parseFixedWidthTableRow(rest, columnCount);
    if (!next || isPipeSeparatorRow(next.row)) break;
    rows.push(next.row);
    rest = next.rest;
  }

  if (rows.length < 2) return null;
  return { prefix, rows, suffix: rest.trim() };
}

/** Split single-line markdown tables onto separate rows for parsing. */
function normalizeMarkdownTables(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => {
      if (!line.includes("|")) return [line];
      if (isPipeTableRow(line.trim())) return [line];
      const collapsed = extractCollapsedMarkdownTable(line);
      if (collapsed) {
        const out = [
          ...(collapsed.prefix ? [collapsed.prefix] : []),
          ...collapsed.rows,
          ...(collapsed.suffix ? [collapsed.suffix] : []),
        ];
        return out;
      }
      return [line];
    })
    .join("\n");
}

/**
 * Turn legacy plain notes (proposal briefs, agent dumps) into sectioned HTML
 * so the timeline reads like an enterprise record, not a wall of text.
 */
export function plainTextToStructuredNoteHtml(raw: string): string {
  const lines = normalizeMarkdownTables(raw).split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i += 1;

  if (i < lines.length) {
    const first = lines[i]!.trim();
    const titled =
      first.length <= 140 &&
      !isBulletLine(first) &&
      !isOrderedLine(first) &&
      !isPipeTableRow(first) &&
      !extractCollapsedMarkdownTable(first) &&
      !SECTION_HEADING_RE.test(first) &&
      !INLINE_FIELD_RE.test(first) &&
      !/[.!?]$/.test(first);
    if (titled) {
      const withStatus = first.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      const statusHint = withStatus?.[2]?.trim() ?? "";
      if (
        withStatus &&
        /\b(awaiting|pending|draft|ready|confirm)\b/i.test(statusHint)
      ) {
        blocks.push(`<h3>${formatInlineNote(withStatus[1]!.trim())}</h3>`);
        const status =
          statusHint.charAt(0).toUpperCase() + statusHint.slice(1);
        blocks.push(
          `<p><strong>Status</strong> — ${formatInlineNote(status)}</p>`,
        );
      } else {
        blocks.push(`<h3>${formatInlineNote(first)}</h3>`);
      }
      i += 1;
      while (i < lines.length && !lines[i]!.trim()) i += 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const trimmed = line.trim();
    const inline = trimmed.match(INLINE_FIELD_RE);
    if (inline) {
      blocks.push(`<h4>${formatInlineNote(headingLabel(inline[1]!))}</h4>`);
      blocks.push(`<p>${formatInlineNote(inline[2]!.trim())}</p>`);
      i += 1;
      continue;
    }
    if (SECTION_HEADING_RE.test(trimmed)) {
      blocks.push(`<h4>${formatInlineNote(headingLabel(trimmed))}</h4>`);
      i += 1;
      continue;
    }
    if (isBulletLine(trimmed) || isOrderedLine(trimmed)) {
      const ordered = isOrderedLine(trimmed);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? isOrderedLine(lines[i]!) : isBulletLine(lines[i]!))
      ) {
        const item = lines[i]!
          .trim()
          .replace(ordered ? /^\d+[.)]\s+/ : /^[-*•]\s+/, "");
        items.push(`<li>${formatInlineNote(item)}</li>`);
        i += 1;
      }
      blocks.push(
        ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`,
      );
      continue;
    }
    if (isPipeTableRow(trimmed)) {
      const tableRows: string[] = [];
      while (i < lines.length && isPipeTableRow(lines[i]!.trim())) {
        tableRows.push(lines[i]!.trim());
        i += 1;
      }
      blocks.push(formatMarkdownTableHtml(tableRows));
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !SECTION_HEADING_RE.test(lines[i]!.trim()) &&
      !INLINE_FIELD_RE.test(lines[i]!.trim()) &&
      !isBulletLine(lines[i]!) &&
      !isOrderedLine(lines[i]!) &&
      !isPipeTableRow(lines[i]!.trim())
    ) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    if (para.length) {
      blocks.push(`<p>${formatInlineNote(para.join(" "))}</p>`);
    }
  }

  return blocks.join("") || `<p>${formatInlineNote(raw.trim())}</p>`;
}

export function encodeNoteBody(input: {
  html: string;
  attachments?: NoteAttachment[];
}): string {
  const html = sanitizeEmailHtml(input.html || "");
  const attachments = (input.attachments ?? []).map((file) => ({
    filename: file.filename.trim() || "attachment",
    contentType: file.contentType || "application/octet-stream",
    size: file.size,
    contentBase64: file.contentBase64,
  }));
  const payload: NotePayload = { v: 1, html, attachments };
  return `${NOTE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseNoteBody(raw: string | null | undefined): {
  html: string;
  plain: string;
  attachments: NoteAttachment[];
} {
  if (!raw?.trim()) {
    return { html: "", plain: "", attachments: [] };
  }

  if (raw.startsWith(NOTE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(NOTE_PREFIX.length)) as NotePayload;
      const html = sanitizeEmailHtml(parsed.html || "");
      const plain = htmlToPlainText(html).trim();
      const attachments = Array.isArray(parsed.attachments)
        ? parsed.attachments.filter(
            (a) =>
              a &&
              typeof a.filename === "string" &&
              typeof a.contentBase64 === "string",
          )
        : [];
      return { html, plain, attachments };
    } catch {
      // fall through to legacy plain text
    }
  }

  const html = plainTextToStructuredNoteHtml(raw);
  return {
    html,
    plain: htmlToPlainText(html).trim() || raw.trim(),
    attachments: [],
  };
}

export function noteBodyIsEmpty(html: string): boolean {
  return !htmlToPlainText(html).trim();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
