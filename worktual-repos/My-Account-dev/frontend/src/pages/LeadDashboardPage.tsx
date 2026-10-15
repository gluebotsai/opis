// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Eye,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  Package,
  Phone,
  ShoppingCart,
  Trash2,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import {
  buildLeadDashboardModel,
  formatCurrency,
  formatDashboardDate,
} from "../lib/leadDashboard.js";
import { deleteLeadCustomer, getLeadById } from "../lib/leads.js";
import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { ConfirmActionModal } from "../components/ConfirmActionModal.tsx";
import { DeleteCustomerModal } from "../components/DeleteCustomerModal.tsx";
import { ProductRequestDetailsModal } from "../components/customer/ProductRequestDetailsModal.tsx";
import "../styles/lead-dashboard.css";
import { getSubscriptionUsage } from "../lib/organizations.js";
import {
  listLeadProductRequests,
  productRequestStatusLabel,
  productRequestTypeLabel,
  productRequestListTitle,
  productRequestDisplayStatus,
  productRequestDisplayStatusTone,
  productRequestStatusHelperText,
  isOpenSalesProductRequest,
  canOpenProductRequestInWorkflow,
} from "../lib/customerProductRequests.js";
import { fetchLeadPaidPayments, fetchLeadPayment, fetchLeadQuotationInvoice, buildPaymentProductRows, isMultiBranchPayment, isPaymentPaid, isPaymentReported, isWelcomeEmailDelivered, paymentStatusLabel, welcomeEmailStatusLabel, branchPaymentStatusLabel } from "../lib/payments.js";
import { subscribeToAppEventsWithReconnect } from "../lib/eventStream.js";
import { paymentReportedSla } from "../lib/paymentSla.js";
import { resendCustomerWelcomeEmail } from "../lib/customerAuth.js";
import {
  listCustomerPortalUsers,
  provisionBranchPortalAccess,
} from "../lib/customerPortalAccess.js";
import { buildSalesWorkspaceProductOverviewPath } from "../lib/activeProducts.js";
import { isTemporaryLead } from "../lib/workspaceViews.js";
import {
  productPaymentBadge,
  shouldShowRenewalTimeline,
  subscriptionStatusTone,
  summarizeSubscriptionStatus,
} from "../lib/subscriptionStatus.js";
import {
  buildProductInvoicePreviewEntries,
  buildQuotationPreviewEntries,
} from "../lib/quoteAttachments.js";
import { InvoiceReviewModal } from "../components/InvoiceReviewModal.tsx";
import {
  billingChangeTypeLabel,
  fetchLeadOpenQuotations,
  openQuotationStatusTone,
  submitSubscriptionBillingChange,
} from "../lib/billingChanges.js";
import {
  branchAddStatusLabel,
  listLeadBranchAddRequests,
} from "../lib/branchAddRequests.js";
import { revertQuotationApproval } from "../lib/quotations.js";

const ACCOUNT_STATS = [
  {
    key: "activeProducts",
    label: "Active products",
    hint: (summary) =>
      summary.activeProductCount === 0
        ? summary.status === "Paid"
          ? "Payment recorded — products syncing"
          : "No live products yet"
        : "Product-paid live subscriptions",
    icon: Package,
    tone: "subscriptions",
    getValue: (summary) => summary.activeProductCount,
  },
  {
    key: "uatImplementation",
    label: "UAT / implementation",
    hint: (summary) =>
      summary.uatOrImplementationCount === 0
        ? "None in progress"
        : "In UAT or implementation",
    icon: ClipboardCheck,
    tone: "uat",
    getValue: (summary) => summary.uatOrImplementationCount ?? 0,
  },
  /* Hidden for now — single-location UI.
  {
    key: "locations",
    label: "Locations",
    hint: "Active locations",
    icon: MapPin,
    tone: "customers",
    getValue: (summary) => summary.branchCount,
  },
  */
  {
    key: "mrr",
    label: "Est. monthly recurring",
    hint: "Estimated MRR",
    icon: TrendingUp,
    tone: "mrr",
    getValue: (summary, format) => format(summary.monthlyRecurring, summary.currency),
  },
  {
    key: "customerSince",
    label: "Customer since",
    hint: "Onboarded date",
    icon: CalendarDays,
    tone: "renewals",
    getValue: (summary) => summary.customerSince,
  },
];

import { UsageBar } from "../components/UsageBar.tsx";

function PanelHeading({ icon: Icon, title, description }) {
  return (
    <div className="lead-dashboard-panel__heading">
      <div className="lead-dashboard-panel__heading-icon">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  );
}

function PaymentProductStatusList({ payment, productSummary, onViewProductInvoice }) {
  const rows = buildPaymentProductRows(payment, productSummary);
  if (!rows.length) {
    return null;
  }

  return (
    <ul className="lead-dashboard-payment-products">
      {rows.map((row, index) => (
        <li className="lead-dashboard-payment-products__item" key={`${row.name}-${row.branch}-${index}`}>
          <div className="lead-dashboard-payment-products__copy">
            <strong>{row.name}</strong>
            {row.branch ? <span> · {row.branch}</span> : null}
          </div>
          <div className="lead-dashboard-payment-products__aside">
            <span
              className={`lead-dashboard-badge ${
                row.statusLabel === "Paid"
                  ? "lead-dashboard-badge--qualified"
                  : "lead-dashboard-badge--neutral"
              }`}
            >
              {row.statusLabel}
            </span>
            {payment.hasInvoice && onViewProductInvoice ? (
              <button
                className="lead-dashboard-link-button"
                onClick={() => onViewProductInvoice(payment, row)}
                type="button"
              >
                View invoice
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PaidPaymentRow({ payment, onOpenInvoice, onViewProductInvoice }) {
  const isFailed = payment.status === "failed";
  const activityAt = isFailed
    ? payment.updatedAt || payment.paidAt
    : payment.paidAt || payment.updatedAt;
  const activityLabel = activityAt ? new Date(activityAt).toLocaleString() : "—";
  const canViewByProduct = Boolean(
    payment.canViewByProduct || (payment.productSummary?.length || 0) > 1,
  );
  const canViewByLocation = Boolean(
    payment.canViewByLocation ||
      payment.invoiceMode === "per_branch" ||
      (payment.branchPayments?.length || 0) > 1 ||
      (payment.quotationIds?.length || 0) > 1,
  );
  const productRows = buildPaymentProductRows(payment, payment.productSummary);
  const hasInlineInvoiceLink = Boolean(
    payment.hasInvoice && onViewProductInvoice && productRows.length > 0,
  );
  const showViewByProduct = Boolean(payment.hasInvoice && canViewByProduct);
  const showViewByLocation = Boolean(payment.hasInvoice && canViewByLocation);
  // Prefer the in-row product "View invoice" link; keep a card-level fallback only
  // when there is no product line to host that link.
  const showCombinedViewInvoice = Boolean(
    payment.hasInvoice &&
      !canViewByProduct &&
      !canViewByLocation &&
      !hasInlineInvoiceLink,
  );
  const showActions = showViewByProduct || showViewByLocation || showCombinedViewInvoice;

  return (
    <div className="lead-dashboard-payment-row">
      <div className="lead-dashboard-payment-row__main">
        <div className="lead-dashboard-payment-row__amount">
          <strong>{payment.amountLabel || "—"}</strong>
          <span
            className={`lead-dashboard-badge ${
              isFailed ? "lead-dashboard-badge--inactive" : "lead-dashboard-badge--qualified"
            }`}
          >
            {isFailed ? "Failed" : "Paid"}
          </span>
        </div>
        <small>
          {isFailed ? `Failed on ${activityLabel}` : `Paid on ${activityLabel}`}
          {payment.provider ? ` · Provider: ${payment.provider}` : ""}
        </small>
        {isFailed && payment.failureReason ? (
          <p className="form-error">{payment.failureReason}</p>
        ) : null}
        <PaymentProductStatusList
          onViewProductInvoice={onViewProductInvoice}
          payment={payment}
          productSummary={payment.productSummary}
        />
        <small className="lead-dashboard-payment-row__invoice">
          Invoice: {payment.invoiceNumber}
          {canViewByProduct ? " · Separate invoice per product available" : ""}
          {canViewByLocation ? " · Separate PDFs per location available" : ""}
        </small>
      </div>
      {showActions ? (
        <div className="lead-dashboard-payment-row__actions">
          {showViewByProduct ? (
            <button
              className="secondary-button"
              onClick={() => onOpenInvoice(payment, "per_product")}
              type="button"
            >
              View by product
            </button>
          ) : null}
          {showViewByLocation ? (
            <button
              className="secondary-button"
              onClick={() => onOpenInvoice(payment, "per_location")}
              type="button"
            >
              View by location
            </button>
          ) : null}
          {showCombinedViewInvoice ? (
            <button
              className="secondary-button"
              onClick={() => onOpenInvoice(payment, "combined")}
              type="button"
            >
              View invoice
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LeadDashboardPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [financeFlash, setFinanceFlash] = useState(
    () => location.state?.message || "",
  );
  const [lead, setLead] = useState(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [statusSyncError, setStatusSyncError] = useState("");
  const [portalAccessError, setPortalAccessError] = useState("");
  const [welcomeEmailLoading, setWelcomeEmailLoading] = useState(false);
  const [welcomeEmailConfirmOpen, setWelcomeEmailConfirmOpen] = useState(false);
  const [welcomeEmailMessage, setWelcomeEmailMessage] = useState("");
  const [portalDirectory, setPortalDirectory] = useState(null);
  const [branchAccessById, setBranchAccessById] = useState({});
  const [branchAccessLoadingId, setBranchAccessLoadingId] = useState("");
  const [paymentRecord, setPaymentRecord] = useState(null);
  const [paymentError, setPaymentError] = useState("");
  const [paidPayments, setPaidPayments] = useState([]);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [revertApprovalOpen, setRevertApprovalOpen] = useState(false);
  const [revertApprovalBusy, setRevertApprovalBusy] = useState(false);
  const [revertApprovalError, setRevertApprovalError] = useState("");
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [usageBySubscriptionId, setUsageBySubscriptionId] = useState({});
  const [productRequests, setProductRequests] = useState([]);
  const [productRequestsLoading, setProductRequestsLoading] = useState(false);
  const [selectedProductRequest, setSelectedProductRequest] = useState(null);
  const [branchAddRequests, setBranchAddRequests] = useState([]);
  const [branchAddRequestsLoading, setBranchAddRequestsLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [openQuotations, setOpenQuotations] = useState([]);
  const [openQuotationsLoading, setOpenQuotationsLoading] = useState(false);
  const [openQuotationsError, setOpenQuotationsError] = useState("");
  const [billingModal, setBillingModal] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [billingPrice, setBillingPrice] = useState("");
  const [billingNote, setBillingNote] = useState("");
  const [billingFlash, setBillingFlash] = useState("");
  const [leadLoadTransient, setLeadLoadTransient] = useState(false);
  const leadRefreshSeqRef = useRef(0);
  const openQuotationsRefreshSeqRef = useRef(0);

  const refreshLead = useCallback(async () => {
    const seq = ++leadRefreshSeqRef.current;
    try {
      const nextLead = await getLeadById(leadId);
      if (seq !== leadRefreshSeqRef.current) {
        return;
      }
      setLead(nextLead);
      setStatusSyncError("");
      setLeadLoadTransient(false);
    } catch (error) {
      if (seq !== leadRefreshSeqRef.current) {
        return;
      }
      const status = Number(error?.status) || 0;
      const transient = status === 502 || status === 503 || status === 504;
      setLeadLoadTransient(transient);
      setStatusSyncError(
        error instanceof Error
          ? error.message
          : transient
            ? "Service temporarily unavailable. Refresh to retry — this lead was not deleted."
            : "Could not load lead.",
      );
      if (!transient) {
        setLead(null);
      }
    } finally {
      if (seq === leadRefreshSeqRef.current) {
        setLeadLoading(false);
      }
    }
  }, [leadId]);

  const refreshProductRequests = useCallback(async ({ silent = false } = {}) => {
    if (!leadId) {
      setProductRequests([]);
      return;
    }
    if (!silent) {
      setProductRequestsLoading(true);
    }
    try {
      const rows = await listLeadProductRequests(leadId);
      setProductRequests(rows);
    } catch {
      setProductRequests([]);
    } finally {
      if (!silent) {
        setProductRequestsLoading(false);
      }
    }
  }, [leadId]);

  const refreshBranchAddRequests = useCallback(async ({ silent = false } = {}) => {
    if (!leadId) {
      setBranchAddRequests([]);
      return;
    }
    if (!silent) {
      setBranchAddRequestsLoading(true);
    }
    try {
      const rows = await listLeadBranchAddRequests(leadId);
      setBranchAddRequests(rows);
    } catch {
      setBranchAddRequests([]);
    } finally {
      if (!silent) {
        setBranchAddRequestsLoading(false);
      }
    }
  }, [leadId]);

  const refreshOpenQuotations = useCallback(async ({ silent = false } = {}) => {
    if (!leadId) {
      setOpenQuotations([]);
      return;
    }
    const seq = ++openQuotationsRefreshSeqRef.current;
    if (!silent) {
      setOpenQuotationsLoading(true);
    }
    try {
      const data = await fetchLeadOpenQuotations(leadId);
      if (seq !== openQuotationsRefreshSeqRef.current) {
        return;
      }
      setOpenQuotations(Array.isArray(data?.quotations) ? data.quotations : []);
      setOpenQuotationsError("");
    } catch (error) {
      if (seq !== openQuotationsRefreshSeqRef.current) {
        return;
      }
      // Keep last known rows — clearing to [] falsely implies "no quotations".
      setOpenQuotationsError(
        error instanceof Error ? error.message : "Could not load open quotations.",
      );
    } finally {
      if (!silent && seq === openQuotationsRefreshSeqRef.current) {
        setOpenQuotationsLoading(false);
      }
    }
  }, [leadId]);

  useEffect(() => {
    void refreshLead();
    void refreshOpenQuotations();
  }, [refreshLead, refreshOpenQuotations]);

  const returnTo =
    location.state?.returnTo ||
    (location.pathname.startsWith("/customers") ? "/customers" : "/products");

  useEffect(() => {
    if (!location.state?.message) {
      return undefined;
    }
    setFinanceFlash(location.state.message);
    navigate(location.pathname, {
      replace: true,
      state: location.state?.returnTo ? { returnTo: location.state.returnTo } : {},
    });
    return undefined;
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    let active = true;

    async function loadPayment() {
      if (
        lead?.status !== "Approved" &&
        lead?.status !== "Paid" &&
        lead?.status !== "Partially paid"
      ) {
        setPaymentRecord(null);
        return;
      }

      try {
        const data = await fetchLeadPayment(leadId);
        if (active) {
          setPaymentRecord(data);
          setPaymentError("");
        }
      } catch (error) {
        if (active) {
          setPaymentRecord(null);
          setPaymentError(
            error instanceof Error ? error.message : "Could not load payment link.",
          );
        }
      }
    }

    loadPayment();
    return () => {
      active = false;
    };
  }, [lead?.status, leadId]);

  const loadPaidPayments = useCallback(async () => {
    try {
      const data = await fetchLeadPaidPayments(leadId);
      setPaidPayments(Array.isArray(data?.payments) ? data.payments : []);
    } catch {
      setPaidPayments([]);
    }
  }, [leadId]);

  useEffect(() => {
    if (
      lead?.status !== "Approved" &&
      lead?.status !== "Paid" &&
      lead?.status !== "Partially paid"
    ) {
      setPaidPayments([]);
      return;
    }
    void loadPaidPayments();
  }, [lead?.status, loadPaidPayments]);

  async function openInvoice(payment, viewMode = "combined", productRow = null) {
    if (!payment?.quotationId) {
      return;
    }
    const preferPerLocation = viewMode === "per_location";
    const preferPerProduct = viewMode === "per_product" || viewMode === "product";
    setInvoiceModal({
      loading: true,
      error: "",
      fileName: payment.invoiceNumber || "",
      previewTabs: [],
      activeId: "",
      entries: [],
      viewMode,
    });
    try {
      const data = await fetchLeadQuotationInvoice(leadId, payment.quotationId, {
        view: preferPerProduct ? "by_product" : undefined,
      });
      const invoice = data?.invoice || {};
      const locationEntries = buildQuotationPreviewEntries(invoice);
      const productEntries = buildProductInvoicePreviewEntries(invoice);
      let entries = locationEntries;

      if (preferPerProduct) {
        entries = productEntries;
        if (productRow) {
          const match =
            productEntries.find(
              (entry) =>
                productRow.productId &&
                entry.productId === productRow.productId &&
                (!productRow.branch ||
                  !entry.branchLabel ||
                  entry.branchLabel === productRow.branch),
            ) ||
            productEntries.find(
              (entry) =>
                entry.label?.includes(productRow.name) ||
                entry.label === productRow.name,
            );
          if (match) {
            entries = [match];
          }
        }
      } else if (
        !preferPerLocation &&
        invoice.pdfBase64 &&
        invoice.invoiceMode !== "per_branch"
      ) {
        entries = [
          {
            id: invoice.fileName || "invoice-combined",
            fileName: invoice.fileName || "invoice.pdf",
            pdfDataUrl: `data:application/pdf;base64,${invoice.pdfBase64}`,
            label: locationEntries.length > 1 ? "Combined invoice" : "Invoice",
          },
        ];
      } else if (preferPerLocation) {
        entries = locationEntries;
      }

      if (!entries.length) {
        setInvoiceModal({
          loading: false,
          error: preferPerProduct
            ? "Could not build separate product invoices for this payment."
            : preferPerLocation
              ? "No per-location invoice PDFs are available for this payment."
              : "No invoice PDF is available for this payment.",
          fileName: payment.invoiceNumber || "",
          previewTabs: [],
          activeId: "",
          entries: [],
          viewMode,
        });
        return;
      }

      if (preferPerLocation && entries.length < 2) {
        setInvoiceModal({
          loading: false,
          error:
            "Only one location invoice is on file for this payment.",
          fileName: entries[0]?.fileName || payment.invoiceNumber || "",
          entries,
          activeId: entries[0]?.id || "",
          viewMode,
        });
        return;
      }

      setInvoiceModal({
        loading: false,
        error: "",
        fileName: entries[0].fileName,
        entries,
        activeId: entries[0].id,
        viewMode: preferPerProduct && productRow ? "product" : viewMode,
      });
    } catch (error) {
      setInvoiceModal({
        loading: false,
        error: error instanceof Error ? error.message : "Could not load invoice.",
        fileName: payment.invoiceNumber || "",
        previewTabs: [],
        activeId: "",
        entries: [],
        viewMode,
      });
    }
  }

  function openProductInvoice(payment, productRow) {
    void openInvoice(payment, "per_product", productRow);
  }

  function openQuotationInvoice(quotation) {
    if (!quotation?.id || !quotation.canViewInvoice) {
      return;
    }
    void openInvoice(
      {
        quotationId: quotation.id,
        invoiceNumber: quotation.fileName || "",
      },
      "combined",
    );
  }

  function openBillingModal(type, entry) {
    setBillingError("");
    setBillingNote("");
    setBillingPrice(
      type === "mrr_adjustment"
        ? String(Number(entry.monthlyPrice) || Number(entry.config?.monthlyBasePrice) || "")
        : "",
    );
    setBillingModal({ type, entry });
  }

  function closeBillingModal() {
    if (billingBusy) {
      return;
    }
    setBillingModal(null);
    setBillingError("");
    setBillingNote("");
    setBillingPrice("");
  }

  async function submitBillingModal(event) {
    event.preventDefault();
    if (!billingModal?.entry?.subscriptionId) {
      return;
    }
    setBillingBusy(true);
    setBillingError("");
    try {
      await submitSubscriptionBillingChange(leadId, billingModal.entry.subscriptionId, {
        type: billingModal.type,
        proposedMonthlyPrice:
          billingModal.type === "mrr_adjustment" ? Number(billingPrice) : undefined,
        note: billingNote,
      });
      setBillingFlash(
        billingModal.type === "mrr_adjustment"
          ? "Price change submitted to finance for approval."
          : "Cancel next invoice request submitted to finance for approval.",
      );
      setBillingModal(null);
      setBillingNote("");
      setBillingPrice("");
      await refreshOpenQuotations({ silent: true });
      await refreshLead();
    } catch (error) {
      setBillingError(
        error instanceof Error ? error.message : "Could not submit billing change.",
      );
    } finally {
      setBillingBusy(false);
    }
  }

  const openBillingBySubscriptionId = useMemo(() => {
    const map = new Map();
    for (const quotation of openQuotations) {
      if (!quotation.isBillingChange) {
        continue;
      }
      const subscriptionId = quotation.billingChange?.subscriptionId;
      if (!subscriptionId) {
        continue;
      }
      if (!map.has(subscriptionId)) {
        map.set(subscriptionId, quotation);
      }
    }
    return map;
  }, [openQuotations]);

  useEffect(() => {
    let reloadTimer = null;
    const unsubscribe = subscribeToAppEventsWithReconnect({
      channels: ["payments", "quotations", "cancellations", "requests"],
      onEvent: (payload) => {
        const matchesLead =
          !payload.leadId || String(payload.leadId) === String(leadId);
        if (!matchesLead) {
          return;
        }
        const eventName = String(payload.event || "");
        if (
          eventName === "payment.reported" ||
          eventName === "payment.paid" ||
          eventName === "payment.failed" ||
          eventName === "payment.welcome_email_updated" ||
          eventName === "quotation.approved" ||
          eventName === "quotation.rejected" ||
          eventName === "quotation.paid" ||
          eventName === "quotation.submitted" ||
          eventName.startsWith("cancellation.") ||
          eventName.startsWith("product_request.") ||
          eventName.startsWith("branch_add.")
        ) {
          if (reloadTimer) {
            window.clearTimeout(reloadTimer);
          }
          reloadTimer = window.setTimeout(() => {
            // Prefer open quotations first so Approved shows even if lead GET 502s.
            void refreshOpenQuotations({ silent: true }).then(() => {
              void refreshLead();
              void refreshProductRequests({ silent: true });
              void refreshBranchAddRequests({ silent: true });
              void fetchLeadPayment(leadId)
                .then((data) => {
                  setPaymentRecord(data);
                  setPaymentError("");
                })
                .catch(() => {});
              void loadPaidPayments();
              if (eventName.startsWith("cancellation.")) {
                void listCustomerPortalUsers(leadId)
                  .then((directory) => setPortalDirectory(directory))
                  .catch(() => {});
              }
            });
          }, 400);
        }
      },
    });

    return () => {
      unsubscribe();
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
    };
  }, [
    leadId,
    refreshLead,
    refreshProductRequests,
    refreshBranchAddRequests,
    refreshOpenQuotations,
    loadPaidPayments,
  ]);

  async function handleResendWelcomeEmail() {
    setPortalAccessError("");
    setWelcomeEmailMessage("");
    setWelcomeEmailLoading(true);
    try {
      const result = await resendCustomerWelcomeEmail(leadId);
      setWelcomeEmailMessage(
        result.notificationQueued
          ? "Welcome email is being sent to the customer."
          : result.notified
            ? "Welcome email resent to the customer with updated portal credentials."
            : "Could not deliver welcome email. Check mail configuration and try again.",
      );
      const directory = await listCustomerPortalUsers(leadId);
      setPortalDirectory(directory);
      setWelcomeEmailConfirmOpen(false);
    } catch (error) {
      setPortalAccessError(
        error instanceof Error ? error.message : "Could not resend welcome email.",
      );
      setWelcomeEmailConfirmOpen(false);
    } finally {
      setWelcomeEmailLoading(false);
    }
  }

  async function handleRevertApproval() {
    const quotationId = paymentRecord?.quotationId || paymentRecord?.quotation?.id;
    if (!quotationId || revertApprovalBusy) {
      return;
    }
    setRevertApprovalBusy(true);
    setRevertApprovalError("");
    try {
      await revertQuotationApproval(quotationId);
      setRevertApprovalOpen(false);
      setFinanceFlash(
        "Invoice approval reverted. Payment link cancelled — create and submit a new invoice to finance.",
      );
      setPaymentRecord(null);
      await refreshLead();
      await refreshOpenQuotations({ silent: true });
    } catch (error) {
      setRevertApprovalError(
        error instanceof Error ? error.message : "Could not revert invoice approval.",
      );
      setRevertApprovalOpen(false);
    } finally {
      setRevertApprovalBusy(false);
    }
  }

  async function handleProvisionBranchAccess(branchId) {
    setPortalAccessError("");
    setBranchAccessLoadingId(branchId);
    try {
      const access = await provisionBranchPortalAccess(leadId, branchId);
      setBranchAccessById((current) => ({ ...current, [branchId]: access }));
      const directory = await listCustomerPortalUsers(leadId);
      setPortalDirectory(directory);
    } catch (error) {
      setPortalAccessError(
        error instanceof Error ? error.message : "Could not provision branch portal access.",
      );
    } finally {
      setBranchAccessLoadingId("");
    }
  }

  useEffect(() => {
    if (lead?.status !== "Paid") {
      setPortalDirectory(null);
      return undefined;
    }

    let active = true;

    async function loadPortalDirectory() {
      try {
        const directory = await listCustomerPortalUsers(leadId);
        if (active) {
          setPortalDirectory(directory);
        }
      } catch {
        if (active) {
          setPortalDirectory(null);
        }
      }
    }

    loadPortalDirectory();
    return () => {
      active = false;
    };
  }, [lead?.status, leadId]);

  useEffect(() => {
    let active = true;
    const subscriptions = lead?.subscriptions || [];

    if (!subscriptions.length) {
      setUsageBySubscriptionId({});
      return undefined;
    }

    async function loadUsage() {
      const entries = await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            const usage = await getSubscriptionUsage(subscription.id);
            return [subscription.id, usage];
          } catch {
            return [subscription.id, []];
          }
        }),
      );

      if (active) {
        setUsageBySubscriptionId(Object.fromEntries(entries));
      }
    }

    loadUsage();
    return () => {
      active = false;
    };
  }, [lead?.subscriptions]);

  useEffect(() => {
    void refreshProductRequests();
  }, [refreshProductRequests]);

  useEffect(() => {
    void refreshBranchAddRequests();
  }, [refreshBranchAddRequests]);

  const openProductRequests = useMemo(
    () => productRequests.filter((entry) => isOpenSalesProductRequest(entry)),
    [productRequests],
  );

  const openBranchAddRequests = useMemo(
    () => branchAddRequests.filter((entry) => entry.status === "submitted"),
    [branchAddRequests],
  );

  const dashboard = useMemo(
    () => buildLeadDashboardModel(lead, usageBySubscriptionId),
    [lead, usageBySubscriptionId],
  );

  useEffect(() => {
    const firstId = dashboard?.locations?.[0]?.id || null;
    setSelectedLocationId((current) => {
      if (current && dashboard?.locations?.some((entry) => entry.id === current)) {
        return current;
      }
      return firstId;
    });
  }, [dashboard?.locations, lead?.id]);

  const selectedLocation = useMemo(() => {
    const locations = dashboard?.locations || [];
    if (!locations.length) {
      return null;
    }
    return locations.find((entry) => entry.id === selectedLocationId) || locations[0];
  }, [dashboard?.locations, selectedLocationId]);

  if (leadLoading) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        <span className="route-loading__spinner" aria-hidden="true" />
        Loading customer…
      </div>
    );
  }

  if (!lead) {
    return (
      <section className="lead-dashboard-page">
        <header className="page-header">
          <div>
            <button
              className="lead-dashboard-page__back"
              onClick={() => navigate(returnTo)}
              type="button"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <h1>{leadLoadTransient ? "Service temporarily unavailable" : "Customer unavailable"}</h1>
            <p>
              {statusSyncError ||
                (leadLoadTransient
                  ? "The API timed out or restarted. This lead was not deleted — retry in a moment."
                  : "This customer could not be loaded.")}
            </p>
            {leadLoadTransient ? (
              <button
                className="primary-button"
                onClick={() => {
                  setLeadLoading(true);
                  void refreshLead();
                }}
                type="button"
              >
                Retry
              </button>
            ) : null}
          </div>
        </header>
      </section>
    );
  }

  if (!dashboard) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        <span className="route-loading__spinner" aria-hidden="true" />
        Loading customer…
      </div>
    );
  }

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <button
            className="lead-dashboard-page__back"
            onClick={() => navigate(returnTo)}
            type="button"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          {/* <p className="eyebrow">Account overview</p> */}
          <h1>{dashboard.contact.companyName}</h1>
          {lead?.partner?.companyName ? (
            <p className="page-header__copy">
              Partner referral: <strong>{lead.partner.companyName}</strong>
            </p>
          ) : null}
          {lead?.reseller?.companyName ? (
            <p className="page-header__copy">
              Reseller: <strong>{lead.reseller.companyName}</strong>
            </p>
          ) : null}
          {isTemporaryLead(lead) ? (
            <p className="page-header__copy">
              Temporary lead — <strong>Finance approval only</strong>. No payment link or customer
              go-live.
            </p>
          ) : (
            <p className="page-header__copy">
              Sales view of purchased products, subscription period, and usage before starting a
              new quote.
            </p>
          )}
        </div>
        <div className="page-header__actions">
          <button
            className="danger-button"
            onClick={() => {
              setDeleteError("");
              setDeleteOpen(true);
            }}
            type="button"
          >
            <Trash2 size={16} />
            Delete customer
          </button>
        </div>
      </header>

      {deleteOpen ? (
        <DeleteCustomerModal
          busy={deleteBusy}
          companyName={dashboard.contact.companyName || lead.companyName || ""}
          copy="This permanently deletes the company, portal logins, quotations, invoices, and related records. This cannot be undone."
          error={deleteError}
          onCancel={() => {
            if (deleteBusy) {
              return;
            }
            setDeleteOpen(false);
            setDeleteError("");
          }}
          onConfirm={async () => {
            setDeleteBusy(true);
            setDeleteError("");
            try {
              await deleteLeadCustomer(leadId);
              navigate(returnTo, {
                replace: true,
                state: { message: "Customer deleted." },
              });
            } catch (error) {
              setDeleteError(
                error instanceof Error ? error.message : "Could not delete customer.",
              );
              setDeleteBusy(false);
            }
          }}
          title="Delete customer"
        />
      ) : null}

      <AdminPageToast
        error={statusSyncError || openQuotationsError || portalAccessError || revertApprovalError}
        onDismiss={() => {
          setStatusSyncError("");
          setOpenQuotationsError("");
          setPortalAccessError("");
          setFinanceFlash("");
          setBillingFlash("");
          setWelcomeEmailMessage("");
          setRevertApprovalError("");
        }}
        success={
          statusSyncError || openQuotationsError || portalAccessError || revertApprovalError
            ? ""
            : financeFlash || billingFlash || welcomeEmailMessage
        }
      />

      {!isTemporaryLead(lead) ? (
        <div className="lead-dashboard-stats">
          {ACCOUNT_STATS.map((stat) => {
            const Icon = stat.icon;
            const hint = typeof stat.hint === "function" ? stat.hint(dashboard.summary) : stat.hint;
            const value =
              stat.key === "mrr"
                ? stat.getValue(dashboard.summary, formatCurrency)
                : stat.getValue(dashboard.summary);

            return (
              <article key={stat.key} className="sales-dashboard-stat-card onboarding-card">
                <div
                  className={`sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--${stat.tone}`}
                >
                  <Icon size={20} strokeWidth={2} />
                </div>
                <div className="sales-dashboard-stat-card__body">
                  <span className="sales-dashboard-stat-card__label">{stat.label}</span>
                  <strong className="sales-dashboard-stat-card__value" title={String(value)}>
                    {value}
                  </strong>
                  <span className="sales-dashboard-stat-card__hint">{hint}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <div className="lead-dashboard-grid">
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Customer details</h2>
          {selectedLocation?.label ? (
            <p className="lead-dashboard-panel__caption">{selectedLocation.label}</p>
          ) : null}
          <dl className="lead-dashboard-details">
            <div>
              <dt>
                <User size={14} /> Contact
              </dt>
              <dd>{selectedLocation?.contactName || "—"}</dd>
            </div>
            <div>
              <dt>Tenant ID</dt>
              <dd>{dashboard.contact.tenantId || "—"}</dd>
            </div>
            <div>
              <dt>
                <Mail size={14} /> Work email
              </dt>
              <dd>{selectedLocation?.workEmail || dashboard.contact.workEmail || "—"}</dd>
            </div>
            <div>
              <dt>Designation</dt>
              <dd>{selectedLocation?.designation || "—"}</dd>
            </div>
            <div>
              <dt>Industry</dt>
              <dd>{selectedLocation?.industryType || "—"}</dd>
            </div>
            <div>
              <dt>
                <Phone size={14} /> Mobile
              </dt>
              <dd>{selectedLocation?.mobile || "—"}</dd>
            </div>
            {selectedLocation?.secondaryMobile ? (
              <div>
                <dt>
                  <Phone size={14} /> Secondary mobile
                </dt>
                <dd>{selectedLocation.secondaryMobile}</dd>
              </div>
            ) : null}
            <div>
              <dt>Tax number</dt>
              <dd>{selectedLocation?.taxNumber || "—"}</dd>
            </div>
          </dl>
        </section>

        {/* Hidden for now — single-location UI.
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Locations</h2>
          <ul className="lead-dashboard-locations">
            {dashboard.locations.map((entry) => {
              const isSelected = selectedLocation?.id === entry.id;
              return (
                <li className={isSelected ? "is-active" : undefined} key={entry.id || `${entry.label}-${entry.address}`}>
                  <button
                    aria-pressed={isSelected}
                    className="lead-dashboard-location-select"
                    onClick={() => setSelectedLocationId(entry.id)}
                    type="button"
                  >
                    <MapPin size={16} />
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.address}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        */}

        {dashboard.finance.note ? (
          <section className="onboarding-card lead-dashboard-panel">
            <div className="lead-dashboard-finance-note">
              <strong>Latest finance note</strong>
              <p>{dashboard.finance.note}</p>
              {dashboard.finance.reviewedAt ? (
                <small>
                  {formatDashboardDate(dashboard.finance.reviewedAt)}
                  {dashboard.finance.reviewedBy ? ` · ${dashboard.finance.reviewedBy}` : ""}
                </small>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {(openQuotationsLoading ||
        openQuotations.length > 0 ||
        openQuotationsError) ? (
        <section className="onboarding-card lead-dashboard-panel">
          <PanelHeading
            icon={FileText}
            title="Quotations in progress"
          />

          {openQuotationsLoading && openQuotations.length === 0 ? (
            <p className="lead-dashboard-empty">Loading quotations…</p>
          ) : openQuotations.length === 0 && !openQuotationsError ? (
            <p className="lead-dashboard-empty">No open quotations for this customer.</p>
          ) : openQuotations.length > 0 ? (
            <div className="lead-dashboard-open-quotations">
              {openQuotations.map((quotation) => {
                const primaryProduct = quotation.productSummary?.[0];
                const productNames = (quotation.productSummary || [])
                  .map((item) => item.name)
                  .filter(Boolean)
                  .join(", ");
                return (
                  <article className="lead-dashboard-open-quote" key={quotation.id}>
                    <div className="lead-dashboard-open-quote__main">
                      <div>
                        <h3>
                          {productNames ||
                            quotation.billingPhaseLabel ||
                            quotation.fileName ||
                            "Quotation"}
                        </h3>
                        <p>
                          {primaryProduct?.branchLabel || quotation.branchLabel || "—"}
                          {quotation.billingPhaseLabel
                            ? ` · ${quotation.billingPhaseLabel}`
                            : ""}
                        </p>
                        <small>
                          Submitted {formatDashboardDate(quotation.submittedAt)}
                          {quotation.submittedBy ? ` · ${quotation.submittedBy}` : ""}
                        </small>
                      </div>
                      <div className="lead-dashboard-open-quote__aside">
                        <span
                          className={`lead-dashboard-badge lead-dashboard-badge--${openQuotationStatusTone(quotation.status)}`}
                        >
                          {quotation.statusLabel}
                        </span>
                        {quotation.grandTotal !== null && quotation.grandTotal !== undefined ? (
                          <span className="lead-dashboard-badge lead-dashboard-badge--price">
                            {formatCurrency(quotation.grandTotal, quotation.currency)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {quotation.status === "Rejected" && quotation.financeNote ? (
                      <p className="lead-dashboard-open-quote__note" role="status">
                        Finance note: {quotation.financeNote}
                      </p>
                    ) : null}

                    {quotation.billingChange?.proposedMonthlyPrice != null &&
                    quotation.billingPhase === "mrr_adjustment" ? (
                      <p className="lead-dashboard-open-quote__note">
                        Proposed MRR:{" "}
                        {formatCurrency(
                          quotation.billingChange.currentMrr,
                          quotation.currency,
                        )}{" "}
                        →{" "}
                        {formatCurrency(
                          quotation.billingChange.proposedMonthlyPrice,
                          quotation.currency,
                        )}
                        /mo
                      </p>
                    ) : null}

                    <div className="lead-dashboard-open-quote__actions">
                      {quotation.canViewInvoice ? (
                        <button
                          className="secondary-button"
                          onClick={() => openQuotationInvoice(quotation)}
                          type="button"
                        >
                          <Eye size={16} />
                          View invoice
                        </button>
                      ) : null}
                      {quotation.canRedoPricing ? (
                        <button
                          className="primary-button"
                          onClick={() =>
                            navigate(`/products/${leadId}/workflow`, {
                              state: {
                                freshQuote: true,
                                redoQuotationId: quotation.id,
                                seedFromRejectedQuotation: {
                                  id: quotation.id,
                                  sourceProductRequestId:
                                    quotation.sourceProductRequestId || null,
                                  assignments: Array.isArray(quotation.assignments)
                                    ? quotation.assignments
                                    : [],
                                  productIds: Array.isArray(quotation.productSummary)
                                    ? [
                                        ...new Set(
                                          quotation.productSummary
                                            .map((item) => item?.productId)
                                            .filter(Boolean),
                                        ),
                                      ]
                                    : [],
                                },
                                returnTo,
                              },
                            })
                          }
                          type="button"
                        >
                          Redo pricing
                        </button>
                      ) : null}
                      {quotation.canRedoBillingChange ? (
                        <button
                          className="primary-button"
                          onClick={() => {
                            const entry = dashboard.activeProducts.find(
                              (product) =>
                                product.subscriptionId ===
                                quotation.billingChange?.subscriptionId,
                            );
                            if (!entry) {
                              setBillingFlash(
                                "Open the purchased product to resubmit this billing change.",
                              );
                              return;
                            }
                            openBillingModal(quotation.billingPhase, entry);
                          }}
                          type="button"
                        >
                          Redo {billingChangeTypeLabel(quotation.billingPhase).toLowerCase() || "request"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {!isTemporaryLead(lead) ? (
      <section className="onboarding-card lead-dashboard-panel">
        <PanelHeading
          description="Current subscriptions, renewal dates, and usage from the sales perspective."
          icon={Package}
          title="Purchased products"
        />

        {dashboard.activeProducts.length === 0 ? (
          <div className="lead-dashboard-empty-state">
            <div className="lead-dashboard-empty-state__icon">
              <Package size={28} strokeWidth={1.5} />
            </div>
            <p>
              {lead?.status === "Paid"
                ? "Payment is recorded, but purchased products are still syncing. Refresh the page in a moment."
                : lead?.status === "Approved" || lead?.status === "Pending Finance Review"
                  ? "Products appear here after the customer pays. Track finance status under Customer product requests when applicable."
                  : "No purchased products yet. Products appear here after payment is confirmed."}
            </p>
          </div>
        ) : (
          <div className="lead-dashboard-products">
            {dashboard.activeProducts.map((entry) => {
              const productStatus = summarizeSubscriptionStatus(entry, lead?.status, {
                paymentStatus: paymentRecord?.payment?.status || "",
              });
              const openBillingChange = entry.subscriptionId
                ? openBillingBySubscriptionId.get(entry.subscriptionId)
                : null;
              const hasBlockingBillingChange =
                openBillingChange &&
                openBillingChange.status !== "Rejected";
              const canManageBilling =
                productStatus.state === "active" &&
                productStatus.isUsable &&
                Boolean(entry.subscriptionId) &&
                !hasBlockingBillingChange;
              const showRenewalTimeline = shouldShowRenewalTimeline(productStatus);
              const showRenewalQuoteButton = entry.subscription.daysRemaining <= 30;
              const showAddonButton =
                !showRenewalQuoteButton &&
                productStatus.state === "active" &&
                productStatus.isUsable;
              const hasPeriodActions =
                showRenewalQuoteButton || showAddonButton || canManageBilling;

              return (
              <article
                className="lead-dashboard-product lead-dashboard-product--clickable"
                key={entry.key}
                onClick={() => navigate(buildSalesWorkspaceProductOverviewPath(leadId, entry.key))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(buildSalesWorkspaceProductOverviewPath(leadId, entry.key));
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="lead-dashboard-product__header">
                  <div>
                    <h3>{entry.productName}</h3>
                    {entry.planLabel ? (
                      <p className="lead-dashboard-product__plan">Plan: {entry.planLabel}</p>
                    ) : null}
                    <p>
                      {entry.branchLabel}
                      {entry.billingLabel !== entry.branchLabel
                        ? ` · billed to ${entry.billingLabel}`
                        : ""}
                    </p>
                  </div>
                  <div className="lead-dashboard-product__badges">
                    <span
                      className={`lead-dashboard-badge lead-dashboard-badge--${subscriptionStatusTone(productStatus.state)}`}
                    >
                      {productStatus.label}
                    </span>
                    {(() => {
                      const paymentBadge = productPaymentBadge(entry);
                      return (
                        <span
                          className={`lead-dashboard-badge lead-dashboard-badge--${paymentBadge.tone}`}
                        >
                          {paymentBadge.label}
                        </span>
                      );
                    })()}
                    <span className="lead-dashboard-badge">{entry.changeTypeLabel}</span>
                    <span className="lead-dashboard-badge lead-dashboard-badge--price">
                      {entry.priceLabel ||
                        formatCurrency(entry.monthlyPrice, entry.config?.currency || "INR")}
                      /mo
                    </span>
                  </div>
                </div>

                {showRenewalTimeline || hasPeriodActions ? (
                  <div className="lead-dashboard-product__period">
                    {showRenewalTimeline ? (
                      <>
                        <CalendarDays size={16} />
                        <span>
                          Started {formatDashboardDate(entry.subscription.startedAt)} ·{" "}
                          {productStatus.state === "cancelling"
                            ? entry.cancelEffectiveAt
                              ? `Cancels on ${formatDashboardDate(entry.cancelEffectiveAt)}`
                              : "Cancels at period end"
                            : `Renews ${formatDashboardDate(entry.subscription.renewsAt)}`}{" "}
                          · {entry.subscription.daysRemaining} days left (
                          {entry.subscription.billingCycle})
                        </span>
                      </>
                    ) : null}
                    {hasPeriodActions ? (
                      <div className="lead-dashboard-product__actions">
                        {showRenewalQuoteButton ? (
                          <button
                            className="secondary-button lead-dashboard-product__renewal"
                            disabled={!(productStatus.state === "active" && productStatus.isUsable)}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/products/${leadId}/workflow`, {
                                state: {
                                  freshQuote: true,
                                  renewal: true,
                                  subscriptionId: entry.subscriptionId,
                                  productId: entry.productId,
                                  returnTo,
                                },
                              });
                            }}
                            title={
                              productStatus.state === "active" && productStatus.isUsable
                                ? undefined
                                : "Available after payment is confirmed and the product is active"
                            }
                            type="button"
                          >
                            Create renewal quote
                          </button>
                        ) : showAddonButton ? (
                          <button
                            className="secondary-button lead-dashboard-product__renewal"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/products/${leadId}/workflow`, {
                                state: {
                                  freshQuote: true,
                                  changeTypeIntent: "addon",
                                  subscriptionId: entry.subscriptionId,
                                  productId: entry.productId,
                                  returnTo,
                                },
                              });
                            }}
                            type="button"
                          >
                            Purchase add-ons
                          </button>
                        ) : null}
                        {canManageBilling ? (
                          <>
                            <button
                              className="secondary-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openBillingModal("mrr_adjustment", entry);
                              }}
                              type="button"
                            >
                              Modify price
                            </button>
                            <button
                              className="secondary-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openBillingModal("renewal_cancel", entry);
                              }}
                              type="button"
                            >
                              Cancel next invoice
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {openBillingChange ? (
                  <p className="lead-dashboard-product__cancel-note" role="status">
                    {openBillingChange.billingPhaseLabel || "Billing change"}:{" "}
                    {openBillingChange.statusLabel}
                    {openBillingChange.status === "Rejected" && openBillingChange.financeNote
                      ? ` — ${openBillingChange.financeNote}`
                      : ""}
                  </p>
                ) : null}
                {productStatus.state === "cancelling" && productStatus.description ? (
                  <p className="lead-dashboard-product__cancel-note" role="status">
                    {productStatus.description}
                  </p>
                ) : null}

                {showRenewalTimeline ? (
                  <div className="lead-dashboard-period-bar">
                    <div
                      className="lead-dashboard-period-bar__fill"
                      style={{ width: `${entry.subscription.periodProgress}%` }}
                    />
                  </div>
                ) : null}

                <div className="lead-dashboard-usage-list">
                  {entry.usage.map((metric) => (
                    <UsageBar key={`${entry.key}-${metric.label}`} metric={metric} />
                  ))}
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {(lead?.status === "Approved" ||
        lead?.status === "Paid" ||
        lead?.status === "Partially paid") &&
      isTemporaryLead(lead) ? (
        <section className="onboarding-card lead-dashboard-panel payment-forward-panel">
          <PanelHeading
            description="This temporary lead stops at finance approval. No payment link is issued and customer portal go-live is not started."
            icon={CreditCard}
            title="Finance approval only"
          />
          <p className="lead-dashboard-empty">
            {lead?.status === "Approved"
              ? "Finance approved this invoice for record. Payment follow-up and forward-payment actions are not available."
              : "Temporary lead — payment and portal fulfillment are out of scope for this record."}
          </p>
        </section>
      ) : (lead?.status === "Approved" ||
          lead?.status === "Paid" ||
          lead?.status === "Partially paid") ? (
        <section className="onboarding-card lead-dashboard-panel payment-forward-panel">
          <PanelHeading
            description={
              isPaymentPaid(paymentRecord?.payment)
                ? "Customer payment has been received and recorded."
                : "Finance approved this invoice. The customer was emailed from the sales mailbox with the payment link."
            }
            icon={CreditCard}
            title={isPaymentPaid(paymentRecord?.payment) ? "Payment received" : "Payment follow-up"}
          />

          {paymentRecord?.payment ? (
            <div className="lead-dashboard-payment-box">
              <div className="payment-forward-summary">
                <CreditCard size={18} />
                <div>
                  <strong>
                    {isMultiBranchPayment(paymentRecord.payment)
                      ? `Total ${paymentRecord.payment.amountLabel || "Payment due"}`
                      : paymentRecord.payment.amountLabel || "Payment due"}
                  </strong>
                  {paymentRecord.payment.status !== "failed" ? (
                    <p>{paymentStatusLabel(paymentRecord.payment)}</p>
                  ) : null}
                  {isPaymentReported(paymentRecord.payment) ? (
                    <p className={paymentReportedSla(paymentRecord.payment).overdue ? "form-error" : ""}>
                      {paymentReportedSla(paymentRecord.payment).label}. Waiting for finance to
                      confirm this bank/cash payment before portal access is sent. (Gateway
                      Stripe/Razorpay payments auto-confirm and should not stay here.)
                    </p>
                  ) : null}
                  {isMultiBranchPayment(paymentRecord.payment) ? (
                    <div className="lead-dashboard-branch-payments">
                      {paymentRecord.payment.branchPayments.map((branchPayment) => (
                        <div key={branchPayment.billingBranchId}>
                          <strong>{branchPayment.branchLabel || branchPayment.billingBranchId}</strong>
                          <p>{branchPayment.amountLabel || branchPayment.grandTotal}</p>
                          <p>{branchPaymentStatusLabel(branchPayment)}</p>
                          {branchPayment.paidAt ? (
                            <small>
                              Paid on {new Date(branchPayment.paidAt).toLocaleString()}
                            </small>
                          ) : branchPayment.paymentLinkUrl ? (
                            <a href={branchPayment.paymentLinkUrl} rel="noreferrer" target="_blank">
                              {branchPayment.paymentLinkUrl}
                            </a>
                          ) : (
                            <p>Payment link pending</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !isPaymentPaid(paymentRecord.payment) ? (
                    <a href={paymentRecord.payment.paymentLinkUrl} rel="noreferrer" target="_blank">
                      {paymentRecord.payment.paymentLinkUrl}
                    </a>
                  ) : paymentRecord.payment.paidAt ? (
                    <small>Paid on {new Date(paymentRecord.payment.paidAt).toLocaleString()}</small>
                  ) : null}
                  <PaymentProductStatusList
                    payment={paymentRecord.payment}
                    productSummary={
                      paymentRecord.payment.productSummary ||
                      paymentRecord.quotation?.productSummary ||
                      []
                    }
                  />
                  <small>
                    Provider: {paymentRecord.payment.provider || "stripe"}
                    {paymentRecord.payment.dryRun ? " · demo mode" : ""}
                  </small>
                </div>
                <div className="lead-dashboard-payment-row__actions">
                  {!isPaymentPaid(paymentRecord.payment) ? (
                    <>
                      <button
                        className="primary-button"
                        onClick={() => navigate(`/products/${leadId}/payment-forward`)}
                        type="button"
                      >
                        <Mail size={18} />
                        Forward again to customer
                      </button>
                      {lead?.status === "Approved" &&
                      !isPaymentReported(paymentRecord.payment) &&
                      !isTemporaryLead(lead) &&
                      (paymentRecord.payment.paymentLinkUrl ||
                        (paymentRecord.payment.branchPayments || []).some(
                          (entry) => entry?.paymentLinkUrl,
                        )) ? (
                        <button
                          className="secondary-button"
                          disabled={revertApprovalBusy}
                          onClick={() => {
                            setRevertApprovalError("");
                            setRevertApprovalOpen(true);
                          }}
                          type="button"
                        >
                          Revert approval
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button
                      className="secondary-button"
                      onClick={() => navigate(`/customers/${leadId}/implementation-uat`)}
                      type="button"
                    >
                      Implementation / UAT
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="lead-dashboard-empty">
              {paymentError ||
                "Payment link is not available yet. Ask finance to approve the latest invoice."}
            </p>
          )}

          {paidPayments.length ? (
            <div className="lead-dashboard-paid-history">
              <div className="lead-dashboard-paid-history__head">
                <h3>Payment history</h3>
                {paidPayments.length > 2 ? (
                  <button
                    className="lead-dashboard-link-button"
                    onClick={() => setShowAllPayments(true)}
                    type="button"
                  >
                    View all ({paidPayments.length})
                  </button>
                ) : null}
              </div>
              <div className="lead-dashboard-paid-history__list">
                {paidPayments.slice(0, 2).map((payment) => (
                  <PaidPaymentRow
                    key={payment.quotationId}
                    onOpenInvoice={openInvoice}
                    onViewProductInvoice={openProductInvoice}
                    payment={payment}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {lead?.status === "Paid" && !isTemporaryLead(lead) ? (
        <section className="onboarding-card lead-dashboard-panel customer-portal-panel">
          <PanelHeading
            description="Each location has its own portal login. Credentials are branch-scoped — there is no company-wide admin login."
            icon={KeyRound}
            title="Customer portal access"
          />
          <div className="customer-portal-access">
            <div className="customer-portal-access__section">
              <strong>Welcome email</strong>
              <p className="customer-portal-access__hint">
                Resends portal credentials for the paid billing location. Generates a new temporary
                password; the previous password stops working immediately.
              </p>
              {welcomeEmailStatusLabel(paymentRecord?.payment) ? (
                <p className="customer-portal-access__status">
                  {welcomeEmailStatusLabel(paymentRecord.payment)}
                </p>
              ) : null}
              {!isWelcomeEmailDelivered(paymentRecord?.payment) ? (
                <p className="customer-portal-access__hint">
                  Payment is confirmed. Send portal access if the customer did not receive
                  credentials.
                </p>
              ) : null}
              <div className="customer-portal-access__actions">
                <button
                  className="primary-button"
                  disabled={welcomeEmailLoading}
                  onClick={() => setWelcomeEmailConfirmOpen(true)}
                  type="button"
                >
                  {welcomeEmailLoading ? "Sending..." : "Send portal access email"}
                </button>
              </div>
            </div>

            {(portalDirectory?.locations || [])
              .filter((location) => (location.status || "active") !== "inactive")
              .map((location) => {
                const existingUser = (portalDirectory?.users || []).find(
                  (portalUser) => portalUser.branchId === location.id,
                );
                const issuedAccess = branchAccessById[location.id];
                const locationTitle = location.isPrimary
                  ? `${location.label || "Head office"} (HQ)`
                  : location.label || "Branch";

                return (
                  <div className="customer-portal-access__section" key={location.id}>
                    <strong>{locationTitle}</strong>
                    <p className="customer-portal-access__hint">
                      Portal login email: {location.workEmail || "Add work email in onboarding"}
                    </p>
                    {existingUser ? (
                      <div className="customer-portal-access__status-row">
                        <p className="customer-portal-access__status">
                          Portal enabled for {existingUser.email}
                        </p>
                      </div>
                    ) : null}
                    <button
                      className="secondary-button"
                      disabled={
                        !location.workEmail || branchAccessLoadingId === location.id
                      }
                      onClick={() => handleProvisionBranchAccess(location.id)}
                      type="button"
                    >
                      {branchAccessLoadingId === location.id
                        ? "Generating..."
                        : existingUser
                          ? "Reset branch credentials"
                          : "Enable branch portal access"}
                    </button>
                    {issuedAccess ? (
                      <div className="customer-portal-access__details">
                        <p>
                          <strong>Email:</strong> {issuedAccess.email}
                        </p>
                        <p>
                          <strong>Temporary password:</strong>{" "}
                          <code>{issuedAccess.temporaryPassword}</code>
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </section>
      ) : null}

      {(branchAddRequestsLoading || openBranchAddRequests.length > 0) ? (
        <section className="onboarding-card lead-dashboard-panel">
          <PanelHeading
            description="Head-office requests to add a new location. Follow up to collect details, create the branch, and quote products."
            icon={MapPin}
            title="Branch add requests"
          />

          {branchAddRequestsLoading ? (
            <p className="customer-support-loading" role="status">
              Loading branch add requests...
            </p>
          ) : null}

          {!branchAddRequestsLoading && openBranchAddRequests.length > 0 ? (
            <div className="customer-product-requests">
              {openBranchAddRequests.map((request) => (
                <article className="customer-product-request-card" key={request.id}>
                  <div className="customer-product-request-card__top">
                    <strong>{request.requestNumber}</strong>
                    <span className="lead-dashboard-badge lead-dashboard-badge--in-progress">
                      {branchAddStatusLabel(request.status)}
                    </span>
                  </div>
                  <p>
                    {request.payload?.label ||
                      "Customer requested a new branch (details TBD)"}
                  </p>
                  <small>
                    {[request.payload?.address, request.payload?.city, request.payload?.state]
                      .filter(Boolean)
                      .join(", ") || "Sales to collect location details"}
                    {request.contactEmail ? ` · ${request.contactEmail}` : ""}
                    {request.createdAt ? ` · ${formatDashboardDate(request.createdAt)}` : ""}
                  </small>
                  {request.payload?.note ? (
                    <small className="customer-product-request-card__helper">
                      Note: {request.payload.note}
                    </small>
                  ) : null}
                  <div className="customer-product-request-card__actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        navigate(`/products/${leadId}/workflow`, {
                          state: {
                            freshQuote: true,
                            returnTo,
                          },
                        })
                      }
                      type="button"
                    >
                      <ShoppingCart size={16} />
                      Open workflow
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {!isTemporaryLead(lead) ? (
      <section className="onboarding-card lead-dashboard-panel">
        <PanelHeading
          description="Customer portal inquiries, purchase, and upgrade requests — including finance review status through payment."
          icon={Package}
          title="Customer product requests"
        />

        {productRequestsLoading ? (
          <p className="customer-support-loading" role="status">
            Loading product requests...
          </p>
        ) : null}

        {!productRequestsLoading && openProductRequests.length === 0 ? (
          <p className="sales-oversight-empty">No open customer product requests.</p>
        ) : null}

        {!productRequestsLoading && openProductRequests.length > 0 ? (
          <div className="customer-product-requests">
            {openProductRequests.map((request) => {
              const displayStatus = productRequestDisplayStatus(request);
              const helperText = productRequestStatusHelperText(displayStatus);
              const canOpenWorkflow = canOpenProductRequestInWorkflow(request);

              function openRequestInWorkflow() {
                navigate(`/products/${leadId}/workflow`, {
                  state: {
                    freshQuote: true,
                    seedFromProductRequest: {
                      ...request,
                      assignments: request.assignments || [],
                    },
                    returnTo,
                  },
                });
              }

              return (
                <article className="customer-product-request-card" key={request.id}>
                  <div className="customer-product-request-card__top">
                    <strong>{request.requestNumber}</strong>
                    <span
                      className={`lead-dashboard-badge lead-dashboard-badge--${productRequestDisplayStatusTone(displayStatus)}`}
                    >
                      {productRequestStatusLabel(displayStatus)}
                    </span>
                  </div>
                  <p>{productRequestListTitle(request)}</p>
                  {String(request.customerNote || "").trim() ? (
                    <p className="customer-product-request-card__note">
                      Note: {String(request.customerNote).trim()}
                    </p>
                  ) : null}
                  <small>
                    {productRequestTypeLabel(request.requestType)}
                    {request.contactEmail ? ` · ${request.contactEmail}` : ""}
                    {request.createdAt
                      ? ` · ${formatDashboardDate(request.createdAt)}`
                      : ""}
                  </small>
                  {helperText ? (
                    <small className="customer-product-request-card__helper">{helperText}</small>
                  ) : null}
                  <div className="customer-product-request-card__actions">
                    <button
                      className="secondary-button"
                      onClick={() => setSelectedProductRequest(request)}
                      type="button"
                    >
                      <Eye size={16} />
                      View full details
                    </button>
                    <button
                      className="secondary-button customer-product-request-card__withdraw"
                      disabled={!canOpenWorkflow}
                      onClick={openRequestInWorkflow}
                      title={
                        canOpenWorkflow
                          ? undefined
                          : displayStatus === "awaiting_finance"
                            ? "Invoice is awaiting finance approval"
                            : "Awaiting customer payment"
                      }
                      type="button"
                    >
                      <ShoppingCart size={16} />
                      Open in workflow
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
      ) : null}

      {selectedProductRequest && !isTemporaryLead(lead) ? (
        <ProductRequestDetailsModal
          audience="sales"
          onClose={() => setSelectedProductRequest(null)}
          request={selectedProductRequest}
        />
      ) : null}

      <section className="lead-dashboard-cta onboarding-card">
        {isTemporaryLead(lead) ? (
          <>
            <PanelHeading
              description={`Create a finance-only invoice for ${dashboard.contact.companyName}. No payment link or customer go-live.`}
              icon={FileText}
              title="Generate invoice"
            />
            <div className="lead-dashboard-cta__actions">
              <button
                className="primary-button"
                onClick={() =>
                  navigate(`/products/${leadId}/workflow`, {
                    state: { freshQuote: true, changeTypeIntent: "new", returnTo },
                  })
                }
                type="button"
              >
                <FileText size={18} />
                Generate invoice
              </button>
            </div>
          </>
        ) : (
          <>
            <PanelHeading
              description={`Purchase a new base plan, or add capacity to an existing active product for ${dashboard.contact.companyName}.`}
              icon={ShoppingCart}
              title="Start a purchase"
            />
            <div className="lead-dashboard-cta__actions">
              <button
                className="primary-button"
                onClick={() =>
                  navigate(`/products/${leadId}/workflow`, {
                    state: { freshQuote: true, changeTypeIntent: "new", returnTo },
                  })
                }
                type="button"
              >
                <ShoppingCart size={18} />
                New product purchase
              </button>
              {dashboard.activeProducts.length > 0 ? (
                <button
                  className="secondary-button"
                  onClick={() =>
                    navigate(`/products/${leadId}/workflow`, {
                      state: { freshQuote: true, changeTypeIntent: "addon", returnTo },
                    })
                  }
                  type="button"
                >
                  Existing product (add-ons only)
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      {welcomeEmailConfirmOpen ? (
        <ConfirmActionModal
          busy={welcomeEmailLoading}
          busyLabel="Sending..."
          confirmLabel="Send email"
          copy="Sending portal access email generates a new temporary password. Any previous password will stop working immediately."
          eyebrow="Customer portal"
          onCancel={() => setWelcomeEmailConfirmOpen(false)}
          onConfirm={() => void handleResendWelcomeEmail()}
          title="Send portal access email?"
        />
      ) : null}

      {revertApprovalOpen ? (
        <ConfirmActionModal
          busy={revertApprovalBusy}
          busyLabel="Reverting…"
          cancelLabel="Keep approval"
          confirmLabel="Revert approval"
          copy="This cancels the Stripe/Razorpay payment link so the customer cannot pay. The invoice leaves finance approval and you must create and re-submit a new invoice."
          eyebrow="Invoice"
          onCancel={() => {
            if (revertApprovalBusy) {
              return;
            }
            setRevertApprovalOpen(false);
          }}
          onConfirm={() => void handleRevertApproval()}
          title="Revert finance approval?"
          tone="danger"
        />
      ) : null}

      {showAllPayments ? (
        <div
          aria-label="All paid payments"
          aria-modal="true"
          className="confirm-modal-overlay"
          role="dialog"
        >
          <div
            className="confirm-modal-overlay__backdrop"
            onClick={() => setShowAllPayments(false)}
          />
          <div className="confirm-modal product-request-details-modal">
            <header className="confirm-modal__header">
              <div className="confirm-modal__icon">
                <CreditCard size={22} />
              </div>
              <div>
                <p className="eyebrow">Payments</p>
                <h2>Payment history</h2>
                <p className="confirm-modal__copy">
                  {paidPayments.length}{" "}
                  {paidPayments.length === 1 ? "payment" : "payments"} for{" "}
                  {dashboard.contact.companyName}
                </p>
              </div>
              <button
                aria-label="Close"
                className="confirm-modal__close"
                onClick={() => setShowAllPayments(false)}
                type="button"
              >
                <ArrowLeft size={18} />
              </button>
            </header>

            <div className="product-request-details-modal__body">
              <div className="lead-dashboard-paid-history__list">
                {paidPayments.map((payment) => (
                  <PaidPaymentRow
                    key={payment.quotationId}
                    onOpenInvoice={openInvoice}
                    onViewProductInvoice={openProductInvoice}
                    payment={payment}
                  />
                ))}
              </div>
            </div>

            <footer className="confirm-modal__footer">
              <button
                className="secondary-button"
                onClick={() => setShowAllPayments(false)}
                type="button"
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {invoiceModal ? (
        <InvoiceReviewModal
          error={invoiceModal.error}
          eyebrow={
            invoiceModal.viewMode === "per_location"
              ? "Invoice by location"
              : invoiceModal.viewMode === "per_product" || invoiceModal.viewMode === "product"
                ? "Invoice by product"
                : "Invoice"
          }
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
          title={
            invoiceModal.viewMode === "per_location"
              ? "Separate invoice per location"
              : invoiceModal.viewMode === "per_product"
                ? "Separate invoice per product"
                : invoiceModal.viewMode === "product"
                  ? "Product invoice"
                  : "Invoice"
          }
        />
      ) : null}

      {billingModal ? (
        <div
          aria-label={
            billingModal.type === "mrr_adjustment" ? "Modify price" : "Cancel next invoice"
          }
          aria-modal="true"
          className="confirm-modal-overlay"
          role="dialog"
        >
          <div
            className="confirm-modal-overlay__backdrop"
            onClick={billingBusy ? undefined : closeBillingModal}
          />
          <form className="confirm-modal" onSubmit={submitBillingModal}>
            <header className="confirm-modal__header">
              <div>
                <h2>
                  {billingModal.type === "mrr_adjustment"
                    ? "Modify recurring price"
                    : "Cancel next invoice"}
                </h2>
                <p className="confirm-modal__copy">
                  {billingModal.type === "mrr_adjustment"
                    ? `Propose a new monthly price for ${billingModal.entry.productName}. Finance must approve before subscription MRR updates permanently.`
                    : `Request finance approval to cancel the upcoming renewal invoice for ${billingModal.entry.productName}. The product stays active through the current period.`}
                </p>
              </div>
              <button
                className="confirm-modal__close"
                disabled={billingBusy}
                onClick={closeBillingModal}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="confirm-modal__body">
              <p>
                Current price:{" "}
                <strong>
                  {formatCurrency(
                    billingModal.entry.monthlyPrice,
                    billingModal.entry.config?.currency || "INR",
                  )}
                  /mo
                </strong>
              </p>
              {billingModal.type === "mrr_adjustment" ? (
                <label className="field">
                  <span>New monthly price</span>
                  <input
                    autoFocus
                    disabled={billingBusy}
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setBillingPrice(event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={billingPrice}
                  />
                </label>
              ) : null}
              <label className="field">
                <span>Note for finance (optional)</span>
                <textarea
                  disabled={billingBusy}
                  onChange={(event) => setBillingNote(event.target.value)}
                  rows={3}
                  value={billingNote}
                />
              </label>
              {billingError ? (
                <p className="confirm-modal__error" role="alert">
                  {billingError}
                </p>
              ) : null}
            </div>

            <footer className="confirm-modal__footer">
              <button
                className="secondary-button"
                disabled={billingBusy}
                onClick={closeBillingModal}
                type="button"
              >
                Cancel
              </button>
              <button className="primary-button" disabled={billingBusy} type="submit">
                {billingBusy ? "Submitting…" : "Submit to finance"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
