import type { PerformancePeriodSelection } from "@/features/performance/api";

export function dashboardExportFilename(
  selection: PerformancePeriodSelection,
  extension: "png" | "csv" | "pdf",
  exportedAt = new Date(),
) {
  const suffix =
    selection.mode === "preset" ? selection.range : `${selection.start}_${selection.end}`;
  const stamp = exportedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `org-dashboard-${suffix}-${stamp}.${extension}`;
}
