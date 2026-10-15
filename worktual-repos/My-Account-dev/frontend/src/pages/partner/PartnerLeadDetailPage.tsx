// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Inbox, Pencil, Trash2 } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { DeleteCustomerModal } from "../../components/DeleteCustomerModal.tsx";
import { InvoiceReviewModal } from "../../components/InvoiceReviewModal.tsx";
import { useLeadEdit } from "../../components/leads/LeadEditProvider.tsx";
import { formatInrAmount } from "../../lib/commissions.js";
import {
  deletePartnerLead,
  fetchPartnerLeadById,
  fetchPartnerQuotationInvoice,
} from "../../lib/partnerAuth.js";
import {
  partnerCanViewInvoice,
  partnerQuotationStatusLabel,
} from "../../lib/partnerQuotations.js";
import { buildQuotationPreviewEntries } from "../../lib/quoteAttachments.js";
import { usePortalLiveDataReload } from "../../hooks/usePortalLiveDataReload.js";
import "../../styles/admin-users-light.css";
import "../../styles/partner-leads.css";
import "../../styles/partner-lead-detail.css";

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

export function PartnerLeadDetailPage() {
  const { leadId } = useParams();
  const { startEditLead } = useLeadEdit();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [invoiceModal, setInvoiceModal] = useState(null);

  const loadLead = useCallback(() => {
    setLoading(true);
    fetchPartnerLeadById(leadId)
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

    function handleLeadUpdated() {
      loadLead();
    }

    window.addEventListener("worktual:lead-updated", handleLeadUpdated);
    return () => {
      window.removeEventListener("worktual:lead-updated", handleLeadUpdated);
    };
  }, [loadLead]);

  usePortalLiveDataReload(loadLead, { leadId });

  async function openInvoice(quotation) {
    if (!quotation?.id || !partnerCanViewInvoice(quotation.status)) {
      return;
    }

    setInvoiceModal({
      loading: true,
      error: "",
      fileName: quotation.fileName || "",
      activeId: "",
      entries: [],
    });

    try {
      const invoice = await fetchPartnerQuotationInvoice(leadId, quotation.id);
      const entries = buildQuotationPreviewEntries(invoice || {});
      if (!entries.length) {
        setInvoiceModal({
          loading: false,
          error: "No invoice PDF is available for this quotation.",
          fileName: quotation.fileName || "",
          activeId: "",
          entries: [],
        });
        return;
      }

      setInvoiceModal({
        loading: false,
        error: "",
        fileName: entries[0].fileName || quotation.fileName || "",
        activeId: entries[0].id,
        entries,
      });
    } catch (loadError) {
      setInvoiceModal({
        loading: false,
        error: loadError instanceof Error ? loadError.message : "Could not load invoice.",
        fileName: quotation.fileName || "",
        activeId: "",
        entries: [],
      });
    }
  }

  const quotations = Array.isArray(lead?.quotations) ? lead.quotations : [];
  const latestQuotation =
    lead?.latestQuotationStatusLabel ||
    partnerQuotationStatusLabel(lead?.latestQuotationStatus);
  const latestTone = quotationTone(lead?.latestQuotationStatus, latestQuotation);
  const assigned = Boolean(lead?.assignedUserId);

  async function confirmDelete() {
    if (!lead?.id) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deletePartnerLead(lead.id);
      window.dispatchEvent(new CustomEvent("worktual:lead-updated"));
      window.location.assign("/partner/leads");
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error ? deleteFailure.message : "Could not delete referral.",
      );
      setDeleteBusy(false);
    }
  }

  return (
    <section className="admin-users-page partner-lead-detail-page">
      <header className="page-header admin-users-page__header partner-lead-detail-page__header">
        <div>
          <Link className="partner-detail-back" to="/partner/leads">
            ← Back to referrals
          </Link>
          <h1>{loading ? "Referral detail" : lead?.companyName || "Referral not found"}</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            {lead
              ? assigned
                ? "Assigned to sales. You can still edit or delete this referral until finance approval."
                : "Awaiting assignment — edit referral details or delete if submitted in error."
              : "Referral profile and quotation history for this partner lead."}
          </p>
        </div>
        {lead ? (
          <div className="page-header__actions">
            <button
              className="secondary-button partner-lead-detail-page__edit"
              onClick={() => startEditLead(lead.id)}
              type="button"
            >
              <Pencil size={16} strokeWidth={1.75} />
              Edit referral
            </button>
            <button
              className="secondary-button partner-lead-detail-page__delete"
              onClick={() => {
                setDeleteOpen(true);
                setDeleteError("");
              }}
              type="button"
            >
              <Trash2 size={16} strokeWidth={1.75} />
              Delete referral
            </button>
          </div>
        ) : null}
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setSuccessMessage("");
        }}
        success={successMessage}
      />

      {loading ? (
        <section className="admin-users-panel partner-detail-panel partner-detail-panel--fill">
          <div className="admin-users-panel__body">
            <p className="admin-users-panel__loading" role="status">
              Loading referral…
            </p>
          </div>
        </section>
      ) : null}

      {!loading && !lead ? (
        <section className="admin-users-panel partner-detail-panel partner-detail-panel--fill">
          <div className="admin-users-panel__body">
            <div className="partner-lead-detail-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>Referral not found</h3>
              <p>This referral may have been removed or is not linked to your partner account.</p>
              <Link className="secondary-button" to="/partner/leads">
                Back to referrals
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && lead ? (
        <>
          <section className="admin-users-panel partner-detail-panel">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Referral profile</h2>
                <p>Contact, assignment, and latest quotation status.</p>
              </div>
            </header>
            <dl className="partner-detail-grid">
              <div>
                <dt>Tenant ID</dt>
                <dd title={lead.tenantId || "—"}>{lead.tenantId || "—"}</dd>
              </div>
              <div>
                <dt>Lead status</dt>
                <dd title={lead.status || "—"}>{lead.status || "—"}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd title={lead.contactName || "—"}>{lead.contactName || "—"}</dd>
              </div>
              <div>
                <dt>Work email</dt>
                <dd title={lead.workEmail || "—"}>{lead.workEmail || "—"}</dd>
              </div>
              <div>
                <dt>Latest quotation</dt>
                <dd>
                  <span className={`partner-leads-pill partner-leads-pill--${latestTone}`}>
                    {latestQuotation}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Assigned</dt>
                <dd>
                  <span
                    className={`partner-leads-pill partner-leads-pill--${
                      assigned ? "assigned" : "unassigned"
                    }`}
                  >
                    {assigned ? "Assigned" : "Awaiting assignment"}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="admin-users-panel partner-detail-panel partner-detail-panel--fill">
            <header className="admin-users-panel__section-header">
              <div>
                <h2>Quotations</h2>
                <p>
                  {quotations.length
                    ? `${quotations.length} quotation${quotations.length === 1 ? "" : "s"} · invoices available when awaiting payment or paid`
                    : "No quotations yet"}
                </p>
              </div>
            </header>
            <div className="admin-users-panel__body">
              {quotations.length === 0 ? (
                <div className="partner-lead-detail-empty" role="status">
                  <Inbox size={28} aria-hidden="true" />
                  <h3>Not quoted yet</h3>
                  <p>Sales will create and submit a quotation. Invoice viewing opens after finance approval or payment.</p>
                </div>
              ) : (
                <div className="admin-users-panel__table-wrap">
                  <table className="admin-users-table partner-quotes-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Amount</th>
                        <th>Submitted</th>
                        <th>Reviewed</th>
                        <th>Paid</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {quotations.map((quotation) => {
                        const status =
                          quotation.statusLabel || partnerQuotationStatusLabel(quotation.status);
                        const tone = quotationTone(quotation.status, status);
                        const amount =
                          quotation.grandTotal != null
                            ? formatInrAmount(quotation.grandTotal, quotation.currency || "INR")
                            : "—";
                        const submitted = formatDate(quotation.submittedAt);
                        const reviewed = formatDate(quotation.reviewedAt);
                        const paid = formatDate(quotation.paidAt);
                        const canView =
                          quotation.canViewInvoice || partnerCanViewInvoice(quotation.status);

                        return (
                          <tr key={quotation.id}>
                            <td title={status}>
                              <span className={`partner-leads-pill partner-leads-pill--${tone}`}>
                                {status}
                              </span>
                            </td>
                            <td title={amount}>{amount}</td>
                            <td title={submitted}>{submitted}</td>
                            <td title={reviewed}>{reviewed}</td>
                            <td title={paid}>{paid}</td>
                            <td>
                              {canView ? (
                                <button
                                  className="partner-quotes-table__action"
                                  onClick={() => void openInvoice(quotation)}
                                  type="button"
                                >
                                  View invoice
                                </button>
                              ) : (
                                <span className="partner-quotes-muted">—</span>
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
          </section>
        </>
      ) : null}

      {invoiceModal ? (
        <InvoiceReviewModal
          error={invoiceModal.error}
          eyebrow="Invoice"
          fileName={invoiceModal.fileName}
          loading={invoiceModal.loading}
          onClose={() => setInvoiceModal(null)}
          pdfDataUrl={
            invoiceModal.entries?.find((entry) => entry.id === invoiceModal.activeId)?.pdfDataUrl ||
            null
          }
          previewTabs={
            invoiceModal.entries?.length > 1
              ? invoiceModal.entries.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  active: entry.id === invoiceModal.activeId,
                  onSelect: () =>
                    setInvoiceModal((current) =>
                      current
                        ? { ...current, activeId: entry.id, fileName: entry.fileName }
                        : current,
                    ),
                }))
              : null
          }
          showProceed={false}
          title="Referral invoice"
        />
      ) : null}

      {deleteOpen && lead ? (
        <DeleteCustomerModal
          busy={deleteBusy}
          companyName={lead.companyName || ""}
          copy="This permanently deletes the referral, quotations, and related records. This cannot be undone."
          error={deleteError}
          onCancel={() => {
            if (!deleteBusy) {
              setDeleteOpen(false);
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
