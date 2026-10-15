import { getFinanceToken } from "./auth.js";
import { fetchJson } from "./http.js";

export async function fetchPaymentConfig() {
  return fetchJson("/api/payments/config");
}

export async function fetchLeadPayment(leadId) {
  return fetchJson(`/api/quotations/payment/${leadId}`);
}

export async function fetchLeadPaidPayments(leadId) {
  return fetchJson(`/api/leads/${leadId}/paid-payments`);
}

export async function fetchLeadQuotationInvoice(leadId, quotationId, { view } = {}) {
  const params = new URLSearchParams();
  if (view) {
    params.set("view", view);
  }
  const query = params.toString();
  return fetchJson(
    `/api/leads/${leadId}/quotations/${quotationId}/invoice${query ? `?${query}` : ""}`,
  );
}

import { resolveCustomerRecipients } from "./customerContact.js";

export function hasAllBranchPaymentLinks(payment) {
  if (payment?.branchPayments?.length > 1) {
    return payment.branchPayments.every((entry) => Boolean(entry.paymentLinkUrl));
  }

  return Boolean(payment?.paymentLinkUrl);
}

export function isMultiBranchPayment(payment) {
  return (payment?.branchPayments?.length || 0) > 1;
}

export function branchPaymentStatusLabel(branchPayment) {
  if (!branchPayment) {
    return "No payment";
  }

  switch (branchPayment.status) {
    case "paid":
      return "Paid";
    case "reported":
      return "Reported — awaiting confirmation";
    case "failed":
      return "Failed";
    default:
      return "Awaiting payment";
  }
}

export function buildPaymentForwardDraft({ lead, payment, quotation, quotationId, salesRepName = "Worktual Sales Team" }) {
  const contactName = lead?.contactName || "there";
  const companyName = lead?.companyName || "your organization";
  const tenantId = lead?.tenantId || "—";
  const amountLabel = payment?.amountLabel || formatPaymentAmount(payment?.grandTotal, payment?.currency);
  const { to, cc } = resolveCustomerRecipients(lead);
  const branchPayments = payment?.branchPayments || [];

  const paymentLines =
    branchPayments.length > 1
      ? [
          "Please complete payment for each branch using the links below:",
          "",
          ...branchPayments.flatMap((entry) => {
            const branchAmount =
              entry.amountLabel || formatPaymentAmount(entry.grandTotal, entry.currency || payment?.currency);
            const invoice = quotation?.invoices?.find(
              (invoiceEntry) => invoiceEntry.billingBranchId === entry.billingBranchId,
            );
            return [
              `Branch: ${entry.branchLabel || entry.billingBranchId}`,
              `Amount due: ${branchAmount}`,
              entry.paymentLinkUrl || "",
              invoice?.fileName ? `Invoice: ${invoice.fileName}` : "",
              "",
            ].filter(Boolean);
          }),
        ]
      : [
          `Amount due: ${amountLabel}`,
          "",
          "You can complete payment securely using the link below:",
          payment?.paymentLinkUrl || "",
        ];

  return {
    to: to[0] || "",
    cc: cc.join(", "),
    bcc: "",
    subject: `Complete your Worktual payment — ${companyName}`,
    body: [
      `Dear ${contactName},`,
      "",
      "Thank you for choosing Worktual. I'm pleased to confirm that our finance team has approved the invoice we prepared for you.",
      "",
      `Company: ${companyName}`,
      `Tenant ID: ${tenantId}`,
      "",
      ...paymentLines,
      "",
      branchPayments.length > 1
        ? "Please find each branch invoice attached for your records."
        : "Please find the approved invoice attached for your records.",
      "",
      "If you have any questions about billing, payment, or next steps, reply to this email and I'll be happy to help.",
      "",
      "Best regards,",
      salesRepName,
      "Worktual | Enterprise Software Provider",
    ].join("\n"),
    quotationId,
    paymentUrl: payment?.paymentLinkUrl || "",
    amountLabel,
  };
}

export function buildPaymentProductRows(payment, productSummary = payment?.productSummary || []) {
  const branchPayments = payment?.branchPayments || [];
  const overallPaid = isPaymentPaid(payment);

  return (productSummary || []).map((item, index) => {
    const name = item.name || item.productId || "Product";
    const branch = item.branchLabel || item.billingLabel || "";
    const branchPayment = branchPayments.find(
      (entry) => branch && String(entry.branchLabel || "").trim() === branch.trim(),
    );

    let statusLabel = "Awaiting payment";
    if (branchPayment) {
      statusLabel = branchPaymentStatusLabel(branchPayment);
    } else if (overallPaid) {
      statusLabel = "Paid";
    }

    return {
      productId: item.productId || "",
      name,
      branch,
      statusLabel,
      index,
    };
  });
}

export function isPaymentPaid(payment) {
  return payment?.status === "paid";
}

export function isBranchPaymentPaid(branchPayment) {
  return branchPayment?.status === "paid";
}

export function isBranchPaymentReported(branchPayment) {
  return branchPayment?.status === "reported";
}

export function isPaymentReported(payment) {
  if (isMultiBranchPayment(payment)) {
    return payment.branchPayments.some((entry) => entry.status === "reported");
  }

  return payment?.status === "reported";
}

export function paymentStatusLabel(payment) {
  if (!payment) {
    return "No payment";
  }

  if (isMultiBranchPayment(payment)) {
    const paidCount = payment.branchPayments.filter((entry) => entry.status === "paid").length;
    const total = payment.branchPayments.length;
    if (paidCount >= total) {
      return "Paid";
    }
    if (paidCount > 0 || payment.status === "partial") {
      return `${paidCount} of ${total} branches paid`;
    }
    const reportedCount = payment.branchPayments.filter((entry) => entry.status === "reported").length;
    if (reportedCount > 0) {
      return `${reportedCount} of ${total} branches reported — awaiting confirmation`;
    }
    const failedCount = payment.branchPayments.filter((entry) => entry.status === "failed").length;
    if (failedCount > 0 || payment.status === "failed") {
      return failedCount === total || payment.status === "failed"
        ? "Payment failed"
        : `${failedCount} of ${total} branches failed`;
    }
    return "Awaiting branch payments";
  }

  switch (payment.status) {
    case "paid":
      return "Paid";
    case "partial":
      return "Partially paid";
    case "reported":
      return "Payment reported — awaiting finance confirmation";
    case "failed":
      return "Payment failed";
    case "refunded":
      return "Refunded";
    default:
      return "Awaiting payment";
  }
}

export function welcomeEmailStatusLabel(payment) {
  if (!payment || payment.status !== "paid") {
    return null;
  }

  switch (payment.welcomeEmailStatus) {
    case "sent":
      return "Welcome email sent";
    case "sent_without_credentials":
      return "Welcome email sent without credentials";
    case "failed":
      return "Welcome email failed";
    case "pending":
      return "Welcome email pending";
    case "unknown":
      return "Welcome email delivery unknown";
    default:
      return null;
  }
}

export function financeAlertStatusLabel(payment) {
  if (!payment || payment.status !== "reported") {
    return null;
  }

  switch (payment.financeAlertStatus) {
    case "sent":
      return "Finance alert sent";
    case "failed":
      return "Finance alert failed";
    case "pending":
      return "Finance alert pending";
    default:
      return null;
  }
}

export function isFinanceAlertActionRequired(payment) {
  return (
    payment?.status === "reported" &&
    (payment?.financeAlertStatus === "failed" || payment?.financeAlertStatus === "pending")
  );
}

export function isWelcomeEmailDelivered(payment) {
  return payment?.welcomeEmailStatus === "sent";
}

export function isWelcomeEmailActionRequired(payment) {
  return (
    payment?.status === "paid" &&
    (payment?.welcomeEmailStatus === "failed" ||
      payment?.welcomeEmailStatus === "sent_without_credentials" ||
      payment?.welcomeEmailStatus === "pending" ||
      payment?.welcomeEmailStatus === "unknown")
  );
}

function financeAuthHeaders() {
  return {
    Authorization: `Bearer ${getFinanceToken()}`,
  };
}

function isSyntheticEvent(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    ("nativeEvent" in value ||
      typeof value.preventDefault === "function" ||
      typeof value.stopPropagation === "function")
  );
}

function normalizeBillingTargetId(value) {
  if (isSyntheticEvent(value)) {
    return null;
  }

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePaymentOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) || isSyntheticEvent(options)) {
    return {};
  }

  return options;
}

function buildReportPaymentPayload(options = {}) {
  const normalized = normalizePaymentOptions(options);
  const payload = {
    notify: normalized.notify !== false,
  };

  const paymentMethod = String(normalized.paymentMethod || "manual").trim();
  if (paymentMethod) {
    payload.paymentMethod = paymentMethod;
  }

  const providerPaymentId = String(
    normalized.providerPaymentId || normalized.reference || "",
  ).trim();
  if (providerPaymentId) {
    payload.providerPaymentId = providerPaymentId;
  }

  const billingBranchId = normalizeBillingTargetId(normalized.billingBranchId);
  if (billingBranchId) {
    payload.billingBranchId = billingBranchId;
  }

  if (normalized.paidAt) {
    payload.paidAt = normalized.paidAt;
  }

  return payload;
}

function buildConfirmPaymentPayload(options = {}) {
  const normalized = normalizePaymentOptions(options);
  const payload = {
    notify: normalized.notify !== false,
  };

  const billingBranchId = normalizeBillingTargetId(normalized.billingBranchId);
  if (billingBranchId) {
    payload.billingBranchId = billingBranchId;
  }

  if (normalized.paidAt) {
    payload.paidAt = normalized.paidAt;
  }

  return payload;
}

export async function reportQuotationPayment(quotationId, options = {}) {
  const id = String(quotationId || "").trim();
  if (!id) {
    throw new Error("Quotation id is required.");
  }

  return fetchJson(`/api/quotations/${id}/report-payment`, {
    method: "POST",
    headers: financeAuthHeaders(),
    body: buildReportPaymentPayload(options),
  });
}

export async function confirmQuotationPayment(quotationId, options = {}) {
  const id = String(quotationId || "").trim();
  if (!id) {
    throw new Error("Quotation id is required.");
  }

  return fetchJson(`/api/quotations/${id}/confirm-payment`, {
    method: "POST",
    headers: financeAuthHeaders(),
    body: buildConfirmPaymentPayload(options),
  });
}

/**
 * Finance one-step mark-paid: records the manual payment reference and confirms
 * fulfillment immediately (no separate confirm step).
 */
export async function markQuotationPaid(quotationId, options = {}) {
  const id = String(quotationId || "").trim();
  if (!id) {
    throw new Error("Quotation id is required.");
  }

  return fetchJson(`/api/quotations/${id}/mark-paid`, {
    method: "POST",
    headers: financeAuthHeaders(),
    body: buildReportPaymentPayload(options),
  });
}

export async function syncQuotationPayment(quotationId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    return await fetchJson(`/api/quotations/${quotationId}/sync-payment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getFinanceToken()}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function resendQuotationWelcomeEmail(quotationId) {
  return fetchJson(`/api/quotations/${quotationId}/resend-welcome-email`, {
    method: "POST",
    headers: financeAuthHeaders(),
    body: {},
  });
}

export async function resendFinancePaymentAlert(quotationId) {
  return fetchJson(`/api/quotations/${quotationId}/resend-finance-alert`, {
    method: "POST",
    headers: financeAuthHeaders(),
    body: {},
  });
}

export function isLeadPaymentComplete(lead, payment) {
  return lead?.status === "Paid" || isPaymentPaid(payment);
}

export function formatPaymentAmount(amount, currency = "INR") {
  if (!amount) {
    return "—";
  }

  return `${currency} ${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
