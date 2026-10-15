// @ts-nocheck
import { useEffect, useState } from "react";
import { Download, Eye, FileText } from "lucide-react";

import { AdminPageToast } from "../admin/AdminPageToast.tsx";
import { InvoiceReviewModal } from "../InvoiceReviewModal.tsx";
import {
  fetchMyInvoice,
  formatInvoiceAmount,
  formatInvoiceDate,
  listMyInvoices,
} from "../../lib/customerInvoices.js";
import { buildQuotationPreviewEntries } from "../../lib/quoteAttachments.js";

export function CustomerInvoicesSection() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoiceModal, setInvoiceModal] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMyInvoices()
      .then((rows) => {
        if (!cancelled) {
          setInvoices(Array.isArray(rows) ? rows : []);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setInvoices([]);
          setError(loadError instanceof Error ? loadError.message : "Could not load invoices.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadInvoiceEntries(invoice) {
    const detail = await fetchMyInvoice(invoice.id);
    const entries = buildQuotationPreviewEntries(detail || {});
    if (!entries.length) {
      throw new Error("No invoice PDF is available for this quotation.");
    }
    return entries;
  }

  async function openInvoice(invoice) {
    if (!invoice?.id || !invoice.canPreview) {
      return;
    }

    setInvoiceModal({
      loading: true,
      error: "",
      fileName: invoice.fileName || "",
      activeId: "",
      entries: [],
    });

    try {
      const entries = await loadInvoiceEntries(invoice);
      setInvoiceModal({
        loading: false,
        error: "",
        fileName: entries[0].fileName || invoice.fileName || "",
        activeId: entries[0].id,
        entries,
      });
    } catch (loadError) {
      setInvoiceModal({
        loading: false,
        error: loadError instanceof Error ? loadError.message : "Could not load invoice.",
        fileName: invoice.fileName || "",
        activeId: "",
        entries: [],
      });
    }
  }

  async function downloadInvoice(invoice) {
    if (!invoice?.id || !invoice.canPreview) {
      return;
    }

    setError("");
    try {
      const entries = await loadInvoiceEntries(invoice);
      const entry = entries[0];
      const link = document.createElement("a");
      link.href = entry.pdfDataUrl;
      link.download = entry.fileName || invoice.fileName || "invoice.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();

      if (entries.length > 1) {
        setInvoiceModal({
          loading: false,
          error: "",
          fileName: entry.fileName || invoice.fileName || "",
          activeId: entry.id,
          entries,
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not download invoice.");
    }
  }

  const activeEntry =
    invoiceModal?.entries?.find((entry) => entry.id === invoiceModal.activeId) || null;

  return (
    <section
      className="onboarding-card lead-dashboard-panel customer-account-invoices"
      id="customer-invoices"
    >
      <div className="lead-dashboard-panel__heading">
        <div className="lead-dashboard-panel__heading-icon">
          <FileText size={18} strokeWidth={2} />
        </div>
        <div>
          <h2>Invoices</h2>
          <p>View, preview, and download approved and paid invoices for your account.</p>
        </div>
      </div>

      <AdminPageToast error={error} onDismiss={() => setError("")} />

      {loading ? (
        <p className="customer-support-loading" role="status">
          Loading invoices...
        </p>
      ) : null}

      {!loading && !error && invoices.length === 0 ? (
        <p className="sales-oversight-empty">No invoices yet.</p>
      ) : null}

      {!loading && invoices.length > 0 ? (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Issued</th>
                <th>Paid</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <strong>{invoice.fileName || invoice.id}</strong>
                  </td>
                  <td>
                    <span className="lead-dashboard-badge">{invoice.statusLabel}</span>
                  </td>
                  <td>{formatInvoiceAmount(invoice.grandTotal, invoice.currency)}</td>
                  <td>{formatInvoiceDate(invoice.reviewedAt || invoice.submittedAt)}</td>
                  <td>{formatInvoiceDate(invoice.paidAt)}</td>
                  <td className="data-table__actions">
                    {invoice.canPreview ? (
                      <div className="customer-invoice-actions">
                        <button
                          className="secondary-button"
                          onClick={() => void openInvoice(invoice)}
                          type="button"
                        >
                          <Eye size={16} />
                          Preview
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => void downloadInvoice(invoice)}
                          type="button"
                        >
                          <Download size={16} />
                          Download
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {invoiceModal ? (
        <InvoiceReviewModal
          error={invoiceModal.error}
          eyebrow="Invoice"
          fileName={invoiceModal.fileName}
          loading={invoiceModal.loading}
          onClose={() => setInvoiceModal(null)}
          pdfDataUrl={activeEntry?.pdfDataUrl || null}
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
          title="Invoice history"
        />
      ) : null}
    </section>
  );
}
