import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  CopilotWorkspace,
  PanelExpandButton,
} from "@/components/assistant/copilot-workspace";
import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { DashboardOverviewPanel } from "@/components/dashboard/dashboard-overview-panel";
import { DashboardViewToggle } from "@/components/dashboard/dashboard-view-toggle";
import { PerformanceDateRangeControl } from "@/components/performance/performance-date-range-control";
import { PerformanceExportMenu } from "@/components/performance/performance-export-menu";
import {
  PerformanceExportPreviewDialog,
  type ExportPreviewFormat,
} from "@/components/performance/performance-export-preview-dialog";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { dashboardApi, type DashboardOverview } from "@/features/dashboard/api";
import { dashboardExportFilename } from "@/features/dashboard/dashboard-export";
import type { PerformancePeriodSelection } from "@/features/performance/api";
import {
  buildDashboardPdfBlob,
  captureElementAsPng,
  downloadCsvText,
  downloadDataUrlAsPng,
  downloadPdfBlob,
} from "@/features/performance/performance-export";
import {
  DASHBOARD_SET_SELECTION_EVENT,
  SCHEDULED_REPORT_CAPTURE_REQUEST,
  SCHEDULED_REPORT_CAPTURE_RESPONSE,
  scheduledReportPeriodToSelection,
} from "@/features/reports/dashboard-capture";
import { useAuth } from "@/hooks/use-auth";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";

/** Soft live refresh for Dashboard Reports only (no skeleton flash). */
const DASHBOARD_POLL_MS = 10_000;

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { setPerformancePeriod } = useCopilotPage();
  const [expandedSide, setExpandedSide] = useState<"left" | "right">("right");
  const [selection, setSelection] = useState<PerformancePeriodSelection>({
    mode: "preset",
    range: "30d",
  });
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"png" | "csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFormat, setPreviewFormat] = useState<ExportPreviewFormat>("png");
  const [previewStatus, setPreviewStatus] = useState<"capturing" | "ready" | "error">("capturing");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewCsvText, setPreviewCsvText] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [, setScheduleMode] = useState<"create" | "manage" | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const inflightRef = useRef(false);
  const requestIdRef = useRef(0);
  const overviewRef = useRef<DashboardOverview | null>(null);
  const selectionRef = useRef(selection);
  const exportingRef = useRef(exporting);
  const previewOpenRef = useRef(previewOpen);

  overviewRef.current = overview;
  selectionRef.current = selection;
  exportingRef.current = exporting;
  previewOpenRef.current = previewOpen;

  useEffect(() => {
    if (selection.mode === "preset") {
      setPerformancePeriod({ range: selection.range });
    } else {
      setPerformancePeriod({ start: selection.start, end: selection.end });
    }
    return () => setPerformancePeriod(undefined);
  }, [selection, setPerformancePeriod]);

  const load = useCallback(async (mode: "initial" | "refresh" | "period" = "refresh") => {
    // Soft polls skip while a request is already in flight; period/initial always supersede.
    if (mode === "refresh" && inflightRef.current) return;
    const requestId = ++requestIdRef.current;
    inflightRef.current = true;
    if (mode === "initial") setLoading(true);
    try {
      const result = await dashboardApi.getOverview(selectionRef.current);
      if (requestId !== requestIdRef.current) return;
      setOverview(result);
      setError(null);
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard");
      // Keep prior overview on soft refresh so the panel does not blank or flash skeleton.
    } finally {
      if (requestId === requestIdRef.current) {
        inflightRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(overviewRef.current ? "period" : "initial");
  }, [selection, load]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (exportingRef.current || previewOpenRef.current) return;
      void load("refresh");
    }, DASHBOARD_POLL_MS);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    function onSetSelection(event: Event) {
      const detail = (event as CustomEvent<PerformancePeriodSelection>).detail;
      if (!detail) return;
      setSelection(detail);
    }

    async function onCaptureRequest(event: Event) {
      const detail = (
        event as CustomEvent<{
          requestId: string;
          period: "yesterday" | "7d" | "30d";
          timeZone: string;
        }>
      ).detail;
      const element = exportRef.current;
      const previousSelection = selectionRef.current;

      const respond = (png: string | null) => {
        window.dispatchEvent(
          new CustomEvent(SCHEDULED_REPORT_CAPTURE_RESPONSE, {
            detail: { requestId: detail.requestId, png },
          }),
        );
      };

      if (!element) {
        respond(null);
        return;
      }

      try {
        setSelection(scheduledReportPeriodToSelection(detail.period, detail.timeZone));
        await new Promise<void>((resolve) => {
          const startedAt = Date.now();
          const wait = () => {
            if (!inflightRef.current && overviewRef.current) {
              resolve();
              return;
            }
            if (Date.now() - startedAt > 15_000) {
              resolve();
              return;
            }
            window.setTimeout(wait, 150);
          };
          wait();
        });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
        const png = await captureElementAsPng(element);
        respond(png);
      } catch {
        respond(null);
      } finally {
        setSelection(previousSelection);
      }
    }

    window.addEventListener(DASHBOARD_SET_SELECTION_EVENT, onSetSelection);
    window.addEventListener(SCHEDULED_REPORT_CAPTURE_REQUEST, onCaptureRequest);
    return () => {
      window.removeEventListener(DASHBOARD_SET_SELECTION_EVENT, onSetSelection);
      window.removeEventListener(SCHEDULED_REPORT_CAPTURE_REQUEST, onCaptureRequest);
    };
  }, []);

  const periodLabel = useMemo(() => {
    if (!overview) return "";
    const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    return `${formatter.format(new Date(overview.period.start))} – ${formatter.format(
      new Date(overview.period.end),
    )}`;
  }, [overview]);

  async function openPngPreview() {
    const element = exportRef.current;
    if (!element || !overview) return;

    setPreviewFormat("png");
    setPreviewOpen(true);
    setPreviewFilename(dashboardExportFilename(selection, "png"));
    setPreviewError(null);
    if (previewImageUrl) {
      setPreviewStatus("ready");
      return;
    }

    setPreviewStatus("capturing");
    try {
      setExporting("png");
      const dataUrl = await captureElementAsPng(element);
      setPreviewImageUrl(dataUrl);
      setPreviewStatus("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to generate PNG preview";
      setPreviewStatus("error");
      setPreviewError(message);
      setError(message);
    } finally {
      setExporting(null);
    }
  }

  async function openCsvPreview() {
    if (!overview) return;

    setPreviewFormat("csv");
    setPreviewOpen(true);
    setPreviewFilename(dashboardExportFilename(selection, "csv"));
    setPreviewError(null);
    if (previewCsvText) {
      setPreviewStatus("ready");
      return;
    }

    setPreviewStatus("capturing");
    try {
      setExporting("csv");
      const report = await dashboardApi.fetchReportCsv(selection);
      setPreviewCsvText(report.text);
      setPreviewFilename(report.filename);
      setPreviewStatus("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to generate CSV preview";
      setPreviewStatus("error");
      setPreviewError(message);
      setError(message);
    } finally {
      setExporting(null);
    }
  }

  async function openPdfPreview() {
    const element = exportRef.current;
    if (!element || !overview) return;

    setPreviewFormat("pdf");
    setPreviewOpen(true);
    setPreviewFilename(dashboardExportFilename(selection, "pdf"));
    setPreviewError(null);
    if (previewImageUrl && previewCsvText) {
      setPreviewStatus("ready");
      return;
    }

    setPreviewStatus("capturing");
    try {
      setExporting("pdf");
      const [dataUrl, report] = await Promise.all([
        previewImageUrl
          ? Promise.resolve(previewImageUrl)
          : captureElementAsPng(element),
        previewCsvText
          ? Promise.resolve({ text: previewCsvText, filename: previewFilename })
          : dashboardApi.fetchReportCsv(selection),
      ]);
      setPreviewImageUrl(dataUrl);
      setPreviewCsvText(report.text);
      setPreviewStatus("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to generate PDF preview";
      setPreviewStatus("error");
      setPreviewError(message);
      setError(message);
    } finally {
      setExporting(null);
    }
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewStatus("capturing");
    setPreviewImageUrl(null);
    setPreviewCsvText(null);
    setPreviewError(null);
  }

  async function savePreview() {
    if (previewFormat === "csv") {
      if (!previewCsvText) return;
      downloadCsvText(previewCsvText, previewFilename);
      closePreview();
      return;
    }
    if (previewFormat === "pdf") {
      if (!previewImageUrl || !previewCsvText) return;
      const blob = await buildDashboardPdfBlob(previewImageUrl, previewCsvText);
      downloadPdfBlob(blob, previewFilename);
      closePreview();
      return;
    }
    if (!previewImageUrl) return;
    downloadDataUrlAsPng(previewImageUrl, previewFilename);
    closePreview();
  }

  return (
    <>
      <CopilotWorkspace
      title="Dashboard"
      subtitle={`Welcome, ${user?.name ?? "there"}. Review queue performance, agent availability, and operational insights.`}
      expandedSide={expandedSide}
      onExpandedSideChange={setExpandedSide}
      copilot={
        <EmbeddedCopilotPanel
          onOpenQueue={(queueId) => navigate(`/admin/workforce/queues?queue=${queueId}`)}
        />
      }
    >
      <div
        ref={exportRef}
        data-performance-export-root="true"
        className={contentPanelClassName}
      >
        <div
          data-export-header
          className={`relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 py-3 ${contentPanelHeaderBorderClassName}`}
        >
          <div className="hidden min-w-0 xl:block">
            <p className="text-[18px] font-semibold text-neutral-900">Reports</p>
            <p className="mt-0.5 text-sm text-neutral-600">
              {loading && !overview ? (
                <span className="inline-block h-3 w-28 animate-pulse rounded bg-neutral-200 align-middle" />
              ) : (
                periodLabel || "Organization-wide contact center results"
              )}
            </p>
          </div>
          <div data-export-ignore="true" className="flex min-w-0 w-full flex-nowrap items-center gap-2 overflow-x-auto xl:w-auto">
            <DashboardViewToggle active="reports" />
            <PerformanceDateRangeControl selection={selection} onChange={setSelection} />
            <PerformanceExportMenu
              disabled={!overview}
              exporting={exporting}
              ariaLabel="Report actions"
              enableScheduleUi
              onScheduleModeChange={setScheduleMode}
              onDownloadReport={() => void openPngPreview()}
            />
            <PanelExpandButton side="right" />
          </div>
        </div>

        <PanelScrollArea className="px-4 py-4">
          <DashboardOverviewPanel
            overview={overview}
            loading={loading && !overview}
            error={overview ? null : error}
          />
        </PanelScrollArea>
      </div>
    </CopilotWorkspace>

      <PerformanceExportPreviewDialog
        open={previewOpen}
        format={previewFormat}
        status={previewStatus}
        imageUrl={previewImageUrl}
        csvText={previewCsvText}
        filename={previewFilename}
        error={previewError}
        onFormatChange={(format) => {
          if (format === "png") void openPngPreview();
          else if (format === "csv") void openCsvPreview();
          else void openPdfPreview();
        }}
        onClose={closePreview}
        onSave={savePreview}
      />
    </>
  );
}
