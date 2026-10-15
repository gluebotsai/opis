// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Inbox, IndianRupee, Users } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import {
  fetchFinancePartnerCommissionOverview,
  formatInrAmount,
  markFinanceCommissionPaid,
} from "../lib/commissions.js";
import { sanitizeUtrInput, UTR_MAX_LENGTH, validateUtr } from "../lib/utrValidation.js";
import "../styles/admin-users-light.css";
import "../styles/finance-partner-commissions.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function KpiCard({ icon: Icon, label, value, accent }) {
  return (
    <article className="admin-users-kpi-card finance-partner-detail-kpi">
      <div
        className="admin-users-kpi-card__icon"
        style={accent ? { color: accent, background: `color-mix(in srgb, ${accent} 12%, #ffffff)` } : undefined}
      >
        <Icon aria-hidden="true" size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

export function FinancePartnerCommissionDetailPage() {
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [payoutDrafts, setPayoutDrafts] = useState({});
  const [payoutReferenceErrors, setPayoutReferenceErrors] = useState({});
  const [actionId, setActionId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function loadOverview() {
    setLoading(true);
    try {
      const data = await fetchFinancePartnerCommissionOverview(partnerId);
      setOverview(data);
      setError("");
    } catch (loadError) {
      setOverview(null);
      setError(
        loadError instanceof Error ? loadError.message : "Could not load partner overview.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, [partnerId]);

  useEffect(() => {
    setPage(1);
  }, [partnerId, pageSize]);

  function updateDraft(entryId, field, value) {
    const nextValue = field === "payoutReference" ? sanitizeUtrInput(value) : value;
    setPayoutDrafts((current) => ({
      ...current,
      [entryId]: {
        ...(current[entryId] || {}),
        [field]: nextValue,
      },
    }));
    if (field === "payoutReference") {
      setPayoutReferenceErrors((current) => {
        if (!current[entryId]) {
          return current;
        }
        const result = validateUtr(nextValue);
        return {
          ...current,
          [entryId]: result.ok ? "" : result.error,
        };
      });
    }
  }

  function validateDraftReference(entryId, rawValue) {
    const result = validateUtr(rawValue);
    setPayoutReferenceErrors((current) => ({
      ...current,
      [entryId]: result.ok ? "" : result.error,
    }));
    return result;
  }

  async function handleMarkPaid(entry, event) {
    event.stopPropagation();
    setError("");
    setMessage("");
    const draft = payoutDrafts[entry.id] || {};
    const referenceResult = validateDraftReference(entry.id, draft.payoutReference || "");
    if (!referenceResult.ok) {
      return;
    }
    setActionId(entry.id);
    try {
      await markFinanceCommissionPaid(entry.id, {
        payoutReference: referenceResult.value,
        notes: draft.notes || "",
      });
      setMessage(`Marked commission paid for ${entry.leadCompanyName || "deal"}.`);
      setPayoutReferenceErrors((current) => ({ ...current, [entry.id]: "" }));
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not mark paid.");
    } finally {
      setActionId("");
    }
  }

  const partner = overview?.partner;
  const summary = overview?.summary;
  const deals = overview?.deals || [];
  const currency = summary?.currency || "INR";

  const totalPages = Math.max(1, Math.ceil(deals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = deals.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, deals.length);
  const visibleDeals = deals.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  return (
    <section className="admin-users-page finance-partner-detail-page">
      <div className="finance-partner-detail-page__chrome">
        <Link className="finance-partner-detail-page__back" to="/finance/commissions">
          ← Back
        </Link>
        <header className="admin-users-page__header finance-partner-detail-page__header">
          <div>
            <h1>{loading ? "Partner overview" : partner?.companyName || "Partner not found"}</h1>
            <p className="admin-users-page__subtitle">
              {partner?.workEmail
                ? `${partner.workEmail}${partner.country ? ` · ${partner.country}` : ""}`
                : "Generated deal value, payouts, leads vs customers, and each commission deal."}
            </p>
          </div>
        </header>
      </div>

      <AdminPageToast
        error={error}
        success={message}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
      />

      {loading ? (
        <section className="admin-users-panel">
          <div className="admin-users-panel__body">
            <p className="admin-users-panel__loading" role="status">
              Loading partner overview…
            </p>
          </div>
        </section>
      ) : null}

      {!loading && !partner ? (
        <section className="admin-users-panel">
          <div className="admin-users-panel__body">
            <div className="finance-partner-commissions-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>Partner not found</h3>
              <p>This partner may have been removed or has no commission history.</p>
              <button
                className="secondary-button"
                onClick={() => navigate("/finance/commissions")}
                type="button"
              >
                Back to partners
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && partner ? (
        <>
          <div className="admin-users-kpi-grid finance-partner-detail-kpi-grid">
            <KpiCard
              accent="#653AE0"
              icon={IndianRupee}
              label="Generated (deals)"
              value={formatInrAmount(summary.dealTotal, currency)}
            />
            <KpiCard
              accent="#E0B73A"
              icon={IndianRupee}
              label="Pending payout"
              value={formatInrAmount(summary.pendingCommissionTotal, currency)}
            />
            <KpiCard
              accent="#098F6A"
              icon={IndianRupee}
              label="Paid to partner"
              value={formatInrAmount(summary.paidCommissionTotal, currency)}
            />
            <KpiCard
              accent="#3A9EE0"
              icon={Users}
              label="Leads vs customers"
              value={`${summary.leadCount} / ${summary.customerCount}`}
            />
          </div>

          <section className="admin-users-panel finance-partner-detail-panel">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Partner details</h2>
                <p>Contact and payout account on file.</p>
              </div>
            </header>
            <dl className="finance-partner-detail-grid">
              <div>
                <dt>Contact</dt>
                <dd title={partner.contactName || "—"}>{partner.contactName || "—"}</dd>
              </div>
              <div>
                <dt>Work email</dt>
                <dd title={partner.workEmail || "—"}>{partner.workEmail || "—"}</dd>
              </div>
              <div>
                <dt>Country</dt>
                <dd title={partner.country || "—"}>{partner.country || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{partner.isActive ? "Active" : "Inactive"}</dd>
              </div>
              <div>
                <dt>Bank</dt>
                <dd title={partner.bankAccount?.bankName || "—"}>
                  {partner.bankAccount?.bankName || "—"}
                </dd>
              </div>
              <div>
                <dt>Account / IBAN</dt>
                <dd
                  title={
                    partner.bankAccount?.iban ||
                    partner.bankAccount?.accountNumber ||
                    "—"
                  }
                >
                  {partner.bankAccount?.iban ||
                    partner.bankAccount?.accountNumber ||
                    "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="admin-users-panel finance-partner-detail-deals-panel">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Deals</h2>
                <p>
                  {deals.length === 1
                    ? "1 commission deal"
                    : `${deals.length} commission deals`}
                  {summary.pendingCount
                    ? ` · ${summary.pendingCount} pending payout${summary.pendingCount === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
            </header>
            <div className="admin-users-panel__body">
              {deals.length === 0 ? (
                <div className="finance-partner-commissions-empty" role="status">
                  <Inbox size={28} aria-hidden="true" />
                  <h3>No deals yet</h3>
                  <p>Commissions appear here after partner-referred quotes are paid.</p>
                </div>
              ) : (
                <div className="admin-users-panel__table-wrap">
                  <table className="admin-users-table finance-partner-commissions-table finance-partner-detail-deals-table">
                    <thead>
                      <tr>
                        <th>Deal</th>
                        <th>Deal amount</th>
                        <th>Rate</th>
                        <th>Commission</th>
                        <th>Status</th>
                        <th>Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDeals.map((entry) => {
                        const draft = payoutDrafts[entry.id] || {};
                        const dealName = entry.leadCompanyName || "—";
                        return (
                          <tr key={entry.id}>
                            <td>
                              <span
                                className="finance-partner-commissions-table__primary"
                                title={dealName}
                              >
                                {dealName}
                              </span>
                              {entry.leadTenantId ? (
                                <span
                                  className="finance-partner-commissions-table__meta"
                                  title={entry.leadTenantId}
                                >
                                  {entry.leadTenantId}
                                </span>
                              ) : null}
                            </td>
                            <td>{formatInrAmount(entry.dealAmount, entry.currency)}</td>
                            <td>{Number(entry.ratePercent).toFixed(2)}%</td>
                            <td>{formatInrAmount(entry.commissionAmount, entry.currency)}</td>
                            <td>
                              <span
                                className={`finance-partner-commissions-pill ${
                                  entry.status === "paid" ? "is-paid" : "is-pending"
                                }`}
                              >
                                {entry.status === "paid" ? "Paid" : "Pending"}
                              </span>
                            </td>
                            <td className="finance-partner-commissions-table__payout">
                              {entry.status === "paid" ? (
                                <div className="finance-partner-commissions-table__paid">
                                  <span title={entry.payoutReference || ""}>
                                    {entry.payoutReference || "—"}
                                  </span>
                                  {entry.paidBy ? (
                                    <span className="finance-partner-commissions-table__meta">
                                      {entry.paidBy}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <div
                                  className="finance-partner-commissions-payout-form"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <label
                                    className={`finance-partner-commissions-payout-form__field${
                                      payoutReferenceErrors[entry.id] ? " field--invalid" : ""
                                    }`}
                                  >
                                    <input
                                      aria-describedby={
                                        payoutReferenceErrors[entry.id]
                                          ? `payout-utr-error-${entry.id}`
                                          : undefined
                                      }
                                      aria-invalid={Boolean(payoutReferenceErrors[entry.id])}
                                      aria-label={`UTR or reference for ${dealName}`}
                                      autoCapitalize="characters"
                                      autoComplete="off"
                                      inputMode="text"
                                      maxLength={UTR_MAX_LENGTH}
                                      onBlur={() =>
                                        validateDraftReference(
                                          entry.id,
                                          draft.payoutReference || "",
                                        )
                                      }
                                      onChange={(event) =>
                                        updateDraft(entry.id, "payoutReference", event.target.value)
                                      }
                                      placeholder="e.g. SBIN123456789012"
                                      spellCheck={false}
                                      type="text"
                                      value={draft.payoutReference || ""}
                                    />
                                    {payoutReferenceErrors[entry.id] ? (
                                      <span
                                        className="field__error"
                                        id={`payout-utr-error-${entry.id}`}
                                        role="alert"
                                      >
                                        {payoutReferenceErrors[entry.id]}
                                      </span>
                                    ) : null}
                                  </label>
                                  <input
                                    aria-label={`Notes for ${dealName}`}
                                    onChange={(event) =>
                                      updateDraft(entry.id, "notes", event.target.value)
                                    }
                                    placeholder="Notes"
                                    type="text"
                                    value={draft.notes || ""}
                                  />
                                  <button
                                    className="primary-button finance-partner-commissions-payout-form__action"
                                    disabled={actionId === entry.id}
                                    onClick={(event) => void handleMarkPaid(entry, event)}
                                    type="button"
                                  >
                                    {actionId === entry.id ? "Saving…" : "Mark paid"}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {deals.length > 0 ? (
              <footer className="admin-users-panel__footer">
                <span>
                  Showing {pageStart} – {pageEnd} of {deals.length}
                </span>
                <div className="admin-users-panel__footer-controls">
                  <label className="admin-users-panel__page-size">
                    <span>Rows</span>
                    <span className="admin-users-panel__page-size-control">
                      <select
                        aria-label="Rows per page"
                        onChange={(event) => setPageSize(Number(event.target.value))}
                        value={pageSize}
                      >
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <nav aria-label="Deals pagination" className="admin-users-panel__pagination">
                    <button
                      aria-label="Previous page"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      type="button"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    {pageNumbers.map((pageNumber) => (
                      <button
                        className={pageNumber === currentPage ? "is-active" : ""}
                        key={pageNumber}
                        onClick={() => setPage(pageNumber)}
                        type="button"
                      >
                        {pageNumber}
                      </button>
                    ))}
                    <button
                      aria-label="Next page"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      type="button"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </nav>
                </div>
              </footer>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}
