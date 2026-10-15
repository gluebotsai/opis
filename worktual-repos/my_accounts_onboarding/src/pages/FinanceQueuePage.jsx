import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Copy, Download, Eye, RefreshCw, XCircle } from "lucide-react";

import { ApproveQuotationModal } from "../components/ApproveQuotationModal.jsx";
import { InvoiceReviewModal } from "../components/InvoiceReviewModal.jsx";
import { clearSession } from "../lib/auth.js";
import { copyTextToClipboard } from "../lib/clipboard.js";
import { approveQuotation, fetchFinanceQuotations, rejectQuotation } from "../lib/quotations.js";
import { fetchPaymentConfig, isPaymentPaid, markQuotationPaid, paymentStatusLabel, syncQuotationPayment } from "../lib/payments.js";
import { buildQuotationPreviewEntries } from "../lib/quoteAttachments.js";
import { subscribeToAppEvents } from "../lib/eventStream.js";

const statusClassNames = {
  "Pending Finance Review": "status-pill status-pill--pending",
  Approved: "status-pill status-pill--approved",
  Paid: "status-pill status-pill--approved",
  Rejected: "status-pill status-pill--rejected",
};

function quotationHasInvoices(quotation) {
  return Boolean(
    quotation?.pdfBase64 || quotation?.invoices?.some((entry) => entry?.pdfBase64),
  );
}

function formatApprovalMessage(result) {
  if (result.retriedPaymentLink) {
    return "Payment link created for this already-approved quotation. Customer email is being sent from the sales mailbox.";
  }

  if (result.payment?.paymentLinkUrl || result.paymentLinkSent) {
    return "Quotation approved and payment link created. Customer email is being sent from the sales mailbox.";
  }

  if (result.alreadyApproved) {
    return "This quotation was already approved. The existing payment link is unchanged.";
  }

  return "Quotation approved. Customer email is being sent.";
}

function formatQuotationAmount(quotation) {
  const payment = quotation?.payment;
  if (payment?.amountLabel) {
    return payment.amountLabel;
  }

  if (payment?.grandTotal) {
    return `${payment.currency || quotation.currency || "INR"} ${Number(payment.grandTotal).toLocaleString("en-IN")}`;
  }

  if (quotation?.grandTotal) {
    return `${quotation.currency || "INR"} ${Number(quotation.grandTotal).toLocaleString("en-IN")}`;
  }

  const invoiceTotal = (quotation?.invoices || []).reduce(
    (sum, entry) => sum + Number(entry?.grandTotal || 0),
    0,
  );
  if (invoiceTotal > 0) {
    const currency =
      quotation?.invoices?.find((entry) => entry?.currency)?.currency || quotation?.currency || "INR";
    return `${currency} ${invoiceTotal.toLocaleString("en-IN")}`;
  }

  return "—";
}

export function FinanceQueuePage() {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [viewingQuotation, setViewingQuotation] = useState(null);
  const [invoicePreviewIndex, setInvoicePreviewIndex] = useState(0);
  const [copyLinkState, setCopyLinkState] = useState(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState("stripe");
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [manualPaymentMethod, setManualPaymentMethod] = useState("bank_transfer");
  const [manualPaymentReference, setManualPaymentReference] = useState("");

  const selectedQuotation = useMemo(
    () => quotations.find((entry) => entry.id === selectedId) || null,
    [quotations, selectedId],
  );

  const viewingPreviewEntries = useMemo(
    () => buildQuotationPreviewEntries(viewingQuotation),
    [viewingQuotation],
  );

  const selectedPreviewEntries = useMemo(
    () => buildQuotationPreviewEntries(selectedQuotation),
    [selectedQuotation],
  );

  const activeViewingPreview =
    viewingPreviewEntries[invoicePreviewIndex] || viewingPreviewEntries[0] || null;

  async function handleCopyPaymentLink(url) {
    setActionError("");

    try {
      await copyTextToClipboard(url);
      setCopyLinkState({ url, copied: true });
      window.setTimeout(() => {
        setCopyLinkState((current) => (current?.url === url ? null : current));
      }, 2000);
    } catch {
      setActionError("Could not copy the payment link. Select and copy it manually.");
    }
  }

  function openInvoicePreview(quotation) {
    setInvoicePreviewIndex(0);
    setViewingQuotation(quotation);
  }

  async function loadQuotations({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }
    setError("");

    try {
      const data = await fetchFinanceQuotations();
      setQuotations(data.quotations || []);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Could not load quotations.";

      if (message.toLowerCase().includes("authentication required")) {
        clearSession();
        navigate("/", { replace: true });
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQuotations();
  }, []);

  useEffect(() => {
    fetchPaymentConfig()
      .then((config) => {
        const stripeReady = Boolean(config?.stripeConfigured || config?.providers?.stripe?.configured);
        const razorpayReady = Boolean(
          config?.razorpayConfigured || config?.providers?.razorpay?.configured,
        );
        setStripeConfigured(stripeReady);
        setRazorpayConfigured(razorpayReady);
        if (stripeReady) {
          setPaymentProvider("stripe");
        } else if (razorpayReady) {
          setPaymentProvider("razorpay");
        }
      })
      .catch(() => {
        setStripeConfigured(false);
        setRazorpayConfigured(false);
      });
  }, []);

  useEffect(() => {
    return subscribeToAppEvents({
      channels: ["quotations", "payments"],
      onEvent: (payload) => {
        if (
          payload.event === "quotation.submitted" ||
          payload.event === "quotation.approved" ||
          payload.event === "payment.paid"
        ) {
          void loadQuotations({ silent: true });
        }
      },
    });
  }, []);

  async function handleApprove() {
    if (!selectedQuotation) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await approveQuotation(selectedQuotation.id, {
        note: note.trim(),
        paymentProvider,
      });
      setShowApproveConfirm(false);
      setActionMessage(formatApprovalMessage(result));
      setNote("");
      await loadQuotations();
    } catch (approveError) {
      setActionError(
        approveError instanceof Error ? approveError.message : "Could not approve quotation.",
      );
      await loadQuotations();
    } finally {
      setActionLoading(false);
    }
  }

  function openApproveConfirm() {
    setActionError("");
    setShowApproveConfirm(true);
  }

  async function handleSyncPayment() {
    if (!selectedQuotation) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await syncQuotationPayment(selectedQuotation.id);
      if (result.synced) {
        setActionMessage("Payment confirmed from Razorpay. Quotation is now marked as Paid.");
      } else if (result.alreadyPaid) {
        setActionMessage("This quotation is already marked as paid.");
      } else {
        setActionError("Razorpay has not marked this payment link as paid yet.");
      }
      await loadQuotations();
    } catch (syncError) {
      setActionError(
        syncError instanceof Error ? syncError.message : "Could not sync payment from Razorpay.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMarkPaid() {
    if (!selectedQuotation) {
      return;
    }

    if (!manualPaymentReference.trim()) {
      setActionError("Enter a payment reference (UTR, receipt number, or transaction ID).");
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await markQuotationPaid(selectedQuotation.id, {
        paymentMethod: manualPaymentMethod,
        providerPaymentId: manualPaymentReference.trim(),
        notify: true,
      });
      setActionMessage(
        result.notificationQueued
          ? "Payment recorded. Confirmation emails are being sent in the background."
          : "Payment recorded. Lead and quotation are now marked as Paid.",
      );
      setManualPaymentReference("");
      await loadQuotations();
    } catch (markPaidError) {
      setActionError(
        markPaidError instanceof Error ? markPaidError.message : "Could not record payment.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!selectedQuotation) {
      return;
    }

    if (!note.trim()) {
      setActionError("A rejection note is required. Please explain why this quotation is rejected.");
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      await rejectQuotation(selectedQuotation.id, note.trim());
      setActionMessage("Quotation rejected. Admin notification email is being sent.");
      setNote("");
      await loadQuotations();
    } catch (rejectError) {
      setActionError(
        rejectError instanceof Error ? rejectError.message : "Could not reject quotation.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <section className="finance-queue-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Finance review</p>
          <h1>Quotation queue</h1>
          <p className="page-header__copy">
            Review quotations submitted by sales. Approve to generate a payment link and email the
            customer from the sales mailbox with the invoice attached.
          </p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={loadQuotations} type="button">
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {actionError ? <p className="form-error">{actionError}</p> : null}
      {actionMessage ? <p className="form-success">{actionMessage}</p> : null}

      <div className="finance-queue-layout">
        <div className="finance-queue-list">
          {loading ? <p className="finance-queue-empty">Loading quotations...</p> : null}
          {!loading && quotations.length === 0 ? (
            <p className="finance-queue-empty">No quotations submitted yet.</p>
          ) : null}

          {quotations.map((quotation) => (
            <button
              className={`finance-queue-item ${selectedId === quotation.id ? "is-active" : ""}`}
              key={quotation.id}
              onClick={() => {
                setSelectedId(quotation.id);
                setNote("");
                setActionError("");
                setActionMessage("");
              }}
              type="button"
            >
              <div className="finance-queue-item__top">
                <strong>{quotation.lead?.companyName || "Unknown company"}</strong>
                <span className={statusClassNames[quotation.status] || "status-pill"}>
                  {quotation.status}
                </span>
              </div>
              <small>
                Domain {quotation.lead?.domainId || "—"} · Submitted{" "}
                {new Date(quotation.submittedAt).toLocaleString()}
              </small>
            </button>
          ))}
        </div>

        <div className="finance-queue-detail">
          {selectedQuotation ? (
            <>
              <div className="finance-queue-detail__header">
                <div>
                  <h2>{selectedQuotation.lead?.companyName}</h2>
                  <p>
                    Contact: {selectedQuotation.lead?.contactName || "—"} ·{" "}
                    {selectedQuotation.lead?.workEmail || "—"}
                  </p>
                </div>
                <div className="finance-queue-detail__actions">
                  <button
                    className="secondary-button"
                    disabled={!quotationHasInvoices(selectedQuotation)}
                    onClick={() => openInvoicePreview(selectedQuotation)}
                    type="button"
                  >
                    <Eye size={16} />
                    View invoice
                  </button>
                  {selectedPreviewEntries[0] ? (
                    <a
                      className="secondary-button"
                      download={selectedPreviewEntries[0].fileName || "quotation.pdf"}
                      href={selectedPreviewEntries[0].pdfDataUrl}
                    >
                      <Download size={16} />
                      Download PDF
                    </a>
                  ) : (
                    <button className="secondary-button" disabled type="button">
                      <Download size={16} />
                      Download PDF
                    </button>
                  )}
                </div>
              </div>

              <dl className="finance-detail-grid">
                <div>
                  <dt>Domain ID</dt>
                  <dd>{selectedQuotation.lead?.domainId || "—"}</dd>
                </div>
                <div>
                  <dt>Submitted by</dt>
                  <dd>{selectedQuotation.submittedBy || "Sales team"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedQuotation.status}</dd>
                </div>
                <div>
                  <dt>Invoice total</dt>
                  <dd>{formatQuotationAmount(selectedQuotation)}</dd>
                </div>
                <div>
                  <dt>Attachment</dt>
                  <dd>
                    {selectedQuotation.invoices?.length > 1
                      ? `${selectedQuotation.invoices.length} branch invoices`
                      : selectedQuotation.fileName}
                  </dd>
                </div>
              </dl>

              {selectedQuotation.branchSummary ? (
                <dl className="finance-detail-grid finance-detail-grid--branch">
                  <div>
                    <dt>Products</dt>
                    <dd>{selectedQuotation.branchSummary.productCount}</dd>
                  </div>
                  <div>
                    <dt>Branches</dt>
                    <dd>{selectedQuotation.branchSummary.branchCount}</dd>
                  </div>
                  <div>
                    <dt>Billing groups</dt>
                    <dd>{selectedQuotation.branchSummary.billingGroupCount}</dd>
                  </div>
                  <div>
                    <dt>Invoice mode</dt>
                    <dd>
                      {selectedQuotation.invoiceMode === "per_branch"
                        ? "Separate per billing group"
                        : "Consolidated"}
                    </dd>
                  </div>
                </dl>
              ) : null}

              {selectedQuotation.productSummary?.length ? (
                <div className="finance-product-summary">
                  <h3>Configured products</h3>
                  <table className="finance-product-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Type</th>
                        <th>Branch</th>
                        <th>Bill to</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedQuotation.productSummary.map((item) => (
                        <tr key={`${item.productId || item.name}-${item.branchLabel}-${item.billingLabel}`}>
                          <td>{item.name}</td>
                          <td>
                            <span className={`change-type-pill change-type-pill--${item.changeType || "new"}`}>
                              {item.changeTypeLabel || "New purchase"}
                            </span>
                          </td>
                          <td>{item.branchLabel || "—"}</td>
                          <td>{item.billingLabel || "—"}</td>
                          <td>{item.priceLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {selectedQuotation.status === "Approved" &&
              selectedQuotation.payment &&
              !selectedQuotation.payment.paymentLinkUrl &&
              !isPaymentPaid(selectedQuotation.payment) ? (
                <div className="finance-review-result">
                  <p className="form-error">
                    Payment link was not created for this approved quotation. Click Approve quotation
                    again to retry link generation after fixing the invoice amount.
                  </p>
                </div>
              ) : null}

              {selectedQuotation.status === "Pending Finance Review" ? (
                <div className="finance-review-actions">
                  <label className="field field--full">
                    <span>Notes</span>
                    <small className="finance-review-actions__hint">
                      Optional for approval. Required when rejecting a quotation.
                    </small>
                    <textarea
                      onChange={(event) => {
                        setNote(event.target.value);
                        if (actionError) {
                          setActionError("");
                        }
                      }}
                      placeholder="Add context for the admin team..."
                      rows="4"
                      value={note}
                    />
                  </label>

                  <div className="finance-review-actions__buttons">
                    <button
                      className="finance-review-actions__approve"
                      disabled={actionLoading}
                      onClick={openApproveConfirm}
                      type="button"
                    >
                      <CheckCircle2 size={18} />
                      Approve quotation
                    </button>

                    <button
                      className="finance-review-actions__reject"
                      disabled={actionLoading}
                      onClick={handleReject}
                      type="button"
                    >
                      <XCircle size={18} />
                      Reject quotation
                    </button>
                  </div>
                </div>
              ) : (
                <div className="finance-review-result">
                  <p>
                    Reviewed by {selectedQuotation.reviewedBy || "Finance team"} on{" "}
                    {selectedQuotation.reviewedAt
                      ? new Date(selectedQuotation.reviewedAt).toLocaleString()
                      : "—"}
                  </p>
                  {selectedQuotation.financeNote ? (
                    <p>
                      <strong>Finance note:</strong> {selectedQuotation.financeNote}
                    </p>
                  ) : null}
                  {selectedQuotation.payment ? (
                    <p>
                      <strong>Payment status:</strong>{" "}
                      {paymentStatusLabel(selectedQuotation.payment)}
                      {selectedQuotation.payment.paidAt
                        ? ` · ${new Date(selectedQuotation.payment.paidAt).toLocaleString()}`
                        : ""}
                    </p>
                  ) : null}
                  {selectedQuotation.payment?.paymentLinkUrl &&
                  !isPaymentPaid(selectedQuotation.payment) ? (
                    <div className="finance-payment-link">
                      <strong>Payment link</strong>
                      <p>{selectedQuotation.payment.amountLabel || selectedQuotation.payment.grandTotal}</p>
                      <a href={selectedQuotation.payment.paymentLinkUrl} rel="noreferrer" target="_blank">
                        {selectedQuotation.payment.paymentLinkUrl}
                      </a>
                      <button
                        className="secondary-button"
                        onClick={() => handleCopyPaymentLink(selectedQuotation.payment.paymentLinkUrl)}
                        type="button"
                      >
                        <Copy size={16} />
                        {copyLinkState?.url === selectedQuotation.payment.paymentLinkUrl &&
                        copyLinkState.copied
                          ? "Copied"
                          : "Copy link"}
                      </button>
                      {selectedQuotation.payment.provider === "razorpay" ? (
                        <button
                          className="secondary-button"
                          disabled={actionLoading}
                          onClick={handleSyncPayment}
                          type="button"
                        >
                          <RefreshCw size={16} />
                          Check Razorpay status
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedQuotation.status === "Approved" &&
                  selectedQuotation.payment &&
                  !isPaymentPaid(selectedQuotation.payment) ? (
                    <div className="finance-review-actions finance-manual-payment">
                      <h3>Record manual payment</h3>
                      <p className="finance-review-actions__hint">
                        Use when the customer paid by bank transfer, cash, or another method outside
                        the payment link.
                      </p>
                      <label className="field">
                        <span>Payment method</span>
                        <select
                          onChange={(event) => setManualPaymentMethod(event.target.value)}
                          value={manualPaymentMethod}
                        >
                          <option value="bank_transfer">Bank transfer</option>
                          <option value="manual">Cash / cheque</option>
                          <option value="other">Other gateway</option>
                        </select>
                      </label>
                      <label className="field field--full">
                        <span>Reference</span>
                        <input
                          onChange={(event) => setManualPaymentReference(event.target.value)}
                          placeholder="UTR, receipt number, or transaction ID"
                          type="text"
                          value={manualPaymentReference}
                        />
                      </label>
                      <button
                        className="finance-review-actions__approve"
                        disabled={actionLoading}
                        onClick={handleMarkPaid}
                        type="button"
                      >
                        Mark as paid
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <p className="finance-queue-empty">Select a quotation to review.</p>
          )}
        </div>
      </div>

      {viewingQuotation && activeViewingPreview ? (
        <InvoiceReviewModal
          eyebrow="Finance review"
          fileName={activeViewingPreview.fileName}
          onClose={() => setViewingQuotation(null)}
          pdfDataUrl={activeViewingPreview.pdfDataUrl}
          previewTabs={
            viewingPreviewEntries.length > 1
              ? viewingPreviewEntries.map((entry, index) => ({
                  id: entry.id,
                  label: entry.label,
                  active: index === invoicePreviewIndex,
                  onSelect: () => setInvoicePreviewIndex(index),
                }))
              : null
          }
          showProceed={false}
          title="Quotation invoice preview"
        />
      ) : null}

      {showApproveConfirm && selectedQuotation ? (
        <ApproveQuotationModal
          companyName={selectedQuotation.lead?.companyName || "Unknown company"}
          loading={actionLoading}
          note={note}
          paymentProvider={paymentProvider}
          onPaymentProviderChange={setPaymentProvider}
          stripeConfigured={stripeConfigured}
          razorpayConfigured={razorpayConfigured}
          onCancel={() => setShowApproveConfirm(false)}
          onConfirm={handleApprove}
        />
      ) : null}
    </section>
  );
}
