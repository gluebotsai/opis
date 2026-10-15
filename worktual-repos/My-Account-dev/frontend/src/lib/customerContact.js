export function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function resolvePortalLoginEmail(lead = {}) {
  return normalizeEmail(lead.adminEmail || lead.workEmail);
}

export function resolveCustomerCcEmails(lead = {}) {
  const login = resolvePortalLoginEmail(lead);
  const work = normalizeEmail(lead.workEmail);
  return work && work !== login ? [work] : [];
}

export function resolveCustomerRecipients(lead = {}) {
  const loginEmail = resolvePortalLoginEmail(lead);
  if (!loginEmail) {
    return { to: [], cc: [] };
  }

  return {
    to: [loginEmail],
    cc: resolveCustomerCcEmails(lead),
  };
}

export function resolveResellerRecipients(reseller = {}) {
  const invoiceEmail = normalizeEmail(reseller.invoiceEmail);
  const workEmail = normalizeEmail(reseller.workEmail);
  const primary = invoiceEmail || workEmail;

  if (!primary) {
    return { to: [], cc: [] };
  }

  const cc = (Array.isArray(reseller.invoiceCcEmails) ? reseller.invoiceCcEmails : [])
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry && entry !== primary);

  return { to: [primary], cc };
}

export function resolveOutboundRecipients(lead = {}) {
  const reseller = lead.reseller || lead.resellerSnapshot;
  if (reseller && (reseller.invoiceEmail || reseller.workEmail)) {
    return resolveResellerRecipients(reseller);
  }

  return resolveCustomerRecipients(lead);
}

export function resolveQuotationBillingBranchId(quotation = {}) {
  const invoiceBranch = quotation?.invoices?.[0]?.billingBranchId;
  if (invoiceBranch) {
    return String(invoiceBranch);
  }
  const fromSummary = quotation?.branchSummary?.billingBranchId;
  if (fromSummary) {
    return String(fromSummary);
  }
  const assignment = Array.isArray(quotation?.assignments) ? quotation.assignments[0] : null;
  return String(assignment?.billingBranchId || assignment?.branchId || "hq");
}

function resolveBranchWorkEmailFromLead(lead = {}, billingBranchId = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    const addr = (lead.additionalAddresses || []).find((entry) => String(entry.id) === branchId);
    return normalizeEmail(addr?.workEmail);
  }
  return normalizeEmail(lead.workEmail);
}

function pushUniqueRecipient(list, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return;
  }
  if (list.some((entry) => normalizeEmail(entry) === normalized)) {
    return;
  }
  list.push(normalized);
}

export function resolveQuotationCustomerRecipients(quotation = {}) {
  const lead = quotation.lead || {};
  const reseller = lead.reseller || lead.resellerSnapshot;
  if (reseller && (reseller.invoiceEmail || reseller.workEmail)) {
    return resolveOutboundRecipients(lead);
  }

  const branchPayments = Array.isArray(quotation.payment?.branchPayments)
    ? quotation.payment.branchPayments
    : [];
  const invoices = Array.isArray(quotation.invoices) ? quotation.invoices : [];
  const multiBranchOnOneQuote =
    branchPayments.length > 1 ||
    (invoices.length > 1 && String(quotation.invoiceMode || "") !== "per_branch");

  if (multiBranchOnOneQuote) {
    return resolveOutboundRecipients(lead);
  }

  const billingBranchId = resolveQuotationBillingBranchId(quotation);
  const branchEmail = resolveBranchWorkEmailFromLead(lead, billingBranchId);
  if (!branchEmail) {
    return resolveOutboundRecipients(lead);
  }

  const cc = [];
  pushUniqueRecipient(cc, lead.adminEmail);
  pushUniqueRecipient(cc, lead.workEmail);
  const filteredCc = cc.filter((email) => email !== branchEmail);

  return {
    to: [branchEmail],
    cc: filteredCc,
    billingBranchId,
  };
}

export function resolveBranchContactName(lead = {}, billingBranchId = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    const addr = (lead.additionalAddresses || []).find((entry) => String(entry.id) === branchId);
    const name = String(addr?.contactName || "").trim();
    if (name) {
      return name;
    }
  }
  return String(lead.contactName || "").trim() || "there";
}
