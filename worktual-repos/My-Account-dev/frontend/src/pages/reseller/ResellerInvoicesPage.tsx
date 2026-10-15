// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Inbox, Search } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { fetchResellerInvoices } from "../../lib/resellerAuth.js";
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

function formatAmount(value, currency = "INR") {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function statusTone(status) {
  const raw = String(status || "").toLowerCase();
  if (raw.includes("paid")) {
    return "paid";
  }
  if (raw.includes("reject") || raw.includes("fail")) {
    return "failed";
  }
  if (raw.includes("awaiting") || raw.includes("approved")) {
    return "info";
  }
  if (raw.includes("pending")) {
    return "pending";
  }
  return "muted";
}

export function ResellerInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadInvoices = useCallback(() => {
    setLoading(true);
    fetchResellerInvoices()
      .then((rows) => {
        setInvoices(rows);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load invoices.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  usePortalLiveDataReload(loadInvoices);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  const filteredInvoices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...invoices]
      .filter((invoice) => {
        if (!query) {
          return true;
        }
        const type = invoice.invoiceSource === "subscription" ? "renewal" : "quotation";
        return [invoice.companyName, invoice.tenantId, invoice.status, type]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort(
        (a, b) =>
          new Date(b.submittedAt || b.reviewedAt || 0).getTime() -
          new Date(a.submittedAt || a.reviewedAt || 0).getTime(),
      );
  }, [invoices, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredInvoices.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredInvoices.length);
  const visibleRows = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveFilters = Boolean(searchQuery.trim());

  const countLabel =
    filteredInvoices.length === 1
      ? "1 invoice in view"
      : `${filteredInvoices.length} invoices in view`;

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  return (
    <section className="admin-users-page reseller-invoices-page">
      <header className="page-header admin-users-page__header reseller-invoices-page__header">
        <div>
          <h1>Invoices</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Approved quotations and subscription invoices for your customers.
          </p>
        </div>
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      <section aria-busy={loading} className="admin-users-panel reseller-invoices-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Billing records</h2>
            <p>{loading ? "Loading…" : countLabel}</p>
          </div>
          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} />
              <input
                aria-label="Search invoices"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, tenant, status…"
                type="search"
                value={searchQuery}
              />
            </label>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading invoices…
            </p>
          ) : null}

          {!loading && invoices.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No invoices yet</h3>
              <p>Invoices appear after sales admin quotes and finance approves payment for your leads.</p>
            </div>
          ) : null}

          {!loading && invoices.length > 0 && filteredInvoices.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No matching invoices</h3>
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
              <table className="admin-users-table reseller-invoices-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tenant ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((invoice, index) => {
                    const company = invoice.companyName || "—";
                    const tenant = invoice.tenantId || "—";
                    const type =
                      invoice.invoiceSource === "subscription" ? "Renewal" : "Quotation";
                    const status = invoice.status || "—";
                    const amount = formatAmount(invoice.grandTotal, invoice.currency);
                    const date = formatDate(invoice.submittedAt || invoice.reviewedAt);
                    const tone = statusTone(status);
                    const key = `${invoice.quotationId || "sub"}-${invoice.leadId}-${index}`;

                    return (
                      <tr key={key}>
                        <td title={company}>
                          <strong className="reseller-table__company">{company}</strong>
                        </td>
                        <td title={tenant}>
                          <span className="reseller-table__tenant">{tenant}</span>
                        </td>
                        <td title={type}>
                          <span
                            className={`reseller-pill reseller-pill--${
                              type === "Renewal" ? "info" : "muted"
                            }`}
                          >
                            {type}
                          </span>
                        </td>
                        <td title={status}>
                          <span className={`reseller-pill reseller-pill--${tone}`}>{status}</span>
                        </td>
                        <td title={amount}>{amount}</td>
                        <td title={date}>{date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {!loading && filteredInvoices.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} – {pageEnd} of {filteredInvoices.length}
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
              <nav aria-label="Invoices pagination" className="admin-users-panel__pagination">
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
