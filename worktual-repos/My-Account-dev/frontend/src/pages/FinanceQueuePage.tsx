// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Copy,
  Download,
  Eye,
  Inbox,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";

import { ApproveQuotationModal } from "../components/ApproveQuotationModal.tsx";
import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { ConfirmActionModal } from "../components/ConfirmActionModal.tsx";
import { FinanceProductSpecModal } from "../components/finance/FinanceProductSpecModal.tsx";
import { InvoiceReviewModal } from "../components/InvoiceReviewModal.tsx";
import { clearSession } from "../lib/auth.js";
import { copyTextToClipboard } from "../lib/clipboard.js";
import { approveQuotation, fetchFinanceQuotation, fetchFinanceQuotations, rejectQuotation } from "../lib/quotations.js";
import { branchPaymentStatusLabel, confirmQuotationPayment, fetchPaymentConfig, financeAlertStatusLabel, hasAllBranchPaymentLinks, isBranchPaymentPaid, isBranchPaymentReported, isFinanceAlertActionRequired, isMultiBranchPayment, isPaymentPaid, isPaymentReported, isWelcomeEmailActionRequired, isWelcomeEmailDelivered, markQuotationPaid, paymentStatusLabel, reportQuotationPayment, resendFinancePaymentAlert, resendQuotationWelcomeEmail, syncQuotationPayment, welcomeEmailStatusLabel } from "../lib/payments.js";
import { paymentReportedSla, setPaymentConfirmSlaHours } from "../lib/paymentSla.js";
import { buildQuotationPreviewEntries } from "../lib/quoteAttachments.js";
import { subscribeToAppEvents } from "../lib/eventStream.js";
import { sanitizeUtrInput, UTR_MAX_LENGTH, validateUtr } from "../lib/utrValidation.js";
import { resolveOutboundRecipients } from "../lib/customerContact.js";
import { resolveInvoiceBillingParty } from "../lib/invoice.js";
import { getLeadCountryDefaults } from "../lib/countryDefaults.js";
import { resolveQuotationPaymentProviderPolicy } from "../lib/paymentProviderPolicy.js";
import "../styles/admin-users-light.css";

const statusClassNames = {
  "Pending Finance Review": "status-pill status-pill--pending finance-status-pill--pending",
  Approved: "status-pill status-pill--approved finance-status-pill--awaiting",
  Paid: "status-pill status-pill--approved finance-status-pill--paid",
  Rejected: "status-pill status-pill--rejected finance-status-pill--rejected",
};

const queueFilters = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Pending review" },
  { id: "awaiting_payment", label: "Awaiting payment" },
  { id: "awaiting_confirmation", label: "Awaiting confirmation" },
  { id: "paid", label: "Paid" },
];

function isBillingChangeQuotation(quotation) {
  const phase = quotation?.billingPhase || "standard";
  return phase === "mrr_adjustment" || phase === "renewal_cancel";
}

function billingChangeLabel(quotation) {
  const phase = quotation?.billingPhase || "";
  if (phase === "mrr_adjustment") {
    return "MRR change";
  }
  if (phase === "renewal_cancel") {
    return "Cancel next renewal";
  }
  return null;
}

function extractBillingChangeDetails(quotation) {
  const assignment = (quotation?.assignments || []).find(
    (entry) => entry?.config?.isBillingChange || entry?.config?.subscriptionId,
  );
  const config = assignment?.config || {};
  return {
    subscriptionId: config.subscriptionId || config.subscription_id || null,
    currentMrr:
      config.currentMrr !== undefined && config.currentMrr !== null
        ? Number(config.currentMrr)
        : null,
    proposedMonthlyPrice:
      config.proposedMonthlyPrice !== undefined && config.proposedMonthlyPrice !== null
        ? Number(config.proposedMonthlyPrice)
        : null,
    note: config.billingChangeNote || config.note || "",
    productId: assignment?.productId || null,
  };
}

function resolveQueueItemStatus(quotation) {
  const paymentStatus = quotation?.payment?.status || "pending";
  const branchPayments = quotation?.payment?.branchPayments || [];
  const hasPaidBranch = branchPayments.some((entry) => entry.status === "paid");
  const hasReportedBranch = branchPayments.some((entry) => entry.status === "reported");
  const hasFailedBranch = branchPayments.some((entry) => entry.status === "failed");
  const billingPhase = quotation?.billingPhase || "standard";

  if (isBillingChangeQuotation(quotation) && quotation.status === "Paid") {
    return {
      label: `${billingChangeLabel(quotation)} applied`,
      className: statusClassNames.Paid,
    };
  }
  if (isBillingChangeQuotation(quotation) && quotation.status === "Pending Finance Review") {
    return {
      label: `${billingChangeLabel(quotation)} — pending review`,
      className: statusClassNames["Pending Finance Review"],
    };
  }
  if (quotation.status === "Paid" || paymentStatus === "paid") {
    return { label: "Paid", className: statusClassNames.Paid };
  }
  if (billingPhase === "go_live_proration" && quotation.status === "Pending Finance Review") {
    return {
      label: "Go-live proration review",
      className: statusClassNames["Pending Finance Review"],
    };
  }
  if (billingPhase === "implementation" && quotation.status === "Approved") {
    return { label: "Implementation fee — awaiting payment", className: statusClassNames.Approved };
  }
  if (billingPhase === "go_live_proration" && quotation.status === "Approved") {
    return { label: "Go-live — awaiting payment", className: statusClassNames.Approved };
  }
  if (quotation.status === "Rejected") {
    return { label: "Rejected", className: statusClassNames.Rejected };
  }
  if (hasPaidBranch || paymentStatus === "partial") {
    const paidCount = branchPayments.filter((entry) => entry.status === "paid").length;
    const total = branchPayments.length;
    return {
      label: total > 1 ? `${paidCount} of ${total} branches paid` : "Partially paid",
      className: "status-pill status-pill--pending finance-status-pill--pending",
    };
  }
  if (paymentStatus === "reported" || hasReportedBranch) {
    return {
      label: "Awaiting confirmation",
      className: "status-pill status-pill--pending finance-status-pill--pending",
    };
  }
  if (paymentStatus === "failed" || (hasFailedBranch && !hasReportedBranch && !hasPaidBranch)) {
    return {
      label: "Payment failed",
      className: statusClassNames.Rejected,
    };
  }
  if (quotation.status === "Approved") {
    return { label: "Awaiting payment", className: statusClassNames.Approved };
  }
  if (quotation.status === "Pending Finance Review") {
    return {
      label: "Pending review",
      className: statusClassNames["Pending Finance Review"],
    };
  }

  return {
    label: quotation.status || "Unknown",
    className: "status-pill",
  };
}

function isGatewayPaymentProvider(payment) {
  const provider = String(payment?.provider || "").toLowerCase();
  return provider === "stripe" || provider === "razorpay";
}

function matchesQueueFilter(quotation, filterId) {
  const paymentStatus = quotation?.payment?.status || "pending";

  switch (filterId) {
    case "pending_review":
      return quotation.status === "Pending Finance Review";
    case "awaiting_payment":
      return (
        quotation.status === "Approved" &&
        (paymentStatus === "pending" ||
          paymentStatus === "partial" ||
          paymentStatus === "failed")
      );
    case "awaiting_confirmation":
      return (
        paymentStatus === "reported" ||
        (quotation.payment?.branchPayments || []).some((entry) => entry.status === "reported")
      );
    case "paid":
      return quotation.status === "Paid" || paymentStatus === "paid";
    default:
      return true;
  }
}

function quotationHasInvoices(quotation) {
  return Boolean(
    quotation?.hasInvoice ||
      quotation?.pdfBase64 ||
      quotation?.invoices?.some((entry) => entry?.hasPdf || entry?.pdfBase64),
  );
}

function isTemporaryFinanceQuotation(quotation) {
  return (
    quotation?.isTemporary === true ||
    quotation?.skipPaymentLink === true ||
    String(quotation?.leadKind || "").toLowerCase() === "temporary" ||
    String(quotation?.lead?.leadKind || "").toLowerCase() === "temporary"
  );
}

function formatApprovalMessage(result) {
  if (result.billingChangeApplied) {
    return result.billingChangeLabel
      ? `${result.billingChangeLabel} approved and applied. No customer payment is required.`
      : "Billing change approved and applied. No customer payment is required.";
  }

  if (
    result.temporaryLead === true ||
    isTemporaryFinanceQuotation(result.quotation)
  ) {
    return result.alreadyApproved
      ? "Temporary lead quotation was already approved for record. No payment link is issued."
      : "Temporary lead quotation approved for record. No payment link is issued.";
  }

  if (result.zeroValueInvoice === true) {
    return result.alreadyApproved
      ? "Zero-value invoice was already approved and fulfilled. No payment link is issued."
      : "Zero-value invoice approved, marked paid, and fulfilled. Welcome/login email will be sent — no payment link.";
  }

  const mailQueued = result.notificationQueued !== false;
  const mailSuffix = mailQueued
    ? "Customer email is being sent from the sales mailbox."
    : "Customer email could not be queued — use Forward again from sales if needed.";

  if (result.offlinePayment) {
    return mailQueued
      ? "Quotation approved for offline payment. Customer email with offline payment instructions is being sent."
      : `Quotation approved for offline payment. ${mailSuffix}`;
  }

  if (result.retriedPaymentLink) {
    return `Payment link created for this already-approved quotation. ${mailSuffix}`;
  }

  if (result.payment?.paymentLinkUrl || result.paymentLinkSent || hasAllBranchPaymentLinks(result.payment)) {
    return `Quotation approved and payment link created. ${mailSuffix}`;
  }

  if (result.alreadyApproved) {
    return "This quotation was already approved. The existing payment link is unchanged.";
  }

  return mailQueued
    ? "Quotation approved. Customer email is being sent."
    : `Quotation approved. ${mailSuffix}`;
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

function quotationBranchLabel(quotation) {
  return (
    quotation?.branchSummary?.branchLabel ||
    quotation?.invoices?.[0]?.branchLabel ||
    (quotation?.branchSummary?.branchLabels?.length === 1
      ? quotation.branchSummary.branchLabels[0]
      : "") ||
    ""
  );
}

function formatSubmittedAt(value) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function quotationSearchHaystack(quotation) {
  return [
    quotation?.lead?.companyName,
    quotation?.lead?.tenantId,
    quotation?.lead?.contactName,
    quotation?.lead?.workEmail,
    quotation?.submittedBy,
    quotationBranchLabel(quotation),
    quotation?.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [detailQuotation, setDetailQuotation] = useState(null);
  const [copyLinkState, setCopyLinkState] = useState(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showWelcomeEmailConfirm, setShowWelcomeEmailConfirm] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState("stripe");
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [manualPaymentMethod, setManualPaymentMethod] = useState("bank_transfer");
  const [manualPaymentReference, setManualPaymentReference] = useState("");
  const [manualPaymentReferenceError, setManualPaymentReferenceError] = useState("");
  const [queueFilter, setQueueFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [productSpecView, setProductSpecView] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filteredQuotations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return quotations.filter((quotation) => {
      if (!matchesQueueFilter(quotation, queueFilter)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return quotationSearchHaystack(quotation).includes(query);
    });
  }, [quotations, queueFilter, searchQuery]);

  const selectedQuotation = useMemo(
    () => quotations.find((entry) => entry.id === selectedId) || null,
    [quotations, selectedId],
  );

  const viewingPreviewEntries = useMemo(
    () => buildQuotationPreviewEntries(viewingQuotation),
    [viewingQuotation],
  );

  const selectedResellerBilling = useMemo(() => {
    const lead = selectedQuotation?.lead;
    if (!lead?.reseller) {
      return null;
    }

    const billingParty = resolveInvoiceBillingParty(lead);
    const recipients = resolveOutboundRecipients(lead);
    const taxLabel = getLeadCountryDefaults(billingParty.country || lead.country || "").taxFieldLabel;

    return {
      billingParty,
      recipients,
      taxLabel,
    };
  }, [selectedQuotation]);

  const selectedPaymentPolicy = useMemo(
    () => resolveQuotationPaymentProviderPolicy(selectedQuotation),
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

  async function ensureQuotationDetail(quotationId) {
    if (
      detailQuotation?.id === quotationId &&
      (detailQuotation.pdfBase64 ||
        detailQuotation.invoices?.some((entry) => entry?.pdfBase64))
    ) {
      return detailQuotation;
    }

    const full = await fetchFinanceQuotation(quotationId);
    setDetailQuotation(full);
    setQuotations((current) =>
      current.map((entry) =>
        entry.id === full.id
          ? {
              ...entry,
              ...full,
              hasInvoice: true,
            }
          : entry,
      ),
    );
    return full;
  }

  async function openInvoicePreview(quotation) {
    setInvoicePreviewIndex(0);
    setActionError("");
    setInvoiceLoading(true);
    try {
      const full = await ensureQuotationDetail(quotation.id);
      setViewingQuotation(full);
    } catch (previewError) {
      setActionError(
        previewError instanceof Error
          ? previewError.message
          : "Could not load the invoice PDF.",
      );
    } finally {
      setInvoiceLoading(false);
    }
  }

  async function handleDownloadPdf() {
    if (!selectedId) {
      return;
    }

    setActionError("");
    setInvoiceLoading(true);
    try {
      const full = await ensureQuotationDetail(selectedId);
      const entries = buildQuotationPreviewEntries(full);
      const primary = entries[0];
      if (!primary?.pdfDataUrl) {
        throw new Error("No invoice PDF is available for this quotation.");
      }

      const link = document.createElement("a");
      link.href = primary.pdfDataUrl;
      link.download = primary.fileName || "quotation.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (downloadError) {
      setActionError(
        downloadError instanceof Error
          ? downloadError.message
          : "Could not download the invoice PDF.",
      );
    } finally {
      setInvoiceLoading(false);
    }
  }

  async function loadQuotations({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }
    setError("");

    try {
      const data = await fetchFinanceQuotations();
      setQuotations(data.quotations || []);
      setDetailQuotation(null);
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
    if (!detailOpen) {
      return undefined;
    }
    function onKeyDown(event) {
      if (event.key === "Escape" && !actionLoading && !showApproveConfirm && !showWelcomeEmailConfirm) {
        closeReview();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailOpen, actionLoading, showApproveConfirm, showWelcomeEmailConfirm]);

  useEffect(() => {
    fetchPaymentConfig()
      .then((config) => {
        if (config?.paymentConfirmSlaHours) {
          setPaymentConfirmSlaHours(config.paymentConfirmSlaHours);
        }
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
    let reloadTimer = null;
    const unsubscribe = subscribeToAppEvents({
      channels: ["quotations", "payments"],
      onEvent: (payload) => {
        if (
          payload.event === "quotation.submitted" ||
          payload.event === "quotation.approved" ||
          payload.event === "quotation.rejected" ||
          payload.event === "payment.reported" ||
          payload.event === "payment.paid" ||
          payload.event === "payment.failed" ||
          payload.event === "payment.welcome_email_updated"
        ) {
          if (reloadTimer) {
            window.clearTimeout(reloadTimer);
          }
          reloadTimer = window.setTimeout(() => {
            void loadQuotations({ silent: true });
          }, 750);
        }
      },
    });

    return () => {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
      unsubscribe();
    };
  }, []);

  // Poll read-only status while waiting for a gateway webhook. Recovery of reported
  // payments is server-owned; the browser must not create repeated fulfillment writes.
  useEffect(() => {
    const payment = selectedQuotation?.payment;
    const provider = String(payment?.provider || "").toLowerCase();
    const isGateway = provider === "stripe" || provider === "razorpay";
    const waitingForWebhook =
      selectedQuotation?.status === "Approved" &&
      isGateway &&
      payment?.paymentLinkUrl &&
      !isPaymentPaid(payment);

    if (!waitingForWebhook) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadQuotations({ silent: true });
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [selectedQuotation?.id, selectedQuotation?.status, selectedQuotation?.payment?.status, selectedQuotation?.payment?.provider, selectedQuotation?.payment?.paymentLinkUrl]);

  async function handleSyncGatewayPayment() {
    if (!selectedQuotation?.id) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await syncQuotationPayment(selectedQuotation.id);
      if (result?.alreadyPaid || result?.payment?.status === "paid" || result?.quotation?.status === "Paid") {
        setActionMessage(
          result?.fulfillmentDeferred
            ? "Payment marked Paid. Product provisioning is still catching up — refresh in a moment."
            : "Payment confirmed from Stripe/Razorpay. Status is now Paid.",
        );
      } else if (result?.synced) {
        setActionMessage("Payment confirmation completed.");
      } else {
        setActionMessage(
          result?.reason
            ? `Sync finished without a paid status (${result.reason}).`
            : "Sync finished. Refresh if status has not updated yet.",
        );
      }
      await loadQuotations();
    } catch (syncError) {
      console.error("Finance gateway sync failed:", syncError);
      setActionError(
        syncError instanceof Error ? syncError.message : "Could not sync payment status.",
      );
    } finally {
      setActionLoading(false);
    }
  }
  function applyQuotationUpdate(updated) {
    if (!updated?.id) {
      return;
    }
    setQuotations((current) =>
      current.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)),
    );
    setDetailQuotation((current) => (current?.id === updated.id ? null : current));
  }

  function openReview(quotation) {
    setSelectedId(quotation.id);
    setNote("");
    setActionError("");
    setActionMessage("");
    setProductSpecView(null);
    setDetailOpen(true);
  }

  function closeReview() {
    if (actionLoading) {
      return;
    }
    setDetailOpen(false);
    setSelectedId("");
    setNote("");
    setProductSpecView(null);
    setShowApproveConfirm(false);
  }

  async function handleApprove() {
    if (!selectedQuotation) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const policy = resolveQuotationPaymentProviderPolicy(selectedQuotation);
      const result = await approveQuotation(selectedQuotation.id, {
        note: note.trim(),
        paymentProvider:
          policy.mode === "offline" || policy.mode === "zero"
            ? null
            : policy.forceProvider || paymentProvider,
      });
      setShowApproveConfirm(false);
      setActionMessage(formatApprovalMessage(result));
      setNote("");
      applyQuotationUpdate(result?.quotation);
    } catch (approveError) {
      const status = Number(approveError?.status) || 0;
      const gateway =
        status === 502 ||
        status === 503 ||
        status === 504 ||
        /temporarily unavailable|timed out|Bad Gateway/i.test(
          approveError instanceof Error ? approveError.message : "",
        );
      setActionError(
        gateway
          ? `${approveError instanceof Error ? approveError.message : "Approve timed out."} Refresh the finance queue — the lead was not deleted.`
          : approveError instanceof Error
            ? approveError.message
            : "Could not approve quotation.",
      );
      await loadQuotations({ silent: true });
    } finally {
      setActionLoading(false);
    }
  }

  function openApproveConfirm() {
    setActionError("");
    if (isBillingChangeQuotation(selectedQuotation)) {
      void handleApprove();
      return;
    }
    if (isTemporaryFinanceQuotation(selectedQuotation)) {
      setPaymentProvider("");
      setShowApproveConfirm(true);
      return;
    }
    const policy = resolveQuotationPaymentProviderPolicy(selectedQuotation);
    if (policy.mode === "offline" || policy.mode === "zero") {
      setPaymentProvider("");
    } else if (policy.forceProvider) {
      setPaymentProvider(policy.forceProvider);
    } else if (stripeConfigured) {
      setPaymentProvider("stripe");
    } else if (razorpayConfigured) {
      setPaymentProvider("razorpay");
    }
    setShowApproveConfirm(true);
  }

  function handleManualPaymentReferenceChange(event) {
    const nextValue = sanitizeUtrInput(event.target.value);
    setManualPaymentReference(nextValue);
    if (manualPaymentReferenceError) {
      const result = validateUtr(nextValue);
      setManualPaymentReferenceError(result.ok ? "" : result.error);
    }
  }

  function handleManualPaymentReferenceBlur() {
    if (!manualPaymentReference.trim()) {
      setManualPaymentReferenceError("");
      return;
    }
    const result = validateUtr(manualPaymentReference);
    setManualPaymentReferenceError(result.ok ? "" : result.error);
  }

  async function handleReportPayment(billingBranchId = null) {
    if (!selectedQuotation) {
      return;
    }

    const normalizedBillingTargetId =
      typeof billingBranchId === "string" && billingBranchId.trim() ? billingBranchId.trim() : null;

    const referenceResult = validateUtr(manualPaymentReference);
    if (!referenceResult.ok) {
      setManualPaymentReferenceError(referenceResult.error);
      return;
    }
    setManualPaymentReferenceError("");

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await reportQuotationPayment(selectedQuotation.id, {
        paymentMethod: manualPaymentMethod,
        providerPaymentId: referenceResult.value,
        billingBranchId: normalizedBillingTargetId,
        notify: true,
      });
      setActionMessage(
        result.alreadyPaid
          ? "This quotation is already confirmed as paid."
          : result.alreadyReported
            ? "Payment was already reported. Verify the bank credit, then confirm payment received."
            : "Payment reported. Verify the bank credit, then confirm payment received.",
      );
      setManualPaymentReference("");
      setManualPaymentReferenceError("");
      applyQuotationUpdate(result?.quotation);
      if (!result?.quotation) {
        await loadQuotations({ silent: true });
      }
    } catch (reportError) {
      setActionError(
        reportError instanceof Error ? reportError.message : "Could not report payment.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMarkPaid(billingBranchId = null) {
    if (!selectedQuotation) {
      return;
    }

    const normalizedBillingTargetId =
      typeof billingBranchId === "string" && billingBranchId.trim() ? billingBranchId.trim() : null;

    const referenceResult = validateUtr(manualPaymentReference);
    if (!referenceResult.ok) {
      setManualPaymentReferenceError(referenceResult.error);
      return;
    }
    setManualPaymentReferenceError("");

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await markQuotationPaid(selectedQuotation.id, {
        paymentMethod: manualPaymentMethod,
        providerPaymentId: referenceResult.value,
        billingBranchId: normalizedBillingTargetId,
        notify: true,
      });
      setActionMessage(
        result.alreadyPaid
          ? "This quotation is already confirmed as paid."
          : result.notificationQueued
            ? normalizedBillingTargetId
              ? "Branch marked paid. Customer email and portal credentials are being sent when applicable."
              : "Marked paid. Customer email and portal credentials are being sent."
            : normalizedBillingTargetId
              ? "Branch marked paid. Products activated."
              : "Marked paid. Products activated.",
      );
      setManualPaymentReference("");
      setManualPaymentReferenceError("");
      applyQuotationUpdate(result?.quotation);
      if (!result?.quotation) {
        await loadQuotations({ silent: true });
      }
    } catch (markError) {
      console.error("Finance mark-paid failed:", markError);
      setActionError(
        markError instanceof Error ? markError.message : "Could not mark payment as paid.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmPayment(billingBranchId = null) {
    if (!selectedQuotation) {
      return;
    }

    const normalizedBillingTargetId =
      typeof billingBranchId === "string" && billingBranchId.trim() ? billingBranchId.trim() : null;

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await confirmQuotationPayment(selectedQuotation.id, {
        billingBranchId: normalizedBillingTargetId,
        notify: true,
      });
      setActionMessage(
        result.notificationQueued
          ? normalizedBillingTargetId
            ? "Branch payment confirmed. Customer email and portal credentials are being sent when applicable."
            : "Payment confirmed. Customer email and portal credentials are being sent."
          : normalizedBillingTargetId
            ? result.allBranchesPaid
              ? "All branch payments confirmed. Lead and quotation are now marked as Paid."
              : "Branch payment confirmed. Remaining branches are still awaiting payment."
            : "Payment confirmed. Lead and quotation are now marked as Paid.",
      );
      await loadQuotations();
    } catch (confirmError) {
      console.error("Finance confirm payment failed:", confirmError);
      setActionError(
        confirmError instanceof Error ? confirmError.message : "Could not confirm payment.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResendWelcomeEmail() {
    if (!selectedQuotation) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await resendQuotationWelcomeEmail(selectedQuotation.id);
      setActionMessage(
        result.notificationQueued
          ? "Welcome email is being sent in the background."
          : result.notified
            ? "Welcome email resent to the customer with updated portal credentials."
            : "Could not deliver welcome email. Check mail configuration and try again.",
      );
      await loadQuotations();
      setShowWelcomeEmailConfirm(false);
    } catch (resendError) {
      setActionError(
        resendError instanceof Error ? resendError.message : "Could not resend welcome email.",
      );
      setShowWelcomeEmailConfirm(false);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResendFinanceAlert() {
    if (!selectedQuotation) {
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await resendFinancePaymentAlert(selectedQuotation.id);
      setActionMessage(
        result.notificationQueued
          ? "Finance alert is being sent in the background."
          : result.notified
            ? "Finance alert resent."
            : "Could not deliver finance alert. Check mail configuration and try again.",
      );
      await loadQuotations();
    } catch (resendError) {
      setActionError(
        resendError instanceof Error ? resendError.message : "Could not resend finance alert.",
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
      const result = await rejectQuotation(selectedQuotation.id, note.trim());
      applyQuotationUpdate(result?.quotation);
      setActionMessage(
        result?.notificationQueued !== false
          ? "Quotation rejected. Sales notification email is being sent."
          : "Quotation rejected. Sales notification email could not be queued — notify sales manually if needed.",
      );
      setNote("");
    } catch (rejectError) {
      const status = Number(rejectError?.status) || 0;
      const gateway =
        status === 502 ||
        status === 503 ||
        status === 504 ||
        /temporarily unavailable|timed out|Bad Gateway/i.test(
          rejectError instanceof Error ? rejectError.message : "",
        );
      setActionError(
        gateway
          ? `${rejectError instanceof Error ? rejectError.message : "Reject timed out."} Refresh the finance queue — the lead was not deleted.`
          : rejectError instanceof Error
            ? rejectError.message
            : "Could not reject quotation.",
      );
      await loadQuotations({ silent: true });
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <section className="finance-queue-page">
      <header className="page-header">
        <div>
          <h1>Quotation queue</h1>
          <p className="page-header__copy">
            Review quotations from sales. Approve to generate a payment link and email the customer
            with the invoice attached.
          </p>
        </div>
      </header>

      <AdminPageToast
        error={error || actionError}
        success={actionMessage}
        onDismiss={() => {
          setError("");
          setActionError("");
          setActionMessage("");
        }}
      />

      <section aria-busy={loading} className="finance-queue-panel">
        <header className="finance-queue-panel__header">
          <div>
            <h2>Quotations</h2>
            <p>
              {loading
                ? "Loading…"
                : `${filteredQuotations.length} quotation${
                    filteredQuotations.length === 1 ? "" : "s"
                  } in view`}
            </p>
          </div>
          <div className="finance-queue-panel__tools">
            <label className="finance-queue-panel__search">
              <Search size={16} strokeWidth={1.75} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, tenant, contact…"
                type="search"
                value={searchQuery}
              />
            </label>
            <label className="finance-queue-panel__filter">
              <select
                aria-label="Filter by status"
                onChange={(event) => setQueueFilter(event.target.value)}
                value={queueFilter}
              >
                {queueFilters.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button finance-queue-panel__refresh"
              disabled={loading}
              onClick={() => void loadQuotations()}
              type="button"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <div className="finance-queue-panel__body">
          {loading ? (
            <p className="finance-queue-empty" role="status">
              Loading quotations…
            </p>
          ) : null}

          {!loading && filteredQuotations.length === 0 ? (
            <div className="finance-queue-empty-state" role="status">
              <Inbox size={28} aria-hidden="true" />
              <h3>
                {quotations.length === 0 || (queueFilter === "all" && !searchQuery.trim())
                  ? "No quotations yet"
                  : "No matching quotations"}
              </h3>
              <p>
                {quotations.length === 0
                  ? "When sales submit a quotation for finance review, it will appear here."
                  : "Try clearing search or choosing a different status filter."}
              </p>
              {queueFilter !== "all" || searchQuery.trim() ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setQueueFilter("all");
                    setSearchQuery("");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && filteredQuotations.length > 0 ? (
            <div className="finance-queue-panel__table-wrap">
              <table className="finance-queue-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tenant</th>
                    {/* Hidden for now — single-location UI.
                    <th>Branch</th>
                    */}
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotations.map((quotation) => {
                    const itemStatus = resolveQueueItemStatus(quotation);
                    const company = quotation.lead?.companyName || "Unknown company";
                    const tenant = quotation.lead?.tenantId || "—";
                    // Hidden for now — single-location UI.
                    // const branch = quotationBranchLabel(quotation) || "—";
                    const amount = isBillingChangeQuotation(quotation)
                      ? billingChangeLabel(quotation) || "Billing change"
                      : formatQuotationAmount(quotation);
                    const submitted = formatSubmittedAt(quotation.submittedAt);
                    const temporary = isTemporaryFinanceQuotation(quotation);

                    return (
                      <tr key={quotation.id}>
                        <td title={company}>
                          <span className="finance-queue-table__company">
                            <span>{company}</span>
                            {temporary ? (
                              <span className="status-pill finance-queue-temporary-badge">
                                Temporary
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td title={tenant}>
                          <span className="finance-queue-table__tenant">{tenant}</span>
                        </td>
                        {/* Hidden for now — single-location UI.
                        <td title={branch}>{branch}</td>
                        */}
                        <td title={amount}>{amount}</td>
                        <td>
                          <span className={itemStatus.className}>{itemStatus.label}</span>
                        </td>
                        <td title={submitted}>{submitted}</td>
                        <td className="finance-queue-table__actions">
                          <button
                            className="secondary-button finance-queue-table__review"
                            onClick={() => openReview(quotation)}
                            type="button"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

      {detailOpen && selectedQuotation ? (
        <div
          aria-label="Review quotation"
          aria-modal="true"
          className="admin-side-overlay finance-queue-overlay"
          role="dialog"
        >
          <button
            aria-label="Close review"
            className="admin-side-overlay__backdrop"
            disabled={actionLoading}
            onClick={closeReview}
            type="button"
          />
          <section className="admin-side-overlay__panel admin-side-overlay__panel--wide finance-queue-overlay__panel">
            <header className="admin-side-overlay__header">
              <div>
                <h2>
                  {selectedQuotation.lead?.companyName || "Unknown company"}
                  {/* Hidden for now — single-location UI.
                  {quotationBranchLabel(selectedQuotation)
                    ? ` · ${quotationBranchLabel(selectedQuotation)}`
                    : ""}
                  */}
                  {isTemporaryFinanceQuotation(selectedQuotation) ? (
                    <span className="status-pill finance-queue-temporary-badge">
                      Temporary
                    </span>
                  ) : null}
                </h2>
                <p>
                  Contact: {selectedQuotation.lead?.contactName || "—"} ·{" "}
                  {selectedQuotation.lead?.workEmail || "—"}
                  {isTemporaryFinanceQuotation(selectedQuotation)
                    ? " · Finance approval only — no payment link"
                    : ""}
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={actionLoading}
                onClick={closeReview}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="admin-side-overlay__body finance-queue-overlay__body">
              <div className="finance-queue-detail__actions finance-queue-overlay__actions">
                <button
                  className="secondary-button"
                  disabled={!quotationHasInvoices(selectedQuotation) || invoiceLoading}
                  onClick={() => void openInvoicePreview(selectedQuotation)}
                  type="button"
                >
                  <Eye size={16} />
                  {invoiceLoading ? "Loading…" : "View invoice"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!quotationHasInvoices(selectedQuotation) || invoiceLoading}
                  onClick={() => void handleDownloadPdf()}
                  type="button"
                >
                  <Download size={16} />
                  Download PDF
                </button>
              </div>

              <dl className="finance-detail-grid">
                <div>
                  <dt>Tenant ID</dt>
                  <dd>{selectedQuotation.lead?.tenantId || "—"}</dd>
                </div>
                <div>
                  <dt>Submitted by</dt>
                  <dd>{selectedQuotation.submittedBy || "Sales team"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedQuotation.status}</dd>
                </div>
                {isBillingChangeQuotation(selectedQuotation) ? (
                  <div>
                    <dt>Request type</dt>
                    <dd>{billingChangeLabel(selectedQuotation)}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>Invoice total</dt>
                    <dd>{formatQuotationAmount(selectedQuotation)}</dd>
                  </div>
                )}
                <div>
                  <dt>Attachment</dt>
                  <dd>
                    {selectedQuotation.invoices?.length > 1
                      ? `${selectedQuotation.invoices.length} branch invoices`
                      : selectedQuotation.fileName || "—"}
                  </dd>
                </div>
              </dl>

              {isBillingChangeQuotation(selectedQuotation) ? (
                <div className="finance-reseller-billing onboarding-card">
                  <h3>{billingChangeLabel(selectedQuotation)}</h3>
                  {(() => {
                    const details = extractBillingChangeDetails(selectedQuotation);
                    const currency = selectedQuotation.currency || "INR";
                    if (selectedQuotation.billingPhase === "mrr_adjustment") {
                      return (
                        <p>
                          Current MRR:{" "}
                          <strong>
                            {Number.isFinite(details.currentMrr)
                              ? `${currency} ${Number(details.currentMrr).toLocaleString("en-IN")}`
                              : "—"}
                          </strong>
                          {" → "}
                          Proposed:{" "}
                          <strong>
                            {Number.isFinite(details.proposedMonthlyPrice)
                              ? `${currency} ${Number(details.proposedMonthlyPrice).toLocaleString("en-IN")}`
                              : "—"}
                          </strong>
                          /mo. Approving updates subscription MRR permanently and does not create a
                          payment link.
                          {details.note ? (
                            <>
                              <br />
                              Sales note: {details.note}
                            </>
                          ) : null}
                        </p>
                      );
                    }
                    return (
                      <p>
                        Cancels the upcoming renewal invoice generation for this subscription. The
                        product remains active through the current period. No customer payment is
                        required.
                        {details.note ? (
                          <>
                            <br />
                            Sales note: {details.note}
                          </>
                        ) : null}
                      </p>
                    );
                  })()}
                </div>
              ) : null}

              {selectedResellerBilling ? (
                <div className="finance-reseller-billing onboarding-card">
                  <h3>Reseller billing party</h3>
                  <p className="finance-review-actions__hint">
                    Invoice PDF and payment-link email use the reseller as bill-to. End customer
                    details are kept for service provisioning only.
                  </p>
                  <dl className="finance-detail-grid">
                    <div>
                      <dt>Bill to</dt>
                      <dd>{selectedResellerBilling.billingParty.companyName || "—"}</dd>
                    </div>
                    <div>
                      <dt>Service for</dt>
                      <dd>{selectedQuotation.lead?.companyName || "—"}</dd>
                    </div>
                    <div className="finance-detail-grid__full">
                      <dt>Billing address</dt>
                      <dd>
                        {selectedResellerBilling.billingParty.billingAddress || "—"}
                        {selectedResellerBilling.billingParty.country
                          ? `, ${selectedResellerBilling.billingParty.country}`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>{selectedResellerBilling.taxLabel}</dt>
                      <dd>{selectedResellerBilling.billingParty.taxNumber || "—"}</dd>
                    </div>
                    <div>
                      <dt>Payment email</dt>
                      <dd>{selectedResellerBilling.recipients.to[0] || "—"}</dd>
                    </div>
                    {selectedResellerBilling.recipients.cc.length ? (
                      <div>
                        <dt>Payment CC</dt>
                        <dd>{selectedResellerBilling.recipients.cc.join(", ")}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ) : null}

              {selectedQuotation.branchSummary ? (
                <dl className="finance-detail-grid finance-detail-grid--branch">
                  <div>
                    <dt>Products</dt>
                    <dd>{selectedQuotation.branchSummary.productCount}</dd>
                  </div>
                  {/* Hidden for now — single-location UI.
                  <div>
                    <dt>Branches</dt>
                    <dd>{selectedQuotation.branchSummary.branchCount}</dd>
                  </div>
                  */}
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
                  <div className="finance-product-summary__header">
                    <h3>Configured products</h3>
                    <button
                      className="secondary-button finance-product-summary__spec-button"
                      onClick={() =>
                        setProductSpecView({
                          quotation: selectedQuotation,
                          productIndex: null,
                        })
                      }
                      type="button"
                    >
                      <Eye size={16} />
                      View specifications
                    </button>
                  </div>
                  <table className="finance-product-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Type</th>
                        <th>Period</th>
                        {/* Hidden for now — single-location UI.
                        <th>Branch</th>
                        <th>Bill to</th>
                        */}
                        <th>Price</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedQuotation.productSummary.map((item, index) => (
                        <tr
                          key={`${item.productId || item.name}-${item.branchLabel}-${item.billingLabel}-${index}`}
                        >
                          <td>{item.name}</td>
                          <td>
                            <span className={`change-type-pill change-type-pill--${item.changeType || "new"}`}>
                              {item.changeTypeLabel || "New purchase"}
                            </span>
                          </td>
                          <td>{item.periodLabel || "—"}</td>
                          {/* Hidden for now — single-location UI.
                          <td>{item.branchLabel || "—"}</td>
                          <td>{item.billingLabel || "—"}</td>
                          */}
                          <td>{item.priceLabel}</td>
                          <td>
                            <button
                              aria-label={`View specification for ${item.name || "product"}`}
                              className="finance-product-table__view"
                              onClick={() =>
                                setProductSpecView({
                                  quotation: selectedQuotation,
                                  productIndex: index,
                                })
                              }
                              type="button"
                            >
                              <Eye size={15} />
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {selectedQuotation.status === "Approved" &&
              isTemporaryFinanceQuotation(selectedQuotation) ? (
                <div className="finance-review-result">
                  <p>
                    Temporary lead — approved for record only. No payment link is issued and
                    customer go-live is not started.
                  </p>
                </div>
              ) : null}

              {selectedPaymentPolicy.mode === "zero" &&
              !isTemporaryFinanceQuotation(selectedQuotation) ? (
                <div className="finance-review-result">
                  <p>
                    Zero-value invoice — approval skips the payment link, marks the invoice paid,
                    fulfills products, and sends the welcome/login email.
                  </p>
                </div>
              ) : null}

              {selectedQuotation.status === "Approved" &&
              !isTemporaryFinanceQuotation(selectedQuotation) &&
              selectedQuotation.payment &&
              !hasAllBranchPaymentLinks(selectedQuotation.payment) &&
              !isPaymentPaid(selectedQuotation.payment) &&
              selectedPaymentPolicy.mode !== "offline" &&
              selectedPaymentPolicy.mode !== "zero" ? (
                <div className="finance-review-result">
                  <p className="form-error">
                    Payment link was not created for this approved quotation. Click Approve quotation
                    again to retry link generation after fixing the invoice amount.
                  </p>
                </div>
              ) : null}

              {selectedQuotation.status === "Approved" &&
              !isTemporaryFinanceQuotation(selectedQuotation) &&
              selectedPaymentPolicy.mode === "offline" &&
              !isPaymentPaid(selectedQuotation.payment) ? (
                <div className="finance-review-result">
                  <p>
                    This invoice exceeds ₹25,00,000. Online payment links are disabled — ask the
                    customer to pay by <strong>bank transfer</strong>, then use Report payment or
                    Mark as paid below when funds are received.
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
                      {isBillingChangeQuotation(selectedQuotation)
                        ? `Approve ${billingChangeLabel(selectedQuotation) || "billing change"}`
                        : "Approve quotation"}
                    </button>

                    <button
                      className="finance-review-actions__reject"
                      disabled={actionLoading}
                      onClick={() => void handleReject()}
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
                      {welcomeEmailStatusLabel(selectedQuotation.payment)
                        ? ` · ${welcomeEmailStatusLabel(selectedQuotation.payment)}`
                        : ""}
                      {financeAlertStatusLabel(selectedQuotation.payment)
                        ? ` · ${financeAlertStatusLabel(selectedQuotation.payment)}`
                        : ""}
                      {selectedQuotation.payment.paymentReportedAt
                        ? ` · Reported ${new Date(selectedQuotation.payment.paymentReportedAt).toLocaleString()}`
                        : ""}
                      {selectedQuotation.payment.financeConfirmedAt
                        ? ` · Confirmed ${new Date(selectedQuotation.payment.financeConfirmedAt).toLocaleString()}`
                        : selectedQuotation.payment.paidAt && isPaymentPaid(selectedQuotation.payment)
                          ? ` · ${new Date(selectedQuotation.payment.paidAt).toLocaleString()}`
                          : ""}
                    </p>
                  ) : null}
                  {selectedQuotation.payment?.status === "failed" &&
                  selectedQuotation.payment?.failureReason ? (
                    <p className="form-error">
                      <strong>Payment failure:</strong> {selectedQuotation.payment.failureReason}
                    </p>
                  ) : null}
                  {isPaymentPaid(selectedQuotation.payment) ? (
                    <div className="finance-review-result">
                      {isWelcomeEmailActionRequired(selectedQuotation.payment) ? (
                        <p className="form-error">
                          {selectedQuotation.payment.welcomeEmailStatus === "sent_without_credentials"
                            ? "Customer was emailed but portal credentials were not included."
                            : selectedQuotation.payment.welcomeEmailStatus === "failed"
                              ? `Welcome email failed${selectedQuotation.payment.welcomeEmailLastError ? `: ${selectedQuotation.payment.welcomeEmailLastError}` : "."}`
                              : "Payment is confirmed but the customer welcome email has not been delivered yet."}{" "}
                          Resend after checking mail configuration.
                        </p>
                      ) : null}
                      <p className="finance-review-actions__hint">
                        Resending generates a new temporary portal password. The customer&apos;s
                        previous password will stop working immediately.
                      </p>
                      <button
                        className="secondary-button"
                        disabled={actionLoading}
                        onClick={() => setShowWelcomeEmailConfirm(true)}
                        type="button"
                      >
                        Resend welcome email
                      </button>
                    </div>
                  ) : null}
                  {isPaymentReported(selectedQuotation.payment) &&
                  !isMultiBranchPayment(selectedQuotation.payment) ? (
                    <div className="finance-review-result">
                      <p className={paymentReportedSla(selectedQuotation.payment).overdue ? "form-error" : ""}>
                        {paymentReportedSla(selectedQuotation.payment).label}
                      </p>
                      {isGatewayPaymentProvider(selectedQuotation.payment) ? (
                        <>
                          <p className="finance-review-actions__hint">
                            Stripe/Razorpay payments are marked paid automatically when the provider
                            webhook confirms payment. If status stays on awaiting confirmation, use
                            Complete confirmation to finish fulfillment.
                          </p>
                          {(selectedQuotation.payment.status === "reported" ||
                            (selectedQuotation.payment.branchPayments || []).some(
                              (entry) => entry.status === "reported",
                            )) && (
                            <button
                              className="finance-review-actions__approve"
                              disabled={actionLoading}
                              onClick={() => void handleSyncGatewayPayment()}
                              type="button"
                            >
                              <RefreshCw size={18} />
                              Complete confirmation
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          {isFinanceAlertActionRequired(selectedQuotation.payment) ? (
                            <p className="form-error">
                              {selectedQuotation.payment.financeAlertStatus === "failed"
                                ? `Finance alert failed${selectedQuotation.payment.financeAlertLastError ? `: ${selectedQuotation.payment.financeAlertLastError}` : "."}`
                                : "Finance team alert has not been delivered yet."}{" "}
                              Resend after checking mail configuration.
                            </p>
                          ) : null}
                          <p className="finance-review-actions__hint">
                            Verify the amount in your bank account, then confirm. This only appears
                            for payments that were reported earlier and are still waiting for
                            confirmation.
                          </p>
                          {selectedQuotation.payment.providerPaymentId ? (
                            <p>
                              <strong>Reference:</strong>{" "}
                              {selectedQuotation.payment.providerPaymentId}
                            </p>
                          ) : null}
                          {isFinanceAlertActionRequired(selectedQuotation.payment) ? (
                            <button
                              className="secondary-button"
                              disabled={actionLoading}
                              onClick={() => void handleResendFinanceAlert()}
                              type="button"
                            >
                              Resend finance alert
                            </button>
                          ) : null}
                          <button
                            className="finance-review-actions__approve"
                            disabled={actionLoading}
                            onClick={() => void handleConfirmPayment()}
                            type="button"
                          >
                            <CheckCircle2 size={18} />
                            Confirm payment received
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                  {isMultiBranchPayment(selectedQuotation.payment) ? (
                    <div className="finance-branch-payments">
                      <strong>Branch payment links</strong>
                      <label
                        className={`field field--full${manualPaymentReferenceError ? " is-invalid" : ""}`}
                      >
                        <span>Payment reference for marking branch paid</span>
                        <input
                          aria-invalid={Boolean(manualPaymentReferenceError)}
                          autoCapitalize="characters"
                          autoComplete="off"
                          maxLength={UTR_MAX_LENGTH}
                          onBlur={handleManualPaymentReferenceBlur}
                          onChange={handleManualPaymentReferenceChange}
                          placeholder="e.g. SBIN123456789012"
                          spellCheck={false}
                          type="text"
                          value={manualPaymentReference}
                        />
                        {manualPaymentReferenceError ? (
                          <span className="field__error" role="alert">
                            {manualPaymentReferenceError}
                          </span>
                        ) : null}
                      </label>
                      {selectedQuotation.payment.branchPayments.map((branchPayment) => (
                        <div
                          className="finance-branch-payment-card"
                          key={branchPayment.billingBranchId}
                        >
                          <p>
                            <strong>{branchPayment.branchLabel || branchPayment.billingBranchId}</strong>
                          </p>
                          <p>{branchPaymentStatusLabel(branchPayment)}</p>
                          {branchPayment.status === "failed" && branchPayment.failureReason ? (
                            <p className="form-error">{branchPayment.failureReason}</p>
                          ) : null}
                          <p>{branchPayment.amountLabel || branchPayment.grandTotal}</p>
                          {branchPayment.paymentLinkUrl ? (
                            <>
                              <a href={branchPayment.paymentLinkUrl} rel="noreferrer" target="_blank">
                                {branchPayment.paymentLinkUrl}
                              </a>
                              <button
                                className="secondary-button"
                                onClick={() => handleCopyPaymentLink(branchPayment.paymentLinkUrl)}
                                type="button"
                              >
                                <Copy size={16} />
                                {copyLinkState?.url === branchPayment.paymentLinkUrl &&
                                copyLinkState.copied
                                  ? "Copied"
                                  : "Copy link"}
                              </button>
                            </>
                          ) : null}
                          {isBranchPaymentReported(branchPayment) ? (
                            isGatewayPaymentProvider(branchPayment) ||
                            isGatewayPaymentProvider(selectedQuotation.payment) ? (
                              <>
                                <p className="finance-review-actions__hint">
                                  Gateway payment — auto-confirms when the Stripe/Razorpay webhook
                                  reports paid. If stuck, use Complete confirmation above.
                                </p>
                                <button
                                  className="secondary-button"
                                  disabled={actionLoading}
                                  onClick={() => void handleSyncGatewayPayment()}
                                  type="button"
                                >
                                  <RefreshCw size={16} />
                                  Complete confirmation
                                </button>
                              </>
                            ) : (
                              <button
                                className="finance-review-actions__approve"
                                disabled={actionLoading}
                                onClick={() => void handleConfirmPayment(branchPayment.billingBranchId)}
                                type="button"
                              >
                                <CheckCircle2 size={16} />
                                Confirm branch payment
                              </button>
                            )
                          ) : null}
                          {selectedQuotation.status === "Approved" &&
                          !isBranchPaymentPaid(branchPayment) &&
                          !isBranchPaymentReported(branchPayment) ? (
                            <button
                              className="secondary-button"
                              disabled={actionLoading || !manualPaymentReference.trim()}
                              onClick={() => void handleMarkPaid(branchPayment.billingBranchId)}
                              type="button"
                            >
                              Mark branch paid
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
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
                      {selectedQuotation.payment.provider === "razorpay" ||
                      selectedQuotation.payment.provider === "stripe" ? (
                        <p className="finance-review-actions__hint">
                          Waiting for{" "}
                          {selectedQuotation.payment.provider === "stripe" ? "Stripe" : "Razorpay"}{" "}
                          webhook. Status updates automatically when payment succeeds — no manual
                          sync needed. This page refreshes when the paid event arrives.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedQuotation.status === "Approved" &&
                  !isTemporaryFinanceQuotation(selectedQuotation) &&
                  !isPaymentPaid(selectedQuotation.payment) &&
                  !isPaymentReported(selectedQuotation.payment) &&
                  !isMultiBranchPayment(selectedQuotation.payment) &&
                  (selectedQuotation.payment || selectedPaymentPolicy.mode === "offline") ? (
                    <div className="finance-review-actions finance-manual-payment">
                      <h3>
                        {selectedPaymentPolicy.mode === "offline"
                          ? "Bank transfer payment"
                          : "Mark as paid"}
                      </h3>
                      <p className="finance-review-actions__hint">
                        {selectedPaymentPolicy.mode === "offline"
                          ? "Enter the UTR / bank reference. Report payment if you need a separate confirmation step, or Mark as paid to activate products immediately."
                          : "Enter the bank/cash reference and mark paid in one step. This activates products and sends portal credentials immediately — no second confirmation. (Stripe/Razorpay payments auto-confirm from the gateway and skip this path.)"}
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
                      <label
                        className={`field field--full${manualPaymentReferenceError ? " is-invalid" : ""}`}
                      >
                        <span>Reference</span>
                        <input
                          aria-invalid={Boolean(manualPaymentReferenceError)}
                          autoCapitalize="characters"
                          autoComplete="off"
                          maxLength={UTR_MAX_LENGTH}
                          onBlur={handleManualPaymentReferenceBlur}
                          onChange={handleManualPaymentReferenceChange}
                          placeholder="e.g. SBIN123456789012"
                          spellCheck={false}
                          type="text"
                          value={manualPaymentReference}
                        />
                        {manualPaymentReferenceError ? (
                          <span className="field__error" role="alert">
                            {manualPaymentReferenceError}
                          </span>
                        ) : null}
                      </label>
                      <div className="finance-review-actions__buttons">
                        <button
                          className="secondary-button"
                          disabled={actionLoading || !manualPaymentReference.trim()}
                          onClick={() => void handleReportPayment()}
                          type="button"
                        >
                          Report payment
                        </button>
                        <button
                          className="finance-review-actions__approve"
                          disabled={actionLoading || !manualPaymentReference.trim()}
                          onClick={() => void handleMarkPaid()}
                          type="button"
                        >
                          <CheckCircle2 size={18} />
                          Mark as paid
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="admin-side-overlay__footer">
              <button
                className="secondary-button"
                disabled={actionLoading}
                onClick={closeReview}
                type="button"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}

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

      {productSpecView?.quotation ? (
        <FinanceProductSpecModal
          onClose={() => setProductSpecView(null)}
          productIndex={productSpecView.productIndex}
          quotation={productSpecView.quotation}
        />
      ) : null}

      {showWelcomeEmailConfirm && selectedQuotation ? (
        <ConfirmActionModal
          busy={actionLoading}
          busyLabel="Sending..."
          confirmLabel="Send email"
          copy="Resending generates a new temporary portal password. Any previous password will stop working immediately."
          eyebrow="Customer portal"
          onCancel={() => setShowWelcomeEmailConfirm(false)}
          onConfirm={() => void handleResendWelcomeEmail()}
          title="Resend welcome email?"
        />
      ) : null}

      {showApproveConfirm && selectedQuotation ? (
        <ApproveQuotationModal
          companyName={selectedQuotation.lead?.companyName || "Unknown company"}
          isResellerLead={Boolean(selectedQuotation.lead?.reseller)}
          isTemporaryLead={isTemporaryFinanceQuotation(selectedQuotation)}
          loading={actionLoading}
          note={note}
          paymentPolicy={selectedPaymentPolicy}
          paymentProvider={paymentProvider}
          paymentRecipientCc={selectedResellerBilling?.recipients.cc || []}
          paymentRecipientEmail={selectedResellerBilling?.recipients.to[0] || ""}
          onPaymentProviderChange={setPaymentProvider}
          stripeConfigured={stripeConfigured}
          razorpayConfigured={razorpayConfigured}
          onCancel={() => setShowApproveConfirm(false)}
          onConfirm={() => void handleApprove()}
        />
      ) : null}
    </section>
  );
}
