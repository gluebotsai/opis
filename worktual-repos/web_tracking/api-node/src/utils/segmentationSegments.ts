export type SegmentationSegmentRow = {
  label: string;
  visitors: number;
  percentage: number;
};

export function buildVisitorSegments(
  rows: { label: string; visitors: number }[],
): SegmentationSegmentRow[] {
  const total = rows.reduce((sum, row) => sum + Number(row.visitors ?? 0), 0);
  return rows.map((row) => {
    const visitors = Number(row.visitors ?? 0);
    const percentage = total > 0 ? Math.round((visitors / total) * 1000) / 10 : 0;
    return { label: row.label, visitors, percentage };
  });
}

export function buildEventSegments(
  rows: { label: string; events: number }[],
): { label: string; events: number; percentage: number }[] {
  const total = rows.reduce((sum, row) => sum + Number(row.events ?? 0), 0);
  return rows.map((row) => {
    const events = Number(row.events ?? 0);
    const percentage = total > 0 ? Math.round((events / total) * 1000) / 10 : 0;
    return { label: row.label, events, percentage };
  });
}
