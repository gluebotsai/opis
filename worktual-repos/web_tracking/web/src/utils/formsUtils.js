export const FORMS_PERIOD_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7D' },
  { id: 'month', label: '30D' },
  { id: 'overall', label: 'Overall' },
];

export function funnelCount(funnel, eventType) {
  const row = (funnel || []).find((item) => item.event_type === eventType);
  return Number(row?.count || 0);
}

export function conversionRate(submits, views) {
  const s = Number(submits) || 0;
  const v = Number(views) || 0;
  if (v <= 0) return s > 0 ? '100%' : '—';
  return `${Math.round((s / v) * 100)}%`;
}

export function formatFormLabel(formId, formName) {
  if (formName && String(formName).trim()) return String(formName).trim();
  if (formId && String(formId).trim()) {
    return String(formId)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Unnamed form';
}

export function formatFieldLabel(key) {
  if (!key) return '';
  const known = {
    name: 'Name',
    email: 'Email',
    mobileNo: 'Mobile',
    mobile: 'Mobile',
    phone: 'Phone',
    companyName: 'Company',
    companyWebsite: 'Website',
    message: 'Message',
    fullName: 'Full name',
  };
  if (known[key]) return known[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

export function formatFieldValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function isEmailLike(key, value) {
  if (!value || typeof value !== 'string') return false;
  if (key.toLowerCase().includes('email')) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
