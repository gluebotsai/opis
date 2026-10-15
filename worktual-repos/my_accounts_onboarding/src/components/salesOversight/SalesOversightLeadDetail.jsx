import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Package } from "lucide-react";

import {
  buildLeadDashboardModel,
  formatCurrency,
  formatDashboardDate,
} from "../../lib/leadDashboard.js";
import { buildProductOverviewPath } from "../../lib/activeProducts.js";
import {
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../../lib/subscriptionStatus.js";
import {
  fetchOversightLeadDetail,
  formatOversightDate,
} from "../../lib/salesOversight.js";

function StatusBadge({ status }) {
  const tone =
    status === "Paid" || status === "Approved"
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

export function SalesOversightLeadDetail({ basePath, leadId }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const dashboard = detail?.lead ? buildLeadDashboardModel(detail.lead) : null;

  return (
    <div className="sales-oversight-page">
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
          <p className="page-eyebrow">Lead overview · Read only</p>
          <h1>{detail?.lead?.companyName || "Lead detail"}</h1>
          <p>{detail?.lead?.domainId}</p>
        </div>
      </header>

      {error ? <div className="form-error-banner">{error}</div> : null}
      {loading ? <p className="route-loading" role="status">Loading lead...</p> : null}

      {!loading && detail ? (
        <>
          <section className="sales-dashboard-summary">
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--customers">
              <div>
                <span>Status</span>
                <StatusBadge status={detail.lead.status} />
              </div>
            </article>
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--subscriptions">
              <div>
                <span>Assigned agent</span>
                <strong>{detail.assignedAgent?.displayName || "Unassigned"}</strong>
              </div>
            </article>
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--mrr">
              <div>
                <span>Active products</span>
                <strong>{dashboard?.summary.activeProductCount ?? 0}</strong>
              </div>
            </article>
            <article className="sales-dashboard-stat-card sales-dashboard-stat-card--finance">
              <div>
                <span>Est. MRR</span>
                <strong>
                  {formatCurrency(
                    dashboard?.summary.monthlyRecurring ?? 0,
                    dashboard?.summary.currency ?? "INR",
                  )}
                </strong>
              </div>
            </article>
          </section>

          <div className="sales-oversight-grid">
            <section className="panel-card">
              <div className="panel-card__header">
                <h2>
                  <Building2 size={18} />
                  Customer details
                </h2>
              </div>
              <dl className="sales-oversight-details">
                <div>
                  <dt>Contact</dt>
                  <dd>{detail.lead.contactName || "—"}</dd>
                </div>
                <div>
                  <dt>Work email</dt>
                  <dd>{detail.lead.workEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Industry</dt>
                  <dd>{detail.lead.industryType || "—"}</dd>
                </div>
                <div>
                  <dt>Country</dt>
                  <dd>{detail.lead.country || "—"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDashboardDate(detail.lead.createdAt)}</dd>
                </div>
              </dl>
            </section>

            <section className="panel-card">
              <div className="panel-card__header">
                <h2>Quotation history</h2>
              </div>
              {detail.quotations.length === 0 ? (
                <p className="sales-oversight-empty">No quotations submitted yet.</p>
              ) : (
                <ul className="sales-oversight-list">
                  {detail.quotations.map((quotation) => (
                    <li key={quotation.id}>
                      <div>
                        <strong>{quotation.status}</strong>
                        <small>
                          {quotation.submittedBy || "Unknown"} ·{" "}
                          {formatOversightDate(quotation.submittedAt)}
                        </small>
                      </div>
                      <span>{formatCurrency(quotation.grandTotal, quotation.currency || "INR")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="panel-card">
            <div className="panel-card__header">
              <h2>
                <Package size={18} />
                Purchased products
              </h2>
            </div>
            {dashboard?.activeProducts?.length ? (
              <div className="sales-oversight-table-wrap">
                <table className="sales-oversight-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Branch</th>
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

                      return (
                      <tr
                        className="sales-oversight-table__row--clickable"
                        key={product.key}
                        onClick={() =>
                          navigate(buildProductOverviewPath(basePath, leadId, product.key))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(buildProductOverviewPath(basePath, leadId, product.key));
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td>{product.productName}</td>
                        <td>{product.branchLabel}</td>
                        <td>
                          <span
                            className={`lead-status lead-status--${subscriptionStatusTone(productStatus.state)}`}
                          >
                            <span className="lead-status__dot" />
                            {productStatus.label}
                          </span>
                        </td>
                        <td>{formatDashboardDate(product.subscription?.renewsAt)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="sales-oversight-empty">No purchased products yet.</p>
            )}
          </section>

          {detail.assignmentHistory?.length ? (
            <section className="panel-card">
              <div className="panel-card__header">
                <h2>Assignment history</h2>
              </div>
              <ul className="sales-oversight-list">
                {detail.assignmentHistory.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>
                        {entry.fromAgentName || "Unassigned"} → {entry.toAgentName || "Unassigned"}
                      </strong>
                      <small>
                        By {entry.assignedByName || "System"} · {formatOversightDate(entry.createdAt)}
                      </small>
                    </div>
                    {entry.reason ? <span>{entry.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
