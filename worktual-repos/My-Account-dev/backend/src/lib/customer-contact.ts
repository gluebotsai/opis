export function normalizeEmail(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Portal login identity — admin email is primary, work email is fallback.
 */
export function resolvePortalLoginEmail(lead: any = {}) {
  return normalizeEmail(lead.adminEmail || lead.workEmail);
}

/**
 * CC work email on customer-facing mail when it differs from the portal login address.
 */
export function resolveCustomerCcEmails(lead: any = {}) {
  const login = resolvePortalLoginEmail(lead);
  const work = normalizeEmail(lead.workEmail);
  return work && work !== login ? [work] : [];
}

export function resolveCustomerRecipients(lead: any = {}) {
  const loginEmail = resolvePortalLoginEmail(lead);
  if (!loginEmail) {
    return { to: [], cc: [] };
  }

  return {
    to: [loginEmail],
    cc: resolveCustomerCcEmails(lead),
  };
}

export function resolveResellerRecipients(reseller: any = {}) {
  const invoiceEmail = normalizeEmail(reseller.invoiceEmail);
  const workEmail = normalizeEmail(reseller.workEmail);
  const primary = invoiceEmail || workEmail;

  if (!primary) {
    return { to: [], cc: [] };
  }

  const cc = (Array.isArray(reseller.invoiceCcEmails) ? reseller.invoiceCcEmails : [])
    .map((entry: any) => normalizeEmail(entry))
    .filter((entry: any) => entry && entry !== primary);

  return { to: [primary], cc };
}

/**
 * Billing and portal emails route to reseller when lead is reseller-sourced.
 */
export function resolveOutboundRecipients(lead: any = {}) {
  const reseller = lead.reseller || lead.resellerSnapshot;
  if (reseller && (reseller.invoiceEmail || reseller.workEmail)) {
    return resolveResellerRecipients(reseller);
  }

  return resolveCustomerRecipients(lead);
}

/**
 * Billing branch for a quotation (per-branch invoice or first assignment).
 */
export function resolveQuotationBillingBranchId(quotation: any = {}) {
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

function resolveBranchWorkEmailFromLead(lead: any = {}, billingBranchId: any = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    const addr = (lead.additionalAddresses || []).find((entry: any) => String(entry.id) === branchId);
    return normalizeEmail(addr?.workEmail);
  }
  return normalizeEmail(lead.workEmail);
}

function pushUniqueRecipient(list: any, email: any) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return;
  }
  if (list.some((entry: any) => normalizeEmail(entry) === normalized)) {
    return;
  }
  list.push(normalized);
}

/**
 * Quotation / payment customer mail:
 * - Reseller deals → reseller billing (unchanged)
 * - Consolidated multi-branch payment on one quote → company admin/work (one payer)
 * - Single billing branch (incl. per-branch quotes) → that branch's work email,
 *   with company admin (and HQ work if different) on CC
 */
export function resolveQuotationCustomerRecipients(quotation: any = {}) {
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

  const cc: any = [];
  pushUniqueRecipient(cc, lead.adminEmail);
  pushUniqueRecipient(cc, lead.workEmail);
  const filteredCc: any = cc.filter((email: any) => email !== branchEmail);

  return {
    to: [branchEmail],
    cc: filteredCc,
    billingBranchId,
  };
}

export function resolveBranchContactName(lead: any = {}, billingBranchId: any = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    const addr = (lead.additionalAddresses || []).find((entry: any) => String(entry.id) === branchId);
    const name = String(addr?.contactName || "").trim();
    if (name) {
      return name;
    }
  }
  return String(lead.contactName || "").trim() || "there";
}

export function assertOutboundEmail(lead: any = {}) {
  const { to } = resolveOutboundRecipients(lead);
  if (!to.length) {
    throw new Error("Lead must have reseller billing email or customer admin/work email.");
  }
  return to[0];
}

export function assertPortalLoginEmail(lead: any = {}) {
  const email = resolvePortalLoginEmail(lead);
  if (!email) {
    throw new Error("Lead must have an admin email or work email for customer portal access.");
  }
  return email;
}
