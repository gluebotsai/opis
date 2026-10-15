import { formatLocalDateTime } from '../utils/formatDateTime';

function formatMoney(n, currency) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n).toFixed(2);
  return currency ? `${currency} ${v}` : v;
}

const STATUS_LABELS = {
  active: 'Still shopping',
  cart_abandoned: 'Cart abandoned',
  checkout_abandoned: 'Checkout abandoned',
  recovered: 'Recovered (purchased)',
  idle: 'No recent cart activity',
  empty: 'Empty cart',
};

const STATUS_HINTS = {
  active: 'Items are still in the cart and this visitor was active recently.',
  cart_abandoned: 'Items remain in the cart but the visitor has been idle past your abandonment threshold.',
  checkout_abandoned: 'Checkout started but not completed; cart may still hold items.',
  recovered: 'A purchase was recorded after cart activity.',
  idle: 'Cart is empty or there is nothing actionable right now.',
};

function statusClass(status) {
  return `cart-abandon-status-pill cart-abandon-status-${String(status)}`;
}

export default function VisitorCartAbandonment({
  cartAbandonment,
  hideProductList = false,
  onViewCartProducts,
}) {
  if (!cartAbandonment) return null;

  const {
    status,
    estimated_cart_value: estimatedValue,
    currency,
    products = [],
    threshold_minutes: thresholdMinutes,
    last_activity_at: lastActivityAt,
    idle_minutes: idleMinutes,
    net_items: netItems,
  } = cartAbandonment;

  if (status === 'empty' || status === 'idle') {
    return null;
  }

  const hasProducts = products.length > 0;
  const hasValue = estimatedValue != null && !Number.isNaN(Number(estimatedValue)) && Number(estimatedValue) > 0;
  if (!hasProducts && !hasValue && Number(netItems ?? 0) <= 0) {
    return null;
  }

  const statusLabel = STATUS_LABELS[status] ?? status;
  const statusHint = STATUS_HINTS[status] ?? null;
  const itemCount = products.reduce((sum, p) => sum + Number(p.quantity ?? 0), 0);

  return (
    <section className="visitor-cart-abandonment visitor-cart-abandonment--inline" aria-label="Cart abandonment signal">
      <header className="visitor-cart-abandonment-head">
        <div className="visitor-cart-abandonment-head-text">
          <div className="visitor-cart-abandonment-title-row">
            <h3 className="visitor-cart-abandonment-title">Abandonment signal</h3>
            <span className={statusClass(status)}>{statusLabel}</span>
          </div>
          <p className="visitor-cart-abandonment-subtitle">
            {statusHint}
            {thresholdMinutes != null && (status === 'active' || status === 'cart_abandoned') && (
              <> · Threshold {thresholdMinutes} min</>
            )}
          </p>
          {(lastActivityAt || idleMinutes != null) && (
            <p className="visitor-cart-abandonment-timing">
              {lastActivityAt && (
                <span>Last cart activity {formatLocalDateTime(lastActivityAt)}</span>
              )}
              {idleMinutes != null && idleMinutes > 0 && (
                <span>{lastActivityAt ? ' · ' : ''}Idle {idleMinutes} min</span>
              )}
            </p>
          )}
        </div>
      </header>

      <div className="visitor-cart-abandonment-body">
        <p className="visitor-cart-abandonment-compare-note">
          <strong>In cart now</strong> lists the same net products from add/remove events.
          This block adds <strong>shopping state</strong> (active vs abandoned) and{' '}
          <strong>estimated value</strong> when prices were sent with events.
        </p>

        <div className="visitor-cart-abandonment-kpi" aria-label="Estimated cart value">
          <span className="visitor-cart-abandonment-kpi-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 6h18M16 10a4 4 0 01-8 0" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="visitor-cart-abandonment-kpi-text">
            <span className="visitor-cart-abandonment-kpi-label">Est. cart value</span>
            <span className="visitor-cart-abandonment-kpi-value">{formatMoney(estimatedValue, currency)}</span>
            {Number(netItems ?? 0) > 0 && (
              <span className="visitor-cart-abandonment-kpi-meta">{netItems} item{netItems === 1 ? '' : 's'} net</span>
            )}
          </div>
        </div>

        {hideProductList && hasProducts && typeof onViewCartProducts === 'function' && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onViewCartProducts}>
            View {products.length} product{products.length === 1 ? '' : 's'} in cart
          </button>
        )}

        {hasProducts && !hideProductList && (
          <div className="visitor-cart-abandonment-products-panel">
            <h4 className="visitor-cart-abandonment-products-heading">Products (with prices)</h4>
            <ul className="visitor-cart-abandonment-product-list">
              {products.map((p) => {
                const lineTotal = p.unit_price > 0
                  ? formatMoney(p.unit_price * p.quantity, p.currency || currency)
                  : null;
                return (
                  <li key={p.product_id} className="visitor-cart-abandonment-product-row">
                    <div className="visitor-cart-abandonment-product-main">
                      <span className="visitor-cart-abandonment-product-name" title={p.product_name}>
                        {p.product_name || p.product_id}
                      </span>
                      <span className="visitor-cart-abandonment-product-meta">
                        {p.quantity != null && <span>{p.quantity} qty</span>}
                        {p.sku && <span className="visitor-cart-abandonment-product-sku">{p.sku}</span>}
                      </span>
                    </div>
                    {lineTotal && (
                      <span className="visitor-cart-abandonment-product-line-total">{lineTotal}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!hideProductList && hasProducts && itemCount > 0 && (
          <p className="visitor-cart-abandonment-footnote">
            Quantities should match <strong>In cart now</strong> unless events are still syncing.
          </p>
        )}
      </div>
    </section>
  );
}
