import { resolveAnalyticsVisual } from "@/components/analytics/derive-visual";
import type { StructuredAnalytics } from "@/services/agent-stream";

/** Remove markdown pipe tables from assistant speech. */
export function stripMarkdownTables(text: string): string {
  const lines = (text || "").split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isTableLine =
      trimmed.startsWith("|") || /^\|?[\s|:-]+\|/.test(trimmed);
    if (isTableLine) {
      skipping = true;
      continue;
    }
    if (skipping && !trimmed) continue;
    skipping = false;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function visualShowsDataGrid(analytics: StructuredAnalytics): boolean {
  const visual = resolveAnalyticsVisual(analytics);
  if (!visual) return false;
  if (visual.kind === "table") {
    return (visual.table?.rows?.length ?? 0) > 0;
  }
  if (visual.kind === "bar" || visual.kind === "line" || visual.kind === "pie") {
    const data = visual.chart?.data;
    return Array.isArray(data) && data.length > 1;
  }
  return false;
}

/** Avoid duplicating tabular analytics in chat when the visual already shows a grid/chart. */
export function companionTextForAnalytics(
  text: string,
  analytics: StructuredAnalytics | undefined,
): string {
  const raw = (text || "").trim();
  if (!raw || !analytics || !visualShowsDataGrid(analytics)) {
    return raw;
  }
  const trimmed = stripMarkdownTables(raw);
  return trimmed || raw.split(/\n\n+/)[0]?.trim() || raw;
}
