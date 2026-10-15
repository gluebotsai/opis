// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Filter, Inbox } from "lucide-react";

import {
  fetchFinanceCommissionPartners,
  formatInrAmount,
} from "../lib/commissions.js";
import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { CommissionSlabsReadonly } from "../components/CommissionSlabsReadonly.tsx";
import "../styles/admin-users-light.css";
import "../styles/finance-partner-commissions.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "paid", label: "Paid" },
];

function statusLabel(status) {
  if (status === "paid") {
    return "Paid";
  }
  if (status === "mixed") {
    return "Mixed";
  }
  return "Pending";
}

function CommissionsFilterDropdown({
  containerRef,
  filter,
  onClose,
  onFilterChange,
  onReset,
}) {
  useEffect(() => {
    function handlePointerDown(event) {
      const container = containerRef?.current;
      if (container && !container.contains(event.target)) {
        onClose();
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [containerRef, onClose]);

  return (
    <div
      className="admin-users-filter-dropdown finance-partner-commissions-filter"
      role="dialog"
      aria-label="Filter commissions"
    >
      <div className="finance-partner-commissions-filter__scroll">
        <div className="admin-users-filter-dropdown__section">
          <p className="admin-users-filter-dropdown__title">Filter by</p>
          <div className="admin-users-filter-dropdown__field">
            <span>Status</span>
            <select
              aria-label="Filter by status"
              onChange={(event) => onFilterChange(event.target.value)}
              value={filter}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="admin-users-filter-dropdown__actions">
        <button className="secondary-button" onClick={onReset} type="button">
          Reset
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Apply
        </button>
      </div>
    </div>
  );
}

export function FinancePartnerCommissionsPage() {
  const navigate = useNavigate();
  const filterAnchorRef = useRef(null);
  const [partners, setPartners] = useState([]);
  const [filter, setFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function loadPartners(statusFilter = filter) {
    setLoading(true);
    try {
      const status = statusFilter === "all" ? undefined : statusFilter;
      const rows = await fetchFinanceCommissionPartners({ status });
      setPartners(rows);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load commissions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPartners(filter);
  }, [filter]);

  useEffect(() => {
    setPage(1);
  }, [filter, pageSize]);

  const pendingTotal = useMemo(
    () => partners.reduce((sum, row) => sum + Number(row.pendingCommissionTotal || 0), 0),
    [partners],
  );

  const totalPages = Math.max(1, Math.ceil(partners.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = partners.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, partners.length);
  const visiblePartners = partners.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  const countLabel = loading
    ? "Loading…"
    : partners.length === 1
      ? "1 partner in view"
      : `${partners.length} partners in view`;

  const subtitleExtra =
    filter !== "paid" && !loading
      ? ` · Pending total ${formatInrAmount(pendingTotal)}`
      : "";

  return (
    <section className="admin-users-page finance-partner-commissions-page">
      <header className="admin-users-page__header">
        <div>
          <h1>Partner commissions</h1>
          <p className="admin-users-page__subtitle">
            Open a partner to review generated deal value, payouts, leads vs customers, and each deal.
          </p>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <section aria-busy={loading} className="admin-users-panel finance-partner-commissions-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Partners</h2>
            <p>
              {countLabel}
              {subtitleExtra}
            </p>
          </div>
          <div className="admin-users-panel__toolbar">
            <div className="admin-users-panel__filter-anchor" ref={filterAnchorRef}>
              <button
                className={`admin-users-panel__tool-button ${
                  showFilters || filter !== "all" ? "is-active" : ""
                }`}
                onClick={() => setShowFilters((current) => !current)}
                type="button"
              >
                <Filter size={16} aria-hidden="true" />
                Filters
              </button>
              {showFilters ? (
                <CommissionsFilterDropdown
                  containerRef={filterAnchorRef}
                  filter={filter}
                  onClose={() => setShowFilters(false)}
                  onFilterChange={setFilter}
                  onReset={() => setFilter("all")}
                />
              ) : null}
            </div>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading partners…
            </p>
          ) : null}

          {!loading && partners.length === 0 ? (
            <div className="finance-partner-commissions-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No partners</h3>
              <p>No partners match this status filter.</p>
              {filter !== "all" ? (
                <button
                  className="secondary-button"
                  onClick={() => setFilter("all")}
                  type="button"
                >
                  Reset filters
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && partners.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table finance-partner-commissions-table">
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th>Generated</th>
                    <th>Pending</th>
                    <th>Paid out</th>
                    <th>Deals</th>
                    <th className="finance-partner-commissions-table__status-col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePartners.map((row) => {
                    const partnerName = row.partnerCompanyName || "—";
                    return (
                      <tr
                        className="is-clickable"
                        key={row.partnerId}
                        onClick={() => navigate(`/finance/commissions/partners/${row.partnerId}`)}
                      >
                        <td>
                          <span
                            className="finance-partner-commissions-table__primary"
                            title={partnerName}
                          >
                            {partnerName}
                          </span>
                          {row.partnerWorkEmail ? (
                            <span
                              className="finance-partner-commissions-table__meta"
                              title={row.partnerWorkEmail}
                            >
                              {row.partnerWorkEmail}
                            </span>
                          ) : null}
                        </td>
                        <td>{formatInrAmount(row.dealTotal, row.currency)}</td>
                        <td>{formatInrAmount(row.pendingCommissionTotal, row.currency)}</td>
                        <td>{formatInrAmount(row.paidCommissionTotal, row.currency)}</td>
                        <td>{row.entryCount}</td>
                        <td className="finance-partner-commissions-table__status-col">
                          <span
                            className={`finance-partner-commissions-pill ${
                              row.status === "paid"
                                ? "is-paid"
                                : row.status === "mixed"
                                  ? "is-mixed"
                                  : "is-pending"
                            }`}
                          >
                            {statusLabel(row.status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {!loading && partners.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} – {pageEnd} of {partners.length}
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
              <nav aria-label="Partners pagination" className="admin-users-panel__pagination">
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

      <CommissionSlabsReadonly title="Commission slabs (view only)" variant="panel" />
    </section>
  );
}
