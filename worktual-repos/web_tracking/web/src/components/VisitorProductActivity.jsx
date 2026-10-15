import { useEffect, useState } from 'react';
import { formatLocalDateTime } from '../utils/formatDateTime';
import { formatPagePath } from '../utils/formatDisplayLabels';
import VisitorCartAbandonment from './VisitorCartAbandonment';

const PREVIEW_LIMIT = 3;

function formatMoney(amount, currency) {
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  const cur = String(currency ?? '').trim();
  return cur ? `${cur} ${n.toFixed(2)}` : n.toFixed(2);
}

function productLabel(item) {
  const name = String(item.product_name ?? '').trim();
  if (name) return name;
  const id = String(item.product_id ?? '').trim();
  if (id && id !== 'unknown' && id !== '/') return id;
  const orderId = String(item.order_id ?? '').trim();
  if (orderId) return `Order ${orderId}`;
  return item.page_path ? formatPagePath(item.page_path) : 'Unknown product';
}

function cartLinesFingerprint(items) {
  if (!items?.length) return '';
  return [...items]
    .map((p) => `${p.product_id ?? ''}:${Number(p.quantity ?? 0)}`)
    .sort()
    .join('|');
}

function ProductRow({ item, badges = [] }) {
  const label = productLabel(item);
  return (
    <li className="visitor-product-row">
      <div className="visitor-product-row-main">
        <span className="visitor-product-row-name" title={label}>{label}</span>
        {badges.length > 0 && (
          <div className="visitor-product-row-badges">
            {badges.map((b) => (
              <span key={b.key} className={`visitor-product-chip visitor-product-chip--${b.tone || 'neutral'}`}>
                {b.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function ProductList({ items, emptyLabel, buildBadges }) {
  if (!items?.length) {
    return <p className="visitor-product-empty">{emptyLabel}</p>;
  }
  return (
    <ul className="visitor-product-row-list">
      {items.map((item) => {
        const key = [
          item.interaction_id,
          item.product_id,
          item.order_id,
          item.page_path,
          item.created_at,
          item.last_viewed_at,
          item.last_added_at,
          item.last_removed_at,
          item.last_checkout_at,
        ].filter(Boolean).join('-');
        return <ProductRow key={key} item={item} badges={buildBadges(item)} />;
      })}
    </ul>
  );
}

function ProductActivityDetailModal({
  open,
  onClose,
  title,
  subtitle,
  items,
  sections,
  emptyLabel,
  buildBadges,
  kpiTone,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sectionList = sections?.length ? sections : null;
  const count = sectionList
    ? sectionList.reduce((sum, s) => sum + (s.items?.length ?? 0), 0)
    : (items?.length ?? 0);

  const panelClass = [
    'visitor-product-modal-panel',
    kpiTone ? `visitor-product-modal-panel--${kpiTone}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="visitor-product-modal-root" role="presentation">
      <button
        type="button"
        className="visitor-product-modal-backdrop"
        aria-label="Close product details"
        onClick={onClose}
      />
      <div
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby="visitor-product-modal-title"
      >
        <header className="visitor-product-modal-header">
          <div>
            <h2 id="visitor-product-modal-title">{title}</h2>
            {subtitle ? <p className="visitor-product-modal-meta">{subtitle}</p> : null}
            <p className="visitor-product-modal-meta">
              {sectionList
                ? `${sectionList.length} section${sectionList.length === 1 ? '' : 's'} · ${count} product row${count === 1 ? '' : 's'}`
                : `${count} product${count === 1 ? '' : 's'}`}
            </p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="visitor-product-modal-body">
          {sectionList ? (
            sectionList.map((section) => (
              <div key={section.title} className="visitor-product-modal-section">
                <h3 className="visitor-product-modal-section-title">{section.title}</h3>
                <ProductList
                  items={section.items}
                  emptyLabel={section.emptyLabel}
                  buildBadges={section.buildBadges}
                />
              </div>
            ))
          ) : (
            <ProductList items={items} emptyLabel={emptyLabel} buildBadges={buildBadges} />
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityKpi({
  kpiId,
  selected,
  onSelect,
  label,
  value,
  hint,
  tone = 'neutral',
}) {
  return (
    <button
      type="button"
      className={[
        'visitor-product-kpi',
        `visitor-product-kpi--${tone}`,
        'visitor-product-kpi--clickable',
        selected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. Click for details.`}
      onClick={() => onSelect(kpiId)}
    >
      <span className="visitor-product-kpi-value">{value}</span>
      <span className="visitor-product-kpi-label">{label}</span>
      {hint ? <span className="visitor-product-kpi-hint">{hint}</span> : null}
      <span className="visitor-product-kpi-action">View details</span>
    </button>
  );
}

const KPI = {
  PRODUCT_VIEWS: 'product_views',
  CART_NOW: 'cart_now',
  CART_ADD: 'cart_add',
  CART_REMOVE: 'cart_remove',
  WISHLIST_NOW: 'wishlist_now',
  WISHLIST_ADD: 'wishlist_add',
  WISHLIST_REMOVE: 'wishlist_remove',
  CHECKOUT_STARTS: 'checkout_starts',
  PURCHASES: 'purchases',
};

function ProductListBlock({
  step,
  title,
  description,
  tone,
  featured = false,
  items,
  emptyLabel,
  buildBadges,
  onViewAll,
  viewAllLabel,
  modalPayload,
}) {
  const list = items ?? [];
  const hasItems = list.length > 0;
  const preview = list.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, list.length - preview.length);

  const blockClass = [
    'visitor-product-block',
    `visitor-product-block--${tone}`,
    featured ? 'visitor-product-block--featured' : '',
    step ? 'visitor-product-block--step' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={blockClass}>
      <div className="visitor-product-block-head">
        <div>
          {step ? <span className="visitor-product-step-tag">{step}</span> : null}
          <h3 className="visitor-product-block-title">{title}</h3>
          {description ? <p className="visitor-product-block-desc">{description}</p> : null}
        </div>
        {hasItems && (
          <span className="visitor-product-block-count" aria-hidden="true">
            {list.length}
          </span>
        )}
      </div>

      {hasItems ? (
        <>
          <ProductList items={preview} emptyLabel={emptyLabel} buildBadges={buildBadges} />
          <footer className="visitor-product-block-footer">
            {hiddenCount > 0 && (
              <p className="visitor-product-block-more">
                +{hiddenCount} more — open full list
              </p>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm visitor-product-block-open"
              onClick={() => onViewAll(
                modalPayload ?? {
                  title,
                  subtitle: description,
                  items: list,
                  emptyLabel,
                  buildBadges,
                },
              )}
            >
              {viewAllLabel ?? `All products (${list.length})`}
            </button>
          </footer>
        </>
      ) : (
        <p className="visitor-product-empty">{emptyLabel}</p>
      )}
    </article>
  );
}

function ProductActivityGroup({ title, subtitle, children, variant }) {
  return (
    <div className={`visitor-product-group${variant ? ` visitor-product-group--${variant}` : ''}`}>
      <div className="visitor-product-group-head">
        <h3 className="visitor-product-group-title">{title}</h3>
        {subtitle ? <p className="visitor-product-group-sub">{subtitle}</p> : null}
      </div>
      <div className="visitor-product-blocks">{children}</div>
    </div>
  );
}

export default function VisitorProductActivity({ activity }) {
  const [listModal, setListModal] = useState(null);
  const [selectedKpi, setSelectedKpi] = useState(null);

  if (!activity) return null;

  const summary = activity.summary ?? {};
  const productsViewed = activity.products_viewed ?? [];
  const cart = activity.cart ?? [];
  const wishlist = activity.wishlist ?? [];
  const cartAdded = activity.cart_added ?? [];
  const cartRemoved = activity.cart_removed ?? [];
  const wishlistAdded = activity.wishlist_added ?? [];
  const wishlistRemoved = activity.wishlist_removed ?? [];
  const checkoutProductLines = activity.checkout_product_lines ?? [];
  const purchaseProductLines = activity.purchase_product_lines ?? [];
  const cartAbandonment = activity.cart_abandonment ?? null;

  const productViews = Number(summary.product_views ?? 0);
  const cartAdds = Number(summary.cart_add_events ?? 0);
  const cartRemoves = Number(summary.cart_remove_events ?? 0);
  const cartNetQty = Number(summary.cart_items ?? 0);
  const cartNetProducts = Number(summary.cart_products ?? 0);
  const wishAdds = Number(summary.wishlist_add_events ?? 0);
  const wishRemoves = Number(summary.wishlist_remove_events ?? 0);
  const wishNetQty = Number(summary.wishlist_items ?? 0);
  const checkouts = Number(summary.checkout_starts ?? 0);
  const purchaseCount = Number(summary.purchases ?? 0);

  const showProductsViewed = productViews > 0 || productsViewed.length > 0;
  const showCartAdded = cartAdded.length > 0 || cartAdds > 0;
  const showCartRemoved = cartRemoved.length > 0 || cartRemoves > 0;
  const showCartNow = cart.length > 0 || cartNetQty > 0 || Number(cartAbandonment?.net_items ?? 0) > 0;
  const showAbandonment = cartAbandonment
    && cartAbandonment.status !== 'empty'
    && cartAbandonment.status !== 'idle';

  const cartMatchesAbandonment = cart.length > 0
    && cartAbandonment?.products?.length > 0
    && cartLinesFingerprint(cart) === cartLinesFingerprint(cartAbandonment.products);

  const showWishlistNet = wishlist.length > 0;
  const showWishlistAdded = wishlistAdded.length > 0 || wishAdds > 0;
  const showWishlistRemoved = wishlistRemoved.length > 0 || wishRemoves > 0;

  const showBrowseGroup = showProductsViewed;
  const showCartGroup = showCartAdded || showCartRemoved || showCartNow || showAbandonment;
  const showWishlistGroup = showWishlistNet || showWishlistAdded || showWishlistRemoved;
  const hasAnyDetail = showBrowseGroup || showCartGroup || showWishlistGroup
    || checkouts > 0 || purchaseCount > 0;

  const viewedBadges = (item) => {
    const badges = [];
    if (Number(item.views ?? 0) > 0) badges.push({ key: 'v', text: `${Number(item.views)} views`, tone: 'blue' });
    if (item.last_viewed_at) {
      badges.push({ key: 't', text: formatLocalDateTime(item.last_viewed_at), tone: 'neutral' });
    }
    return badges;
  };

  const qtyBadges = (item, timeKey) => {
    const badges = [];
    if (Number(item.quantity ?? 0) > 0) badges.push({ key: 'q', text: `${Number(item.quantity)} qty`, tone: 'orange' });
    const t = item[timeKey];
    if (t) badges.push({ key: 't', text: formatLocalDateTime(t), tone: 'neutral' });
    if (Number(item.events ?? 0) > 1) badges.push({ key: 'e', text: `${Number(item.events)} events`, tone: 'neutral' });
    return badges;
  };

  const wishQtyBadges = (item, timeKey) => {
    const badges = qtyBadges(item, timeKey);
    return badges.map((b) => (b.key === 'q' ? { ...b, tone: 'violet' } : b));
  };

  const commerceLineBadges = (item, timeField) => {
    const badges = [];
    if (Number(item.quantity ?? 0) > 0) {
      badges.push({ key: 'q', text: `${Number(item.quantity)} qty`, tone: 'green' });
    }
    const price = formatMoney(item.unit_price, item.currency);
    if (price && Number(item.unit_price ?? 0) > 0) {
      badges.push({ key: 'p', text: price, tone: 'green' });
    }
    if (item.sku) badges.push({ key: 's', text: item.sku, tone: 'neutral' });
    if (item.order_id) badges.push({ key: 'o', text: item.order_id, tone: 'neutral' });
    const t = item[timeField];
    if (t) badges.push({ key: 't', text: formatLocalDateTime(t), tone: 'neutral' });
    return badges;
  };

  const checkoutModalPayload = () => ({
    title: 'Products at checkout',
    subtitle: `${checkoutProductLines.length} product line${checkoutProductLines.length === 1 ? '' : 's'} · ${checkouts} checkout${checkouts === 1 ? '' : 's'}`,
    items: checkoutProductLines,
    emptyLabel: checkouts > 0 && !checkoutProductLines.length
      ? 'Checkout recorded but props.products[] is missing in events.'
      : 'No products at checkout yet.',
    buildBadges: (i) => commerceLineBadges(i, 'checkout_at'),
    kpiTone: 'green',
  });

  const purchaseModalPayload = () => ({
    title: 'Products purchased',
    subtitle: `${purchaseProductLines.length} product line${purchaseProductLines.length === 1 ? '' : 's'} · ${purchaseCount} order${purchaseCount === 1 ? '' : 's'}`,
    items: purchaseProductLines,
    emptyLabel: purchaseCount > 0 && !purchaseProductLines.length
      ? 'Purchase recorded but props.products[] is missing in events.'
      : 'No purchased products yet.',
    buildBadges: (i) => commerceLineBadges(i, 'purchased_at'),
    kpiTone: 'green',
  });

  const openList = (payload) => {
    setSelectedKpi(null);
    setListModal(payload);
  };

  const closeList = () => {
    setListModal(null);
    setSelectedKpi(null);
  };

  const openKpiDetail = (kpiId) => {
    setSelectedKpi(kpiId);

    switch (kpiId) {
      case KPI.PRODUCT_VIEWS:
        setListModal({
          title: 'Product views',
          subtitle: 'Products viewed by this visitor',
          items: productsViewed,
          emptyLabel: productViews > 0
            ? 'Views recorded but product names missing in events.'
            : 'No product views.',
          buildBadges: viewedBadges,
          kpiTone: 'blue',
        });
        break;
      case KPI.CART_NOW:
        setListModal({
          title: 'In cart now',
          subtitle: 'Net quantity per product (adds minus removes)',
          items: cart,
          emptyLabel: 'Cart is empty.',
          buildBadges: (i) => qtyBadges(i, 'last_added_at'),
          kpiTone: 'orange',
        });
        break;
      case KPI.CART_ADD:
        setListModal({
          title: 'Added to cart',
          subtitle: `${cartAdds} add event${cartAdds === 1 ? '' : 's'} · ${cartAdded.length} product${cartAdded.length === 1 ? '' : 's'}`,
          items: cartAdded,
          emptyLabel: cartAdds > 0 && !cartAdded.length
            ? `${cartAdds} add event(s); product names missing.`
            : 'No add-to-cart products.',
          buildBadges: (i) => qtyBadges(i, 'last_added_at'),
          kpiTone: 'orange',
        });
        break;
      case KPI.CART_REMOVE:
        setListModal({
          title: 'Removed from cart',
          subtitle: `${cartRemoves} remove event${cartRemoves === 1 ? '' : 's'} · ${cartRemoved.length} product${cartRemoved.length === 1 ? '' : 's'}`,
          items: cartRemoved,
          emptyLabel: cartRemoves > 0 && !cartRemoved.length
            ? `${cartRemoves} remove event(s); product names missing.`
            : 'No remove-from-cart products.',
          buildBadges: (i) => qtyBadges(i, 'last_removed_at'),
          kpiTone: 'orange',
        });
        break;
      case KPI.WISHLIST_NOW:
        setListModal({
          title: 'On wishlist',
          subtitle: 'Net wishlist quantity per product',
          items: wishlist,
          emptyLabel: 'No products on wishlist.',
          buildBadges: (i) => wishQtyBadges(i, 'last_added_at'),
          kpiTone: 'violet',
        });
        break;
      case KPI.WISHLIST_ADD:
        setListModal({
          title: 'Added to wishlist',
          subtitle: `${wishAdds} add event${wishAdds === 1 ? '' : 's'} · ${wishlistAdded.length} product${wishlistAdded.length === 1 ? '' : 's'}`,
          items: wishlistAdded,
          emptyLabel: wishAdds > 0 && !wishlistAdded.length
            ? `${wishAdds} add event(s); product names missing.`
            : 'No wishlist add products.',
          buildBadges: (i) => wishQtyBadges(i, 'last_added_at'),
          kpiTone: 'violet',
        });
        break;
      case KPI.WISHLIST_REMOVE:
        setListModal({
          title: 'Removed from wishlist',
          subtitle: `${wishRemoves} remove event${wishRemoves === 1 ? '' : 's'} · ${wishlistRemoved.length} product${wishlistRemoved.length === 1 ? '' : 's'}`,
          items: wishlistRemoved,
          emptyLabel: wishRemoves > 0 && !wishlistRemoved.length
            ? `${wishRemoves} remove event(s); product names missing.`
            : 'No wishlist remove products.',
          buildBadges: (i) => wishQtyBadges(i, 'last_removed_at'),
          kpiTone: 'violet',
        });
        break;
      case KPI.CHECKOUT_STARTS:
        setListModal(checkoutModalPayload());
        break;
      case KPI.PURCHASES:
        setListModal(purchaseModalPayload());
        break;
      default:
        break;
    }
  };

  const openCartNowModal = () => {
    openKpiDetail(KPI.CART_NOW);
  };

  return (
    <section className="visitor-section visitor-product-activity-section">
      <div className="visitor-product-activity-heading">
        <h2 className="visitor-section-title">Product activity</h2>
        <p className="visitor-product-activity-lead">
          Click a metric for product lists. Checkout and purchase show only product name, qty, price, SKU, and time.
        </p>
      </div>

      <div className="card visitor-product-activity">
        <div className="visitor-product-kpi-grid" role="group" aria-label="Product activity metrics">
          <ActivityKpi
            kpiId={KPI.PRODUCT_VIEWS}
            selected={selectedKpi === KPI.PRODUCT_VIEWS}
            onSelect={openKpiDetail}
            label="Product views"
            value={productViews}
            tone="blue"
          />
          <ActivityKpi
            kpiId={KPI.CART_NOW}
            selected={selectedKpi === KPI.CART_NOW}
            onSelect={openKpiDetail}
            label="In cart now"
            value={cartNetQty}
            hint={`${cartNetProducts} product${cartNetProducts === 1 ? '' : 's'}`}
            tone="orange"
          />
          <ActivityKpi
            kpiId={KPI.CART_ADD}
            selected={selectedKpi === KPI.CART_ADD}
            onSelect={openKpiDetail}
            label="Add to cart"
            value={cartAdds}
            hint={`${cartAdded.length} product${cartAdded.length === 1 ? '' : 's'}`}
            tone="orange"
          />
          <ActivityKpi
            kpiId={KPI.CART_REMOVE}
            selected={selectedKpi === KPI.CART_REMOVE}
            onSelect={openKpiDetail}
            label="Remove from cart"
            value={cartRemoves}
            hint={`${cartRemoved.length} product${cartRemoved.length === 1 ? '' : 's'}`}
            tone="orange"
          />
          <ActivityKpi
            kpiId={KPI.WISHLIST_NOW}
            selected={selectedKpi === KPI.WISHLIST_NOW}
            onSelect={openKpiDetail}
            label="On wishlist"
            value={wishNetQty}
            hint={`${Number(summary.wishlist_products ?? 0)} product${Number(summary.wishlist_products ?? 0) === 1 ? '' : 's'}`}
            tone="violet"
          />
          <ActivityKpi
            kpiId={KPI.WISHLIST_ADD}
            selected={selectedKpi === KPI.WISHLIST_ADD}
            onSelect={openKpiDetail}
            label="Add to wishlist"
            value={wishAdds}
            hint={`${wishlistAdded.length} product${wishlistAdded.length === 1 ? '' : 's'}`}
            tone="violet"
          />
          <ActivityKpi
            kpiId={KPI.WISHLIST_REMOVE}
            selected={selectedKpi === KPI.WISHLIST_REMOVE}
            onSelect={openKpiDetail}
            label="Remove from wishlist"
            value={wishRemoves}
            hint={`${wishlistRemoved.length} product${wishlistRemoved.length === 1 ? '' : 's'}`}
            tone="violet"
          />
          <ActivityKpi
            kpiId={KPI.CHECKOUT_STARTS}
            selected={selectedKpi === KPI.CHECKOUT_STARTS}
            onSelect={openKpiDetail}
            label="Checkout starts"
            value={checkouts}
            hint={`${checkoutProductLines.length} product line${checkoutProductLines.length === 1 ? '' : 's'}`}
            tone="green"
          />
          <ActivityKpi
            kpiId={KPI.PURCHASES}
            selected={selectedKpi === KPI.PURCHASES}
            onSelect={openKpiDetail}
            label="Purchases"
            value={purchaseCount}
            hint={`${purchaseProductLines.length} product line${purchaseProductLines.length === 1 ? '' : 's'}`}
            tone="green"
          />
        </div>

        {!hasAnyDetail ? (
          <p className="visitor-product-empty visitor-product-empty--center">No product activity recorded for this visitor yet.</p>
        ) : (
          <div className="visitor-product-groups-stack">
            {showBrowseGroup && (
              <ProductActivityGroup title="Browse" subtitle="Products they viewed">
                <ProductListBlock
                  title="Products viewed"
                  description="Every product page view we could tie to this visitor"
                  tone="browse"
                  items={productsViewed}
                  emptyLabel={
                    productViews > 0
                      ? 'Views recorded but product names missing in events.'
                      : 'No product views.'
                  }
                  buildBadges={viewedBadges}
                  onViewAll={openList}
                />
              </ProductActivityGroup>
            )}

            {showCartGroup && (
              <ProductActivityGroup
                title="Cart"
                subtitle="History first, then current cart, then abandonment (not the same thing)"
                variant="cart"
              >
                <div className="visitor-product-cart-flow">
                  <ProductListBlock
                    step="1"
                    title="Added to cart"
                    description="All products they added — full history in the popup"
                    tone="cart"
                    items={cartAdded}
                    emptyLabel={
                      cartAdds > 0 && !cartAdded.length
                        ? `${cartAdds} add event(s) recorded; product names missing in events.`
                        : 'No add-to-cart events yet.'
                    }
                    buildBadges={(i) => qtyBadges(i, 'last_added_at')}
                    onViewAll={openList}
                  />
                  <ProductListBlock
                    step="2"
                    title="Removed from cart"
                    description="All products they removed — full history in the popup"
                    tone="cart"
                    items={cartRemoved}
                    emptyLabel={
                      cartRemoves > 0 && !cartRemoved.length
                        ? `${cartRemoves} remove event(s) recorded; product names missing in events.`
                        : 'No remove-from-cart events yet.'
                    }
                    buildBadges={(i) => qtyBadges(i, 'last_removed_at')}
                    onViewAll={openList}
                  />
                  <ProductListBlock
                    step="3"
                    title="In cart now"
                    description="What is in the cart right now (net of adds and removes)"
                    tone="cart"
                    featured
                    items={cart}
                    emptyLabel="Cart is empty — adds and removes net to zero."
                    buildBadges={(i) => qtyBadges(i, 'last_added_at')}
                    onViewAll={openList}
                  />
                  {showAbandonment && (
                    <VisitorCartAbandonment
                      cartAbandonment={cartAbandonment}
                      hideProductList={cartMatchesAbandonment}
                      onViewCartProducts={cart.length > 0 ? openCartNowModal : undefined}
                    />
                  )}
                </div>
              </ProductActivityGroup>
            )}

            {showWishlistGroup && (
              <ProductActivityGroup title="Wishlist" subtitle="Saves and removals">
                {showWishlistAdded && (
                  <ProductListBlock
                    title="Added to wishlist"
                    description="All add events — open popup for the full list"
                    tone="wishlist"
                    items={wishlistAdded}
                    emptyLabel="No add events."
                    buildBadges={(i) => wishQtyBadges(i, 'last_added_at')}
                    onViewAll={openList}
                  />
                )}
                {showWishlistRemoved && (
                  <ProductListBlock
                    title="Removed from wishlist"
                    description="All remove events — open popup for the full list"
                    tone="wishlist"
                    items={wishlistRemoved}
                    emptyLabel="No remove events."
                    buildBadges={(i) => wishQtyBadges(i, 'last_removed_at')}
                    onViewAll={openList}
                  />
                )}
                {showWishlistNet && (
                  <ProductListBlock
                    title="On wishlist now"
                    description="Net quantity per product"
                    tone="wishlist"
                    featured
                    items={wishlist}
                    emptyLabel="No wishlist items."
                    buildBadges={(i) => wishQtyBadges(i, 'last_added_at')}
                    onViewAll={openList}
                  />
                )}
              </ProductActivityGroup>
            )}
          </div>
        )}
      </div>

      <ProductActivityDetailModal
        open={Boolean(listModal)}
        onClose={closeList}
        title={listModal?.title ?? ''}
        subtitle={listModal?.subtitle}
        items={listModal?.items}
        sections={listModal?.sections}
        emptyLabel={listModal?.emptyLabel ?? 'No items.'}
        buildBadges={listModal?.buildBadges ?? (() => [])}
        kpiTone={listModal?.kpiTone}
      />
    </section>
  );
}
