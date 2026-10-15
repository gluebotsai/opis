// @ts-nocheck
import { Building2, CheckCircle2, MapPin, Rocket, User } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import { getProductName } from "../../lib/productCatalog.js";
import { formatDashboardDate } from "../../lib/leadDashboard.js";
import { summarizeSubscriptionStatus } from "../../lib/subscriptionStatus.js";

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

export function CustomerOnboardingPage() {
  const { dashboard, lead, loading, error } = useCustomerDashboard();

  if (loading) {
    return <p className="route-loading" role="status">Loading onboarding...</p>;
  }

  if (error) {
    return <AdminPageToast error={error} />;
  }

  if (!dashboard) {
    return null;
  }

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Customer portal</p>
          <h1>Onboarding</h1>
          <p className="page-header__copy">
            Your company profile and implementation status for each subscribed product.
          </p>
        </div>
      </header>

      <div className="lead-dashboard-grid">
        <section className="onboarding-card lead-dashboard-panel">
          <div className="lead-dashboard-panel__heading">
            <div className="lead-dashboard-panel__heading-icon">
              <Building2 size={18} strokeWidth={2} />
            </div>
            <div>
              <h2>Company profile</h2>
              <p>Details used for provisioning and billing.</p>
            </div>
          </div>
          <div className="product-overview-details">
            <DetailRow label="Company" value={dashboard.contact.companyName} />
            <DetailRow label="Tenant ID" value={dashboard.contact.tenantId} />
            <DetailRow label="Industry" value={dashboard.contact.industryType} />
            <DetailRow label="Company size" value={lead?.companySize} />
            <DetailRow label="Country" value={lead?.country} />
            <DetailRow label="Website" value={dashboard.contact.websiteUrl} />
            <DetailRow label="Tax number" value={dashboard.contact.taxNumber} />
            <DetailRow
              label="Customer since"
              value={dashboard.summary.customerSince}
            />
          </div>
        </section>

        <section className="onboarding-card lead-dashboard-panel">
          <div className="lead-dashboard-panel__heading">
            <div className="lead-dashboard-panel__heading-icon">
              <User size={18} strokeWidth={2} />
            </div>
            <div>
              <h2>Primary contact</h2>
              <p>Your account administrator and work contact.</p>
            </div>
          </div>
          <div className="product-overview-details">
            <DetailRow label="Contact name" value={dashboard.contact.contactName} />
            <DetailRow label="Designation" value={dashboard.contact.designation} />
            <DetailRow label="Work email" value={dashboard.contact.workEmail} />
            <DetailRow label="Mobile" value={dashboard.contact.mobile} />
          </div>
        </section>
      </div>

      {/* Hidden for now — single-location UI.
      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <MapPin size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Locations</h2>
            <p>
              {dashboard.locations.length > 1
                ? "Branches and billing addresses on your account."
                : "Your branch location and billing address."}
            </p>
          </div>
        </div>
        <ul className="lead-dashboard-locations">
          {dashboard.locations.map((entry) => (
            <li key={`${entry.label}-${entry.address}`}>
              <MapPin size={16} />
              <span>
                <strong>{entry.label}</strong>
                {entry.country ? <em>{entry.country}</em> : null}
                {entry.taxNumber ? <small>{entry.taxNumber}</small> : null}
                <small>{entry.address}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>
      */}

      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <Rocket size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Product implementation</h2>
            <p>Setup and go-live status for each product on your account.</p>
          </div>
        </div>

        {!dashboard.activeProducts.length ? (
          <p className="sales-oversight-empty">No products to show yet.</p>
        ) : (
          <div className="lead-dashboard-products">
            {dashboard.activeProducts.map((entry) => {
              const status = summarizeSubscriptionStatus(entry, lead?.status);
              const implementationDone =
                entry.implementationPurchased === true ||
                entry.config?.implementationPurchased === true;

              return (
                <article className="lead-dashboard-product" key={entry.key}>
                  <div className="lead-dashboard-product__header">
                    <div>
                      <h3>{entry.productName || getProductName(entry.productId)}</h3>
                      {/* Hidden for now — single-location UI.
                      <p>{entry.branchLabel}</p>
                      */}
                    </div>
                    <div className="lead-dashboard-product__badges">
                      <span className="lead-dashboard-badge">{status.label}</span>
                      <span
                        className={`lead-dashboard-badge lead-dashboard-badge--${implementationDone ? "qualified" : "in-progress"}`}
                      >
                        {implementationDone ? "Implementation complete" : "Implementation included"}
                      </span>
                    </div>
                  </div>
                  <div className="product-overview-details">
                    <DetailRow label="Product" value={getProductName(entry.productId)} />
                    {/* Hidden for now — single-location UI.
                    <DetailRow label="Location" value={entry.branchLabel} />
                    */}
                    <DetailRow label="Status" value={status.description} />
                    <DetailRow
                      label="Activated"
                      value={status.startedOn || formatDashboardDate(entry.approvedAt)}
                    />
                    <DetailRow label="Region" value={entry.config?.region} />
                    <DetailRow label="Billing cycle" value={entry.subscription?.billingCycle} />
                    <DetailRow
                      label="Currency"
                      value={entry.config?.currency || dashboard.summary.currency}
                    />
                  </div>
                  {implementationDone ? (
                    <p className="product-overview-copy">
                      <CheckCircle2 size={14} /> Implementation has been completed for this product.
                    </p>
                  ) : (
                    <p className="product-overview-copy">
                      Implementation is part of your subscription. Our team will coordinate setup
                      using the contact details above.
                    </p>
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
