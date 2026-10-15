import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, Package, TrendingUp } from "lucide-react";

import { UsageBar } from "../UsageBar.jsx";
import {
  buildLeadDashboardModel,
  formatCurrency,
  formatDashboardDate,
} from "../../lib/leadDashboard.js";
import {
  findActiveProductByKey,
  getChangeTypeLabel,
  normalizeProductKeyParam,
} from "../../lib/activeProducts.js";
import {
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../../lib/subscriptionStatus.js";
import { fetchOversightLeadDetail } from "../../lib/salesOversight.js";
import { getLeadById } from "../../lib/leads.js";

function StatusBadge({ label, state }) {
  const tone = subscriptionStatusTone(state);

  return (
    <span className={`lead-status lead-status--${tone}`}>
      <span className="lead-status__dot" />
      {label}
    </span>
  );
}

function DetailRow({ label, value }) {
  if (!value || value === "—") {
    return null;
  }

  return (
    <div className="product-overview-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ProductSubscriptionOverview({
  basePath,
  leadId,
  productKey,
  loadLead = null,
  usageBySubscriptionId = {},
}) {
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      if (loadLead) {
        const data = await loadLead(leadId);
        setLead(data?.lead || data);
      } else {
        const data = await fetchOversightLeadDetail(leadId);
        setLead(data.lead);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load product.");
    } finally {
      setLoading(false);
    }
  }, [leadId, loadLead]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const decodedKey = normalizeProductKeyParam(productKey);
  const dashboard = lead ? buildLeadDashboardModel(lead, usageBySubscriptionId) : null;
  const product = useMemo(
    () => findActiveProductByKey(dashboard?.activeProducts, decodedKey),
    [dashboard, decodedKey],
  );

  const status = product ? summarizeSubscriptionStatus(product, lead?.status) : null;

  return (
    <div className="sales-oversight-page product-overview-page lead-dashboard-page">
      <header className="page-header">
        <button
          className="ghost-button sales-oversight-back"
          onClick={() => navigate(-1)}
          type="button"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div>
          <p className="page-eyebrow">Product usage · Read only</p>
          <h1>{product?.productName || "Product overview"}</h1>
          <p>{lead?.companyName || "—"}</p>
        </div>
      </header>

      {error ? <div className="form-error-banner">{error}</div> : null}
      {loading ? <p className="route-loading" role="status">Loading product...</p> : null}

      {!loading && !product ? (
        <p className="sales-oversight-empty">Product not found for this customer.</p>
      ) : null}

      {!loading && product && status ? (
        <>
          <section className="sales-dashboard-summary">
            <article className="sales-dashboard-stat-card">
              <div>
                <span>Status</span>
                <StatusBadge label={status.label} state={status.state} />
              </div>
            </article>
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--subscriptions">
              <div>
                <span>Branch</span>
                <strong>{product.branchLabel}</strong>
              </div>
            </article>
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--mrr">
              <div>
                <span>Monthly price</span>
                <strong>
                  {product.priceLabel ||
                    formatCurrency(product.monthlyPrice, product.config?.currency || "INR")}
                </strong>
              </div>
            </article>
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--finance">
              <div>
                <span>Billing cycle</span>
                <strong>{product.subscription?.billingCycle || "monthly"}</strong>
              </div>
            </article>
          </section>

          <div className="sales-oversight-grid">
            <section className="panel-card">
              <div className="panel-card__header">
                <h2>
                  <Package size={18} />
                  Subscription status
                </h2>
              </div>
              <p className="product-overview-copy">{status.description}</p>
              <div className="product-overview-details">
                <DetailRow label="Change type" value={getChangeTypeLabel(product.changeType)} />
                <DetailRow label="Started" value={status.startedOn} />
                <DetailRow label="Renews / ended" value={status.renewsAt || status.expiredOn} />
                <DetailRow
                  label="Days remaining"
                  value={
                    status.daysRemaining !== undefined ? String(status.daysRemaining) : undefined
                  }
                />
                <DetailRow label="Activates when" value={status.activatesWhen} />
                <DetailRow label="Activates on" value={status.activatesOn} />
                <DetailRow label="Reactivates when" value={status.reactivatesWhen} />
              </div>
            </section>

            <section className="panel-card">
              <div className="panel-card__header">
                <h2>
                  <CalendarDays size={18} />
                  Billing period
                </h2>
              </div>
              <p className="product-overview-copy">
                Started {formatDashboardDate(product.subscription?.startedAt)} · Renews{" "}
                {formatDashboardDate(product.subscription?.renewsAt)}
              </p>
              <div className="lead-dashboard-period-bar product-overview-period-bar">
                <div
                  className="lead-dashboard-period-bar__fill"
                  style={{ width: `${product.subscription?.periodProgress ?? 0}%` }}
                />
              </div>
              <p className="product-overview-meta">
                {product.subscription?.daysRemaining ?? 0} days left in current period
              </p>
            </section>
          </div>

          <section className="panel-card">
            <div className="panel-card__header">
              <h2>
                <TrendingUp size={18} />
                Usage this period
              </h2>
            </div>
            {product.usage?.length ? (
              <div className="lead-dashboard-usage-list">
                {product.usage.map((metric) => (
                  <UsageBar key={`${product.key}-${metric.label}`} metric={metric} />
                ))}
              </div>
            ) : (
              <p className="sales-oversight-empty">
                {status.isUsable
                  ? "No usage limits configured for this product."
                  : "Usage tracking starts when the product is active."}
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export function createSalesWorkspaceProductLoader() {
  return async (leadId) => {
    const lead = await getLeadById(leadId);
    return { lead };
  };
}
