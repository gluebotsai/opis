import type { CSSProperties, ReactNode } from "react";

type RowsValue = number | string | undefined;

function rowsStyle(rows: RowsValue): CSSProperties | undefined {
  if (rows == null) return undefined;
  if (typeof rows === "number") {
    return { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
  }
  return { gridTemplateRows: rows };
}

export function SkeletonGrid({
  columns,
  rows,
  children,
  className = "",
}: {
  columns: string;
  rows?: number | string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-4 ${columns} ${className}`.trim()} style={rowsStyle(rows)}>
      {children}
    </div>
  );
}
