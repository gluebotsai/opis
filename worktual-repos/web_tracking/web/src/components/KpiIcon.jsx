const ICONS = {
  online: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
    </svg>
  ),
  visitors: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  new: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  returning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 12l2 2-2 2M21 14H12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pageviews: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  bounce: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M4 5h10v14H4V5z" strokeLinejoin="round" />
      <path d="M14 12h7" strokeLinecap="round" />
      <path d="M18 9.5l3 2.5-3 2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11" cy="12" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  ),
  sessions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  duration: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pages: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clicks: (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 18.5V8.8c0-1.35 1-2.3 2.2-2.3s2.2.95 2.2 2.3v7.1" />
      <path d="M17.9 15.9V11c0-1.3.95-2.2 2.1-2.2s2.1.9 2.1 2.2v5.2" />
      <path d="M22.1 16v-3.2c0-1.25.9-2.1 2-2.1s2 .85 2 2.1v7.1" />
      <path d="M26.1 19.9v-2.4c0-1.2.85-2.05 1.95-2.05S30 16.3 30 17.5v5.1c0 5.2-3.6 8.9-9.1 8.9h-2.5c-3.1 0-5.6-1.25-7.2-3.7l-3.1-4.8c-.7-1.1-.4-2.5.65-3.2 1-.7 2.35-.45 3.1.5l1.65 2.1v-5.1" />
      <path d="M13.5 18.5H7.8c-1.3 0-2.3-.95-2.3-2.2S6.5 14.1 7.8 14.1h5.7" />
    </svg>
  ),
  conversions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'product-view': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 14l10-5 10 5v11l-10 5-10-5V14z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="18" r="3" />
      <circle cx="18" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  'cart-add': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <circle cx="8" cy="30" r="1.6" />
        <circle cx="16" cy="30" r="1.6" />
        <path d="M4 14h2l2.2 10.5H18l2.4-9H7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M28 5.5v5M25.5 8h5" strokeLinecap="round" />
      </g>
    </svg>
  ),
  'cart-remove': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <circle cx="8" cy="30" r="1.6" />
        <circle cx="16" cy="30" r="1.6" />
        <path d="M4 14h2l2.2 10.5H18l2.4-9H7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M25.5 8h5" strokeLinecap="round" />
      </g>
    </svg>
  ),
  'cart-abandoned': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <circle cx="8" cy="30" r="1.6" />
        <circle cx="16" cy="30" r="1.6" />
        <path d="M4 14h2l2.2 10.5H18l2.4-9H7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M28 10.5v3.2M28 8h.01" strokeLinecap="round" />
        <path d="M28 6.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" fill="currentColor" stroke="none" />
      </g>
    </svg>
  ),
  'wishlist-add': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <path d="M10 27l-1-0.9C5.2 22.2 3 19.8 3 16.2 3 13.5 5.1 11.5 7.8 11.5c1.4 0 2.7 0.8 3.5 2 .8-1.2 2.1-2 3.5-2 2.7 0 4.8 2 4.8 4.7 0 3.6-2.2 6-6.2 9.8L10 27z" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M28 5.5v5M25.5 8h5" strokeLinecap="round" />
      </g>
    </svg>
  ),
  'wishlist-remove': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <path d="M10 27l-1-0.9C5.2 22.2 3 19.8 3 16.2 3 13.5 5.1 11.5 7.8 11.5c1.4 0 2.7 0.8 3.5 2 .8-1.2 2.1-2 3.5-2 2.7 0 4.8 2 4.8 4.7 0 3.6-2.2 6-6.2 9.8L10 27z" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M25.5 8h5" strokeLinecap="round" />
      </g>
    </svg>
  ),
  checkout: (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="6" y="11" width="24" height="15" rx="2.5" />
      <path d="M6 17h24" strokeLinecap="round" />
      <path d="M11 22h4" strokeLinecap="round" />
      <path d="M23 25l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  purchase: (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <circle cx="8" cy="30" r="1.6" />
        <circle cx="16" cy="30" r="1.6" />
        <path d="M4 14h2l2.2 10.5H18l2.4-9H7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M25.5 8.5l2 2 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  ),
  refund: (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 15.5A10.5 10.5 0 1 1 11.8 25" />
      <path d="M9 15.5V9.5" />
      <path d="M9 15.5H15" />
      <path d="M18 12.5v11" />
      <path d="M21.5 14.5c-.7-1-1.8-1.5-3.3-1.5-1.8 0-3 .9-3 2.2 0 1.5 1.2 2 3.2 2.5 2 .5 3.1 1 3.1 2.5 0 1.4-1.3 2.4-3.2 2.4-1.6 0-2.8-.5-3.6-1.6" />
    </svg>
  ),
  'products-touched': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <rect x="20" y="7" width="9" height="9" rx="1.5" />
      <rect x="7" y="20" width="9" height="9" rx="1.5" />
      <rect x="20" y="20" width="9" height="9" rx="1.5" />
    </svg>
  ),
  'product-visitors': (
    <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <g className="kpi-icon-main">
        <circle cx="13" cy="14" r="3.2" />
        <path d="M6 29v-1.5a5 5 0 015-5h4a5 5 0 015 5V29" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="kpi-icon-badge">
        <circle cx="28" cy="8" r="6" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        <path d="M28 5.5v5M25.5 8h5" strokeLinecap="round" />
      </g>
    </svg>
  ),
};

const TINT_CLASS = {
  online: 'kpi-icon-online',
  visitors: 'kpi-icon-visitors',
  new: 'kpi-icon-new',
  returning: 'kpi-icon-returning',
  pageviews: 'kpi-icon-pageviews',
  bounce: 'kpi-icon-bounce',
  sessions: 'kpi-icon-sessions',
  duration: 'kpi-icon-duration',
  pages: 'kpi-icon-pages',
  clicks: 'kpi-icon-clicks',
  conversions: 'kpi-icon-conversions',
  'product-view': 'kpi-icon-product-view',
  'cart-add': 'kpi-icon-cart-add',
  'cart-remove': 'kpi-icon-cart-remove',
  'cart-abandoned': 'kpi-icon-cart-abandoned',
  'wishlist-add': 'kpi-icon-wishlist-add',
  'wishlist-remove': 'kpi-icon-wishlist-remove',
  checkout: 'kpi-icon-checkout',
  purchase: 'kpi-icon-purchase',
  refund: 'kpi-icon-refund',
  'products-touched': 'kpi-icon-products-touched',
  'product-visitors': 'kpi-icon-product-visitors',
};

export default function KpiIcon({ name, size = 'default' }) {
  const svg = ICONS[name];
  const tint = TINT_CLASS[name] || 'kpi-icon-visitors';
  if (!svg) return null;

  const sizeClass = size === 'lg' ? ' kpi-icon-wrap-lg' : '';

  return (
    <span className={`kpi-card-ref-icon kpi-icon-wrap${sizeClass} ${tint}`} aria-hidden="true">
      {svg}
    </span>
  );
}
