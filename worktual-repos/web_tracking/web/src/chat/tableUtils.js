import { formatGeoLabel, formatPagePath } from '../utils/formatDisplayLabels';

const COLUMN_LABELS = {
  visitor_id: 'Visitor ID',
  session_id: 'Session ID',
  page_path: 'Page',
  page_views: 'Page views',
  unique_visitors: 'Unique visitors',
  total_time_seconds: 'Time (sec)',
  total_time_minutes: 'Time (min)',
  first_seen_at: 'First seen',
  last_seen_at: 'Last seen',
  views: 'Views',
  sessions: 'Sessions',
  country: 'Country',
  conversions: 'Conversions',
};

export function humanizeColumn(column) {
  const key = String(column || '').toLowerCase();
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  return String(column || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isIdColumn(column) {
  const col = String(column || '').toLowerCase();
  return col === 'visitor_id'
    || col === 'session_id'
    || col === 'visitor'
    || col === 'visitor id'
    || col === 'session'
    || col === 'session id';
}

export function idCellClass(column) {
  return isIdColumn(column) ? 'cell-id' : undefined;
}

export function formatDisplayValue(column, value) {
  const col = String(column || '').toLowerCase();
  if (col === 'page_path' || col === 'page path') {
    return formatPagePath(value);
  }
  if (col === 'city' || col === 'country') {
    return formatGeoLabel(value);
  }
  return null;
}
