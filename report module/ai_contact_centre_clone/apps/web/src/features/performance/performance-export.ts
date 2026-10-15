type LayoutSnapshot = {
  element: HTMLElement;
  overflow: string;
  overflowY: string;
  overflowX: string;
  height: string;
  maxHeight: string;
  minHeight: string;
  flex: string;
};

type ExportRootSnapshot = LayoutSnapshot & {
  width: string;
  minWidth: string;
  borderRadius: string;
  className: string;
};

type DownloadPngOptions = {
  filter?: (node: HTMLElement) => boolean;
  exportWidth?: number;
};

function shouldExpandLayout(element: HTMLElement): boolean {
  const computed = getComputedStyle(element);
  return (
    computed.overflow !== "visible" ||
    computed.overflowY !== "visible" ||
    computed.overflowX !== "visible" ||
    computed.maxHeight !== "none" ||
    element.classList.contains("min-h-0") ||
    element.classList.contains("panel-scroll-native") ||
    element.classList.contains("overflow-hidden")
  );
}

function snapshotLayout(element: HTMLElement): LayoutSnapshot {
  return {
    element,
    overflow: element.style.overflow,
    overflowY: element.style.overflowY,
    overflowX: element.style.overflowX,
    height: element.style.height,
    maxHeight: element.style.maxHeight,
    minHeight: element.style.minHeight,
    flex: element.style.flex,
  };
}

function expandLayout(element: HTMLElement) {
  element.style.overflow = "visible";
  element.style.overflowY = "visible";
  element.style.overflowX = "visible";
  element.style.maxHeight = "none";
  element.style.minHeight = "auto";
  element.style.height = "auto";
  element.style.flex = "none";
}

function restoreLayout(snapshots: LayoutSnapshot[]) {
  for (const snapshot of snapshots) {
    snapshot.element.style.overflow = snapshot.overflow;
    snapshot.element.style.overflowY = snapshot.overflowY;
    snapshot.element.style.overflowX = snapshot.overflowX;
    snapshot.element.style.height = snapshot.height;
    snapshot.element.style.maxHeight = snapshot.maxHeight;
    snapshot.element.style.minHeight = snapshot.minHeight;
    snapshot.element.style.flex = snapshot.flex;
  }
}

function resolveExportWidth(element: HTMLElement, exportWidth?: number) {
  if (exportWidth) return exportWidth;
  const panelWidth = element.getBoundingClientRect().width;
  return Math.max(1100, Math.round(panelWidth));
}

function applyExportPresentation(element: HTMLElement, exportWidth: number): ExportRootSnapshot {
  const snapshot: ExportRootSnapshot = {
    ...snapshotLayout(element),
    width: element.style.width,
    minWidth: element.style.minWidth,
    borderRadius: element.style.borderRadius,
    className: element.className,
  };

  element.classList.add("performance-export-capture");
  element.style.width = `${exportWidth}px`;
  element.style.minWidth = `${exportWidth}px`;
  element.style.borderRadius = "0";
  expandLayout(element);

  return snapshot;
}

function restoreExportPresentation(snapshot: ExportRootSnapshot) {
  snapshot.element.className = snapshot.className;
  snapshot.element.style.width = snapshot.width;
  snapshot.element.style.minWidth = snapshot.minWidth;
  snapshot.element.style.borderRadius = snapshot.borderRadius;
  restoreLayout([snapshot]);
}

function collectLayoutNodes(root: HTMLElement): LayoutSnapshot[] {
  const snapshots: LayoutSnapshot[] = [];

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (shouldExpandLayout(element)) {
      snapshots.push(snapshotLayout(element));
      expandLayout(element);
    }
  }

  return snapshots;
}

function scrollContainersToTop(element: HTMLElement) {
  let current: HTMLElement | null = element;

  while (current) {
    current.scrollTop = 0;
    current.scrollLeft = 0;
    if (current.dataset.performanceExportRoot === "true") {
      break;
    }
    current = current.parentElement;
  }
}

async function waitForLayout() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function measureExportDimensions(element: HTMLElement, exportWidth: number) {
  const body = element.querySelector<HTMLElement>("[data-export-body]");
  if (!body) {
    return {
      width: Math.ceil(element.scrollWidth || element.clientWidth || exportWidth),
      height: Math.ceil(element.scrollHeight || element.clientHeight),
    };
  }

  const rootTop = element.getBoundingClientRect().top;
  const recent = element.querySelector<HTMLElement>("[data-export-recent]");
  const bottomElement = recent ?? body;
  const bottom = bottomElement.getBoundingClientRect().bottom;

  return {
    width: Math.max(
      exportWidth,
      Math.ceil(body.scrollWidth || body.getBoundingClientRect().width),
    ),
    height: Math.ceil(bottom - rootTop + 24),
  };
}

async function renderElementAsPng(
  element: HTMLElement,
  options?: DownloadPngOptions,
): Promise<string> {
  const { toPng } = await import("html-to-image");
  const exportWidth = resolveExportWidth(element, options?.exportWidth);
  const rootSnapshot = applyExportPresentation(element, exportWidth);
  const layoutSnapshots = collectLayoutNodes(element);

  scrollContainersToTop(element);
  await waitForLayout();

  try {
    const { width, height } = measureExportDimensions(element, exportWidth);

    return await toPng(element, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
      width,
      height,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) {
          return true;
        }
        if (node.dataset.exportIgnore === "true") {
          return false;
        }
        return options?.filter ? options.filter(node) : true;
      },
    });
  } finally {
    restoreLayout(layoutSnapshots);
    restoreExportPresentation(rootSnapshot);
  }
}

export async function captureElementAsPng(
  element: HTMLElement,
  options?: DownloadPngOptions,
): Promise<string> {
  return renderElementAsPng(element, options);
}

export function downloadDataUrlAsPng(dataUrl: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadElementAsPng(
  element: HTMLElement,
  filename: string,
  options?: DownloadPngOptions,
) {
  const dataUrl = await renderElementAsPng(element, options);
  downloadDataUrlAsPng(dataUrl, filename);
}

export function performanceExportFilename(
  selection: { mode: "preset"; range: string } | { mode: "custom"; start: string; end: string },
  extension: "png" | "csv" | "pdf",
  exportedAt = new Date(),
) {
  const suffix =
    selection.mode === "preset"
      ? selection.range
      : `${selection.start}_${selection.end}`;
  const stamp = exportedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `my-performance-${suffix}-${stamp}.${extension}`;
}

export function filenameFromContentDisposition(
  disposition: string | undefined,
  fallback: string,
): string {
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

export type CsvPreviewRow = {
  cells: string[];
  kind: "section" | "header" | "data";
};

export function parseCsvPreview(text: string, maxRows = 250): CsvPreviewRow[] {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/);
  const rows: CsvPreviewRow[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const nonEmptyCells = cells.filter((cell) => cell.length > 0);

    let kind: CsvPreviewRow["kind"] = "data";
    if (nonEmptyCells.length === 1) {
      kind = "section";
    } else if (
      rows.length === 0 ||
      rows[rows.length - 1]?.kind === "section" ||
      (cells.length >= 2 && cells[0] === "Metric")
    ) {
      kind = "header";
    }

    rows.push({ cells, kind });
    if (rows.length >= maxRows) break;
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

export function downloadCsvText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export type CsvTableSection = {
  title: string;
  headers: string[];
  rows: string[][];
};

export function parseCsvTableSections(text: string): CsvTableSection[] {
  const parsed = parseCsvPreview(text, 10_000);
  const sections: CsvTableSection[] = [];
  let current: CsvTableSection | null = null;

  for (const row of parsed) {
    if (row.kind === "section") {
      if (current && (current.headers.length > 0 || current.rows.length > 0)) {
        sections.push(current);
      }
      current = { title: row.cells[0] ?? "Report", headers: [], rows: [] };
      continue;
    }

    if (!current) {
      current = { title: "Report", headers: [], rows: [] };
    }

    if (row.kind === "header") {
      current.headers = row.cells;
      continue;
    }

    current.rows.push(row.cells);
  }

  if (current && (current.headers.length > 0 || current.rows.length > 0)) {
    sections.push(current);
  }

  return sections;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load report image"));
    image.src = src;
  });
}

function dashboardCapturePageFormat(
  naturalWidth: number,
  naturalHeight: number,
  margin = 18,
): [number, number] {
  const width = 595.28;
  const usableWidth = width - margin * 2;
  const height = naturalHeight * (usableWidth / naturalWidth) + margin * 2;
  return [width, height];
}

export async function buildDashboardPdfBlob(imageDataUrl: string, csvText: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const image = await loadImage(imageDataUrl);
  const captureMargin = 18;
  const pageFormat = dashboardCapturePageFormat(image.naturalWidth, image.naturalHeight, captureMargin);
  const doc = new jsPDF({
    unit: "pt",
    format: pageFormat,
    orientation: pageFormat[1] >= pageFormat[0] ? "portrait" : "landscape",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - captureMargin * 2;
  const maxHeight = pageHeight - captureMargin * 2;
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = captureMargin + (maxWidth - drawWidth) / 2;
  const y = captureMargin + (maxHeight - drawHeight) / 2;
  doc.addImage(imageDataUrl, "PNG", x, y, drawWidth, drawHeight, undefined, "FAST");

  const tableMargin = 36;
  const sections = parseCsvTableSections(csvText);
  for (const section of sections) {
    doc.addPage("a4", "landscape");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(23, 23, 23);
    doc.text(section.title, tableMargin, tableMargin + 10);

    autoTable(doc, {
      startY: tableMargin + 22,
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
      margin: { left: tableMargin, right: tableMargin },
    });
  }

  return doc.output("blob");
}

export function downloadPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadDashboardPdf(
  imageDataUrl: string,
  csvText: string,
  filename: string,
) {
  const blob = await buildDashboardPdfBlob(imageDataUrl, csvText);
  downloadPdfBlob(blob, filename);
}
