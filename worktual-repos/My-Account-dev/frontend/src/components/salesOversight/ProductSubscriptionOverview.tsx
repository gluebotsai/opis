// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, Package, TrendingUp } from "lucide-react";

import { UsageBar } from "../UsageBar.tsx";
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
  shouldShowRenewalTimeline,
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../../lib/subscriptionStatus.js";
import { fetchOversightLeadDetail } from "../../lib/salesOversight.js";
import { getLeadById } from "../../lib/leads.js";
import { getSubscriptionUsage } from "../../lib/organizations.js";
import { AdminPageToast } from "../admin/AdminPageToast.tsx";

import "../../styles/admin-users-light.css";
import "../../styles/product-overview.css";

function statusPillModifier(state) {
  const tone = subscriptionStatusTone(state);
  switch (tone) {
    case "qualified":
      return "success";
    case "in-progress":
      return "progress";
    case "inactive":
      return state === "cancelled" || state === "branch_inactive" ? "caution" : "neutral";
    default:
      return "info";
  }
}

function StatusPill({ label, state }) {
  const modifier = statusPillModifier(state);
  return (
    <span className={`product-overview-status-pill product-overview-status-pill--${modifier}`}>
      <span className="product-overview-status-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function DetailItem({ label, value, full = false }) {
  if (value == null || value === "" || value === "—") {
    return null;
  }

  return (
    <div className={full ? "product-overview-grid__full" : undefined}>
      <dt>{label}</dt>
      <dd title={typeof value === "string" ? value : undefined}>{value}</dd>
    </div>
  );
}

export function ProductSubscriptionOverview({
  basePath,
  leadId,
  productKey,
  loadLead = null,
  usageBySubscriptionId: usageBySubscriptionIdProp = null,
  headerActions = null,
}) {
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usageBySubscriptionId, setUsageBySubscriptionId] = useState(
    usageBySubscriptionIdProp || {},
  );

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

  useEffect(() => {
    if (usageBySubscriptionIdProp) {
      setUsageBySubscriptionId(usageBySubscriptionIdProp);
      return undefined;
    }

    let active = true;
    const subscriptions = lead?.subscriptions || [];
    if (!subscriptions.length) {
      setUsageBySubscriptionId({});
      return undefined;
    }

    async function loadUsage() {
      const entries = await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            const usage = await getSubscriptionUsage(subscription.id);
            return [subscription.id, usage];
          } catch {
            return [subscription.id, []];
          }
        }),
      );
      if (active) {
        setUsageBySubscriptionId(Object.fromEntries(entries));
      }
    }

    loadUsage();
    return () => {
      active = false;
    };
  }, [lead?.subscriptions, usageBySubscriptionIdProp]);

  const decodedKey = normalizeProductKeyParam(productKey);
  const dashboard = lead ? buildLeadDashboardModel(lead, usageBySubscriptionId) : null;
  const product = useMemo(
    () => findActiveProductByKey(dashboard?.activeProducts, decodedKey),
    [dashboard, decodedKey],
  );

  const status = product ? summarizeSubscriptionStatus(product, lead?.status) : null;
  const showRenewalTimeline = shouldShowRenewalTimeline(status);
  const monthlyPriceLabel =
    product?.priceLabel ||
    (product
      ? formatCurrency(product.monthlyPrice, product.config?.currency || "INR")
      : "—");
  const companyName = lead?.companyName || "—";
  const productTitle = product?.productName || "Product overview";

  return (
    <section className="admin-users-page product-overview-page">
      <header className="admin-users-page__header product-overview-page__header">
        <button
          className="product-overview-page__back"
          onClick={() => navigate(-1)}
          type="button"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="product-overview-page__header-row">
          <div className="product-overview-page__header-text">
            <h1 title={productTitle}>{productTitle}</h1>
            <p className="admin-users-page__subtitle">
              {companyName}
              {" · "}
              Product usage · Read only
            </p>
          </div>
          {headerActions ? (
            <div className="product-overview-page__actions">{headerActions}</div>
          ) : null}
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />
      {loading ? (
        <p className="route-loading" role="status">
          Loading product…
        </p>
      ) : null}

      {!loading && !product ? (
        <p className="product-overview-empty product-overview-empty--page">
          Product not found for this customer.
        </p>
      ) : null}

      {!loading && product && status ? (
        <>
          <div className="product-overview-layout">
            <section className="admin-users-panel product-overview-panel">
              <div className="admin-users-panel__section-header">
                <div>
                  <h2>
                    <span
                      className="product-overview-panel__icon product-overview-panel__icon--status"
                      aria-hidden="true"
                    >
                      <Package size={16} />
                    </span>
                    Subscription status
                  </h2>
                  <p className="admin-users-panel__subtitle">{status.description}</p>
                </div>
              </div>
              <dl className="product-overview-grid">
                <DetailItem
                  label="Status"
                  value={<StatusPill label={status.label} state={status.state} />}
                />
                <DetailItem label="Plan" value={product.planLabel} />
                <DetailItem label="Branch" value={product.branchLabel} />
                <DetailItem
                  label="Change type"
                  value={getChangeTypeLabel(product.changeType)}
                />
                <DetailItem label="Monthly price" value={monthlyPriceLabel} />
                <DetailItem
                  label="Billing cycle"
                  value={product.subscription?.billingCycle || "monthly"}
                />
                <DetailItem label="Started" value={status.startedOn} />
                <DetailItem
                  label="Renews / ended"
                  value={status.renewsAt || status.expiredOn}
                />
                <DetailItem
                  label="Days remaining"
                  value={
                    status.daysRemaining !== undefined
                      ? String(status.daysRemaining)
                      : undefined
                  }
                />
                <DetailItem label="Activates when" value={status.activatesWhen} full />
                <DetailItem label="Activates on" value={status.activatesOn} />
                <DetailItem label="Reactivates when" value={status.reactivatesWhen} full />
              </dl>
            </section>

            {showRenewalTimeline ? (
              <section className="admin-users-panel product-overview-panel">
                <div className="admin-users-panel__section-header">
                  <div>
                    <h2>
                      <span
                        className="product-overview-panel__icon product-overview-panel__icon--billing"
                        aria-hidden="true"
                      >
                        <CalendarDays size={16} />
                      </span>
                      Billing period
                    </h2>
                    <p className="admin-users-panel__subtitle">
                      Current subscription period progress
                    </p>
                  </div>
                </div>
                <div className="product-overview-billing">
                  <p className="product-overview-copy product-overview-copy--flush">
                    Started {formatDashboardDate(product.subscription?.startedAt)} · Renews{" "}
                    {formatDashboardDate(product.subscription?.renewsAt)}
                  </p>
                  <div
                    aria-hidden="true"
                    className="product-overview-period-bar"
                  >
                    <div
                      className="product-overview-period-bar__fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, product.subscription?.periodProgress ?? 0))}%`,
                      }}
                    />
                  </div>
                  <p className="product-overview-meta">
                    {product.subscription?.daysRemaining ?? 0} days left in current period
                  </p>
                </div>
              </section>
            ) : null}
          </div>

          <section className="admin-users-panel product-overview-panel product-overview-panel--usage">
            <div className="admin-users-panel__section-header">
              <div>
                <h2>
                  <span
                    className="product-overview-panel__icon product-overview-panel__icon--usage"
                    aria-hidden="true"
                  >
                    <TrendingUp size={16} />
                  </span>
                  Usage this period
                </h2>
                <p className="admin-users-panel__subtitle">
                  {product.usage?.length
                    ? `${product.usage.length} metric${product.usage.length === 1 ? "" : "s"}`
                    : "Entitlement usage for the current billing period"}
                </p>
              </div>
            </div>
            <div className="admin-users-panel__body">
              {product.usage?.length ? (
                <div className="product-overview-usage-list">
                  {product.usage.map((metric) => (
                    <UsageBar key={`${product.key}-${metric.label}`} metric={metric} />
                  ))}
                </div>
              ) : (
                <p className="product-overview-empty">
                  {status.isUsable
                    ? "No usage limits configured for this product."
                    : "Usage tracking starts when the product is active."}
                </p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

export function createSalesWorkspaceProductLoader() {
  return async (leadId) => {
    const lead = await getLeadById(leadId);
    return { lead };
  };
}
