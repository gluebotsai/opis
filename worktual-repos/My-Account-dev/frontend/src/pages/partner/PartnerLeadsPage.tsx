// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Inbox, Plus, Search } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { DeleteCustomerModal } from "../../components/DeleteCustomerModal.tsx";
import { usePortalLeadCreate } from "../../components/leads/PortalLeadCreateProvider.tsx";
import { useLeadEdit } from "../../components/leads/LeadEditProvider.tsx";
import { deletePartnerLead, fetchPartnerLeads } from "../../lib/partnerAuth.js";
import { partnerQuotationStatusLabel } from "../../lib/partnerQuotations.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/partner-leads.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const ASSIGNMENT_FILTERS = [
  { value: "all", label: "All assignments" },
  { value: "assigned", label: "Assigned" },
  { value: "awaiting", label: "Awaiting assignment" },
];

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function isAssigned(lead) {
  return Boolean(lead.assignedUserId);
}

function assignmentLabel(lead) {
  return isAssigned(lead) ? "Assigned" : "Awaiting assignment";
}

function quotationTone(status, label) {
  const raw = String(status || label || "").toLowerCase();
  if (raw.includes("paid")) {
    return "paid";
  }
  if (raw.includes("reject") || raw.includes("fail")) {
    return "rejected";
  }
  if (raw.includes("awaiting payment") || raw.includes("approved")) {
    return "awaiting";
  }
  if (raw.includes("pending") || raw.includes("finance")) {
    return "pending";
  }
  if (raw.includes("not quoted") || !status) {
    return "none";
  }
  return "pending";
}

export function PartnerLeadsPage() {
  const navigate = useNavigate();
  const { startCreateLead } = usePortalLeadCreate();
  const { startEditLead } = useLeadEdit();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadLeads = useCallback(() => {
    setLoading(true);
    fetchPartnerLeads()
      .then((rows) => {
        setLeads(rows);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load referrals.");
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

  usePortalLiveDataReload(loadLeads);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, assignmentFilter, pageSize]);

  const filteredLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...leads]
      .filter((lead) => {
        if (assignmentFilter === "assigned" && !isAssigned(lead)) {
          return false;
        }
        if (assignmentFilter === "awaiting" && isAssigned(lead)) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [lead.companyName, lead.tenantId, lead.contactName, lead.status]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [assignmentFilter, leads, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filteredLeads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredLeads.length);
  const visibleLeads = filteredLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveFilters = assignmentFilter !== "all" || Boolean(searchQuery.trim());

  const countLabel =
    filteredLeads.length === 1 ? "1 referral in view" : `${filteredLeads.length} referrals in view`;

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
      await deletePartnerLead(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage(`Deleted ${deleteTarget.companyName || "referral"}.`);
      loadLeads();
      window.dispatchEvent(new CustomEvent("worktual:lead-updated"));
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error ? deleteFailure.message : "Could not delete referral.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="admin-users-page partner-leads-page">
      <header className="page-header admin-users-page__header partner-leads-page__header">
        <div>
          <h1>My referrals</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Track referred customers, quotation progress, and payment status.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="primary-button admin-users-page__create"
            onClick={startCreateLead}
            type="button"
          >
            <Plus size={18} strokeWidth={1.75} />
            Lead creation
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

      <section aria-busy={loading} className="admin-users-panel partner-leads-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All referrals</h2>
            <p>{loading ? "Loading…" : countLabel}</p>
          </div>
          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} strokeWidth={1.75} />
              <input
                aria-label="Search referrals"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, tenant, contact…"
                type="search"
                value={searchQuery}
              />
            </label>
            <label className="partner-leads-filter">
              <span className="visually-hidden">Assignment filter</span>
              <select
                aria-label="Filter by assignment"
                onChange={(event) => setAssignmentFilter(event.target.value)}
                value={assignmentFilter}
              >
                {ASSIGNMENT_FILTERS.map((option) => (
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
              Loading referrals…
            </p>
          ) : null}

          {!loading && leads.length === 0 ? (
            <div className="partner-leads-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No referrals yet</h3>
              <p>Submit a customer referral to start tracking assignment, quotes, and payment.</p>
            </div>
          ) : null}

          {!loading && leads.length > 0 && filteredLeads.length === 0 ? (
            <div className="partner-leads-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>No matching referrals</h3>
              <p>Try a different search or clear the assignment filter.</p>
              {hasActiveFilters ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSearchQuery("");
                    setAssignmentFilter("all");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && visibleLeads.length > 0 ? (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table partner-leads-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tenant ID</th>
                    <th>Contact</th>
                    <th>Lead status</th>
                    <th>Quotation</th>
                    <th>Assignment</th>
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
                    const quotation =
                      lead.latestQuotationStatusLabel ||
                      partnerQuotationStatusLabel(lead.latestQuotationStatus);
                    const assignment = assignmentLabel(lead);
                    const created = formatDate(lead.createdAt);
                    const quoteTone = quotationTone(lead.latestQuotationStatus, quotation);

                    return (
                      <tr
                        className="is-clickable"
                        key={lead.id}
                        onClick={() => navigate(`/partner/leads/${lead.id}`)}
                      >
                        <td title={company}>
                          <strong className="partner-leads-table__company">{company}</strong>
                        </td>
                        <td title={tenant}>
                          <span className="partner-leads-table__tenant">{tenant}</span>
                        </td>
                        <td title={contact}>{contact}</td>
                        <td title={status}>{status}</td>
                        <td title={quotation}>
                          <span className={`partner-leads-pill partner-leads-pill--${quoteTone}`}>
                            {quotation}
                          </span>
                        </td>
                        <td title={assignment}>
                          <span
                            className={`partner-leads-pill partner-leads-pill--${
                              isAssigned(lead) ? "assigned" : "unassigned"
                            }`}
                          >
                            {assignment}
                          </span>
                        </td>
                        <td title={created}>{created}</td>
                        <td>
                          <div className="partner-leads-table__actions">
                            <button
                              className="partner-leads-table__action"
                              onClick={(event) => {
                                event.stopPropagation();
                                startEditLead(lead.id);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="partner-leads-table__action partner-leads-table__action--danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteTarget(lead);
                                setDeleteError("");
                              }}
                              type="button"
                            >
                              Delete
                            </button>
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
              <nav aria-label="Referrals pagination" className="admin-users-panel__pagination">
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
          copy="This permanently deletes the referral, quotations, and related records. This cannot be undone."
          error={deleteError}
          onCancel={() => {
            if (!deleteBusy) {
              setDeleteTarget(null);
              setDeleteError("");
            }
          }}
          onConfirm={confirmDelete}
          title="Delete referral"
        />
      ) : null}
    </section>
  );
}
