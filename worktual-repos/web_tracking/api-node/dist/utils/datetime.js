const CLICKHOUSE_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:\s*UTC)?$/;
const DATETIME_FIELD = /(_at|_seen|last_activity|timestamp|started|ended)$/i;
function hasExplicitTimezone(value) {
    return /Z$|[+-]\d{2}:\d{2}$/.test(value);
}
function capIsoToApiNow(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms))
        return iso;
    const nowMs = Date.now();
    if (ms <= nowMs)
        return iso;
    return new Date(nowMs).toISOString();
}
/** ClickHouse DateTime64 values are UTC but often serialize without a timezone suffix. */
export function clickHouseUtcToIso(value) {
    if (value == null || value === "")
        return value;
    if (value instanceof Date)
        return capIsoToApiNow(value.toISOString());
    if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value > 1e12 ? value : value * 1000;
        return capIsoToApiNow(new Date(ms).toISOString());
    }
    const text = String(value).trim();
    if (!text)
        return value;
    if (text.includes("T") && hasExplicitTimezone(text)) {
        return capIsoToApiNow(new Date(text).toISOString());
    }
    const match = CLICKHOUSE_DATETIME.exec(text);
    if (match) {
        const [, date, time, fraction] = match;
        const ms = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : "";
        return capIsoToApiNow(new Date(`${date}T${time}${ms}Z`).toISOString());
    }
    if (text.includes("T") && !hasExplicitTimezone(text)) {
        return capIsoToApiNow(new Date(`${text}Z`).toISOString());
    }
    return value;
}
function shouldNormalizeDateField(key) {
    return DATETIME_FIELD.test(key);
}
export function normalizeRowDatetimes(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = shouldNormalizeDateField(key) ? clickHouseUtcToIso(value) : value;
    }
    return out;
}
export function normalizeRowsDatetimes(rows) {
    return rows.map(normalizeRowDatetimes);
}
