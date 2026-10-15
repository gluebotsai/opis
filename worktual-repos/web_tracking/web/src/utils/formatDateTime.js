const CLICKHOUSE_DATETIME =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:\s*UTC)?$/;

function hasExplicitTimezone(value) {
  return /Z$|[+-]\d{2}:\d{2}$/.test(value);
}

/** Parse API / ClickHouse datetimes (stored UTC) for display in local time. */
export function parseApiDateTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (text.includes('T') && hasExplicitTimezone(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const match = CLICKHOUSE_DATETIME.exec(text);
  if (match) {
    const [, date, time, fraction] = match;
    const ms = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
    const parsed = new Date(`${date}T${time}${ms}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (text.includes('T') && !hasExplicitTimezone(text)) {
    const parsed = new Date(`${text}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Never show activity timestamps ahead of the viewer's clock (server/client skew). */
export function capToViewerNow(date) {
  if (!date || Number.isNaN(date.getTime())) return date;
  const nowMs = Date.now();
  if (date.getTime() <= nowMs) return date;
  return new Date(nowMs);
}

/** Parse API datetime (ISO UTC) and format in the user's local timezone. */
export function formatLocalDateTime(value) {
  const date = capToViewerNow(parseApiDateTime(value));
  if (!date) return '—';
  return date.toLocaleString();
}
