import { getFinanceToken } from "./auth.js";
import { fetchJson } from "./http.js";

export async function fetchPaymentConfig() {
  return fetchJson("/api/payments/config");
}

export async function fetchLeadPayment(leadId) {
  return fetchJson(`/api/quotations/payment/${leadId}`);
}

export function buildPaymentForwardDraft({ lead, payment, quotationId, salesRepName = "Worktual Sales Team" }) {
  const contactName = lead?.contactName || "there";
  const companyName = lead?.companyName || "your organization";
  const domainId = lead?.domainId || "—";
  const amountLabel = payment?.amountLabel || formatPaymentAmount(payment?.grandTotal, payment?.currency);
  const paymentUrl = payment?.paymentLinkUrl || "";

  return {
    to: lead?.workEmail || "",
    cc: "",
    bcc: "",
    subject: `Complete your Worktual payment — ${companyName}`,
    body: [
      `Dear ${contactName},`,
      "",
      "Thank you for choosing Worktual. I'm pleased to confirm that our finance team has approved the quotation we prepared for you.",
      "",
      `Company: ${companyName}`,
      `Domain ID: ${domainId}`,
      `Amount due: ${amountLabel}`,
      "",
      "You can complete payment securely using the link below:",
      paymentUrl,
      "",
      "Please find the approved invoice attached for your records.",
      "",
      "If you have any questions about billing, payment, or next steps, reply to this email and I'll be happy to help.",
      "",
      "Best regards,",
      salesRepName,
      "Worktual | Enterprise Software Provider",
    ].join("\n"),
    quotationId,
    paymentUrl,
    amountLabel,
  };
}

export function isPaymentPaid(payment) {
  return payment?.status === "paid";
}

export function paymentStatusLabel(payment) {
  if (!payment) {
    return "No payment";
  }

  switch (payment.status) {
    case "paid":
      return "Paid";
    case "failed":
      return "Payment failed";
    case "refunded":
      return "Refunded";
    default:
      return "Awaiting payment";
  }
}

export async function markQuotationPaid(quotationId, options = {}) {
  return fetchJson(`/api/quotations/${quotationId}/mark-paid`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getFinanceToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options),
  });
}

export async function syncQuotationPayment(quotationId) {
  return fetchJson(`/api/quotations/${quotationId}/sync-payment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getFinanceToken()}`,
    },
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
