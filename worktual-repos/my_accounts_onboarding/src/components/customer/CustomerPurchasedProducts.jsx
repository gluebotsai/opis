import { ArrowUpRight, CalendarDays, Package, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { UsageBar } from "../UsageBar.jsx";
import { buildCustomerProductPath } from "../../lib/customerPortal.js";
import { formatCurrency, formatDashboardDate } from "../../lib/leadDashboard.js";
import {
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../../lib/subscriptionStatus.js";

export function CustomerPurchasedProducts({
  dashboard,
  lead,
  emptyMessage = "No active products on your account yet.",
  showUsage = true,
  showUpgradeActions = false,
  showCancellationActions = false,
  pendingCancellationBySubscriptionId = {},
  onRequestCancellation,
  onWithdrawCancellation,
  cancellationBusyId = "",
}) {
  const navigate = useNavigate();

  function openUpgradeRequest(event, productKey) {
    event.stopPropagation();
    navigate(`/customer/products/${encodeURIComponent(productKey)}/request`);
  }

  if (!dashboard?.activeProducts?.length) {
    return (
      <div className="lead-dashboard-empty-state">
        <div className="lead-dashboard-empty-state__icon">
          <Package size={28} strokeWidth={1.5} />
        </div>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="lead-dashboard-products">
      {dashboard.activeProducts.map((entry) => {
        const productStatus = summarizeSubscriptionStatus(entry, lead?.status);

        return (
          <article
            className="lead-dashboard-product lead-dashboard-product--clickable"
            key={entry.key}
            onClick={() => navigate(buildCustomerProductPath(entry.key))}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate(buildCustomerProductPath(entry.key));
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="lead-dashboard-product__header">
              <div>
                <h3>{entry.productName}</h3>
                <p>
                  {entry.branchLabel}
                  {entry.billingLabel !== entry.branchLabel
                    ? ` · billed to ${entry.billingLabel}`
                    : ""}
                </p>
              </div>
              <div className="lead-dashboard-product__badges">
                <span
                  className={`lead-dashboard-badge lead-dashboard-badge--${subscriptionStatusTone(productStatus.state)}`}
                >
                  {productStatus.label}
                </span>
                <span className="lead-dashboard-badge">{entry.changeTypeLabel}</span>
                <span className="lead-dashboard-badge lead-dashboard-badge--price">
                  {entry.priceLabel ||
                    formatCurrency(entry.monthlyPrice, entry.config?.currency || "INR")}
                  /mo
                </span>
              </div>
            </div>

            <div className="lead-dashboard-product__period">
              <CalendarDays size={16} />
              <span>
                Started {formatDashboardDate(entry.subscription.startedAt)} · Renews{" "}
                {formatDashboardDate(entry.subscription.renewsAt)} ·{" "}
                {entry.subscription.daysRemaining} days left ({entry.subscription.billingCycle})
              </span>
            </div>

            <div className="lead-dashboard-period-bar">
              <div
                className="lead-dashboard-period-bar__fill"
                style={{ width: `${entry.subscription.periodProgress}%` }}
              />
            </div>

            {showUsage ? (
              <div className="lead-dashboard-usage-list">
                {entry.usage.map((metric) => (
                  <UsageBar key={`${entry.key}-${metric.label}`} metric={metric} />
                ))}
              </div>
            ) : null}

            {showUpgradeActions || showCancellationActions ? (
              <div className="customer-product-card__actions">
                {showUpgradeActions ? (
                  <button
                    className="secondary-button"
                    onClick={(event) => openUpgradeRequest(event, entry.key)}
                    type="button"
                  >
                    <ArrowUpRight size={15} />
                    Request upgrade
                  </button>
                ) : null}
                {showCancellationActions ? (
                  pendingCancellationBySubscriptionId[entry.subscriptionId] ? (
                    <button
                      className="secondary-button"
                      disabled={cancellationBusyId === pendingCancellationBySubscriptionId[entry.subscriptionId].id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onWithdrawCancellation?.(
                          pendingCancellationBySubscriptionId[entry.subscriptionId].id,
                        );
                      }}
                      type="button"
                    >
                      <XCircle size={15} />
                      {pendingCancellationBySubscriptionId[entry.subscriptionId].status ===
                      "approved_scheduled"
                        ? "Withdraw scheduled cancellation"
                        : "Withdraw cancellation request"}
                    </button>
                  ) : entry.cancelAtPeriodEnd ? (
                    <span className="lead-dashboard-badge">Cancels at period end</span>
                  ) : (
                    <button
                      className="secondary-button"
                      disabled={!entry.subscriptionId || cancellationBusyId === entry.subscriptionId}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRequestCancellation?.(entry);
                      }}
                      type="button"
                    >
                      <XCircle size={15} />
                      Request cancellation
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
