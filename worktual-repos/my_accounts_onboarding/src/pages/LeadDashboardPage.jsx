import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  Mail,
  MapPin,
  Package,
  Phone,
  ShoppingCart,
  TrendingUp,
  User,
  KeyRound,
} from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import {
  buildLeadDashboardModel,
  formatCurrency,
  formatDashboardDate,
} from "../lib/leadDashboard.js";
import { getLeadById } from "../lib/leads.js";
import { getSubscriptionUsage } from "../lib/organizations.js";
import { fetchLeadPayment, isPaymentPaid, paymentStatusLabel } from "../lib/payments.js";
import { provisionCustomerPortalAccess } from "../lib/customerAuth.js";
import {
  listCustomerPortalUsers,
  provisionBranchPortalAccess,
} from "../lib/customerPortalAccess.js";
import { buildSalesWorkspaceProductOverviewPath } from "../lib/activeProducts.js";
import {
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../lib/subscriptionStatus.js";

const ACCOUNT_STATS = [
  {
    key: "activeProducts",
    label: "Active products",
    hint: (summary) =>
      summary.activeProductCount === 0
        ? summary.status === "Paid"
          ? "Payment recorded — products syncing"
          : "No active products yet"
        : "Approved subscriptions",
    icon: Package,
    tone: "subscriptions",
    getValue: (summary) => summary.activeProductCount,
  },
  {
    key: "locations",
    label: "Locations",
    hint: "Active locations",
    icon: MapPin,
    tone: "customers",
    getValue: (summary) => summary.branchCount,
  },
  {
    key: "mrr",
    label: "Est. monthly recurring",
    hint: "Estimated MRR",
    icon: TrendingUp,
    tone: "mrr",
    getValue: (summary, format) => format(summary.monthlyRecurring, summary.currency),
  },
  {
    key: "customerSince",
    label: "Customer since",
    hint: "Onboarded date",
    icon: CalendarDays,
    tone: "renewals",
    getValue: (summary) => summary.customerSince,
  },
];

function StatusBadge({ status }) {
  const tone =
    status === "Paid"
      ? "qualified"
      : status === "Approved"
      ? "qualified"
      : status === "Rejected"
        ? "inactive"
        : status === "Pending Finance Review"
          ? "in-progress"
          : "new";

  return (
    <span className={`lead-status lead-status--${tone}`}>
      <span className="lead-status__dot" />
      {status}
    </span>
  );
}

import { UsageBar } from "../components/UsageBar.jsx";

function PanelHeading({ icon: Icon, title, description }) {
  return (
    <div className="lead-dashboard-panel__heading">
      <div className="lead-dashboard-panel__heading-icon">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  );
}

export function LeadDashboardPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [statusSyncError, setStatusSyncError] = useState("");
  const [portalAccess, setPortalAccess] = useState(null);
  const [portalAccessError, setPortalAccessError] = useState("");
  const [portalAccessLoading, setPortalAccessLoading] = useState(false);
  const [portalDirectory, setPortalDirectory] = useState(null);
  const [branchAccessById, setBranchAccessById] = useState({});
  const [branchAccessLoadingId, setBranchAccessLoadingId] = useState("");
  const [paymentRecord, setPaymentRecord] = useState(null);
  const [paymentError, setPaymentError] = useState("");
  const [usageBySubscriptionId, setUsageBySubscriptionId] = useState({});

  const refreshLead = useCallback(async () => {
    try {
      const nextLead = await getLeadById(leadId);
      setLead(nextLead);
      setStatusSyncError("");
    } catch (error) {
      setStatusSyncError(
        error instanceof Error ? error.message : "Could not load lead.",
      );
    } finally {
      setLeadLoading(false);
    }
  }, [leadId]);

  const syncQuotationStatuses = useCallback(async () => {
    await refreshLead();
  }, [refreshLead]);

  useEffect(() => {
    refreshLead();
    syncQuotationStatuses();
  }, [refreshLead, syncQuotationStatuses]);

  useEffect(() => {
    let active = true;

    async function loadPayment() {
      if (lead?.status !== "Approved" && lead?.status !== "Paid") {
        setPaymentRecord(null);
        return;
      }

      try {
        const data = await fetchLeadPayment(leadId);
        if (active) {
          setPaymentRecord(data);
          setPaymentError("");
        }
      } catch (error) {
        if (active) {
          setPaymentRecord(null);
          setPaymentError(
            error instanceof Error ? error.message : "Could not load payment link.",
          );
        }
      }
    }

    loadPayment();
    return () => {
      active = false;
    };
  }, [lead?.status, leadId]);

  async function handleProvisionPortalAccess() {
    setPortalAccessError("");
    setPortalAccessLoading(true);
    try {
      const access = await provisionCustomerPortalAccess(leadId);
      setPortalAccess(access);
      const directory = await listCustomerPortalUsers(leadId);
      setPortalDirectory(directory);
    } catch (error) {
      setPortalAccessError(
        error instanceof Error ? error.message : "Could not provision customer portal access.",
      );
    } finally {
      setPortalAccessLoading(false);
    }
  }

  async function handleProvisionBranchAccess(locationId) {
    setPortalAccessError("");
    setBranchAccessLoadingId(locationId);
    try {
      const access = await provisionBranchPortalAccess(leadId, locationId);
      setBranchAccessById((current) => ({ ...current, [locationId]: access }));
      const directory = await listCustomerPortalUsers(leadId);
      setPortalDirectory(directory);
    } catch (error) {
      setPortalAccessError(
        error instanceof Error ? error.message : "Could not provision branch portal access.",
      );
    } finally {
      setBranchAccessLoadingId("");
    }
  }

  useEffect(() => {
    if (lead?.status !== "Paid") {
      setPortalDirectory(null);
      return undefined;
    }

    let active = true;

    async function loadPortalDirectory() {
      try {
        const directory = await listCustomerPortalUsers(leadId);
        if (active) {
          setPortalDirectory(directory);
        }
      } catch {
        if (active) {
          setPortalDirectory(null);
        }
      }
    }

    loadPortalDirectory();
    return () => {
      active = false;
    };
  }, [lead?.status, leadId]);

  useEffect(() => {
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
  }, [lead?.subscriptions]);

  const dashboard = useMemo(
    () => buildLeadDashboardModel(lead, usageBySubscriptionId),
    [lead, usageBySubscriptionId],
  );

  if (leadLoading) {
    return null;
  }

  if (!lead) {
    return <Navigate replace to="/products" />;
  }

  if (!dashboard) {
    return null;
  }

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <button
            className="lead-dashboard-page__back"
            onClick={() => navigate("/products")}
            type="button"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          {/* <p className="eyebrow">Account overview</p> */}
          <h1>{dashboard.contact.companyName}</h1>
          <p className="page-header__copy">
            Sales view of purchased products, subscription period, and usage before starting a
            new quote.
          </p>
        </div>
        <div className="page-header__actions">
          <StatusBadge status={dashboard.summary.status} />
        </div>
      </header>

      {statusSyncError ? <p className="form-error">{statusSyncError}</p> : null}

      <div className="lead-dashboard-stats">
        {ACCOUNT_STATS.map((stat) => {
          const Icon = stat.icon;
          const hint = typeof stat.hint === "function" ? stat.hint(dashboard.summary) : stat.hint;
          const value =
            stat.key === "mrr"
              ? stat.getValue(dashboard.summary, formatCurrency)
              : stat.getValue(dashboard.summary);

          return (
            <article key={stat.key} className="sales-dashboard-stat-card onboarding-card">
              <div
                className={`sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--${stat.tone}`}
              >
                <Icon size={20} strokeWidth={2} />
              </div>
              <div className="sales-dashboard-stat-card__body">
                <span className="sales-dashboard-stat-card__label">{stat.label}</span>
                <strong className="sales-dashboard-stat-card__value">{value}</strong>
                <span className="sales-dashboard-stat-card__hint">{hint}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="lead-dashboard-grid">
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Customer details</h2>
          <dl className="lead-dashboard-details">
            <div>
              <dt>
                <User size={14} /> Contact
              </dt>
              <dd>{dashboard.contact.contactName}</dd>
            </div>
            <div>
              <dt>Domain ID</dt>
              <dd>{dashboard.contact.domainId}</dd>
            </div>
            <div>
              <dt>
                <Mail size={14} /> Work email
              </dt>
              <dd>{dashboard.contact.workEmail || "—"}</dd>
            </div>
            <div>
              <dt>
                <Building2 size={14} /> Admin email
              </dt>
              <dd>{dashboard.contact.adminEmail || "—"}</dd>
            </div>
            <div>
              <dt>Designation</dt>
              <dd>{dashboard.contact.designation || "—"}</dd>
            </div>
            <div>
              <dt>Industry</dt>
              <dd>{dashboard.contact.industryType || "—"}</dd>
            </div>
            <div>
              <dt>
                <Phone size={14} /> Mobile
              </dt>
              <dd>{dashboard.contact.mobile || "—"}</dd>
            </div>
            <div>
              <dt>Tax number</dt>
              <dd>{dashboard.contact.taxNumber || "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="onboarding-card lead-dashboard-panel">
          <h2>Locations</h2>
          <ul className="lead-dashboard-locations">
            {dashboard.locations.map((entry) => (
              <li key={`${entry.label}-${entry.address}`}>
                <MapPin size={16} />
                <span>
                  <strong>{entry.label}</strong>
                  <small>{entry.address}</small>
                </span>
              </li>
            ))}
          </ul>

          {dashboard.finance.note ? (
            <div className="lead-dashboard-finance-note">
              <strong>Latest finance note</strong>
              <p>{dashboard.finance.note}</p>
              {dashboard.finance.reviewedAt ? (
                <small>
                  {formatDashboardDate(dashboard.finance.reviewedAt)}
                  {dashboard.finance.reviewedBy ? ` · ${dashboard.finance.reviewedBy}` : ""}
                </small>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <section className="onboarding-card lead-dashboard-panel">
        <PanelHeading
          description="Current subscriptions, renewal dates, and usage from the sales perspective."
          icon={Package}
          title="Purchased products"
        />

        {dashboard.activeProducts.length === 0 ? (
          <div className="lead-dashboard-empty-state">
            <div className="lead-dashboard-empty-state__icon">
              <Package size={28} strokeWidth={1.5} />
            </div>
            <p>
              {lead?.status === "Paid"
                ? "Payment is recorded, but purchased products are still syncing. Refresh the page in a moment."
                : "No approved purchases yet. Use Purchase below to create the first quotation."}
            </p>
          </div>
        ) : (
          <div className="lead-dashboard-products">
            {dashboard.activeProducts.map((entry) => {
              const productStatus = summarizeSubscriptionStatus(entry, lead?.status);

              return (
              <article
                className="lead-dashboard-product lead-dashboard-product--clickable"
                key={entry.key}
                onClick={() => navigate(buildSalesWorkspaceProductOverviewPath(leadId, entry.key))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(buildSalesWorkspaceProductOverviewPath(leadId, entry.key));
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
                    {entry.subscription.daysRemaining} days left (
                    {entry.subscription.billingCycle})
                  </span>
                  {entry.subscription.daysRemaining <= 30 ? (
                    <button
                      className="secondary-button lead-dashboard-product__renewal"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/products/${leadId}/workflow`, {
                          state: {
                            freshQuote: true,
                            renewal: true,
                            subscriptionId: entry.subscriptionId,
                          },
                        });
                      }}
                      type="button"
                    >
                      Create renewal quote
                    </button>
                  ) : null}
                </div>

                <div className="lead-dashboard-period-bar">
                  <div
                    className="lead-dashboard-period-bar__fill"
                    style={{ width: `${entry.subscription.periodProgress}%` }}
                  />
                </div>

                <div className="lead-dashboard-usage-list">
                  {entry.usage.map((metric) => (
                    <UsageBar key={`${entry.key}-${metric.label}`} metric={metric} />
                  ))}
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>

      {(lead?.status === "Approved" || lead?.status === "Paid") ? (
        <section className="onboarding-card lead-dashboard-panel payment-forward-panel">
          <PanelHeading
            description={
              isPaymentPaid(paymentRecord?.payment)
                ? "Customer payment has been received and recorded."
                : "Finance approved this quotation. The customer was emailed from the sales mailbox with the payment link."
            }
            icon={CreditCard}
            title={isPaymentPaid(paymentRecord?.payment) ? "Payment received" : "Payment follow-up"}
          />

          {paymentRecord?.payment ? (
            <div className="lead-dashboard-payment-box">
              <div className="payment-forward-summary">
                <CreditCard size={18} />
                <div>
                  <strong>{paymentRecord.payment.amountLabel || "Payment due"}</strong>
                  <p>{paymentStatusLabel(paymentRecord.payment)}</p>
                  {!isPaymentPaid(paymentRecord.payment) ? (
                    <a href={paymentRecord.payment.paymentLinkUrl} rel="noreferrer" target="_blank">
                      {paymentRecord.payment.paymentLinkUrl}
                    </a>
                  ) : paymentRecord.payment.paidAt ? (
                    <small>Paid on {new Date(paymentRecord.payment.paidAt).toLocaleString()}</small>
                  ) : null}
                  <small>
                    Provider: {paymentRecord.payment.provider || "stripe"}
                    {paymentRecord.payment.dryRun ? " · demo mode" : ""}
                  </small>
                </div>
                {!isPaymentPaid(paymentRecord.payment) ? (
                  <button
                    className="primary-button"
                    onClick={() => navigate(`/products/${leadId}/payment-forward`)}
                    type="button"
                  >
                    <Mail size={18} />
                    Forward again to customer
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="lead-dashboard-empty">
              {paymentError ||
                "Payment link is not available yet. Ask finance to approve the latest quotation."}
            </p>
          )}
        </section>
      ) : null}

      {lead?.status === "Paid" ? (
        <section className="onboarding-card lead-dashboard-panel customer-portal-panel">
          <PanelHeading
            description="Company admin sees all branches and products. Branch users only see their own branch after you enable access."
            icon={KeyRound}
            title="Customer portal access"
          />
          <div className="customer-portal-access">
            <div className="customer-portal-access__section">
              <strong>Company admin (all branches)</strong>
              <p className="customer-portal-access__hint">
                Uses the lead admin email. This login can view every branch and product.
              </p>
              {(portalDirectory?.users || []).some(
                (user) => user.role === "org_admin" && !user.locationId,
              ) ? (
                <p className="customer-portal-access__status">
                  Company admin portal enabled for{" "}
                  {
                    (portalDirectory?.users || []).find(
                      (user) => user.role === "org_admin" && !user.locationId,
                    )?.email
                  }
                </p>
              ) : null}
              <button
                className="secondary-button"
                disabled={portalAccessLoading}
                onClick={handleProvisionPortalAccess}
                type="button"
              >
                {portalAccessLoading ? "Generating..." : "Generate company admin credentials"}
              </button>
              {portalAccess ? (
                <div className="customer-portal-access__details">
                  <p>
                    <strong>Login URL:</strong>{" "}
                    <a href={portalAccess.loginUrl} rel="noreferrer" target="_blank">
                      {portalAccess.loginUrl}
                    </a>
                  </p>
                  <p>
                    <strong>Email:</strong> {portalAccess.email}
                  </p>
                  <p>
                    <strong>Temporary password:</strong>{" "}
                    <code>{portalAccess.temporaryPassword}</code>
                  </p>
                </div>
              ) : null}
            </div>

            {(portalDirectory?.locations || [])
              .filter((location) => !location.isPrimary)
              .map((location) => {
                const existingUser = (portalDirectory?.users || []).find(
                  (user) =>
                    user.role === "branch_user" && user.locationId === location.id,
                );
                const issuedAccess = branchAccessById[location.id];

                return (
                  <div className="customer-portal-access__section" key={location.id}>
                    <strong>{location.label || "Branch"}</strong>
                    <p className="customer-portal-access__hint">
                      Branch login email: {location.workEmail || "Add work email in onboarding"}
                    </p>
                    {existingUser ? (
                      <p className="customer-portal-access__status">
                        Branch portal enabled for {existingUser.email}
                      </p>
                    ) : null}
                    <button
                      className="secondary-button"
                      disabled={
                        !location.workEmail || branchAccessLoadingId === location.id
                      }
                      onClick={() => handleProvisionBranchAccess(location.id)}
                      type="button"
                    >
                      {branchAccessLoadingId === location.id
                        ? "Generating..."
                        : existingUser
                          ? "Reset branch credentials"
                          : "Enable branch portal access"}
                    </button>
                    {issuedAccess ? (
                      <div className="customer-portal-access__details">
                        <p>
                          <strong>Email:</strong> {issuedAccess.email}
                        </p>
                        <p>
                          <strong>Temporary password:</strong>{" "}
                          <code>{issuedAccess.temporaryPassword}</code>
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            {portalAccessError ? <p className="form-error">{portalAccessError}</p> : null}
          </div>
        </section>
      ) : null}

      <section className="lead-dashboard-cta onboarding-card">
        <PanelHeading
          description={`Add products, upgrade existing subscriptions, or attach add-ons for ${dashboard.contact.companyName}.`}
          icon={ShoppingCart}
          title="Start a new purchase"
        />
        <button
          className="primary-button"
          onClick={() => navigate(`/products/${leadId}/workflow`, { state: { freshQuote: true } })}
          type="button"
        >
          <ShoppingCart size={18} />
          Purchase / new quote
        </button>
      </section>
    </section>
  );
}
