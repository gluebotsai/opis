export function buildVisitorSegments(rows) {
    const total = rows.reduce((sum, row) => sum + Number(row.visitors ?? 0), 0);
    return rows.map((row) => {
        const visitors = Number(row.visitors ?? 0);
        const percentage = total > 0 ? Math.round((visitors / total) * 1000) / 10 : 0;
        return { label: row.label, visitors, percentage };
    });
}
export function buildEventSegments(rows) {
    const total = rows.reduce((sum, row) => sum + Number(row.events ?? 0), 0);
    return rows.map((row) => {
        const events = Number(row.events ?? 0);
        const percentage = total > 0 ? Math.round((events / total) * 1000) / 10 : 0;
        return { label: row.label, events, percentage };
    });
}
