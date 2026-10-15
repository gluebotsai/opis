/**
 * Export proposal document HTML as Word (.docx) with tables preserved.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ITableCellBorders,
} from "docx";
import {
  parseProposalExportLayout,
  ptToHalfPoints,
  ptToTwip,
  type ProposalExportLayout,
} from "@/lib/proposal-export-layout";

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;

function contentWidth(theme: ProposalExportLayout): number {
  return (
    PAGE_WIDTH -
    ptToTwip(theme.margins.left) -
    ptToTwip(theme.margins.right)
  );
}

function cellBorders(color: string): ITableCellBorders {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color },
    bottom: { style: BorderStyle.SINGLE, size: 4, color },
    left: { style: BorderStyle.SINGLE, size: 4, color },
    right: { style: BorderStyle.SINGLE, size: 4, color },
  };
}

function alignOf(
  value: "left" | "center" | "right" | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (value === "center") return AlignmentType.CENTER;
  if (value === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

type DocChild = Paragraph | Table;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number.parseInt(n, 10)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkup(value: string, options?: { listMarker?: boolean }): string {
  const withLists =
    options?.listMarker === false
      ? value.replace(/<li[^>]*>/gi, "")
      : value.replace(/<li[^>]*>/gi, "• ");
  return decodeEntities(
    withLists
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findBalancedClose(html: string, tag: string, from: number): number {
  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let i = from;
  while (i < html.length && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return html.length;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
    } else {
      depth -= 1;
      i = close.index + close[0].length;
      if (depth === 0) return i;
    }
  }
  return html.length;
}

function extractTables(html: string): { html: string; tables: string[] } {
  const tables: string[] = [];
  let out = "";
  let i = 0;
  while (i < html.length) {
    const rel = html.slice(i).search(/<table\b/i);
    if (rel < 0) {
      out += html.slice(i);
      break;
    }
    const abs = i + rel;
    out += html.slice(i, abs);
    const openEnd = html.indexOf(">", abs);
    if (openEnd < 0) {
      out += html.slice(abs);
      break;
    }
    const close = findBalancedClose(html, "table", openEnd + 1);
    tables.push(html.slice(abs, close));
    out += `\u0001TABLE${tables.length - 1}\u0001`;
    i = close;
  }
  return { html: out, tables };
}

function cellParagraphs(
  html: string,
  header: boolean,
  theme: ProposalExportLayout,
): Paragraph[] {
  const text = stripMarkup(html, { listMarker: false });
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const color = header && theme.tableHeaderFill ? "FFFFFF" : theme.text;
  const size = ptToHalfPoints(theme.sizeBodyPt);
  if (!lines.length) {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: "",
            bold: header,
            color,
            font: theme.fontBody,
            size,
          }),
        ],
      }),
    ];
  }
  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: line,
            bold: header,
            color,
            size,
            font: theme.fontBody,
          }),
        ],
      }),
  );
}

function parseHtmlTableRows(
  chunk: string,
  headerDefault: boolean,
): Array<{ cells: string[]; header: boolean }> {
  const parsed: Array<{ cells: string[]; header: boolean }> = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(chunk))) {
    const rowHtml = match[1] || "";
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml))) {
      cells.push(cellMatch[1] || "");
    }
    if (!cells.length) continue;
    parsed.push({
      cells,
      header: headerDefault || /<th\b/i.test(rowHtml),
    });
  }
  return parsed;
}

function htmlTableToDocx(tableHtml: string, theme: ProposalExportLayout): Table {
  const isCoverMeta = /class="[^"]*cover-meta/i.test(tableHtml);
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tableHtml)?.[1] || "";
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableHtml)?.[1] || "";
  const parsed = [
    ...parseHtmlTableRows(thead, true),
    ...parseHtmlTableRows(tbody || (!thead ? tableHtml : ""), false),
  ];
  const rows: TableRow[] = [];
  const maxCols = parsed.reduce((n, row) => Math.max(n, row.cells.length), 0);

  const colCount = Math.max(1, maxCols);
  const width = contentWidth(theme);
  const colWidth = Math.floor(width / colCount);
  const borders = cellBorders(isCoverMeta ? theme.tableBorder : theme.tableBorder);
  const fillHeader = theme.tableHeaderFill && !isCoverMeta;

  for (const row of parsed) {
    const cells = [...row.cells];
    while (cells.length < colCount) cells.push("");
    rows.push(
      new TableRow({
        tableHeader: row.header,
        children: cells.slice(0, colCount).map(
          (cell) =>
            new TableCell({
              borders,
              width: { size: colWidth, type: WidthType.DXA },
              verticalAlign: VerticalAlign.TOP,
              shading:
                row.header && fillHeader
                  ? { type: ShadingType.CLEAR, fill: theme.tableHeaderBg }
                  : undefined,
              children: cellParagraphs(cell, row.header && fillHeader, theme),
            }),
        ),
      }),
    );
  }

  if (!rows.length) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: width, type: WidthType.DXA },
            children: [new Paragraph("")],
          }),
        ],
      }),
    );
  }

  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: Array.from({ length: colCount }, () => colWidth),
    rows,
  });
}

function styledParagraph(
  text: string,
  theme: ProposalExportLayout,
  options?: {
    kind?: "brand" | "title" | "heading" | "body" | "muted" | "tag";
    italic?: boolean;
    bold?: boolean;
    after?: number;
    before?: number;
    align?: "left" | "center" | "right";
  },
): Paragraph {
  const kind = options?.kind || "body";
  const size =
    kind === "brand"
      ? ptToHalfPoints(theme.sizeBrandPt)
      : kind === "title"
        ? ptToHalfPoints(theme.sizeTitlePt)
        : kind === "heading"
          ? ptToHalfPoints(theme.sizeHeadingPt)
          : ptToHalfPoints(theme.sizeBodyPt);
  const color =
    kind === "brand"
      ? theme.brandColor
      : kind === "title"
        ? theme.titleColor
        : kind === "heading"
          ? theme.headingColor
          : kind === "muted"
            ? theme.muted
            : theme.text;
  const font =
    kind === "brand"
      ? theme.fontBrand
      : kind === "title" || kind === "heading"
        ? theme.fontHeading
        : theme.fontBody;
  return new Paragraph({
    spacing: { before: options?.before ?? 0, after: options?.after ?? 160 },
    alignment: alignOf(options?.align),
    children: [
      new TextRun({
        text,
        italics: options?.italic,
        bold:
          options?.bold ??
          (kind === "brand" || kind === "title" || kind === "heading"),
        font,
        size,
        color,
      }),
    ],
  });
}

function extractTaggedLists(html: string): { html: string; lists: string[] } {
  const lists: string[] = [];
  const next = html.replace(
    /<ul\b[^>]*class="[^"]*product-tags[^"]*"[^>]*>[\s\S]*?<\/ul>/gi,
    (chunk) => {
      lists.push(chunk);
      return `\u0001TAGS${lists.length - 1}\u0001`;
    },
  );
  return { html: next, lists };
}

function productTagParagraphs(listHtml: string, theme: ProposalExportLayout): Paragraph[] {
  const items: string[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(listHtml))) {
    const text = stripMarkup(match[1] || "", { listMarker: false });
    if (text) items.push(text);
  }
  if (!items.length) {
    const fallback = stripMarkup(listHtml, { listMarker: false });
    if (fallback) items.push(fallback);
  }
  return items.map((text) =>
    styledParagraph(text, theme, {
      kind: "tag",
      bold: true,
      after: 80,
      align: theme.productTagsAlign,
    }),
  );
}

/** Convert preview HTML (proposal-doc tables, cover, headings) into Word blocks. */
export function htmlToDocxChildren(html: string): DocChild[] {
  const theme = parseProposalExportLayout(html);
  const withoutStyle = html.replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const article =
    /<article\b[^>]*class="[^"]*proposal-doc[^"]*"[^>]*>([\s\S]*?)<\/article>/i.exec(
      withoutStyle,
    )?.[1] || withoutStyle;
  const { html: withoutTables, tables } = extractTables(article);
  const { html: withPlaceholders, lists } = extractTaggedLists(withoutTables);
  const children: DocChild[] = [];
  const re =
    /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<li\b[^>]*>([\s\S]*?)<\/li>|\u0001TABLE(\d+)\u0001|\u0001TAGS(\d+)\u0001/gi;
  let match: RegExpExecArray | null;
  let last = 0;
  const flushText = (chunk: string) => {
    const text = stripMarkup(chunk, { listMarker: false });
    if (text) {
      children.push(styledParagraph(text, theme, { after: 120 }));
    }
  };

  while ((match = re.exec(withPlaceholders))) {
    flushText(withPlaceholders.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[6] != null) {
      const listHtml = lists[Number(match[6])];
      if (listHtml) children.push(...productTagParagraphs(listHtml, theme));
      continue;
    }
    if (match[5] != null) {
      const tableHtml = tables[Number(match[5])];
      if (tableHtml) children.push(htmlTableToDocx(tableHtml, theme));
      continue;
    }
    if (match[1]) {
      const cls = /class="([^"]*)"/i.exec(match[0])?.[1] || "";
      const text = stripMarkup(match[2] || "", { listMarker: false });
      if (!text) continue;
      if (/cover-title|bp-cover-title/i.test(cls)) {
        children.push(
          styledParagraph(text, theme, {
            kind: "title",
            after: 160,
            align: theme.coverTitleAlign,
          }),
        );
      } else {
        children.push(
          styledParagraph(text, theme, {
            kind: "heading",
            before: 240,
            after: 120,
          }),
        );
      }
      continue;
    }
    if (match[3] != null) {
      const cls = /class="([^"]*)"/i.exec(match[0])?.[1] || "";
      const text = stripMarkup(match[3], { listMarker: false });
      if (!text) continue;
      if (/cover-brand/i.test(cls)) {
        children.push(
          styledParagraph(text, theme, {
            kind: "brand",
            after: 200,
            align: theme.coverBrandAlign,
          }),
        );
      } else if (/cover-prepared/i.test(cls)) {
        children.push(
          styledParagraph(text, theme, { italic: true, bold: true, after: 80 }),
        );
      } else if (/cover-date/i.test(cls)) {
        children.push(
          styledParagraph(text, theme, { kind: "muted", after: 240 }),
        );
      } else {
        children.push(styledParagraph(text, theme, { after: 140 }));
      }
      continue;
    }
    if (match[4] != null) {
      const text = stripMarkup(match[4], { listMarker: false });
      if (!text) continue;
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          bullet: { level: 0 },
          children: [
            new TextRun({
              text,
              font: theme.fontBody,
              size: ptToHalfPoints(theme.sizeBodyPt),
              color: theme.text,
            }),
          ],
        }),
      );
    }
  }
  flushText(withPlaceholders.slice(last));
  return children;
}

function bodyParagraphs(body: string): Paragraph[] {
  const chunks = body
    .split(/\n{2,}/)
    .map((part) => stripMarkup(part))
    .filter(Boolean);
  if (!chunks.length) {
    return [new Paragraph({ children: [new TextRun("")] })];
  }
  return chunks.map(
    (text) =>
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun(text)],
      }),
  );
}

export async function proposalSectionsToDocxBuffer(input: {
  number: string;
  title: string;
  customerName: string;
  vendorName: string;
  date: string;
  sections: Array<{ title: string; body: string }>;
}): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: input.number,
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
    }),
    new Paragraph({
      text: input.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `Prepared for ${input.customerName}`,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: input.date, color: "666666" })],
    }),
  ];

  for (const section of input.sections) {
    const heading = stripMarkup(section.title);
    if (heading) {
      children.push(
        new Paragraph({
          text: heading,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        }),
      );
    }
    children.push(...bodyParagraphs(section.body));
  }

  children.push(
    new Paragraph({
      spacing: { before: 360 },
      children: [
        new TextRun({
          text: `Prepared by ${input.vendorName}`,
          italics: true,
          color: "666666",
        }),
      ],
    }),
  );

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function proposalHtmlToDocxBuffer(input: {
  number: string;
  title: string;
  customerName: string;
  vendorName: string;
  date: string;
  html: string;
  sections?: Array<{ title: string; body: string }>;
}): Promise<Buffer> {
  const fromHtml = htmlToDocxChildren(input.html);
  const hasTable = fromHtml.some((child) => child instanceof Table);
  const hasBody = fromHtml.length > 0;
  if (!hasBody && input.sections?.length) {
    return proposalSectionsToDocxBuffer({
      number: input.number,
      title: input.title,
      customerName: input.customerName,
      vendorName: input.vendorName,
      date: input.date,
      sections: input.sections,
    });
  }

  const children: DocChild[] = [];
  const previewLooksComplete =
    /cover-brand|cover-title|proposal-doc/i.test(input.html);
  if (
    !previewLooksComplete &&
    !/PROP-|proposal/i.test(stripMarkup(input.html).slice(0, 80))
  ) {
    children.push(
      styledParagraph(input.number, parseProposalExportLayout(input.html), {
        kind: "brand",
        after: 80,
      }),
    );
  }
  children.push(...fromHtml);
  if (!hasTable && input.sections?.length) {
    for (const section of input.sections) {
      if (/<table\b/i.test(section.body)) {
        children.push(...htmlToDocxChildren(section.body));
      }
    }
  }

  const theme = parseProposalExportLayout(input.html);
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: theme.fontBody,
            size: ptToHalfPoints(theme.sizeBodyPt),
            color: theme.text,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: ptToTwip(theme.margins.top),
              right: ptToTwip(theme.margins.right),
              bottom: ptToTwip(theme.margins.bottom),
              left: ptToTwip(theme.margins.left),
            },
          },
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
