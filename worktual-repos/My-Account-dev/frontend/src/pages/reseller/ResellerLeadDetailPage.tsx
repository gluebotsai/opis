// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Inbox, Pencil, Trash2 } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { DeleteCustomerModal } from "../../components/DeleteCustomerModal.tsx";
import { useLeadEdit } from "../../components/leads/LeadEditProvider.tsx";
import { deleteResellerLead, fetchResellerLeadById } from "../../lib/resellerAuth.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/reseller-portal.css";
import "../../styles/reseller-lead-detail.css";

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function ResellerLeadDetailPage() {
  const { leadId } = useParams();
  const { startEditLead } = useLeadEdit();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadLead = useCallback(() => {
    setLoading(true);
    fetchResellerLeadById(leadId)
      .then((row) => {
        setLead(row);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load lead.");
        setLead(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);

  usePortalLiveDataReload(loadLead, { leadId });

  async function confirmDelete() {
    if (!lead?.id) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteResellerLead(lead.id);
      window.dispatchEvent(new CustomEvent("worktual:lead-updated"));
      window.location.assign("/reseller/leads");
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error ? deleteFailure.message : "Could not delete lead.",
      );
      setDeleteBusy(false);
    }
  }

  return (
    <section className="admin-users-page reseller-lead-detail-page">
      <header className="page-header admin-users-page__header reseller-lead-detail-page__header">
        <div>
          <Link className="reseller-detail-back" to="/reseller/leads">
            ← Back to leads
          </Link>
          <h1>{loading ? "Lead details" : lead?.companyName || "Lead not found"}</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            {lead
              ? `Tenant ID ${lead.tenantId || "—"} · Status ${lead.status || "—"}`
              : "Customer profile and subscriptions for this reseller lead."}
          </p>
        </div>
        {lead ? (
          <div className="page-header__actions">
            <button
              className="secondary-button"
              onClick={() => startEditLead(lead.id)}
              type="button"
            >
              <Pencil size={16} strokeWidth={1.75} />
              Edit lead
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setDeleteOpen(true);
                setDeleteError("");
              }}
              type="button"
            >
              <Trash2 size={16} strokeWidth={1.75} />
              Delete lead
            </button>
          </div>
        ) : null}
      </header>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      {loading ? (
        <section className="admin-users-panel reseller-detail-panel reseller-detail-panel--fill">
          <div className="admin-users-panel__body">
            <p className="admin-users-panel__loading" role="status">
              Loading lead…
            </p>
          </div>
        </section>
      ) : null}

      {!loading && !lead ? (
        <section className="admin-users-panel reseller-detail-panel reseller-detail-panel--fill">
          <div className="admin-users-panel__body">
            <div className="reseller-lead-detail-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>Lead not found</h3>
              <p>This lead may have been removed or is not assigned to your account.</p>
              <Link className="secondary-button" to="/reseller/leads">
                Back to leads
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && lead ? (
        <>
          <section className="admin-users-panel reseller-detail-panel">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Company profile</h2>
                <p>Contact and billing details for this customer.</p>
              </div>
            </header>
            <dl className="reseller-detail-grid">
              <div>
                <dt>Contact</dt>
                <dd title={[lead.contactName, lead.designation].filter(Boolean).join(" · ")}>
                  {lead.contactName || "—"}
                  {lead.designation ? ` · ${lead.designation}` : ""}
                </dd>
              </div>
              <div>
                <dt>Work email</dt>
                <dd title={lead.workEmail || "—"}>{lead.workEmail || "—"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd title={formatDate(lead.createdAt)}>{formatDate(lead.createdAt)}</dd>
              </div>
              <div className="reseller-detail-grid__full">
                <dt>Billing address</dt>
                <dd title={lead.billingAddress || "—"}>{lead.billingAddress || "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="admin-users-panel reseller-detail-panel reseller-detail-panel--fill">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Subscriptions</h2>
                <p>
                  {lead.subscriptions?.length
                    ? `${lead.subscriptions.length} subscription${
                        lead.subscriptions.length === 1 ? "" : "s"
                      }`
                    : "No subscriptions yet"}
                </p>
              </div>
            </header>
            <div className="admin-users-panel__body">
              {!lead.subscriptions?.length ? (
                <div className="reseller-lead-detail-empty" role="status">
                  <Inbox size={28} aria-hidden="true" />
                  <h3>No subscriptions</h3>
                  <p>Subscriptions appear after a paid quotation for this customer.</p>
                </div>
              ) : (
                <div className="admin-users-panel__table-wrap">
                  <table className="admin-users-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Status</th>
                        <th>Renews</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lead.subscriptions.map((subscription) => {
                        const product = subscription.productId || "—";
                        const status = subscription.status || "—";
                        const renews = formatDate(subscription.renewsAt);
                        return (
                          <tr key={subscription.id}>
                            <td title={product}>{product}</td>
                            <td title={status}>{status}</td>
                            <td title={renews}>{renews}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      {deleteOpen && lead ? (
        <DeleteCustomerModal
          busy={deleteBusy}
          companyName={lead.companyName || ""}
          copy="This permanently deletes the lead, quotations, and related records. This cannot be undone."
          error={deleteError}
          onCancel={() => {
            if (!deleteBusy) {
              setDeleteOpen(false);
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
