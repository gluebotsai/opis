import { useState } from "react";
import { AnalyticsDataTable } from "@/components/analytics/AnalyticsDataTable";
import { AnalyticsPlotCard } from "@/components/analytics/AnalyticsPlotCard";
import { resolveAnalyticsVisual } from "@/components/analytics/derive-visual";
import { chartPointsFromVisual } from "@/components/analytics/visual-to-plot";
import type { AnalyticsVisual as AnalyticsVisualPayload, StructuredAnalytics } from "@/services/agent-stream";

function cellText(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "—";
}

const RAW_ID_VALUE =
  /^(?:cm[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function isIdColumn(
  column: { key: string; label: string },
  rows: Array<Record<string, unknown>>,
): boolean {
  const key = column.key.trim();
  const label = column.label.trim();
  if (/^(?:id|.*(?:_id|Id))$/.test(key) || /^id$/i.test(key)) return true;
  if (/^(?:id|.*\sid)$/i.test(label)) return true;
  const values = rows
    .map((row) => String(row[column.key] ?? "").trim())
    .filter(Boolean);
  return values.length > 0 && values.every((value) => RAW_ID_VALUE.test(value));
}

const CHAT_TABLE_PAGE_SIZE = 10;

function ChatAnalyticsTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}) {
  const visibleColumns = columns.filter((column) => !isIdColumn(column, rows));
  const [page, setPage] = useState(0);
  if (visibleColumns.length === 0) return null;
  const pageCount = Math.max(1, Math.ceil(rows.length / CHAT_TABLE_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * CHAT_TABLE_PAGE_SIZE;
  const pageRows = rows.slice(start, start + CHAT_TABLE_PAGE_SIZE);
  return (
    <div className="assistant-message-html max-w-full">
      {title.trim() ? <p>{title}</p> : null}
      <div className="assistant-table-wrap">
        <table>
          <thead>
            <tr>
              {visibleColumns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => (
              <tr key={start + index}>
                {visibleColumns.map((col) => (
                  <td key={col.key}>{cellText(row[col.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > CHAT_TABLE_PAGE_SIZE ? (
        <div className="mt-2 flex items-center justify-between gap-3 text-[13px] text-[#525252]">
          <span>
            {start + 1}–{start + pageRows.length} of {rows.length}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className="rounded-full border border-[#bfbfbf] bg-white px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              className="rounded-full border border-[#bfbfbf] bg-white px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AnalyticsVisualCard({
  visual,
  presentation,
}: {
  visual: AnalyticsVisualPayload;
  presentation?: "chat";
}) {
  if (visual.kind === "kpi") {
    return (
      <AnalyticsPlotCard
        title={visual.title}
        description={visual.description}
        kind="kpi"
        kpis={visual.kpis ?? []}
      />
    );
  }

  if (visual.kind === "bar" || visual.kind === "line" || visual.kind === "pie") {
    const points = chartPointsFromVisual(visual);
    if (points.length === 0) return null;
    return (
      <AnalyticsPlotCard
        title={visual.title}
        description={visual.description}
        kind={visual.kind}
        points={points}
      />
    );
  }

  if (presentation === "chat") {
    return (
      <ChatAnalyticsTable
        title={visual.title}
        columns={visual.table?.columns ?? []}
        rows={visual.table?.rows ?? []}
      />
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-2xs">
      <AnalyticsDataTable
        title={visual.title}
        columns={visual.table?.columns ?? []}
        rows={visual.table?.rows ?? []}
        embedded
      />
    </div>
  );
}

export function AnalyticsVisual({
  analytics,
  presentation,
}: {
  analytics: StructuredAnalytics;
  presentation?: "chat";
}) {
  const visuals = (analytics.visuals ?? []).filter(
    (item) => item?.version === "1.0" && item.kind,
  );
  if (visuals.length > 1) {
    return (
      <div className="flex flex-col gap-3">
        {visuals.map((visual, index) => (
          <AnalyticsVisualCard
            key={`${visual.kind}-${visual.title}-${index}`}
            visual={visual}
            presentation={presentation}
          />
        ))}
      </div>
    );
  }

  const visual = resolveAnalyticsVisual(analytics);
  if (!visual) return null;
  return <AnalyticsVisualCard visual={visual} presentation={presentation} />;
}
