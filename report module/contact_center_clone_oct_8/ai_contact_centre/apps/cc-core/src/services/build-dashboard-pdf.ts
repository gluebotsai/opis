import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import {
  DASHBOARD_CAPTURE_PAGE_MARGIN_PT,
  addDashboardImageFitToPage,
  dashboardCapturePageFormat,
} from "../lib/dashboard-pdf-image.js";
import { parseCsvTableSections, type CsvTableSection } from "../lib/csv-table-sections.js";
import type { DashboardReportLayoutInput } from "./dashboard-report-layout.js";
import type { ReportIncludedSections } from "./scheduled-reports.js";

function readDashboardImage(
  buffer: Buffer,
): { width: number; height: number; mimeType: "image/png" | "image/jpeg"; format: "PNG" | "JPEG" } {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      mimeType: "image/png",
      format: "PNG",
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1]!;
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          mimeType: "image/jpeg",
          format: "JPEG",
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }

  throw new Error("Invalid dashboard image; expected PNG or JPEG");
}

function imageBufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export type BuildScheduledReportPdfInput = {
  title: string;
  periodLabel: string;
  sections: ReportIncludedSections;
  dashboardImagePng?: Buffer | null;
  dashboardLayout?: DashboardReportLayoutInput;
  kpiCsvText?: string;
  agentCsvText?: string;
  summaryText?: string | null;
  highlights?: string[];
  improvementSuggestions?: string[];
};

/** @deprecated Use BuildScheduledReportPdfInput */
export type BuildDashboardPdfInput = {
  dashboardImagePng: Buffer;
  csvReportText: string;
  summaryText?: string | null;
  highlights?: string[];
};

function firstCsvSection(text: string | undefined): CsvTableSection | null {
  if (!text?.trim()) return null;
  return parseCsvTableSections(text)[0] ?? null;
}

function renderTablePage(doc: jsPDF, section: CsvTableSection, margin: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(23, 23, 23);
  doc.text(section.title, margin, margin + 10);

  autoTable(doc, {
    startY: margin + 22,
    head: section.headers.length ? [section.headers] : undefined,
    body: section.rows,
    styles: {
      fontSize: 8,
      cellPadding: 4,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [23, 23, 23],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });
}

function renderDashboardPlaceholderPage(
  doc: jsPDF,
  input: Pick<BuildScheduledReportPdfInput, "title" | "periodLabel" | "dashboardLayout">,
  margin: number,
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(91, 85, 255);
  doc.rect(0, 0, pageWidth, 56, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(input.title, margin, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(input.periodLabel, margin, 50);

  const layout = input.dashboardLayout;
  const kpis = layout?.orgKpis;
  if (!kpis) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(12);
    doc.text("Dashboard snapshot unavailable for this run.", margin, 90);
    return;
  }

  const cards: Array<{ label: string; value: string }> = [
    { label: "Handled", value: String(kpis.handled ?? 0) },
    { label: "Resolution %", value: `${kpis.resolutionRate ?? 0}%` },
    { label: "SLA %", value: `${kpis.slaRate ?? 0}%` },
    { label: "Avg handle (s)", value: kpis.avgHandleSeconds == null ? "—" : String(kpis.avgHandleSeconds) },
  ];

  const cardWidth = (pageWidth - margin * 2 - 36) / 4;
  let x = margin;
  const y = 78;
  for (const card of cards) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardWidth, 64, 6, 6, "FD");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text(card.label, x + 10, y + 18);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(card.value, x + 10, y + 40);
    doc.setFont("helvetica", "normal");
    x += cardWidth + 12;
  }
}

function renderSummaryPage(
  doc: jsPDF,
  input: Pick<
    BuildScheduledReportPdfInput,
    "summaryText" | "highlights" | "improvementSuggestions" | "periodLabel"
  >,
  margin: number,
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = margin + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(23, 23, 23);
  doc.text("Executive summary", margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(31, 41, 55);

  const summary =
    input.summaryText?.trim() ||
    `Performance report for ${input.periodLabel}. Review agent metrics and presence on the prior pages.`;
  const summaryLines = doc.splitTextToSize(summary, pageWidth - margin * 2);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 12 + 12;

  if (input.highlights?.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Highlights", margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const highlight of input.highlights) {
      const lines = doc.splitTextToSize(`• ${highlight}`, pageWidth - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 12 + 4;
    }
    y += 8;
  }

  if (input.improvementSuggestions?.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Improvement suggestions", margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const suggestion of input.improvementSuggestions) {
      const lines = doc.splitTextToSize(`• ${suggestion}`, pageWidth - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 12 + 4;
    }
  }
}

export function buildScheduledReportPdfBuffer(input: BuildScheduledReportPdfInput): Buffer {
  const tableMargin = 36;
  let doc: jsPDF | null = null;
  let pageCount = 0;

  const createDoc = (format: "landscape-a4" | [number, number] = "landscape-a4") => {
    doc =
      format === "landscape-a4"
        ? new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
        : new jsPDF({
            unit: "pt",
            format,
            orientation: format[1] >= format[0] ? "portrait" : "landscape",
          });
    pageCount = 1;
    return doc;
  };

  const addTablePage = () => {
    if (!doc) return createDoc();
    doc.addPage("a4", "landscape");
    pageCount += 1;
    return doc;
  };

  if (input.sections.dashboardKpis) {
    if (input.dashboardImagePng && input.dashboardImagePng.length > 0) {
      const image = readDashboardImage(input.dashboardImagePng);
      const pdf = createDoc(dashboardCapturePageFormat(image.width, image.height));
      addDashboardImageFitToPage(
        pdf,
        imageBufferToDataUrl(input.dashboardImagePng, image.mimeType),
        image.width,
        image.height,
        DASHBOARD_CAPTURE_PAGE_MARGIN_PT,
        image.format,
      );
    } else {
      renderDashboardPlaceholderPage(createDoc(), input, tableMargin);
    }

    const kpiSection = firstCsvSection(input.kpiCsvText);
    if (kpiSection) {
      renderTablePage(addTablePage(), kpiSection, tableMargin);
    }
  }

  if (input.sections.agentTable) {
    const agentSection = firstCsvSection(input.agentCsvText);
    if (agentSection) {
      renderTablePage(addTablePage(), agentSection, tableMargin);
    }
  }

  if (
    input.sections.aiSummary &&
    (input.summaryText ||
      (input.highlights?.length ?? 0) > 0 ||
      (input.improvementSuggestions?.length ?? 0) > 0)
  ) {
    renderSummaryPage(addTablePage(), input, tableMargin);
  }

  if (!doc || pageCount === 0) {
    const pdf = createDoc();
    pdf.setFontSize(12);
    pdf.text("No report sections were included.", tableMargin, tableMargin + 10);
  }

  return Buffer.from(doc!.output("arraybuffer"));
}

/** @deprecated Use buildScheduledReportPdfBuffer */
export function buildDashboardPdfBuffer(input: BuildDashboardPdfInput): Buffer {
  const sections = parseCsvTableSections(input.csvReportText);
  const kpiCsvText = sections[0]
    ? [
        sections[0].title,
        sections[0].headers.join(","),
        ...sections[0].rows.map((row) => row.join(",")),
        "",
      ].join("\n")
    : "";
  const agentSection = sections[1];
  const agentCsvText =
    agentSection
      ? [
          agentSection.title,
          agentSection.headers.join(","),
          ...agentSection.rows.map((row) => row.join(",")),
          "",
        ].join("\n")
      : "";

  return buildScheduledReportPdfBuffer({
    title: "Scheduled report",
    periodLabel: "Report period",
    sections: {
      dashboardKpis: Boolean(kpiCsvText),
      agentTable: Boolean(agentCsvText),
      aiSummary: Boolean(input.summaryText || input.highlights?.length),
    },
    dashboardImagePng: input.dashboardImagePng,
    kpiCsvText,
    agentCsvText,
    summaryText: input.summaryText,
    highlights: input.highlights,
  });
}

export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ?? 0;
}
