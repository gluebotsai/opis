import { buildScheduledReportPdfBuffer } from "./build-dashboard-pdf.js";
import type { DashboardReportLayoutInput } from "./dashboard-report-layout.js";
import type { ReportIncludedSections, ReportWindow } from "./scheduled-reports.js";

export type ReportComposerInput = {
  title: string;
  periodLabel: string;
  exportedAt?: Date;
  sections: ReportIncludedSections;
  window: ReportWindow;
  dashboardLayout?: DashboardReportLayoutInput;
  kpiCsvText?: string;
  agentCsvText?: string;
  summaryText?: string | null;
  highlights?: string[];
  improvementSuggestions?: string[];
  dashboardImagePng?: Buffer | null;
};

function ensureSectionSelected(sections: ReportIncludedSections): void {
  if (!sections.dashboardKpis && !sections.agentTable && !sections.aiSummary) {
    throw new Error("At least one report section must be selected");
  }
}

export async function composeScheduledReportPdf(input: ReportComposerInput): Promise<Buffer> {
  ensureSectionSelected(input.sections);

  return buildScheduledReportPdfBuffer({
    title: input.title,
    periodLabel: input.periodLabel,
    sections: input.sections,
    dashboardImagePng: input.dashboardImagePng,
    dashboardLayout: input.dashboardLayout,
    kpiCsvText: input.kpiCsvText,
    agentCsvText: input.agentCsvText,
    summaryText: input.sections.aiSummary ? input.summaryText : null,
    highlights: input.sections.aiSummary ? input.highlights : [],
    improvementSuggestions: input.sections.aiSummary ? input.improvementSuggestions : [],
  });
}

export function extractPdfTextForTest(buffer: Buffer): string {
  return buffer.toString("latin1");
}
