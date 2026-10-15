// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Inbox, Search } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { fetchResellerRenewals } from "../../lib/resellerAuth.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/reseller-portal.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function statusTone(status) {
  const raw = String(status || "").toLowerCase();
  if (raw.includes("fail") || raw.includes("cancel") || raw.includes("overdue")) {
    return "failed";
  }
  if (raw.includes("paid") || raw.includes("active") || raw.includes("renewed")) {
    return "paid";
  }
  if (raw.includes("due") || raw.includes("pending") || raw.includes("upcoming")) {
    return "due";
  }
  return "muted";
}

export function ResellerRenewalsPage() {
  const [renewals, setRenewals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadRenewals = useCallback(() => {
    setLoading(true);
    fetchResellerRenewals({ withinDays: 90 })
      .then((rows) => {
        setRenewals(rows);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load renewals.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadRenewals();
  }, [loadRenewals]);

  usePortalLiveDataReload(loadRenewals);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  const filteredRenewals = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...renewals]
      .filter((row) => {
        if (!query) {
          return true;
        }
        return [row.companyName, row.tenantId, row.productId, row.status]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
  }, [renewals, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRenewals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredRenewals.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredRenewals.length);
  const visibleRows = filteredRenewals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveFilters = Boolean(searchQuery.trim());

  const countLabel =
    filteredRenewals.length === 1
      ? "1 renewal in view"
      : `${filteredRenewals.length} renewals in view`;

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  return (
    <section className="admin-users-page reseller-renewals-page">
      <header className="page-header admin-users-page__header reseller-renewals-page__header">
        <div>
          <h1>Upcoming renewals</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Renewal dates for your customers in the next 90 days.
          </p>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <section aria-busy={loading} className="admin-users-panel reseller-renewals-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Renewals</h2>
            <p>{loading ? "Loading…" : countLabel}</p>
          </div>
          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} />
              <input
                aria-label="Search renewals"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, tenant, product…"
                type="search"
                value={searchQuery}
              />
            </label>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading renewals…
            </p>
          ) : null}

          {!loading && renewals.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No upcoming renewals</h3>
              <p>Renewals appear here when your customers have subscriptions due in the next 90 days.</p>
            </div>
          ) : null}

          {!loading && renewals.length > 0 && filteredRenewals.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No matching renewals</h3>
              <p>Try a different search term.</p>
              {hasActiveFilters ? (
                <button
                  className="secondary-button"
                  onClick={() => setSearchQuery("")}
                  type="button"
                >
                  Clear search
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && visibleRows.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table reseller-renewals-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tenant ID</th>
                    <th>Product</th>
                    <th>Due date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((renewal) => {
                    const company = renewal.companyName || "—";
                    const tenant = renewal.tenantId || "—";
                    const product = renewal.productId || "—";
                    const due = formatDate(renewal.dueAt);
                    const status = renewal.status || "—";
                    const tone = statusTone(status);

                    return (
                      <tr key={renewal.id}>
                        <td title={company}>
                          <strong className="reseller-table__company">{company}</strong>
                        </td>
                        <td title={tenant}>
                          <span className="reseller-table__tenant">{tenant}</span>
                        </td>
                        <td title={product}>{product}</td>
                        <td title={due}>{due}</td>
                        <td title={status}>
                          <span className={`reseller-pill reseller-pill--${tone}`}>{status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {!loading && filteredRenewals.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} – {pageEnd} of {filteredRenewals.length}
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
              <nav aria-label="Renewals pagination" className="admin-users-panel__pagination">
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
    </section>
  );
}
