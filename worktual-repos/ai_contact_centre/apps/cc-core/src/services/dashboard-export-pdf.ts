import { parseCsvTableSections } from "../lib/csv-table-sections.js";

const TABLE_MARGIN = 36;
const HEADER_FILL = "#f1f5f9";
const HEADER_TEXT = "#171717";
const BODY_TEXT = "#171717";
const ALT_ROW_FILL = "#f8fafc";
const BORDER_COLOR = "#e2e8f0";

function columnWidths(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  tableWidth: number,
): number[] {
  if (headers.length === 0) return [tableWidth];
  if (headers.length === 2 && headers[0] === "Metric") {
    return [tableWidth * 0.62, tableWidth * 0.38];
  }

  const minWidths = headers.map((header, index) => {
    const headerWidth = doc.widthOfString(header) + 12;
    const maxRowWidth = rows.reduce((max, row) => {
      const cell = row[index] ?? "";
      return Math.max(max, doc.widthOfString(cell) + 12);
    }, 0);
    return Math.max(headerWidth, maxRowWidth, 48);
  });

  const totalMin = minWidths.reduce((sum, width) => sum + width, 0);
  if (totalMin <= tableWidth) {
    const extra = tableWidth - totalMin;
    return minWidths.map((width) => width + extra / headers.length);
  }

  const scale = tableWidth / totalMin;
  return minWidths.map((width) => width * scale);
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  cells: string[],
  widths: number[],
  y: number,
  rowHeight: number,
  options: { header?: boolean; alt?: boolean },
): void {
  const xStart = TABLE_MARGIN;
  let x = xStart;

  if (options.alt) {
    doc.save();
    doc.rect(xStart, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill(ALT_ROW_FILL);
    doc.restore();
  }

  cells.forEach((cell, index) => {
    const width = widths[index] ?? widths[widths.length - 1] ?? 80;
    if (options.header) {
      doc.save();
      doc.rect(x, y, width, rowHeight).fill(HEADER_FILL);
      doc.restore();
    }

    doc
      .fontSize(8)
      .fillColor(options.header ? HEADER_TEXT : BODY_TEXT)
      .font(options.header ? "Helvetica-Bold" : "Helvetica")
      .text(cell, x + 4, y + 5, {
        width: width - 8,
        height: rowHeight - 6,
        ellipsis: true,
      });

    doc.save();
    doc.rect(x, y, width, rowHeight).strokeColor(BORDER_COLOR).lineWidth(0.5).stroke();
    doc.restore();

    x += width;
  });
}

export function renderCsvTableSections(
  doc: PDFKit.PDFDocument,
  csvText: string,
  startNewPage: boolean,
): void {
  const sections = parseCsvTableSections(csvText);
  if (sections.length === 0) return;

  for (const [index, section] of sections.entries()) {
    if (index > 0 || startNewPage) {
      doc.addPage({ layout: "portrait", margin: TABLE_MARGIN });
    }

    doc.font("Helvetica-Bold").fontSize(13).fillColor(HEADER_TEXT);
    doc.text(section.title, TABLE_MARGIN, TABLE_MARGIN + 10);

    const tableWidth = doc.page.width - TABLE_MARGIN * 2;
    const rowHeight = 18;
    let y = TABLE_MARGIN + 32;
    const columnCount = Math.max(section.headers.length, ...section.rows.map((row) => row.length), 1);
    const normalizedHeaders =
      section.headers.length > 0
        ? section.headers
        : Array.from({ length: columnCount }, (_, cellIndex) => `Column ${cellIndex + 1}`);
    const widths = columnWidths(doc, normalizedHeaders, section.rows, tableWidth);

    drawTableRow(doc, normalizedHeaders, widths, y, rowHeight, { header: true });
    y += rowHeight;

    section.rows.forEach((row, rowIndex) => {
      if (y + rowHeight > doc.page.height - TABLE_MARGIN) {
        doc.addPage({ layout: "portrait", margin: TABLE_MARGIN });
        y = TABLE_MARGIN;
        drawTableRow(doc, normalizedHeaders, widths, y, rowHeight, { header: true });
        y += rowHeight;
      }

      const normalizedRow = Array.from({ length: normalizedHeaders.length }, (_, cellIndex) => row[cellIndex] ?? "");
      drawTableRow(doc, normalizedRow, widths, y, rowHeight, { alt: rowIndex % 2 === 1 });
      y += rowHeight;
    });
  }
}
