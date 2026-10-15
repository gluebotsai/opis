export function AnalyticsDataTable({
  title,
  columns,
  rows,
  summary,
  embedded = false,
}: {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  summary?: string;
  embedded?: boolean;
}) {
  if (columns.length === 0 && !summary?.trim()) return null;

  const shellClass = embedded
    ? ""
    : "mt-2 w-full border-t border-neutral-200/80 pt-2";

  return (
    <div className={shellClass}>
      {!embedded ? (
        <p className="text-xs font-medium uppercase tracking-wide text-text-caption">{title}</p>
      ) : (
        <p className="text-sm font-semibold text-neutral-900">{title}</p>
      )}
      {summary?.trim() ? (
        <p className={`text-sm text-text-secondary ${embedded ? "mt-1" : "mt-1.5"}`}>{summary}</p>
      ) : null}
      {columns.length > 0 ? (
        <div
          className={`max-h-48 overflow-auto rounded-lg border border-border-default bg-white ${
            embedded ? "mt-3" : "mt-2"
          }`}
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default text-left text-text-caption">
                {columns.map((col) => (
                  <th key={col.key} className="px-2 py-1.5 font-medium">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row, idx) => (
                <tr key={idx} className="border-b border-border-default/60">
                  {columns.map((col) => (
                    <td key={col.key} className="px-2 py-1.5 text-text-secondary">
                      {String(row[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
