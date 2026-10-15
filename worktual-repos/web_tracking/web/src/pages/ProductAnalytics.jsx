import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AppShell from '../layout/AppShell';
import KpiIcon from '../components/KpiIcon';
import Pagination from '../components/Pagination';
import { useAuth } from '../AuthContext';
import AbandonedCartsSection from '../components/AbandonedCartsSection';
import {
  getEcommerceOverview,
  getEcommerceProducts,
  getEcommerceTrending,
  getEcommerceEngagedVisitors,
  getEcommerceAbandonedCarts,
} from '../api';
import {
  visitorContactTypeLabel,
  visitorIsKnown,
  visitorProfileName,
} from '../utils/visitorProfileDisplay';
import useLiveTrackingStream from '../hooks/useLiveTrackingStream';
import {
  applyCountsToOverview,
  applyLiveProductRow,
  ECOM_EVENT_TYPES,
} from '../utils/ecommerceLive';
import {
  formatCommerceMoney,
  netRevenue,
  netRevenueBreakdownHint,
} from '../utils/commerceRevenue';

const DEFAULT_TABLE_PAGE_SIZE = 10;

const PRODUCT_ANALYTICS_REFRESH_MS =
  Number(import.meta.env.VITE_PRODUCT_ANALYTICS_REFRESH_MS) || 15000;

const PERIOD_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7D' },
  { id: 'month', label: '30D' },
  { id: 'overall', label: 'All time' },
];

function formatDateRange(period) {
  const end = new Date();
  const start = new Date();
  if (period === 'today') {
    return end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (period === 'week') start.setDate(end.getDate() - 6);
  else if (period === 'month') start.setDate(end.getDate() - 29);
  else return 'All time';

  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function ProductKpiCell({ icon, label, value, subtitle }) {
  return (
    <div className="product-analytics-kpi-cell">
      <KpiIcon name={icon} size="lg" />
      <div className="product-analytics-kpi-cell-body">
        <div className="product-analytics-kpi-label">{label}</div>
        <div className="product-analytics-kpi-value">{value}</div>
        <div className={`product-analytics-kpi-subtitle${subtitle ? '' : ' is-placeholder'}`}>
          {subtitle || '\u00A0'}
        </div>
      </div>
    </div>
  );
}

function ProductKpiRow({ title, cols = 3, children }) {
  const colClass =
    cols === 2 ? 'is-cols-2' : cols === 4 ? 'is-cols-4' : 'is-cols-3';
  return (
    <div className="product-analytics-kpi-row-wrap">
      {title && <h3 className="product-analytics-kpi-row-title">{title}</h3>}
      <div className={`product-analytics-kpi-row ${colClass}`}>
        {children}
      </div>
    </div>
  );
}

function formatNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

function formatMoney(n, currency = '') {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n).toFixed(2);
  return currency ? `${currency} ${v}` : v;
}

export default function ProductAnalytics() {
  const { user } = useAuth();
  const enabled = user?.features?.product_analytics === true;

  const [period, setPeriod] = useState('month');
  const [overview, setOverview] = useState(null);
  const [products, setProducts] = useState([]);
  const [trending, setTrending] = useState([]);
  const [engagedVisitors, setEngagedVisitors] = useState([]);
  const [productsOffset, setProductsOffset] = useState(0);
  const [productsLimit, setProductsLimit] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [visitorsOffset, setVisitorsOffset] = useState(0);
  const [visitorsLimit, setVisitorsLimit] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [abandonRefresh, setAbandonRefresh] = useState(0);
  const [abandonSilentRefresh, setAbandonSilentRefresh] = useState(0);
  const [cartAbandonedCount, setCartAbandonedCount] = useState(null);
  const [cartAbandonThresholdMinutes, setCartAbandonThresholdMinutes] = useState(60);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const [ov, prod, trend, visitors, abandonSummary] = await Promise.all([
        getEcommerceOverview(period),
        getEcommerceProducts(period, 50),
        getEcommerceTrending(period, 10),
        getEcommerceEngagedVisitors(period, 100),
        getEcommerceAbandonedCarts({
          mode: 'operational',
          status: 'cart_abandoned',
          limit: 1,
          offset: 0,
        }).then((res) => res.data).catch(() => null),
      ]);
      if (abandonSummary) {
        setCartAbandonedCount(
          abandonSummary.total ?? abandonSummary.summary?.cart_abandoned ?? 0,
        );
        setCartAbandonThresholdMinutes(abandonSummary.threshold_minutes ?? 60);
      }
      setOverview(ov.data);
      setProducts(prod.data?.products ?? []);
      setTrending(trend.data?.trending ?? []);
      setEngagedVisitors(visitors.data?.visitors ?? []);
      setLastUpdated(new Date());
      if (!silent) {
        setAbandonRefresh((n) => n + 1);
      } else {
        setAbandonSilentRefresh((n) => n + 1);
      }
    } catch (err) {
      console.error(err);
      if (!silent) setError('Failed to load product analytics.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load({ silent: true });
      }
    }, PRODUCT_ANALYTICS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        load({ silent: true });
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [enabled, load]);

  useEffect(() => {
    setProductsOffset(0);
    setVisitorsOffset(0);
  }, [period]);

  useLiveTrackingStream({
    enabled,
    onSnapshot: (snap) => {
      if (period === 'today' && snap?.counts) {
        setOverview((prev) => applyCountsToOverview(prev, snap.counts));
      }
      if (period === 'today' && Array.isArray(snap?.top_products) && snap.top_products.length) {
        setProducts(snap.top_products);
      }
    },
    onTracking: (event) => {
      if (period !== 'today') return;
      if (event?.counts) {
        setOverview((prev) => applyCountsToOverview(prev, event.counts));
      }
      if (ECOM_EVENT_TYPES.has(event?.type) && event.product) {
        setProducts((prev) => applyLiveProductRow(prev, event));
      }
      setLastUpdated(new Date());
    },
  });

  const pagedProducts = useMemo(
    () => products.slice(productsOffset, productsOffset + productsLimit),
    [products, productsOffset, productsLimit],
  );

  const pagedEngagedVisitors = useMemo(
    () => engagedVisitors.slice(visitorsOffset, visitorsOffset + visitorsLimit),
    [engagedVisitors, visitorsOffset, visitorsLimit],
  );

  const handleProductsLimitChange = (nextLimit) => {
    setProductsLimit(nextLimit);
    setProductsOffset(0);
  };

  const handleVisitorsLimitChange = (nextLimit) => {
    setVisitorsLimit(nextLimit);
    setVisitorsOffset(0);
  };

  if (!enabled) {
    const formsEnabled =
      user?.features?.forms !== false && String(user?.business_type ?? '').toUpperCase() !== 'B2B';
    const fallback = formsEnabled ? '/forms' : '/';
    return <Navigate to={fallback} replace />;
  }

  const o = overview ?? {};
  const netIncome =
    o.net_revenue != null ? Number(o.net_revenue) : netRevenue(o.purchase_revenue, o.refund_value);
  const headerToolbar = (
    <div className="product-analytics-toolbar">
      <div className="period-pills" role="tablist" aria-label="Report period">
        {PERIOD_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={period === id}
            className={`period-pill${period === id ? ' active' : ''}`}
            onClick={() => setPeriod(id)}
            disabled={loading}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-black product-analytics-refresh"
        onClick={() => load({ silent: Boolean(overview) })}
        disabled={loading || refreshing}
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );

  const subtitleMeta = (
    <>
      <span>{formatDateRange(period)}</span>
      {lastUpdated ? (
        <span className="reports-main-panel-meta">
          Updated {lastUpdated.toLocaleTimeString()}
          {refreshing ? ' (refreshing…)' : ''}
        </span>
      ) : null}
    </>
  );

  return (
    <AppShell title="Product Analytics" fullBleed>
      <div className="reports-panel-standalone">
        <div className="reports-panel-shell">
          <div className="reports-panel-shell-header reports-main-panel-header reports-toolbar-panel">
            <div className="reports-main-panel-heading">
              <h2 className="reports-main-panel-title">Product analytics</h2>
              <div className="reports-main-panel-desc">{subtitleMeta}</div>
            </div>
            <div className="reports-main-panel-aside">{headerToolbar}</div>
          </div>

          <div className="reports-panel-stack reports-panel-stack--nested product-analytics-stack">
      {error && <p className="error-banner">{error}</p>}

      <section className="product-analytics-kpis" aria-label="Product metrics">
        <ProductKpiRow title="Product reach">
          <ProductKpiCell
            icon="product-view"
            label="Product page views"
            value={formatNum(o.product_views)}
            subtitle="Each product detail view (same product can count more than once)"
          />
          <ProductKpiCell
            icon="products-touched"
            label="Unique products with activity"
            value={formatNum(o.unique_products_touched)}
            subtitle="Different products with view, cart, wishlist, or checkout events"
          />
          <ProductKpiCell
            icon="product-visitors"
            label="Visitors with product activity"
            value={formatNum(o.product_engaged_visitors)}
            subtitle="Unique shoppers who viewed or interacted with any product"
          />
        </ProductKpiRow>

        <ProductKpiRow title="Cart">
          <ProductKpiCell
            icon="cart-add"
            label="Add to cart"
            value={formatNum(o.cart_adds)}
            subtitle={`ATC rate ${o.add_to_cart_rate ?? 0}%`}
          />
          <ProductKpiCell icon="cart-remove" label="Remove from cart" value={formatNum(o.cart_removes)} />
          <ProductKpiCell
            icon="cart-abandoned"
            label="Cart abandoned"
            value={formatNum(cartAbandonedCount)}
            subtitle={
              cartAbandonedCount != null
                ? `${cartAbandonThresholdMinutes} min idle`
                : undefined
            }
          />
        </ProductKpiRow>

        <ProductKpiRow title="Wishlist" cols={2}>
          <ProductKpiCell icon="wishlist-add" label="Add to wishlist" value={formatNum(o.wishlist_adds)} />
          <ProductKpiCell icon="wishlist-remove" label="Remove from wishlist" value={formatNum(o.wishlist_removes)} />
        </ProductKpiRow>

        <ProductKpiRow title="Checkout & revenue" cols={4}>
          <ProductKpiCell
            icon="conversions"
            label="Net revenue"
            value={formatCommerceMoney(netIncome)}
            subtitle={netRevenueBreakdownHint(o.purchase_revenue, o.refund_value)}
          />
          <ProductKpiCell icon="checkout" label="Checkout starts" value={formatNum(o.checkout_starts)} />
          <ProductKpiCell
            icon="purchase"
            label="Purchases"
            value={formatNum(o.purchases)}
            subtitle={formatMoney(o.purchase_revenue)}
          />
          <ProductKpiCell
            icon="refund"
            label="Refunds"
            value={formatNum(o.refunds)}
            subtitle={formatMoney(o.refund_value)}
          />
        </ProductKpiRow>
      </section>

      <section className="analytics-section">
        <div className="section-header">
          <h2>Trending products</h2>
          <p className="section-subtitle">Views and cart activity combined</p>
        </div>
        <div className="card analytics-table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Views</th>
                  <th>Cart adds</th>
                  <th>Engaging visitors</th>
                  <th>Trend score</th>
                </tr>
              </thead>
              <tbody>
                {!loading && trending.map((row) => (
                  <tr key={row.product_id}>
                    <td>
                      <div className="product-cell-name">{row.product_name}</div>
                      <div className="product-cell-id">{row.product_id}</div>
                    </td>
                    <td>{row.product_category || '—'}</td>
                    <td>{formatNum(row.views)}</td>
                    <td>{formatNum(row.cart_adds)}</td>
                    <td>{formatNum(row.engaging_visitors)}</td>
                    <td>{formatNum(row.trend_score)}</td>
                  </tr>
                ))}
                {!loading && trending.length === 0 && (
                  <tr><td colSpan={6}>No product events yet — wire SDK ecommerce hooks on the storefront.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="analytics-section">
        <div className="section-header">
          <h2>All products</h2>
          <p className="section-subtitle">Views, cart, and wishlist by product</p>
        </div>
        <div className="card analytics-table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Brand</th>
                  <th>Price</th>
                  <th>Views</th>
                  <th>Cart +</th>
                  <th>Cart −</th>
                  <th>Wishlist +</th>
                  <th>Wishlist −</th>
                  <th>Visitors</th>
                </tr>
              </thead>
              <tbody>
                {!loading && pagedProducts.map((row) => (
                  <tr key={row.product_id}>
                    <td>
                      <div className="product-cell-name">{row.product_name}</div>
                      <div className="product-cell-id">{row.product_id}</div>
                    </td>
                    <td>{row.product_category || '—'}</td>
                    <td>{row.product_brand || '—'}</td>
                    <td>{formatMoney(row.product_price, row.currency)}</td>
                    <td>{formatNum(row.views)}</td>
                    <td>{formatNum(row.cart_adds)}</td>
                    <td>{formatNum(row.cart_removes)}</td>
                    <td>{formatNum(row.wishlist_adds)}</td>
                    <td>{formatNum(row.wishlist_removes)}</td>
                    <td>{formatNum(row.engaging_visitors)}</td>
                  </tr>
                ))}
                {!loading && products.length === 0 && (
                  <tr><td colSpan={10}>No product events yet — wire SDK ecommerce hooks on the storefront.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {products.length > 0 && (
            <Pagination
              offset={productsOffset}
              limit={productsLimit}
              total={products.length}
              loading={loading}
              onOffsetChange={setProductsOffset}
              onLimitChange={handleProductsLimitChange}
              itemLabel="products"
            />
          )}
        </div>
      </section>

      <section className="analytics-section">
        <div className="section-header">
          <h2>Customers &amp; visitors engaging products</h2>
          <p className="section-subtitle">
            Shoppers ranked by product interactions; CDP profile shown when linked.
          </p>
        </div>
        <div className="card analytics-table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Visitor ID</th>
                  <th>Customer</th>
                  <th>Contact type</th>
                  <th>Interactions</th>
                  <th>Product views</th>
                  <th>Cart +</th>
                  <th>Cart −</th>
                  <th>Wishlist +</th>
                  <th>Wishlist −</th>
                  <th>Products touched</th>
                </tr>
              </thead>
              <tbody>
                {!loading && pagedEngagedVisitors.map((row) => {
                  const cdp = row.cdp_profile;
                  const linkedCount = Number(cdp?.linked_visitor_ids_count ?? 0);
                  return (
                  <tr key={row.visitor_id}>
                    <td>
                      <Link to={`/visitors/${encodeURIComponent(row.visitor_id)}`} className="visitor-id">
                        <code>{row.visitor_id}</code>
                      </Link>
                    </td>
                    <td>
                      <span className={visitorIsKnown(cdp) ? undefined : 'visitor-muted'}>
                        {visitorProfileName(cdp)}
                      </span>
                      {linkedCount > 1 && (
                        <span className="visitor-muted" title="Same customer across multiple visitor IDs">
                          {' '}· {linkedCount} IDs
                        </span>
                      )}
                    </td>
                    <td>{visitorContactTypeLabel(cdp)}</td>
                    <td>{formatNum(row.interactions)}</td>
                    <td>{formatNum(row.product_views)}</td>
                    <td>{formatNum(row.cart_adds)}</td>
                    <td>{formatNum(row.cart_removes)}</td>
                    <td>{formatNum(row.wishlist_adds)}</td>
                    <td>{formatNum(row.wishlist_removes)}</td>
                    <td>{formatNum(row.products_touched)}</td>
                  </tr>
                  );
                })}
                {!loading && engagedVisitors.length === 0 && (
                  <tr><td colSpan={10}>No visitors with product interactions in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {engagedVisitors.length > 0 && (
            <Pagination
              offset={visitorsOffset}
              limit={visitorsLimit}
              total={engagedVisitors.length}
              loading={loading}
              onOffsetChange={setVisitorsOffset}
              onLimitChange={handleVisitorsLimitChange}
              itemLabel="visitors"
            />
          )}
        </div>
      </section>

      <AbandonedCartsSection
        refreshToken={abandonRefresh}
        silentRefreshToken={abandonSilentRefresh}
      />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
