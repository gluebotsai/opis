/** Local-only UI preview — never enable in production builds. */

export const DEV_UI_PREVIEW_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_DEV_UI_PREVIEW === 'true';

const PREVIEW_FLAG = 'devUiPreview';

export const DEV_PREVIEW_LOGIN_PAYLOAD = {
  token: 'dev-ui-preview-token',
  admin_name: 'Admin',
  email: 'preview@local.dev',
  organization_id: 1,
  website_id: 12345,
  website_url: 'https://preview.local.dev',
  site_type: 'other',
  features: { product_analytics: true, conversions: true },
  websites: [{ website_id: 12345, website_url: 'https://preview.local.dev', site_type: 'other' }],
};

export function isDevUiPreviewSession() {
  return DEV_UI_PREVIEW_ENABLED && localStorage.getItem(PREVIEW_FLAG) === '1';
}

export function markDevUiPreviewSession() {
  if (!DEV_UI_PREVIEW_ENABLED) return;
  localStorage.setItem(PREVIEW_FLAG, '1');
}

export function clearDevUiPreviewSession() {
  localStorage.removeItem(PREVIEW_FLAG);
}
