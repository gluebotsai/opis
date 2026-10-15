import type { jsPDF } from "jspdf";

/** A4 portrait width in pt — dashboard captures are tall, so page 1 follows the PNG. */
export const DASHBOARD_CAPTURE_PAGE_WIDTH_PT = 595.28;
export const DASHBOARD_CAPTURE_PAGE_MARGIN_PT = 8;

/** Page size that keeps the Reports download PNG readable instead of shrinking it onto landscape A4. */
export function dashboardCapturePageFormat(
  naturalWidth: number,
  naturalHeight: number,
  margin = DASHBOARD_CAPTURE_PAGE_MARGIN_PT,
): [number, number] {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("Invalid dashboard image dimensions");
  }
  const width = DASHBOARD_CAPTURE_PAGE_WIDTH_PT;
  const usableWidth = width - margin * 2;
  const height = naturalHeight * (usableWidth / naturalWidth) + margin * 2;
  return [width, height];
}

/** Scale the full dashboard capture to fit on a single PDF page. */
export function addDashboardImageFitToPage(
  doc: jsPDF,
  imageDataUrl: string,
  naturalWidth: number,
  naturalHeight: number,
  margin = DASHBOARD_CAPTURE_PAGE_MARGIN_PT,
  format: "PNG" | "JPEG" = "PNG",
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;

  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("Invalid dashboard image dimensions");
  }

  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  const x = margin + (maxWidth - drawWidth) / 2;
  const y = margin + (maxHeight - drawHeight) / 2;

  doc.addImage(imageDataUrl, format, x, y, drawWidth, drawHeight, undefined, "FAST");
}

/** @deprecated Use addDashboardImageFitToPage — kept for existing imports during migration. */
export const addPaginatedDashboardImage = addDashboardImageFitToPage;
