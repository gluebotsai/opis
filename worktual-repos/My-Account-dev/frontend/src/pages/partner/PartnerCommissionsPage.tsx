// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Inbox, Search } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { CommissionSlabsReadonly } from "../../components/CommissionSlabsReadonly.tsx";
import {
  fetchPartnerCommissions,
  formatInrAmount,
} from "../../lib/commissions.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/partner-commissions.css";

const PAGE_SIZE = 4;
const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
];
const PERIOD_FILTERS = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function entryDate(entry) {
  return entry.status === "paid" ? entry.paidAt || entry.accruedAt : entry.accruedAt;
}

function isWithinPeriod(isoDate, periodDays) {
  if (periodDays === "all" || periodDays == null) {
    return true;
  }
  if (!isoDate) {
    return false;
  }
  const days = Number(periodDays);
  if (!Number.isFinite(days) || days < 0) {
    return true;
  }
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) {
    return false;
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ts >= cutoff;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function PartnerCommissionsPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [page, setPage] = useState(1);

  const loadCommissions = useCallback(() => {
    setLoading(true);
    fetchPartnerCommissions()
      .then((data) => {
        setEntries(data.entries || []);
        setError("");
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : "Could not load commissions.",
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadCommissions();
  }, [loadCommissions]);

  usePortalLiveDataReload(loadCommissions);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, periodFilter]);

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...entries]
      .filter((entry) => {
        if (statusFilter !== "all" && entry.status !== statusFilter) {
          return false;
        }
        if (!isWithinPeriod(entryDate(entry), periodFilter)) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [
          entry.leadCompanyName,
          entry.leadTenantId,
          entry.payoutReference,
          entry.notes,
          entry.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") {
          return -1;
        }
        if (b.status === "pending" && a.status !== "pending") {
          return 1;
        }
        const aTime = new Date(entryDate(a) || 0).getTime();
        const bTime = new Date(entryDate(b) || 0).getTime();
        return bTime - aTime;
      });
  }, [entries, periodFilter, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredEntries.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredEntries.length);
  const visibleEntries = filteredEntries.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  const hasActiveFilters =
    statusFilter !== "all" || periodFilter !== "all" || Boolean(searchQuery.trim());
  const countLabel =
    filteredEntries.length === 1
      ? "1 entry in view"
      : `${filteredEntries.length} entries in view`;

  return (
    <section className="admin-users-page partner-commissions-page">
      <header className="admin-users-page__header partner-commissions-page__header">
        <div>
          <h1>Commissions</h1>
          <p className="admin-users-page__subtitle">
            Track pending payouts and the history of commissions finance has paid to you.
          </p>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <section
        aria-busy={loading}
        className="admin-users-panel partner-commissions-entries-panel"
      >
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Entries</h2>
            <p>{loading ? "Loading…" : countLabel}</p>
          </div>
          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} />
              <input
                aria-label="Search commissions"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search deal, tenant, reference…"
                type="search"
                value={searchQuery}
              />
            </label>
            <label className="partner-commissions-filter">
              <span className="visually-hidden">Status filter</span>
              <select
                aria-label="Filter by status"
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="partner-commissions-filter">
              <span className="visually-hidden">Period filter</span>
              <select
                aria-label="Filter by period"
                onChange={(event) => setPeriodFilter(event.target.value)}
                value={periodFilter}
              >
                {PERIOD_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading commissions…
            </p>
          ) : null}

          {!loading && entries.length === 0 ? (
            <div className="partner-commissions-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No commissions yet</h3>
              <p>Commissions appear when a referred customer deal is paid and finance confirms payout.</p>
            </div>
          ) : null}

          {!loading && entries.length > 0 && filteredEntries.length === 0 ? (
            <div className="partner-commissions-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No matching entries</h3>
              <p>Try another search, status, or period.</p>
              {hasActiveFilters ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setPeriodFilter("all");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && visibleEntries.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table partner-commissions-table">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th>Deal amount</th>
                    <th>Rate</th>
                    <th>Commission</th>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry) => {
                    const dealName = entry.leadCompanyName || "—";
                    const isPaid = entry.status === "paid";
                    const dateValue = isPaid ? entry.paidAt : entry.accruedAt;
                    const reference = entry.payoutReference || "—";
                    return (
                      <tr key={entry.id}>
                        <td>
                          <span
                            className="partner-commissions-table__primary"
                            title={dealName}
                          >
                            {dealName}
                          </span>
                          {entry.leadTenantId ? (
                            <span
                              className="partner-commissions-table__meta"
                              title={entry.leadTenantId}
                            >
                              {entry.leadTenantId}
                            </span>
                          ) : null}
                        </td>
                        <td>{formatInrAmount(entry.dealAmount, entry.currency)}</td>
                        <td>{Number(entry.ratePercent).toFixed(2)}%</td>
                        <td>{formatInrAmount(entry.commissionAmount, entry.currency)}</td>
                        <td title={isPaid ? "Paid on" : "Accrued"}>
                          {formatDate(dateValue)}
                        </td>
                        <td title={reference === "—" ? undefined : reference}>{reference}</td>
                        <td>
                          <span
                            className={`partner-commissions-pill ${
                              isPaid ? "is-paid" : "is-pending"
                            }`}
                          >
                            {isPaid ? "Paid" : "Pending"}
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

        {!loading && filteredEntries.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} – {pageEnd} of {filteredEntries.length}
            </span>
            <div className="admin-users-panel__footer-controls">
              <nav aria-label="Commissions pagination" className="admin-users-panel__pagination">
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
