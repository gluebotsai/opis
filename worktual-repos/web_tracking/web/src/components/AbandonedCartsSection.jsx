import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getEcommerceAbandonedCarts } from '../api';
import {
  visitorIsKnown,
  visitorListProfileLabel,
} from '../utils/visitorProfileDisplay';
import { formatLocalDateTime } from '../utils/formatDateTime';
import Pagination from './Pagination';

const PAGE_SIZE = 10;

function formatMoney(n, currency) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n).toFixed(2);
  return currency ? `${currency} ${v}` : v;
}


export default function AbandonedCartsSection({ refreshToken = 0, silentRefreshToken = 0 }) {
  const [mode, setMode] = useState('operational');
  const [carts, setCarts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [thresholdMinutes, setThresholdMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    setError(null);
    if (silent && hasLoadedRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const { data } = await getEcommerceAbandonedCarts({
        mode,
        status: 'cart_abandoned',
        limit: PAGE_SIZE,
        offset,
      });
      setCarts(data.carts ?? []);
      setSummary(data.summary ?? null);
      setThresholdMinutes(data.threshold_minutes ?? 60);
      setTotal(Number(data.total ?? 0));
    } catch (e) {
      setError(e?.message || 'Failed to load abandoned carts');
    } finally {
      setLoading(false);
      setRefreshing(false);
      hasLoadedRef.current = true;
    }
  }, [mode, offset]);

  useEffect(() => {
    load({ silent: false });
  }, [load, refreshToken]);

  useEffect(() => {
    if (silentRefreshToken === 0) return;
    load({ silent: true });
  }, [load, silentRefreshToken]);

  useEffect(() => {
    setOffset(0);
  }, [mode]);

  return (
    <section className="product-analytics-section abandoned-carts-section" aria-label="Cart abandonment">
      <div className="abandoned-carts-section-header">
        <div>
          <h2 className="section-title">Cart abandonment</h2>
          <p className="section-subtitle">
            Net items in cart (add − remove), no purchase, inactive for{' '}
            {mode === 'reporting' ? '24 hours' : '60 minutes'}. Product or page views keep them active.
          </p>
        </div>
        <div className="abandoned-carts-mode-toggle" role="group" aria-label="Threshold mode">
          <button
            type="button"
            className={mode === 'operational' ? 'active' : ''}
            onClick={() => setMode('operational')}
          >
            Live (60 min)
          </button>
          <button
            type="button"
            className={mode === 'reporting' ? 'active' : ''}
            onClick={() => setMode('reporting')}
          >
            Reporting (24 h)
          </button>
        </div>
      </div>

      {summary && (
        <div className="abandoned-carts-kpis">
          <span>Active (cart, within window): {summary.active_with_cart ?? summary.active ?? 0}</span>
          <span>Cart abandoned: {summary.cart_abandoned ?? 0}</span>
          <span>Recovered: {summary.recovered ?? 0}</span>
          {refreshing && <span className="visitors-list-refreshing">Updating…</span>}
        </div>
      )}

      {error && <p className="error-banner">{error}</p>}

      <div className="card">
        <div className="table-wrap">
          <table className="data-table abandoned-carts-table">
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Customer</th>
                <th>Products</th>
                <th>Value</th>
                <th>Last activity</th>
                <th>Idle</th>
              </tr>
            </thead>
            <tbody>
              {loading && !carts.length && (
                <tr><td colSpan={6}>Loading…</td></tr>
              )}
              {(carts.length > 0 || !loading) && carts.map((row) => {
                const cdp = row.cdp_profile;
                const products = row.products ?? [];
                const value = formatMoney(row.estimated_cart_value, row.currency);
                return (
                  <tr key={row.visitor_id}>
                    <td>
                      <Link to={`/visitors/${encodeURIComponent(row.visitor_id)}`} className="visitor-id">
                        <code>{row.visitor_id}</code>
                      </Link>
                    </td>
                    <td>
                      <span className={visitorIsKnown(cdp) ? undefined : 'visitor-muted'}>
                        {visitorListProfileLabel(cdp, row.last_active_profile_label)}
                      </span>
                    </td>
                    <td className="abandoned-carts-products-cell">
                      {products.length === 0 ? (
                        <span className="visitor-muted">—</span>
                      ) : (
                        <ul className="abandoned-carts-product-chips">
                          {products.map((p) => (
                            <li key={p.product_id}>
                              {(p.product_name || p.product_id)} × {p.quantity}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{value}</td>
                    <td>{row.last_activity_at ? formatLocalDateTime(row.last_activity_at) : '—'}</td>
                    <td>{row.idle_minutes != null ? `${row.idle_minutes} min` : '—'}</td>
                  </tr>
                );
              })}
              {!loading && carts.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    No cart abandons for the {thresholdMinutes}-minute threshold (visitors may still be active
                    or have no net cart items).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!loading && total > 0 && (
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={total}
            loading={loading && !carts.length}
            onOffsetChange={setOffset}
            itemLabel="abandoned carts"
          />
        )}
      </div>
    </section>
  );
}
