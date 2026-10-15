/** Human-readable labels for analytics tables (geo + page paths). */

export function formatGeoLabel(value) {
  const text = String(value ?? '').trim();
  if (!text || text.toUpperCase() === 'UN' || text.toLowerCase() === 'unknown') return 'Unknown';
  return text;
}

function splitPathAndQuery(raw) {
  const qIdx = raw.indexOf('?');
  if (qIdx === -1) return { pathname: raw, search: '' };
  return { pathname: raw.slice(0, qIdx) || '/', search: raw.slice(qIdx) };
}

/** Short label for tables, heatmaps, and engagement lists (full path in title tooltips). */
export function formatPagePath(path) {
  const raw = String(path ?? '').trim();
  if (raw === '/' || raw === '') return 'Home page (/)';
  const { pathname, search } = splitPathAndQuery(raw);
  if (!search) return pathname;
  if (search.length <= 36) return `${pathname}${search}`;
  return `${pathname} (?…)`;
}

export function formatPagePathTitle(path) {
  const raw = String(path ?? '').trim();
  if (raw === '/' || raw === '') return '/';
  return raw;
}

/** Bounce sessions: show the page they left on; non-bounce shows "No". */
export function formatBounceDisplay(session) {
  const bounced = Number(session?.is_bounce ?? 0) === 1;
  const page = String(session?.bounce_page ?? '').trim()
    || (bounced ? String(session?.entry_page ?? '').trim() : '');
  if (!bounced) return 'No';
  if (!page) return '—';
  return formatPagePath(page);
}

export function bouncePageTitle(session) {
  const page = String(session?.bounce_page ?? session?.entry_page ?? '').trim();
  return page ? formatPagePathTitle(page) : '';
}

/** Product row label for visitor engagement / top products. */
export function formatProductLabel(item) {
  const name = String(item?.product_name ?? '').trim();
  if (name && name.toLowerCase() !== 'unknown') return name;
  const id = String(item?.product_id ?? '').trim();
  if (id && id !== 'unknown' && id !== '/') return id;
  const orderId = String(item?.order_id ?? '').trim();
  if (orderId) return `Order ${orderId}`;
  return '';
}
