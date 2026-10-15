// @ts-nocheck
import { ArrowUpRight, CalendarDays, Package, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { UsageBar } from "../UsageBar.tsx";
import { buildCustomerProductPath } from "../../lib/customerPortal.js";
import { formatCurrency, formatDashboardDate } from "../../lib/leadDashboard.js";
import {
  productPaymentBadge,
  shouldShowRenewalTimeline,
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../../lib/subscriptionStatus.js";
import { canWithdrawCancellationRequest } from "../../lib/branchCancellationRequests.js";

export function CustomerPurchasedProducts({
  dashboard,
  lead,
  emptyMessage = "No active products on your account yet.",
  showUsage = true,
  showUpgradeActions = false,
  showCancellationActions = false,
  pendingCancellationBySubscriptionId = {},
  pendingDropBranchIds = null,
  onRequestCancellation,
  onWithdrawCancellation,
  cancellationBusyId = "",
}) {
  const navigate = useNavigate();
  const blockedBranchIds = pendingDropBranchIds || new Set();

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
        const pendingCancellation =
          entry.subscriptionId
            ? pendingCancellationBySubscriptionId[entry.subscriptionId]
            : null;
        const statusEntry = {
          ...entry,
          cancelAtPeriodEnd:
            entry.cancelAtPeriodEnd === true ||
            pendingCancellation?.status === "approved_scheduled",
          cancelEffectiveAt:
            entry.cancelEffectiveAt || pendingCancellation?.effectiveAt || null,
          scheduledCancellationStatus: pendingCancellation?.status || null,
          scheduledCancelEffectiveAt: pendingCancellation?.effectiveAt || null,
        };
        const productStatus = summarizeSubscriptionStatus(statusEntry, lead?.status);
        const showRenewalTimeline = shouldShowRenewalTimeline(productStatus);
        const hasOpenCancellation =
          Boolean(pendingCancellation) || blockedBranchIds.has(entry.branchId);
        const scheduledDropAt =
          entry.cancelEffectiveAt || pendingCancellation?.effectiveAt || null;
        const cancellationMessage =
          productStatus.state === "cancelling" || productStatus.state === "cancellation_pending"
            ? productStatus.description
            : "";

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
                {entry.planLabel ? (
                  <p className="lead-dashboard-product__plan">Plan: {entry.planLabel}</p>
                ) : null}
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
                {(() => {
                  const paymentBadge = productPaymentBadge(entry);
                  return (
                    <span
                      className={`lead-dashboard-badge lead-dashboard-badge--${paymentBadge.tone}`}
                    >
                      {paymentBadge.label}
                    </span>
                  );
                })()}
                <span className="lead-dashboard-badge">{entry.changeTypeLabel}</span>
                <span className="lead-dashboard-badge lead-dashboard-badge--price">
                  {entry.priceLabel ||
                    formatCurrency(entry.monthlyPrice, entry.config?.currency || "INR")}
                  /mo
                </span>
              </div>
            </div>

            {showRenewalTimeline ? (
              <div className="lead-dashboard-product__period">
                <CalendarDays size={16} />
                <span>
                  Started {formatDashboardDate(entry.subscription.startedAt)} ·{" "}
                  {productStatus.state === "cancelling"
                    ? scheduledDropAt
                      ? `Cancels on ${formatDashboardDate(scheduledDropAt)}`
                      : "Cancels at period end"
                    : `Renews ${formatDashboardDate(entry.subscription.renewsAt)}`}{" "}
                  · {entry.subscription.daysRemaining} days left ({entry.subscription.billingCycle})
                </span>
              </div>
            ) : null}
            {cancellationMessage ? (
              <p className="lead-dashboard-product__cancel-note" role="status">
                {cancellationMessage}
              </p>
            ) : null}

            {showRenewalTimeline ? (
              <div className="lead-dashboard-period-bar">
                <div
                  className="lead-dashboard-period-bar__fill"
                  style={{ width: `${entry.subscription.periodProgress}%` }}
                />
              </div>
            ) : null}

            {showUsage ? (
              <div className="lead-dashboard-usage-list">
                {entry.usage.map((metric) => (
                  <UsageBar key={`${entry.key}-${metric.label}`} metric={metric} />
                ))}
              </div>
            ) : null}

            {(() => {
              const showUpgradeButton = showUpgradeActions && !hasOpenCancellation;
              const pendingRequest = entry.subscriptionId
                ? pendingCancellationBySubscriptionId[entry.subscriptionId]
                : null;
              const showWithdrawButton =
                showCancellationActions &&
                pendingRequest &&
                canWithdrawCancellationRequest(pendingRequest);
              const showRequestCancellationButton =
                showCancellationActions &&
                !pendingRequest &&
                !entry.cancelAtPeriodEnd &&
                productStatus.state !== "cancelling";

              if (!showUpgradeButton && !showWithdrawButton && !showRequestCancellationButton) {
                return null;
              }

              return (
                <div className="customer-product-card__actions">
                  {showUpgradeButton ? (
                    <button
                      className="secondary-button"
                      onClick={(event) => openUpgradeRequest(event, entry.key)}
                      type="button"
                    >
                      <ArrowUpRight size={15} />
                      Request upgrade
                    </button>
                  ) : null}
                  {showWithdrawButton ? (
                    <button
                      className="secondary-button"
                      disabled={cancellationBusyId === pendingRequest.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onWithdrawCancellation?.(pendingRequest.id);
                      }}
                      type="button"
                    >
                      <XCircle size={15} />
                      Withdraw cancellation request
                    </button>
                  ) : null}
                  {showRequestCancellationButton ? (
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
                  ) : null}
                </div>
              );
            })()}
          </article>
        );
      })}
    </div>
  );
}
