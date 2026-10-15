import { pool } from "../../db/pool.js";
import { rowToCamel } from "../../db/util.js";
import { resolveResellerRecipients } from "../../lib/customer-contact.js";
import { sendEmail } from "../mail/mail-runtime.js";
import { getLeadById } from "../leads/lead-store.js";
import { getQuotation } from "../quotations/quotation-store.js";
import { getCommissionEntryById } from "../commissions/commission-store.js";
import * as partnersRepo from "../../repositories/raw/partners.repo.js";
import * as resellersRepo from "../../repositories/raw/resellers.repo.js";
import { resolveAdminMailContext } from "./service.js";

function formatLeadBlock(lead: any = {}) {
  return [
    `Company: ${lead.companyName || "—"}`,
    `Tenant ID: ${lead.tenantId || "—"}`,
    `Contact: ${lead.contactName || "—"}`,
    `Work email: ${lead.workEmail || "—"}`,
    `Status: ${lead.status || "—"}`,
  ].join("\n");
}

function formatAmount(amount: any, currency = "INR") {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || "INR"} ${value.toFixed(2)}`;
  }
}

async function resolvePartnerNotificationRecipients(partnerId: any) {
  if (!partnerId) {
    return { to: [], cc: [] };
  }
  const row = await partnersRepo.selectPartnerById(pool, partnerId);
  if (!row || row.is_active === false) {
    return { to: [], cc: [] };
  }
  const partner = rowToCamel(row);
  const users = await partnersRepo.selectPartnerUsersByPartnerId(pool, partnerId);
  const loginEmails = (users || [])
    .filter((user: any) => user.is_active !== false && user.email)
    .map((user: any) => String(user.email).trim().toLowerCase());
  const workEmail = String(partner?.workEmail || "")
    .trim()
    .toLowerCase();
  const primary = workEmail || loginEmails[0] || "";
  if (!primary) {
    return { to: [], cc: [] };
  }
  const cc = [...new Set(loginEmails.filter((email: string) => email && email !== primary))];
  return { to: [primary], cc: cc as string[] };
}

async function resolveResellerNotificationRecipients(resellerId: any) {
  if (!resellerId) {
    return { to: [], cc: [] };
  }
  const row = await resellersRepo.selectResellerById(pool, resellerId);
  if (!row || row.is_active === false) {
    return { to: [], cc: [] };
  }
  const reseller = rowToCamel(row);
  return resolveResellerRecipients({
    invoiceEmail: reseller?.invoiceEmail,
    workEmail: reseller?.workEmail,
    invoiceCcEmails: reseller?.invoiceCcEmails,
  });
}

async function sendPortalNotification({
  to,
  cc = [],
  subject,
  body,
}: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}) {
  const recipients = (to || []).map((entry) => String(entry || "").trim()).filter(Boolean);
  if (!recipients.length) {
    console.warn("[portal.mail] Skipping — no recipient configured.");
    return { skipped: true, reason: "no_recipient" };
  }

  const ccList = (cc || []).map((entry) => String(entry || "").trim()).filter(Boolean);
  const adminContext = await resolveAdminMailContext();
  return sendEmail(
    {
      to: recipients,
      ...(ccList.length ? { cc: ccList } : {}),
      subject,
      body,
      mailbox: "admin",
    },
    "admin",
    adminContext as any,
  );
}

async function resolvePortalAudience(lead: any) {
  const partnerRecipients = lead?.partnerId
    ? await resolvePartnerNotificationRecipients(lead.partnerId)
    : { to: [], cc: [] };
  const resellerRecipients = lead?.resellerId
    ? await resolveResellerNotificationRecipients(lead.resellerId)
    : { to: [], cc: [] };
  return { partnerRecipients, resellerRecipients };
}

export async function notifyPortalCommissionAccrued(entryId: any) {
  const entry = await getCommissionEntryById(entryId);
  if (!entry?.partnerId) {
    return { skipped: true, reason: "not_partner_commission" };
  }

  const lead = entry.leadId ? await getLeadById(entry.leadId) : null;
  const quotation = entry.quotationId ? await getQuotation(entry.quotationId) : null;
  const recipients = await resolvePartnerNotificationRecipients(entry.partnerId);
  if (!recipients.to.length) {
    return { skipped: true, reason: "no_recipient" };
  }

  const currency = entry.currency || quotation?.currency || "INR";
  const subject = `Commission earned — ${lead?.companyName || "referral deal"}`;
  const body = [
    "Dear Partner,",
    "",
    "A customer you referred has completed payment. Your commission is accrued and pending finance payout.",
    "",
    "Deal summary",
    "------------",
    formatLeadBlock(lead),
    "",
    `Deal amount: ${formatAmount(entry.dealAmount, currency)}`,
    `Commission rate: ${entry.ratePercent ?? "—"}%`,
    `Commission amount: ${formatAmount(entry.commissionAmount, currency)}`,
    `Status: Pending payout`,
    "",
    "Sign in to your partner portal to view commission entries and bank details.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  return sendPortalNotification({ ...recipients, subject, body });
}

export async function notifyPortalCommissionPaid(entryId: any) {
  const entry = await getCommissionEntryById(entryId);
  if (!entry?.partnerId || entry.status !== "paid") {
    return { skipped: true, reason: "not_paid_partner_commission" };
  }

  const lead = entry.leadId ? await getLeadById(entry.leadId) : null;
  const recipients = await resolvePartnerNotificationRecipients(entry.partnerId);
  if (!recipients.to.length) {
    return { skipped: true, reason: "no_recipient" };
  }

  const currency = String(entry.currency || "INR");
  const reference = String(entry.payoutReference || "").trim();
  const subject = `Commission paid — ${lead?.companyName || "referral deal"}`;
  const body = [
    "Dear Partner,",
    "",
    "Finance has marked your commission as paid.",
    "",
    "Payout summary",
    "---------------",
    formatLeadBlock(lead),
    "",
    `Commission amount: ${formatAmount(entry.commissionAmount, currency)}`,
    reference ? `UTR / reference: ${reference}` : "",
    entry.paidAt ? `Paid on: ${new Date(String(entry.paidAt)).toLocaleString()}` : "",
    "",
    "Regards,",
    "Worktual Finance Team",
  ]
    .filter(Boolean)
    .join("\n");

  return sendPortalNotification({ ...recipients, subject, body });
}

export async function notifyPortalLeadCreated(leadId: any, { event = "created" }: { event?: string } = {}) {
  const lead = await getLeadById(leadId);
  if (!lead) {
    return { skipped: true, reason: "lead_not_found" };
  }

  const { partnerRecipients, resellerRecipients } = await resolvePortalAudience(lead);
  const isAssigned = Boolean(lead.assignedUserId);
  const eventLabel =
    event === "assigned" || (event === "created" && isAssigned && lead.resellerId)
      ? "submitted and assigned to sales"
      : event === "assigned"
        ? "assigned to sales"
        : "submitted";

  const subject = `Referral ${eventLabel} — ${lead.companyName || "new lead"}`;
  const body = [
    lead.partnerId ? "Dear Partner," : "Dear Reseller,",
    "",
    `Your customer referral has been ${eventLabel}.`,
    "",
    "Lead details",
    "------------",
    formatLeadBlock(lead),
    "",
    isAssigned
      ? "Sales will prepare the quotation and submit it to finance for approval."
      : "Sales admin will assign an executive and prepare the quotation.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  const results = [];
  if (lead.partnerId && partnerRecipients.to.length) {
    results.push(
      await sendPortalNotification({ ...partnerRecipients, subject, body: body.replace("Dear Reseller,", "Dear Partner,") }),
    );
  }
  if (lead.resellerId && resellerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...resellerRecipients, subject, body }));
  }
  return results.length ? results : { skipped: true, reason: "no_recipient" };
}

export async function notifyPortalQuotationSubmitted(quotationId: any) {
  const quotation = await getQuotation(quotationId);
  if (!quotation?.leadId) {
    return { skipped: true, reason: "quotation_not_found" };
  }
  const lead = quotation.lead || (await getLeadById(quotation.leadId));
  const { partnerRecipients, resellerRecipients } = await resolvePortalAudience(lead);
  const amount = formatAmount(quotation.grandTotal, quotation.currency || "INR");
  const subject = `Invoice sent to finance — ${lead?.companyName || "referral"}`;
  const body = [
    lead?.partnerId ? "Dear Partner," : "Dear Reseller,",
    "",
    "Sales has submitted an invoice to finance for review.",
    "",
    formatLeadBlock(lead),
    "",
    `Quotation amount: ${amount}`,
    `Status: Pending finance review`,
    "",
    "You will receive another update when finance approves or rejects the invoice.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  const results = [];
  if (lead?.partnerId && partnerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...partnerRecipients, subject, body }));
  }
  if (lead?.resellerId && resellerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...resellerRecipients, subject, body }));
  }
  return results.length ? results : { skipped: true, reason: "no_recipient" };
}

export async function notifyPortalQuotationApproved(quotationId: any) {
  const quotation = await getQuotation(quotationId);
  if (!quotation?.leadId) {
    return { skipped: true, reason: "quotation_not_found" };
  }
  const lead = quotation.lead || (await getLeadById(quotation.leadId));
  const { partnerRecipients, resellerRecipients } = await resolvePortalAudience(lead);
  const amount = formatAmount(quotation.grandTotal, quotation.currency || "INR");
  const subject = `Invoice approved — ${lead?.companyName || "referral"}`;
  const body = [
    lead?.partnerId ? "Dear Partner," : "Dear Reseller,",
    "",
    "Finance has approved the invoice. The customer can proceed with payment.",
    "",
    formatLeadBlock(lead),
    "",
    `Approved amount: ${amount}`,
    "",
    "Regards,",
    "Worktual Finance Team",
  ].join("\n");

  const results = [];
  if (lead?.partnerId && partnerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...partnerRecipients, subject, body }));
  }
  if (lead?.resellerId && resellerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...resellerRecipients, subject, body }));
  }
  return results.length ? results : { skipped: true, reason: "no_recipient" };
}

export async function notifyPortalQuotationRejected(quotationId: any) {
  const quotation = await getQuotation(quotationId);
  if (!quotation?.leadId) {
    return { skipped: true, reason: "quotation_not_found" };
  }
  const lead = quotation.lead || (await getLeadById(quotation.leadId));
  const { partnerRecipients, resellerRecipients } = await resolvePortalAudience(lead);
  const note = String(
    (quotation as any).reviewNotes || (quotation as any).rejectionReason || "",
  ).trim();
  const subject = `Invoice rejected — ${lead?.companyName || "referral"}`;
  const body = [
    lead?.partnerId ? "Dear Partner," : "Dear Reseller,",
    "",
    "Finance has rejected the invoice submitted for this referral.",
    "",
    formatLeadBlock(lead),
    "",
    note ? `Finance note: ${note}` : "Sales will revise the invoice and resubmit for finance review.",
    "",
    "Regards,",
    "Worktual Finance Team",
  ].join("\n");

  const results = [];
  if (lead?.partnerId && partnerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...partnerRecipients, subject, body }));
  }
  if (lead?.resellerId && resellerRecipients.to.length) {
    results.push(await sendPortalNotification({ ...resellerRecipients, subject, body }));
  }
  return results.length ? results : { skipped: true, reason: "no_recipient" };
}

export async function notifyPortalCustomerPaid(quotationId: any) {
  const quotation = await getQuotation(quotationId);
  if (!quotation?.leadId) {
    return { skipped: true, reason: "quotation_not_found" };
  }
  const lead = quotation.lead || (await getLeadById(quotation.leadId));
  if (!lead?.resellerId || lead.partnerId) {
    return { skipped: true, reason: "partner_commission_mail_handles_partner" };
  }
  const recipients = await resolveResellerNotificationRecipients(lead.resellerId);
  if (!recipients.to.length) {
    return { skipped: true, reason: "no_recipient" };
  }
  const amount = formatAmount(quotation.grandTotal, quotation.currency || "INR");
  const subject = `Customer paid — ${lead.companyName || "reseller lead"}`;
  const body = [
    "Dear Reseller,",
    "",
    "The customer for your lead has completed payment.",
    "",
    formatLeadBlock(lead),
    "",
    `Paid amount: ${amount}`,
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");
  return sendPortalNotification({ ...recipients, subject, body });
}
