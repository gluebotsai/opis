// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Inbox,
  IndianRupee,
  Package,
  Users,
} from "lucide-react";

import {
  buildLeadDashboardModel,
  formatCurrency,
  formatDashboardDate,
} from "../../lib/leadDashboard.js";
import { buildProductOverviewPath } from "../../lib/activeProducts.js";
import {
  shouldShowRenewalTimeline,
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../../lib/subscriptionStatus.js";
import {
  fetchOversightLeadDetail,
  formatOversightDate,
} from "../../lib/salesOversight.js";
import { getSubscriptionUsage } from "../../lib/organizations.js";
import { AdminPageToast } from "../admin/AdminPageToast.tsx";

import "../../styles/admin-users-light.css";
import "../../styles/sa-lead-detail.css";

export function SalesOversightLeadDetail({ basePath, leadId }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usageBySubscriptionId, setUsageBySubscriptionId] = useState({});

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchOversightLeadDetail(leadId);
      setDetail(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load lead.");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    let active = true;
    const subscriptions = detail?.lead?.subscriptions || [];
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
  }, [detail?.lead?.subscriptions]);

  const dashboard = detail?.lead
    ? buildLeadDashboardModel(detail.lead, usageBySubscriptionId)
    : null;

  const companyName = detail?.lead?.companyName || "Lead detail";
  const tenantId = detail?.lead?.tenantId || "";
  const mrrLabel = formatCurrency(
    dashboard?.summary.monthlyRecurring ?? 0,
    dashboard?.summary.currency ?? "INR",
  );

  return (
    <section className="admin-users-page sa-lead-detail-page">
      <header className="admin-users-page__header sa-lead-detail-page__header">
        <button
          aria-label="Back"
          className="sa-lead-detail-page__back"
          onClick={() => navigate(-1)}
          type="button"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <div>
          <h1 title={loading ? "Loading…" : companyName}>
            {loading ? "Loading…" : companyName}
          </h1>
          <p className="admin-users-page__subtitle">
            Lead overview · Read only
            {tenantId ? ` · ${tenantId}` : ""}
          </p>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      {loading ? (
        <section className="admin-users-panel sa-lead-detail-panel">
          <div className="admin-users-panel__body">
            <p className="admin-users-panel__loading" role="status">
              Loading lead…
            </p>
          </div>
        </section>
      ) : null}

      {!loading && !detail ? (
        <section className="admin-users-panel sa-lead-detail-panel">
          <div className="admin-users-panel__body">
            <div className="sa-lead-detail-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>Lead not found</h3>
              <p>This lead may have been removed or is not available in sales oversight.</p>
              <button className="secondary-button" onClick={() => navigate(-1)} type="button">
                Go back
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && detail ? (
        <>
          <section className="admin-users-kpi-grid sa-lead-detail-kpi" aria-label="Lead summary">
            <article className="admin-users-kpi-card">
              <div className="admin-users-kpi-card__icon sa-lead-detail-kpi__icon--agent" aria-hidden="true">
                <Users size={18} />
              </div>
              <div>
                <span>Assigned agent</span>
                <strong title={detail.assignedAgent?.displayName || "Unassigned"}>
                  {detail.assignedAgent?.displayName || "Unassigned"}
                </strong>
              </div>
            </article>

            <article className="admin-users-kpi-card">
              <div
                className="admin-users-kpi-card__icon sa-lead-detail-kpi__icon--products"
                aria-hidden="true"
              >
                <Package size={18} />
              </div>
              <div>
                <span>Active products</span>
                <strong>{dashboard?.summary.activeProductCount ?? 0}</strong>
              </div>
            </article>

            <article className="admin-users-kpi-card">
              <div className="admin-users-kpi-card__icon sa-lead-detail-kpi__icon--mrr" aria-hidden="true">
                <IndianRupee size={18} />
              </div>
              <div>
                <span>Est. MRR</span>
                <strong title={mrrLabel}>{mrrLabel}</strong>
              </div>
            </article>
          </section>

          <div className="sa-lead-detail-layout">
            <section className="admin-users-panel sa-lead-detail-panel">
              <header className="admin-users-panel__section-header">
                <div>
                  <h2>Customer details</h2>
                  <p>Contact and company profile for this lead.</p>
                </div>
              </header>
              <dl className="sa-lead-detail-grid">
                <div>
                  <dt>Contact</dt>
                  <dd title={detail.lead.contactName || "—"}>{detail.lead.contactName || "—"}</dd>
                </div>
                <div>
                  <dt>Work email</dt>
                  <dd title={detail.lead.workEmail || "—"}>{detail.lead.workEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Industry</dt>
                  <dd title={detail.lead.industryType || "—"}>{detail.lead.industryType || "—"}</dd>
                </div>
                <div>
                  <dt>Country</dt>
                  <dd title={detail.lead.country || "—"}>{detail.lead.country || "—"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd title={formatDashboardDate(detail.lead.createdAt)}>
                    {formatDashboardDate(detail.lead.createdAt)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="admin-users-panel sa-lead-detail-panel sa-lead-detail-panel--quotes">
              <header className="admin-users-panel__section-header">
                <div>
                  <h2>Quotation history</h2>
                  <p>
                    {detail.quotations.length
                      ? `${detail.quotations.length} quotation${
                          detail.quotations.length === 1 ? "" : "s"
                        }`
                      : "No quotations yet"}
                  </p>
                </div>
              </header>
              <div className="admin-users-panel__body sa-lead-detail-panel__scroll">
                {detail.quotations.length === 0 ? (
                  <div className="sa-lead-detail-empty" role="status">
                    <Inbox size={28} aria-hidden="true" />
                    <h3>No quotations</h3>
                    <p>Quotations appear after sales submits a quote for this lead.</p>
                  </div>
                ) : (
                  <ul className="sa-lead-detail-list">
                    {detail.quotations.map((quotation) => (
                      <li key={quotation.id}>
                        <div className="sa-lead-detail-list__main">
                          <strong>{quotation.status}</strong>
                          <small>
                            {quotation.submittedBy || "Unknown"} ·{" "}
                            {formatOversightDate(quotation.submittedAt)}
                          </small>
                        </div>
                        <span className="sa-lead-detail-list__meta">
                          {formatCurrency(quotation.grandTotal, quotation.currency || "INR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="admin-users-panel sa-lead-detail-panel sa-lead-detail-panel--full">
              <header className="admin-users-panel__section-header">
                <div>
                  <h2>Purchased products</h2>
                  <p>
                    {dashboard?.activeProducts?.length
                      ? `${dashboard.activeProducts.length} product${
                          dashboard.activeProducts.length === 1 ? "" : "s"
                        } · select a row for overview`
                      : "No purchased products yet"}
                  </p>
                </div>
              </header>
              <div className="admin-users-panel__body">
                {dashboard?.activeProducts?.length ? (
                  <div className="admin-users-panel__table-wrap">
                    <table className="admin-users-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          {/* Hidden for now — single-location UI.
                          <th>Branch</th>
                          */}
                          <th>Status</th>
                          <th>Renewal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.activeProducts.map((product) => {
                          const productStatus = summarizeSubscriptionStatus(
                            product,
                            detail.lead?.status,
                          );
                          const renews = shouldShowRenewalTimeline(productStatus)
                            ? formatDashboardDate(product.subscription?.renewsAt)
                            : "—";

                          return (
                            <tr
                              className="is-clickable"
                              key={product.key}
                              onClick={() =>
                                navigate(buildProductOverviewPath(basePath, leadId, product.key))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  navigate(
                                    buildProductOverviewPath(basePath, leadId, product.key),
                                  );
                                }
                              }}
                              role="link"
                              tabIndex={0}
                            >
                              <td title={product.productName}>{product.productName}</td>
                              {/* Hidden for now — single-location UI.
                              <td title={product.branchLabel}>{product.branchLabel}</td>
                              */}
                              <td>
                                <span
                                  className={`lead-status lead-status--${subscriptionStatusTone(
                                    productStatus.state,
                                  )}`}
                                >
                                  <span className="lead-status__dot" />
                                  {productStatus.label}
                                </span>
                              </td>
                              <td title={renews}>{renews}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="sa-lead-detail-empty" role="status">
                    <Inbox size={28} aria-hidden="true" />
                    <h3>No purchased products</h3>
                    <p>Products appear here after a paid quotation for this lead.</p>
                  </div>
                )}
              </div>
            </section>

            {detail.assignmentHistory?.length ? (
              <section className="admin-users-panel sa-lead-detail-panel sa-lead-detail-panel--full">
                <header className="admin-users-panel__section-header">
                  <div>
                    <h2>Assignment history</h2>
                    <p>
                      {detail.assignmentHistory.length} reassignment
                      {detail.assignmentHistory.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </header>
                <ul className="sa-lead-detail-list">
                  {detail.assignmentHistory.map((entry) => (
                    <li key={entry.id}>
                      <div className="sa-lead-detail-list__main">
                        <strong>
                          {entry.fromAgentName || "Unassigned"} → {entry.toAgentName || "Unassigned"}
                        </strong>
                        <small>
                          By {entry.assignedByName || "System"} ·{" "}
                          {formatOversightDate(entry.createdAt)}
                        </small>
                      </div>
                      {entry.reason ? (
                        <span className="sa-lead-detail-list__meta">{entry.reason}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
