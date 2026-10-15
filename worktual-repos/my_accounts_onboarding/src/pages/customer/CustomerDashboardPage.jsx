import { useState } from "react";
import {
  Building2,
  CalendarDays,
  Mail,
  MapPin,
  Package,
  Phone,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";

import { CustomerPurchasedProducts } from "../../components/customer/CustomerPurchasedProducts.jsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import { submitCancellationRequest } from "../../lib/branchCancellationRequests.js";
import { formatCurrency } from "../../lib/leadDashboard.js";
import { getCustomerSession, isCustomerBranchUser } from "../../lib/customerAuth.js";

const ACCOUNT_STATS = [
  {
    key: "activeProducts",
    label: "Active products",
    hint: "Your subscribed products",
    icon: Package,
    tone: "subscriptions",
    getValue: (summary) => summary.activeProductCount,
  },
  {
    key: "locations",
    label: "Locations",
    hint: "Account locations",
    icon: MapPin,
    tone: "customers",
    getValue: (summary) => summary.branchCount,
  },
  {
    key: "mrr",
    label: "Monthly recurring",
    hint: "Estimated subscription total",
    icon: TrendingUp,
    tone: "mrr",
    getValue: (summary, format) => format(summary.monthlyRecurring, summary.currency),
  },
  {
    key: "customerSince",
    label: "Customer since",
    hint: "Account start date",
    icon: CalendarDays,
    tone: "renewals",
    getValue: (summary) => summary.customerSince,
  },
];

export function CustomerDashboardPage() {
  const session = getCustomerSession();
  const branchUser = isCustomerBranchUser(session);
  const { dashboard, lead, loading, error } = useCustomerDashboard();
  const [branchDropMessage, setBranchDropMessage] = useState("");
  const [branchDropError, setBranchDropError] = useState("");
  const [branchDropBusy, setBranchDropBusy] = useState("");

  async function handleRequestBranchDrop(location) {
    if ((location.status || "active") === "inactive") {
      return;
    }

    if (location.scheduledDropAt) {
      return;
    }

    const endOfPeriod = window.confirm(
      `Request branch drop for ${location.label}?\n\nDrop at end of the current billing period? (Recommended — branch stays active until the latest product renewal date.)\n\nOK = End of billing period\nCancel = Choose immediate drop instead`,
    );

    if (endOfPeriod === null) {
      return;
    }

    let effectiveTiming = "end_of_period";
    if (!endOfPeriod) {
      const immediate = window.confirm(
        "Drop branch immediately? All products and portal access stop when admin approves.",
      );
      if (!immediate) {
        return;
      }
      effectiveTiming = "immediate";
    }

    const note = window.prompt("Optional note for Worktual admin:", "");
    if (note === null) {
      return;
    }

    setBranchDropBusy(location.id);
    setBranchDropError("");
    setBranchDropMessage("");

    try {
      await submitCancellationRequest({
        requestKind: "drop_branch",
        locationId: location.id,
        customerNote: note.trim(),
        effectiveTiming,
        companyName: lead?.companyName || "",
        domainId: lead?.domainId || "",
      });
      setBranchDropMessage(
        effectiveTiming === "immediate"
          ? "Immediate branch drop request submitted to Worktual admin."
          : "Branch drop at end of billing period submitted to Worktual admin.",
      );
    } catch (dropError) {
      setBranchDropError(
        dropError instanceof Error ? dropError.message : "Could not submit branch drop request.",
      );
    } finally {
      setBranchDropBusy("");
    }
  }

  if (loading) {
    return <p className="route-loading" role="status">Loading dashboard...</p>;
  }

  if (error) {
    return <div className="form-error-banner">{error}</div>;
  }

  if (!dashboard) {
    return null;
  }

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Customer portal</p>
          <h1>{dashboard.contact.companyName}</h1>
          <p className="page-header__copy">
            Welcome{session?.displayName ? `, ${session.displayName}` : ""}.
            {branchUser
              ? ` You are viewing ${session?.locationLabel || "your branch"} only.`
              : " Review your subscriptions, usage, and account details across all branches."}
          </p>
        </div>
      </header>

      {branchDropMessage ? <div className="form-success-banner">{branchDropMessage}</div> : null}
      {branchDropError ? <div className="form-error-banner">{branchDropError}</div> : null}

      <div className="lead-dashboard-stats">
        {ACCOUNT_STATS.map((stat) => {
          const Icon = stat.icon;
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
                <span className="sales-dashboard-stat-card__hint">{stat.hint}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="lead-dashboard-grid">
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Account contact</h2>
          <dl className="lead-dashboard-details">
            <div>
              <dt>
                <User size={14} /> Contact
              </dt>
              <dd>{dashboard.contact.contactName}</dd>
            </div>
            <div>
              <dt>Domain ID</dt>
              <dd>{dashboard.contact.domainId || "—"}</dd>
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
              <dt>
                <Phone size={14} /> Mobile
              </dt>
              <dd>{dashboard.contact.mobile || "—"}</dd>
            </div>
            <div>
              <dt>Industry</dt>
              <dd>{dashboard.contact.industryType || "—"}</dd>
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
                  <strong>
                    {entry.label}
                    {(entry.status || "active") === "inactive"
                      ? " (Inactive)"
                      : entry.scheduledDropAt
                        ? " (Drop scheduled)"
                        : ""}
                  </strong>
                  <small>{entry.address}</small>
                </span>
                {(entry.status || "active") !== "inactive" &&
                !entry.scheduledDropAt &&
                (!branchUser || session?.locationId === entry.id) ? (
                  <button
                    className="secondary-button"
                    disabled={branchDropBusy === entry.id}
                    onClick={() => handleRequestBranchDrop(entry)}
                    type="button"
                  >
                    <XCircle size={14} />
                    Request branch drop
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <Package size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Your products</h2>
            <p>Active subscriptions with renewal dates and current usage.</p>
          </div>
        </div>

        <CustomerPurchasedProducts dashboard={dashboard} lead={lead} />
      </section>
    </section>
  );
}
