import { useEffect, useMemo } from "react";
import { Download, LoaderCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { parseCsvPreview } from "@/features/performance/performance-export";
import { cn } from "@/lib/utils";

export type ExportPreviewFormat = "png" | "csv" | "pdf";

type PerformanceExportPreviewDialogProps = {
  open: boolean;
  format: ExportPreviewFormat;
  status: "capturing" | "ready" | "error";
  imageUrl?: string | null;
  csvText?: string | null;
  filename: string;
  error?: string | null;
  layerClassName?: string;
  disableSave?: boolean;
  allowPdf?: boolean;
  onFormatChange?: (format: ExportPreviewFormat) => void;
  onClose: () => void;
  onSave: () => void;
};

export function PerformanceExportPreviewDialog({
  open,
  format,
  status,
  imageUrl = null,
  csvText = null,
  filename,
  error = null,
  layerClassName,
  disableSave,
  allowPdf = true,
  onFormatChange,
  onClose,
  onSave,
}: PerformanceExportPreviewDialogProps) {
  const csvRows = useMemo(
    () => (csvText ? parseCsvPreview(csvText) : []),
    [csvText],
  );
  const csvColumnCount = useMemo(
    () => csvRows.reduce((max, row) => Math.max(max, row.cells.length), 0),
    [csvRows],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && status !== "capturing") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, status]);

  if (!open) return null;

  const isCsv = format === "csv";
  const isPdf = format === "pdf";
  const title = isCsv ? "CSV report preview" : isPdf ? "PDF report preview" : "Report preview";
  const loadingTitle = isCsv
    ? "Preparing your CSV report…"
    : isPdf
      ? "Preparing your PDF report…"
      : "Preparing your report image…";
  const loadingCaption = isCsv
    ? "Loading KPIs for preview."
    : isPdf
      ? "Capturing the dashboard image and KPI tables for PDF export."
      : "Capturing charts and metrics for preview.";
  const saveLabel = isCsv ? "Download CSV" : isPdf ? "Download PDF" : "Save image";
  const showFormatTabs = Boolean(onFormatChange);
  const showDialogTitle = showFormatTabs || status !== "ready" || isCsv || isPdf;
  const formatOptions = [
    { id: "png" as const, label: "Image" },
    { id: "csv" as const, label: "CSV" },
    ...(allowPdf ? [{ id: "pdf" as const, label: "PDF" }] : []),
  ];

  return (
    <div
      className={cn(
        "performance-export-preview-backdrop fixed inset-0 grid place-items-center p-4 sm:p-6",
        layerClassName ?? "z-[70]",
      )}
      role="presentation"
      onClick={status === "capturing" ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="performance-export-preview-title"
        className="performance-export-preview-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {showDialogTitle ? (
          <div className="flex items-start justify-between gap-4 border-b-[0.6px] border-[#bfbfbf] px-5 py-4">
            <div className="min-w-0">
              <h2
                id="performance-export-preview-title"
                className="text-sm font-semibold text-neutral-900"
              >
                {title}
              </h2>
              <p className="mt-0.5 truncate text-sm text-neutral-600">{filename}</p>
              {showFormatTabs ? (
                <div className="mt-3">
                  <SegmentTabs
                    value={format}
                    options={formatOptions}
                    onChange={(next) => {
                      if (status === "capturing" || next === format) return;
                      onFormatChange?.(next);
                    }}
                    fitContent
                    className="max-w-full"
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Close preview"
              disabled={status === "capturing"}
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <h2 id="performance-export-preview-title" className="sr-only">
            {title}
          </h2>
        )}

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            status === "ready" && !isCsv && !isPdf
              ? "bg-neutral-100"
              : "bg-[linear-gradient(180deg,#f8fafc_0%,#f3f4f6_100%)] p-4 sm:p-5",
          )}
        >
          {status === "capturing" ? (
            <div className="performance-export-preview-loading flex h-[min(68vh,720px)] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white/80 px-6 text-center">
              <div className="relative flex size-16 items-center justify-center">
                <span className="absolute inset-0 rounded-full border-2 border-blue-100" />
                <span className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent performance-export-preview-spinner" />
                <LoaderCircle className="relative size-7 animate-spin text-blue-600" />
              </div>
              <p className="mt-5 text-sm font-medium text-neutral-800">{loadingTitle}</p>
              <p className="mt-1 max-w-sm text-xs text-neutral-600">{loadingCaption}</p>
            </div>
          ) : status === "error" ? (
            <div className="flex h-[min(40vh,360px)] flex-col items-center justify-center rounded-xl border border-red-100 bg-red-50 px-6 text-center">
              <p className="text-sm font-medium text-red-700">Unable to generate preview</p>
              <p className="mt-1 max-w-sm text-xs text-red-600">{error ?? "Please try again."}</p>
            </div>
          ) : isPdf ? (
            <div className="flex h-[min(68vh,720px)] min-h-0 flex-col overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
              <PanelScrollArea className="performance-export-preview-stage min-h-0 flex-1">
                <div className="space-y-4 p-4">
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                      Page 1 · Dashboard
                    </p>
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="Dashboard report preview"
                        className="block h-auto w-full rounded-lg border-[0.6px] border-[#bfbfbf]"
                      />
                    ) : null}
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                      Page 2 · KPI tables
                    </p>
                    {csvRows.length === 0 ? (
                      <p className="py-6 text-center text-xs text-neutral-400">No table rows to preview</p>
                    ) : (
                      <table className="min-w-full border-collapse text-left text-sm text-neutral-700">
                        <tbody>
                          {csvRows.map((row, rowIndex) => {
                            if (row.kind === "section") {
                              return (
                                <tr key={`pdf-section-${rowIndex}`} className="bg-neutral-50">
                                  <td
                                    colSpan={Math.max(csvColumnCount, 1)}
                                    className="border-b-[0.6px] border-[#bfbfbf] px-3 py-2 font-semibold text-neutral-900"
                                  >
                                    {row.cells[0]}
                                  </td>
                                </tr>
                              );
                            }

                            return (
                              <tr
                                key={`pdf-row-${rowIndex}`}
                                className={cn(
                                  row.kind === "header"
                                    ? "bg-neutral-100/80 font-medium text-neutral-900"
                                    : "hover:bg-neutral-50/80",
                                )}
                              >
                                {Array.from({ length: csvColumnCount }, (_, cellIndex) => (
                                  <td
                                    key={`pdf-cell-${rowIndex}-${cellIndex}`}
                                    className="border-b-[0.6px] border-[#bfbfbf] px-3 py-1.5 align-top whitespace-nowrap"
                                  >
                                    {row.cells[cellIndex] ?? ""}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </PanelScrollArea>
            </div>
          ) : isCsv ? (
            <div className="flex h-[min(68vh,720px)] min-h-0 flex-col overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
              <PanelScrollArea className="performance-export-preview-stage min-h-0 flex-1">
                {csvRows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-xs text-neutral-400">No CSV rows to preview</p>
                ) : (
                  <table className="min-w-full border-collapse text-left text-sm text-neutral-700">
                    <tbody>
                      {csvRows.map((row, rowIndex) => {
                        if (row.kind === "section") {
                          return (
                            <tr key={`section-${rowIndex}`} className="bg-neutral-50">
                              <td
                                colSpan={Math.max(csvColumnCount, 1)}
                                className="border-b-[0.6px] border-[#bfbfbf] px-3 py-2 font-semibold text-neutral-900"
                              >
                                {row.cells[0]}
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={`row-${rowIndex}`}
                            className={cn(
                              row.kind === "header"
                                ? "bg-neutral-100/80 font-medium text-neutral-900"
                                : "hover:bg-neutral-50/80",
                            )}
                          >
                            {Array.from({ length: csvColumnCount }, (_, cellIndex) => (
                              <td
                                key={`cell-${rowIndex}-${cellIndex}`}
                                className="border-b-[0.6px] border-[#bfbfbf] px-3 py-1.5 align-top whitespace-nowrap"
                              >
                                {row.cells[cellIndex] ?? ""}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </PanelScrollArea>
            </div>
          ) : (
            <div className="relative flex h-[min(68vh,720px)] min-h-0 flex-col overflow-hidden">
              {showDialogTitle ? null : (
                <button
                  type="button"
                  aria-label="Close preview"
                  onClick={onClose}
                  className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg bg-white/90 text-neutral-600 hover:bg-white hover:text-neutral-800"
                >
                  <X className="size-4" />
                </button>
              )}
              <PanelScrollArea className="performance-export-preview-stage min-h-0 flex-1">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Performance report preview"
                    className="performance-export-preview-image block h-auto w-full rounded-none"
                  />
                ) : null}
              </PanelScrollArea>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t-[0.6px] border-[#bfbfbf] px-5 py-4">
          <p className="min-w-0 truncate text-sm text-neutral-600">{filename}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={status === "capturing"}>
              Cancel
            </Button>
            <Button
              onClick={onSave}
              disabled={
                status !== "ready" ||
                (disableSave !== undefined
                  ? disableSave
                  : isCsv
                    ? !csvText
                    : isPdf
                      ? !imageUrl || !csvText
                      : !imageUrl)
              }
            >
              <Download className="size-3.5" aria-hidden />
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
