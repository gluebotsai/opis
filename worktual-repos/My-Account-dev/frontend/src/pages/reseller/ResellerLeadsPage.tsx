// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Inbox, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { DeleteCustomerModal } from "../../components/DeleteCustomerModal.tsx";
import { usePortalLeadCreate } from "../../components/leads/PortalLeadCreateProvider.tsx";
import { useLeadEdit } from "../../components/leads/LeadEditProvider.tsx";
import { deleteResellerLead, fetchResellerLeads } from "../../lib/resellerAuth.js";
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
  if (raw.includes("reject") || raw.includes("inactive")) {
    return "rejected";
  }
  if (raw.includes("pending") || raw.includes("new")) {
    return "pending";
  }
  if (raw.includes("customer") || raw.includes("active") || raw.includes("qualified")) {
    return "active";
  }
  return "muted";
}

export function ResellerLeadsPage() {
  const navigate = useNavigate();
  const { startCreateLead } = usePortalLeadCreate();
  const { startEditLead } = useLeadEdit();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openRowMenuId, setOpenRowMenuId] = useState("");
  const rowMenuRef = useRef(null);

  const loadLeads = useCallback(() => {
    setLoading(true);
    fetchResellerLeads()
      .then((rows) => {
        setLeads(rows);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load leads.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadLeads();

    function handleLeadUpdated() {
      loadLeads();
    }

    window.addEventListener("worktual:lead-updated", handleLeadUpdated);
    return () => {
      window.removeEventListener("worktual:lead-updated", handleLeadUpdated);
    };
  }, [loadLeads]);

  useEffect(() => {
    if (!openRowMenuId) {
      return undefined;
    }
    function handlePointerDown(event) {
      if (rowMenuRef.current && !rowMenuRef.current.contains(event.target)) {
        setOpenRowMenuId("");
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenRowMenuId("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openRowMenuId]);

  usePortalLiveDataReload(loadLeads);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  const filteredLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...leads]
      .filter((lead) => {
        if (!query) {
          return true;
        }
        return [lead.companyName, lead.tenantId, lead.contactName, lead.status]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [leads, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredLeads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredLeads.length);
  const visibleLeads = filteredLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveFilters = Boolean(searchQuery.trim());

  const countLabel =
    filteredLeads.length === 1 ? "1 lead in view" : `${filteredLeads.length} leads in view`;

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  async function confirmDelete() {
    if (!deleteTarget?.id) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteResellerLead(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage(`Deleted ${deleteTarget.companyName || "lead"}.`);
      loadLeads();
      window.dispatchEvent(new CustomEvent("worktual:lead-updated"));
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error ? deleteFailure.message : "Could not delete lead.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="admin-users-page reseller-leads-page">
      <header className="page-header admin-users-page__header reseller-leads-page__header">
        <div>
          <h1>Your leads</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            End customers assigned to your reseller account.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="primary-button admin-users-page__create"
            onClick={startCreateLead}
            type="button"
          >
            <Plus size={18} strokeWidth={1.75} />
            Create lead
          </button>
        </div>
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setSuccessMessage("");
        }}
        success={successMessage}
      />

      <section aria-busy={loading} className="admin-users-panel reseller-leads-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All leads</h2>
            <p>{loading ? "Loading…" : countLabel}</p>
          </div>
          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} />
              <input
                aria-label="Search leads"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, tenant, contact…"
                type="search"
                value={searchQuery}
              />
            </label>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading" role="status">
              Loading leads…
            </p>
          ) : null}

          {!loading && leads.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No leads yet</h3>
              <p>Create a customer lead to start tracking status and renewals.</p>
              <button className="primary-button" onClick={startCreateLead} type="button">
                <Plus size={16} strokeWidth={1.75} />
                Create lead
              </button>
            </div>
          ) : null}

          {!loading && leads.length > 0 && filteredLeads.length === 0 ? (
            <div className="reseller-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No matching leads</h3>
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

          {!loading && visibleLeads.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table reseller-leads-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tenant ID</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((lead) => {
                    const company = lead.companyName || "—";
                    const tenant = lead.tenantId || "—";
                    const contact = lead.contactName || "—";
                    const status = lead.status || "—";
                    const created = formatDate(lead.createdAt);
                    const tone = statusTone(status);

                    return (
                      <tr
                        className="is-clickable"
                        key={lead.id}
                        onClick={() => navigate(`/reseller/leads/${lead.id}`)}
                      >
                        <td title={company}>
                          <strong className="reseller-table__company">{company}</strong>
                        </td>
                        <td title={tenant}>
                          <span className="reseller-table__tenant">{tenant}</span>
                        </td>
                        <td title={contact}>{contact}</td>
                        <td title={status}>
                          <span className={`reseller-pill reseller-pill--${tone}`}>{status}</span>
                        </td>
                        <td title={created}>{created}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div
                            className="admin-users-table__menu-anchor"
                            ref={openRowMenuId === lead.id ? rowMenuRef : null}
                          >
                            <button
                              aria-expanded={openRowMenuId === lead.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${company}`}
                              className="admin-users-table__menu-trigger"
                              onClick={() =>
                                setOpenRowMenuId((current) =>
                                  current === lead.id ? "" : lead.id,
                                )
                              }
                              type="button"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openRowMenuId === lead.id ? (
                              <div className="admin-users-row-menu" role="menu">
                                <button
                                  onClick={() => {
                                    setOpenRowMenuId("");
                                    startEditLead(lead.id);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  className="admin-users-row-menu__danger"
                                  onClick={() => {
                                    setOpenRowMenuId("");
                                    setDeleteTarget(lead);
                                    setDeleteError("");
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {!loading && filteredLeads.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <span>
              Showing {pageStart} – {pageEnd} of {filteredLeads.length}
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
              <nav aria-label="Leads pagination" className="admin-users-panel__pagination">
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

      {deleteTarget ? (
        <DeleteCustomerModal
          busy={deleteBusy}
          companyName={deleteTarget.companyName || ""}
          copy="This permanently deletes the lead, quotations, and related records. This cannot be undone."
          error={deleteError}
          onCancel={() => {
            if (!deleteBusy) {
              setDeleteTarget(null);
              setDeleteError("");
            }
          }}
          onConfirm={confirmDelete}
          title="Delete lead"
        />
      ) : null}
    </section>
  );
}
