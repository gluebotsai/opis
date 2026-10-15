import { Activity, AlertTriangle, CalendarDays, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { UsageBar } from "../../components/UsageBar.jsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import { buildCustomerProductPath } from "../../lib/customerPortal.js";
import { formatDashboardDate } from "../../lib/leadDashboard.js";
import { summarizeSubscriptionStatus } from "../../lib/subscriptionStatus.js";

export function CustomerOperationalHubPage() {
  const navigate = useNavigate();
  const { dashboard, lead, loading, error } = useCustomerDashboard();

  if (loading) {
    return <p className="route-loading" role="status">Loading operational hub...</p>;
  }

  if (error) {
    return <div className="form-error-banner">{error}</div>;
  }

  if (!dashboard) {
    return null;
  }

  const renewalAlerts = dashboard.activeProducts.filter(
    (entry) => entry.subscription?.daysRemaining <= 30,
  );

  const usageAlerts = dashboard.activeProducts.flatMap((entry) =>
    entry.usage
      .filter((metric) => metric.percentUsed >= 80)
      .map((metric) => ({
        productName: entry.productName,
        productKey: entry.key,
        metric,
      })),
  );

  const avgUsage =
    dashboard.activeProducts.length > 0
      ? Math.round(
          dashboard.activeProducts.reduce((sum, entry) => {
            const productAvg =
              entry.usage.length > 0
                ? entry.usage.reduce((inner, metric) => inner + metric.percentUsed, 0) /
                  entry.usage.length
                : 0;
            return sum + productAvg;
          }, 0) / dashboard.activeProducts.length,
        )
      : 0;

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Customer portal</p>
          <h1>Operational hub</h1>
          <p className="page-header__copy">
            Cross-product usage, renewals, and operational health for your account.
          </p>
        </div>
      </header>

      <div className="lead-dashboard-stats">
        <article className="sales-dashboard-stat-card onboarding-card">
          <div className="sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--subscriptions">
            <Package size={20} strokeWidth={2} />
          </div>
          <div className="sales-dashboard-stat-card__body">
            <span className="sales-dashboard-stat-card__label">Active products</span>
            <strong className="sales-dashboard-stat-card__value">
              {dashboard.summary.activeProductCount}
            </strong>
            <span className="sales-dashboard-stat-card__hint">Live subscriptions</span>
          </div>
        </article>
        <article className="sales-dashboard-stat-card onboarding-card">
          <div className="sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--mrr">
            <Activity size={20} strokeWidth={2} />
          </div>
          <div className="sales-dashboard-stat-card__body">
            <span className="sales-dashboard-stat-card__label">Avg usage</span>
            <strong className="sales-dashboard-stat-card__value sales-dashboard-stat-card__value--percent">
              {avgUsage}%
            </strong>
            <span className="sales-dashboard-stat-card__hint">Across all products</span>
          </div>
        </article>
        <article className="sales-dashboard-stat-card onboarding-card">
          <div className="sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--renewals">
            <CalendarDays size={20} strokeWidth={2} />
          </div>
          <div className="sales-dashboard-stat-card__body">
            <span className="sales-dashboard-stat-card__label">Renewals soon</span>
            <strong className="sales-dashboard-stat-card__value">{renewalAlerts.length}</strong>
            <span className="sales-dashboard-stat-card__hint">Within 30 days</span>
          </div>
        </article>
        <article className="sales-dashboard-stat-card onboarding-card">
          <div className="sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--finance">
            <AlertTriangle size={20} strokeWidth={2} />
          </div>
          <div className="sales-dashboard-stat-card__body">
            <span className="sales-dashboard-stat-card__label">Usage alerts</span>
            <strong className="sales-dashboard-stat-card__value">{usageAlerts.length}</strong>
            <span className="sales-dashboard-stat-card__hint">Above 80% consumed</span>
          </div>
        </article>
      </div>

      {renewalAlerts.length > 0 ? (
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Upcoming renewals</h2>
          <div className="lead-dashboard-products">
            {renewalAlerts.map((entry) => (
              <article
                className="lead-dashboard-product lead-dashboard-product--clickable"
                key={entry.key}
                onClick={() => navigate(buildCustomerProductPath(entry.key))}
                role="button"
                tabIndex={0}
              >
                <div className="lead-dashboard-product__header">
                  <div>
                    <h3>{entry.productName}</h3>
                    <p>{entry.branchLabel}</p>
                  </div>
                  <span className="lead-dashboard-badge lead-dashboard-badge--in-progress">
                    {entry.subscription.daysRemaining} days left
                  </span>
                </div>
                <p className="product-overview-copy">
                  Renews {formatDashboardDate(entry.subscription.renewsAt)}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="onboarding-card lead-dashboard-panel">
        <h2>Usage by product</h2>
        {!dashboard.activeProducts.length ? (
          <p className="sales-oversight-empty">No usage data available yet.</p>
        ) : (
          <div className="lead-dashboard-products">
            {dashboard.activeProducts.map((entry) => {
              const status = summarizeSubscriptionStatus(entry, lead?.status);

              return (
                <article
                  className="lead-dashboard-product lead-dashboard-product--clickable"
                  key={entry.key}
                  onClick={() => navigate(buildCustomerProductPath(entry.key))}
                  role="button"
                  tabIndex={0}
                >
                  <div className="lead-dashboard-product__header">
                    <div>
                      <h3>{entry.productName}</h3>
                      <p>
                        {entry.branchLabel} · {status.label}
                      </p>
                    </div>
                  </div>
                  {entry.usage.length ? (
                    <div className="lead-dashboard-usage-list">
                      {entry.usage.map((metric) => (
                        <UsageBar key={`${entry.key}-${metric.label}`} metric={metric} />
                      ))}
                    </div>
                  ) : (
                    <p className="product-overview-copy">No usage limits configured.</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
