import { sendEmail } from "./mail.js";
import { getLeadOwnership } from "./leads.js";
import {
  getActiveSalesAdminUser,
  getUserById,
  isSalesFacingUser,
  isUserActive,
  USER_ROLES,
} from "./users.js";

function env(name) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function formatLeadBlock(lead = {}) {
  return [
    `Company: ${lead.companyName || "—"}`,
    `Domain ID: ${lead.domainId || "—"}`,
    `Contact: ${lead.contactName || "—"}`,
    `Work email: ${lead.workEmail || "—"}`,
    `Admin email: ${lead.adminEmail || "—"}`,
  ].join("\n");
}

function resolveSalesTeamEmail() {
  return (
    env("SALES_TEAM_EMAIL") ||
    env("SALES_SMTP_USER") ||
    env("SMTP_USER") ||
    env("SALES_LOGIN_EMAIL")
  );
}

function resolveSalesAdminEmail() {
  return (
    env("SALES_ADMIN_LOGIN_EMAIL") ||
    env("SALES_ADMIN_SMTP_USER") ||
    env("SALES_ADMIN_SMTP_FROM") ||
    resolveSalesTeamEmail()
  );
}

export async function resolveCustomerProductRequestRecipient(sourceLeadId) {
  const ownership = sourceLeadId ? await getLeadOwnership(sourceLeadId) : null;

  if (ownership?.createdByUserId) {
    const creator = await getUserById(ownership.createdByUserId);
    if (isUserActive(creator) && isSalesFacingUser(creator) && creator.email) {
      return {
        email: creator.email.trim(),
        name: creator.displayName || creator.email,
        mailbox: creator.role === USER_ROLES.SALES_ADMIN ? "sales_admin" : "sales",
        routedTo: "lead_creator",
      };
    }
  }

  const salesAdmin = await getActiveSalesAdminUser();
  if (salesAdmin?.email) {
    return {
      email: salesAdmin.email.trim(),
      name: salesAdmin.displayName || salesAdmin.email,
      mailbox: "sales_admin",
      routedTo: "sales_admin",
    };
  }

  const fallbackEmail = resolveSalesAdminEmail();
  if (!fallbackEmail) {
    return null;
  }

  return {
    email: fallbackEmail,
    name: "Sales Admin",
    mailbox: "sales_admin",
    routedTo: "sales_admin_fallback",
  };
}

function resolveCustomerRecipients(lead = {}) {
  const workEmail = lead.workEmail?.trim();

  if (!workEmail) {
    throw new Error("Lead work email is missing on this quotation.");
  }

  return { to: [workEmail], cc: [] };
}

function formatReviewBlock(quotation) {
  return [
    `Quotation ID: ${quotation.id}`,
    `Submitted by: ${quotation.submittedBy || "Sales team"}`,
    `Submitted at: ${quotation.submittedAt}`,
    `Reviewed by: ${quotation.reviewedBy || "Finance team"}`,
    `Reviewed at: ${quotation.reviewedAt}`,
    quotation.financeNote ? `Finance note: ${quotation.financeNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function quotationAttachments(quotation) {
  if (Array.isArray(quotation.invoices) && quotation.invoices.length > 0) {
    return quotation.invoices
      .filter((entry) => entry.pdfBase64)
      .map((entry) => ({
        fileName: entry.fileName,
        contentBase64: entry.pdfBase64,
      }));
  }

  if (!quotation.pdfBase64) {
    return [];
  }

  return [
    {
      fileName: quotation.fileName,
      contentBase64: quotation.pdfBase64,
    },
  ];
}

function quotationAttachment(quotation) {
  const attachments = quotationAttachments(quotation);
  return attachments[0];
}

function quotationEmailAttachments(quotation) {
  const attachments = quotationAttachments(quotation);
  if (!attachments.length) {
    return {};
  }

  if (attachments.length === 1) {
    return { attachment: attachments[0] };
  }

  return { attachments };
}

function formatBranchSummaryBlock(quotation) {
  const summary = quotation.branchSummary;
  if (!summary) {
    return "";
  }

  return [
    "Branch summary",
    "--------------",
    `Products: ${summary.productCount}`,
    `Branches: ${summary.branchCount}`,
    `Billing groups: ${summary.billingGroupCount}`,
    summary.branchLabels?.length ? `Locations: ${summary.branchLabels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatProductSummaryBlock(quotation) {
  const items = quotation.productSummary || [];
  if (!items.length) {
    return "";
  }

  const lines = items.map((item) => {
    const branchPart = item.branchLabel ? ` @ ${item.branchLabel}` : "";
    const billingPart =
      item.billingLabel && item.billingLabel !== item.branchLabel
        ? ` (bill to ${item.billingLabel})`
        : "";
    const typePart = item.changeTypeLabel ? ` [${item.changeTypeLabel}]` : "";
    return `- ${item.name}${typePart}${branchPart}${billingPart}: ${item.priceLabel}`;
  });

  return ["Product breakdown", "-----------------", ...lines].join("\n");
}

export async function notifyAdminQuotationDecision(quotation, decision) {
  const adminEmail = env("ADMIN_EMAIL");
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is not configured in .env.");
  }

  const companyName = quotation.lead?.companyName || "Unknown company";
  const isApproved = decision === "approved";
  const subject = isApproved
    ? `Quotation approved — ${companyName}`
    : `Quotation rejected — ${companyName}`;

  const body = [
    "Dear Admin,",
    "",
    `Finance has ${isApproved ? "approved" : "rejected"} the quotation submitted for review.`,
    "",
    "Lead details",
    "------------",
    formatLeadBlock(quotation.lead),
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    formatReviewBlock(quotation),
    "",
    isApproved
      ? "You may proceed with the next customer onboarding steps."
      : "Please review the rejection note and coordinate with sales for revisions.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [adminEmail],
      subject,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: "finance",
    },
    "finance",
  );
}

function resolveSalesRecipient(quotation) {
  const submittedBy = String(quotation.submittedBy || "").trim();
  if (submittedBy.includes("@")) {
    return submittedBy;
  }

  return resolveSalesTeamEmail();
}

function formatPaymentBlock(quotation) {
  const payment = quotation.payment;
  if (!payment?.paymentLinkUrl) {
    return "";
  }

  return [
    "Payment link",
    "------------",
    `Amount due: ${payment.amountLabel || payment.grandTotal}`,
    `Provider: ${payment.provider || "stripe"}`,
    `Pay online: ${payment.paymentLinkUrl}`,
    payment.dryRun ? "Note: Payment link generated in demo mode (provider keys not configured)." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveSalesRep(quotation) {
  const submittedBy = String(quotation.submittedBy || "").trim();
  const salesRepIsEmail = submittedBy.includes("@");
  const salesRepName = salesRepIsEmail ? "Worktual Sales Team" : submittedBy || "Worktual Sales Team";

  return {
    salesRepEmail: salesRepIsEmail ? submittedBy : resolveSalesTeamEmail(),
    salesRepName,
    salesRepIsEmail,
  };
}

function formatCustomerPaymentBlock(quotation) {
  const payment = quotation.payment;
  if (!payment?.paymentLinkUrl) {
    return "";
  }

  const amountLabel =
    payment.amountLabel ||
    (payment.grandTotal
      ? `${payment.currency || "INR"} ${Number(payment.grandTotal).toLocaleString("en-IN")}`
      : "");

  return [
    `Amount due: ${amountLabel}`,
    "",
    "You can complete payment securely using the link below:",
    payment.paymentLinkUrl,
  ].join("\n");
}

export async function notifyCustomerPaymentLinkFromSales(quotation) {
  const lead = quotation.lead || {};
  const { to, cc } = resolveCustomerRecipients(lead);

  if (!quotation.payment?.paymentLinkUrl) {
    throw new Error("Payment link is missing on this quotation.");
  }

  if (!quotation.pdfBase64 && !quotation.invoices?.some((entry) => entry.pdfBase64)) {
    throw new Error("Invoice PDF is missing on this quotation.");
  }

  const companyName = lead.companyName || "your organization";
  const contactName = lead.contactName || "there";
  const domainId = lead.domainId || "—";
  const { salesRepEmail, salesRepName, salesRepIsEmail } = resolveSalesRep(quotation);
  const subject = `Complete your Worktual payment — ${companyName}`;

  const body = [
    `Dear ${contactName},`,
    "",
    "Thank you for choosing Worktual. I'm pleased to confirm that our finance team has approved the quotation we prepared for you.",
    "",
    `Company: ${companyName}`,
    `Domain ID: ${domainId}`,
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    "",
    formatCustomerPaymentBlock(quotation),
    "",
    "Please find the approved invoice attached for your records.",
    "",
    "If you have any questions about billing, payment, or next steps, reply to this email and I'll be happy to help.",
    "",
    "Best regards,",
    salesRepName,
    salesRepIsEmail ? quotation.submittedBy : "",
    "Worktual | Enterprise Software Provider",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    to,
    cc: cc.length ? cc : undefined,
    subject,
    body,
    ...quotationEmailAttachments(quotation),
    mailbox: "sales",
  };

  if (salesRepEmail) {
    payload.replyTo = salesRepEmail;
    payload.cc = [...(payload.cc || []), salesRepEmail].filter(
      (email, index, list) => list.indexOf(email) === index,
    );
  }

  console.log(
    `[mail] Sending customer payment link to ${to.join(", ")} from sales mailbox (cc sales rep).`,
  );
  await sendEmail(payload, "sales");
}

export async function notifySalesQuotationApproved(quotation) {
  const salesEmail = resolveSalesRecipient(quotation);
  if (!salesEmail) {
    throw new Error("Sales team email is not configured. Set SALES_TEAM_EMAIL in .env.");
  }

  const companyName = quotation.lead?.companyName || "Unknown company";
  const subject = `Payment link ready — ${companyName}`;

  const body = [
    "Dear Sales Team,",
    "",
    "Finance has approved the quotation you submitted. A payment link has been generated for the invoice amount.",
    "",
    "Lead details",
    "------------",
    formatLeadBlock(quotation.lead),
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    formatReviewBlock(quotation),
    "",
    formatPaymentBlock(quotation),
    "",
    "Please forward the payment link to the customer from your sales workspace. The approved invoice is attached for reference.",
    "",
    "Regards,",
    "Worktual Finance Team",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`[mail] Notifying sales at ${salesEmail} with payment link from finance mailbox.`);
  await sendEmail(
    {
      to: [salesEmail],
      subject,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: "finance",
    },
    "finance",
  );
}

export async function notifyCustomerInvoiceApproved(quotation) {
  const lead = quotation.lead || {};
  const { to, cc } = resolveCustomerRecipients(lead);

  if (!quotation.pdfBase64 && !quotation.invoices?.some((entry) => entry.pdfBase64)) {
    throw new Error("Invoice PDF is missing on this quotation.");
  }

  const companyName = lead.companyName || "your organization";
  const contactName = lead.contactName || "there";
  const domainId = lead.domainId || "—";
  const salesRep = quotation.submittedBy || "Worktual Sales Team";
  const salesRepIsEmail = salesRep.includes("@");
  const salesRepName = salesRepIsEmail ? "Worktual Sales Team" : salesRep;
  const subject = `Your Worktual invoice — ${companyName}`;

  const body = [
    `Dear ${contactName},`,
    "",
    "Thank you for choosing Worktual. I'm pleased to share the approved invoice for your subscription.",
    "",
    `Company: ${companyName}`,
    `Domain ID: ${domainId}`,
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    "",
    "Our finance team has reviewed and confirmed the pricing we discussed. Please find the invoice attached for your records.",
    "",
    "If you have any questions about the invoice, billing, or onboarding next steps, reply to this email and I'll be happy to help.",
    "",
    "Best regards,",
    salesRepName,
    salesRepIsEmail ? salesRep : "",
    "Worktual | Enterprise Software Provider",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    to,
    cc: cc.length ? cc : undefined,
    subject,
    body,
    ...quotationEmailAttachments(quotation),
    mailbox: "sales",
  };

  if (salesRepIsEmail) {
    payload.replyTo = salesRep;
  }

  console.log(`[mail] Sending customer invoice to ${to.join(", ")} from sales mailbox.`);
  await sendEmail(payload, "sales");
}

export async function notifyQuotationApproved(quotation) {
  try {
    await notifyCustomerPaymentLinkFromSales(quotation);
    return {
      sales: true,
      customer: true,
      paymentLinkSent: Boolean(quotation.payment?.paymentLinkUrl),
      notificationSent: true,
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Customer payment email failed.");
  }
}

function resolveFinanceTeamEmail() {
  return (
    env("FINANCE_TEAM_EMAIL") ||
    env("FINANCE_SMTP_USER") ||
    env("FINANCE_LOGIN_EMAIL")
  );
}

function resolvePortalCredentialsEmail() {
  return env("PORTAL_CREDENTIALS_EMAIL") || "ajsworktual@gmail.com";
}

function resolvePortalLoginUrl() {
  return `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/`;
}

export async function notifyPortalCredentialsWithInvoice(quotation, portalAccess) {
  const credentialsEmail = resolvePortalCredentialsEmail();
  if (!credentialsEmail) {
    return { sent: false, reason: "missing_credentials_recipient" };
  }

  if (!portalAccess?.email || !portalAccess?.temporaryPassword) {
    return { sent: false, reason: "missing_portal_credentials" };
  }

  const lead = quotation.lead || {};
  const companyName = lead.companyName || "Unknown company";
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");
  const invoiceAttachments = quotationAttachments(quotation);
  const portalLoginUrl = resolvePortalLoginUrl();

  const body = [
    "A customer payment has been recorded. Share the portal credentials below with the customer if needed.",
    "",
    "Lead details",
    "------------",
    formatLeadBlock(lead),
    "",
    `Quotation ID: ${quotation.id}`,
    `Amount paid: ${amountLabel}`,
    "",
    "Customer portal credentials",
    "---------------------------",
    `Login URL: ${portalLoginUrl}`,
    `Email: ${portalAccess.email}`,
    `Temporary password: ${portalAccess.temporaryPassword}`,
    "",
    invoiceAttachments.length
      ? invoiceAttachments.length > 1
        ? "The approved invoices are attached to this email."
        : "The approved invoice is attached to this email."
      : "Invoice PDF was not available on this quotation.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  console.log(
    `[mail] Sending portal credentials and invoice to ${credentialsEmail} for ${companyName}.`,
  );

  await sendEmail(
    {
      to: [credentialsEmail],
      subject: `Customer portal credentials — ${companyName}`,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: "finance",
    },
    "finance",
  );

  return { sent: true, recipient: credentialsEmail };
}

export async function notifyPaymentReceived(quotationInput, { source = "stripe", portalAccess = null } = {}) {
  const { getQuotation } = await import("./quotations.js");
  let quotation = quotationInput;

  if (!quotation?.pdfBase64 && !quotation?.invoices?.length && quotation?.id) {
    const hydrated = await getQuotation(quotation.id);
    if (hydrated) {
      quotation = {
        ...hydrated,
        payment: quotationInput.payment || hydrated.payment,
        lead: quotationInput.lead || hydrated.lead,
      };
    }
  }

  const lead = quotation.lead || quotation.leadSnapshot || {};
  const companyName = lead.companyName || "Unknown company";
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");
  const salesEmail = resolveSalesRecipient(quotation) || resolveSalesTeamEmail();
  const financeEmail = resolveFinanceTeamEmail();
  const paidAt = quotation.payment?.paidAt || new Date().toISOString();

  const summaryBlock = [
    "Payment received",
    "----------------",
    `Company: ${companyName}`,
    `Domain ID: ${lead.domainId || "—"}`,
    `Quotation ID: ${quotation.id}`,
    `Amount: ${amountLabel}`,
    `Paid at: ${paidAt}`,
    `Source: ${source}`,
  ].join("\n");

  const recipients = [salesEmail, financeEmail].filter(Boolean);
  const uniqueRecipients = [...new Set(recipients)];

  if (uniqueRecipients.length) {
    await sendEmail(
      {
        to: uniqueRecipients,
        subject: `Payment received — ${companyName}`,
        body: [
          "A customer payment has been recorded.",
          "",
          summaryBlock,
          "",
          "The lead and quotation are now marked as Paid in Worktual Accounts.",
          "",
          "Regards,",
          "Worktual Accounts",
        ].join("\n"),
        mailbox: "finance",
      },
      "finance",
    );
  }

  const customerEmail = lead.workEmail?.trim();
  const portalLoginUrl = resolvePortalLoginUrl();

  if (portalAccess?.email && portalAccess?.temporaryPassword) {
    try {
      await notifyPortalCredentialsWithInvoice(quotation, portalAccess);
    } catch (error) {
      console.error(
        "[mail] Portal credentials email failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (customerEmail) {
    const customerBody = [
      `Dear ${lead.contactName || "there"},`,
      "",
      "Thank you — we have received your payment.",
      "",
      `Amount: ${amountLabel}`,
      `Reference: Quotation ${quotation.id}`,
      "",
    ];

    if (portalAccess?.temporaryPassword) {
      customerBody.push(
        "Your customer portal account is ready.",
        "",
        `Portal: ${portalLoginUrl}`,
        `Email: ${portalAccess.email || customerEmail}`,
        `Temporary password: ${portalAccess.temporaryPassword}`,
        "",
        "Please sign in and change your password when a password update option is available.",
        "",
      );
    } else {
      customerBody.push("Our team will follow up with onboarding next steps shortly.", "");
    }

    customerBody.push("Best regards,", "Worktual Team");

    await sendEmail(
      {
        to: [customerEmail],
        subject: `Payment received — ${companyName}`,
        body: customerBody.join("\n"),
        ...quotationEmailAttachments(quotation),
        mailbox: "sales",
      },
      "sales",
    );
  }

  return {
    notified: true,
    recipients: uniqueRecipients,
    customerNotified: Boolean(customerEmail),
    credentialsNotified: Boolean(portalAccess?.temporaryPassword),
  };
}

function resolveSupportTeamEmail() {
  return (
    env("SUPPORT_TEAM_EMAIL") ||
    env("FINANCE_TEAM_EMAIL") ||
    env("FINANCE_SMTP_USER") ||
    env("SALES_TEAM_EMAIL") ||
    env("SMTP_USER")
  );
}

export async function notifySupportTicketCreated(ticket, initialMessage = null) {
  const supportEmail = resolveSupportTeamEmail();
  if (!supportEmail) {
    return { sent: false, reason: "missing_support_recipient" };
  }

  const body = [
    "A new customer support ticket has been raised.",
    "",
    `Ticket: ${ticket.ticketNumber}`,
    `Company: ${ticket.companyName || "—"}`,
    `Domain ID: ${ticket.domainId || "—"}`,
    `Product: ${ticket.productLabel || "Account & billing"}`,
    `Category: ${ticket.category}`,
    `Priority: ${ticket.priority}`,
    `Subject: ${ticket.subject}`,
    `Contact: ${ticket.contactEmail || "—"}`,
    "",
    "Description",
    "-----------",
    initialMessage?.body || ticket.description,
    "",
    ticket.subscriptionKey ? `Subscription key: ${ticket.subscriptionKey}` : "",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [supportEmail],
      subject: `[${ticket.ticketNumber}] ${ticket.subject}`,
      body,
      mailbox: "finance",
    },
    "finance",
  );

  return { sent: true, recipient: supportEmail };
}

export async function notifySalesSupportTicketCreated(ticket, initialMessage = null) {
  const { resolveSalesOwnerForOrganization } = await import("./supportTickets.js");
  const ownership = ticket?.organizationId
    ? await resolveSalesOwnerForOrganization(ticket.organizationId)
    : null;

  const recipient = ownership?.sourceLeadId
    ? await resolveCustomerProductRequestRecipient(ownership.sourceLeadId)
    : null;

  if (!recipient?.email) {
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const body = [
    "A customer from your account has raised a support ticket.",
    "",
    `Assigned to: ${recipient.name}`,
    "",
    `Ticket: ${ticket.ticketNumber}`,
    `Company: ${ticket.companyName || "—"}`,
    `Domain ID: ${ticket.domainId || "—"}`,
    `Product: ${ticket.productLabel || "Account & billing"}`,
    `Category: ${ticket.category}`,
    `Priority: ${ticket.priority}`,
    `Subject: ${ticket.subject}`,
    `Contact: ${ticket.contactEmail || "—"}`,
    "",
    "Description",
    "-----------",
    initialMessage?.body || ticket.description,
    "",
    "Open Support in Worktual Accounts to review and reply.",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [recipient.email],
      subject: `[${ticket.ticketNumber}] Customer support: ${ticket.subject}`,
      body,
      mailbox: recipient.mailbox || "sales",
    },
    recipient.mailbox || "sales",
  );

  return { sent: true, recipient: recipient.email, routedTo: recipient.routedTo };
}

export async function notifyCustomerProductRequest(requestRecord) {
  const recipient = await resolveCustomerProductRequestRecipient(requestRecord.sourceLeadId);
  if (!recipient?.email) {
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const summaryLines = (requestRecord.productSummary || []).map(
    (entry) =>
      `- ${entry.name} (${entry.changeTypeLabel || entry.changeType || "new"}) @ ${entry.branchLabel || "—"}: ${entry.priceLabel || "—"}`,
  );

  const routedToLine =
    recipient.routedTo === "lead_creator"
      ? `Assigned to: ${recipient.name} (lead creator)`
      : `Assigned to: ${recipient.name} (sales admin — lead creator unavailable)`;

  const body = [
    "A customer has submitted a product purchase or upgrade request from the portal.",
    "",
    routedToLine,
    "",
    `Request: ${requestRecord.requestNumber}`,
    `Type: ${requestRecord.requestType}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Domain ID: ${requestRecord.domainId || "—"}`,
    `Contact: ${requestRecord.contactEmail || "—"}`,
    `Lead ID: ${requestRecord.sourceLeadId}`,
    "",
    "Requested products",
    "------------------",
    ...(summaryLines.length ? summaryLines : ["(no summary provided)"]),
    "",
    requestRecord.customerNote ? `Customer note: ${requestRecord.customerNote}` : "",
    "",
    "Open the lead in Worktual Accounts to review, price, and send a quotation to finance when ready.",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [recipient.email],
      subject: `[${requestRecord.requestNumber}] Customer product request — ${requestRecord.companyName || "Account"}`,
      body,
      mailbox: recipient.mailbox || "sales",
    },
    recipient.mailbox || "sales",
  );

  return {
    sent: true,
    recipient: recipient.email,
    routedTo: recipient.routedTo,
    recipientName: recipient.name,
  };
}

export async function notifyCustomerProductRequestCancelled(requestRecord) {
  const recipient = await resolveCustomerProductRequestRecipient(requestRecord.sourceLeadId);
  if (!recipient?.email) {
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const body = [
    "A customer has withdrawn a product request from the portal.",
    "",
    `Request: ${requestRecord.requestNumber}`,
    `Type: ${requestRecord.requestType}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Domain ID: ${requestRecord.domainId || "—"}`,
    `Contact: ${requestRecord.contactEmail || "—"}`,
    `Lead ID: ${requestRecord.sourceLeadId}`,
    "",
    "No further action is required unless the customer submits a new request.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  await sendEmail(
    {
      to: [recipient.email],
      subject: `[${requestRecord.requestNumber}] Customer product request withdrawn`,
      body,
      mailbox: recipient.mailbox || "sales",
    },
    recipient.mailbox || "sales",
  );

  return { sent: true, recipient: recipient.email };
}

function formatCancellationRequestBlock(requestRecord) {
  return [
    `Request: ${requestRecord.requestNumber}`,
    `Kind: ${requestRecord.requestKind}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Domain ID: ${requestRecord.domainId || "—"}`,
    `Branch/location ID: ${requestRecord.locationId || "—"}`,
    requestRecord.productId ? `Product: ${requestRecord.productId}` : "",
    requestRecord.subscriptionId ? `Subscription ID: ${requestRecord.subscriptionId}` : "",
    requestRecord.relatedQuotationId ? `Quotation ID: ${requestRecord.relatedQuotationId}` : "",
    requestRecord.triggerSource ? `Trigger: ${requestRecord.triggerSource}` : "",
    requestRecord.graceDeadlineAt ? `Grace deadline: ${requestRecord.graceDeadlineAt}` : "",
    requestRecord.contactEmail ? `Contact: ${requestRecord.contactEmail}` : "",
    requestRecord.customerNote ? `Note: ${requestRecord.customerNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function adminQueueUrl() {
  return `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/admin/cancellation-requests`;
}

export async function notifyAdminCancellationRequested(requestRecord) {
  const adminEmail = env("ADMIN_EMAIL");
  if (!adminEmail) {
    console.warn("[mail] ADMIN_EMAIL not configured — skipping cancellation request alert.");
    return { sent: false, reason: "missing_admin_email" };
  }

  const subject =
    requestRecord.requestKind === "drop_branch"
      ? `[${requestRecord.requestNumber}] Branch drop request — ${requestRecord.companyName || "Customer"}`
      : `[${requestRecord.requestNumber}] Product cancellation request — ${requestRecord.companyName || "Customer"}`;

  const body = [
    "Dear Admin,",
    "",
    "A customer has submitted a branch/product cancellation request from the portal.",
    "",
    formatCancellationRequestBlock(requestRecord),
    "",
    `Review and action in Worktual Admin: ${adminQueueUrl()}`,
    "",
    "Only platform admin can approve cancellations or drop a branch inactive.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ].join("\n");

  await sendEmail(
    {
      to: [adminEmail],
      subject,
      body,
      mailbox: "finance",
    },
    "finance",
  );

  return { sent: true, recipient: adminEmail };
}

export async function notifyAdminBranchCancellationAlert(requestRecord, context = {}) {
  const adminEmail = env("ADMIN_EMAIL");
  if (!adminEmail) {
    console.warn("[mail] ADMIN_EMAIL not configured — skipping auto-escalation alert.");
    return { sent: false, reason: "missing_admin_email" };
  }

  const scenarioLabel =
    context.scenario === "renewal_unpaid"
      ? "Renewal unpaid after grace period"
      : "Initial payment unpaid after grace period";

  const subject = `[AUTO] ${scenarioLabel} — ${requestRecord.companyName || "Customer"} (${requestRecord.locationId})`;

  const body = [
    "Dear Admin,",
    "",
    "A branch/product subscription has crossed the configured payment grace period without payment.",
    "",
    `Scenario: ${scenarioLabel}`,
    formatCancellationRequestBlock(requestRecord),
    context.amountDue ? `Amount due: ${context.currency || "INR"} ${context.amountDue}` : "",
    context.renewsAt ? `Subscription expired on: ${context.renewsAt}` : "",
    "",
    "An auto-escalated cancellation request has been created for your review.",
    "",
    `Review in Worktual Admin: ${adminQueueUrl()}`,
    "",
    "Approve to cancel the product at this branch or drop the branch inactive.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [adminEmail],
      subject,
      body,
      mailbox: "finance",
    },
    "finance",
  );

  return { sent: true, recipient: adminEmail };
}

export async function notifyCustomerCancellationResolved(requestRecord, decision) {
  const recipient = requestRecord.contactEmail;
  if (!recipient) {
    return { sent: false, reason: "missing_contact_email" };
  }

  const approved = decision === "approved";
  const subject = approved
    ? `[${requestRecord.requestNumber}] Cancellation approved — ${requestRecord.companyName || "Worktual"}`
    : `[${requestRecord.requestNumber}] Cancellation request update — ${requestRecord.companyName || "Worktual"}`;

  const body = [
    "Dear Customer,",
    "",
    approved
      ? "Your cancellation request has been approved by Worktual admin."
      : "Your cancellation request was reviewed and could not be approved at this time.",
    "",
    formatCancellationRequestBlock(requestRecord),
    requestRecord.adminNote ? `Admin note: ${requestRecord.adminNote}` : "",
    "",
    approved
      ? "The affected product or branch access has been deactivated as requested."
      : "Contact your Worktual account team if you need further assistance.",
    "",
    "Regards,",
    "Worktual Accounts Team",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [recipient],
      subject,
      body,
      mailbox: "sales",
    },
    "sales",
  );

  return { sent: true, recipient };
}

function resolveSetupInviteFrom() {
  return (
    env("SETUP_INVITE_SMTP_FROM") ||
    "Worktual <sample151102@gmail.com>"
  );
}

function resolveSetupInviteMailProfile() {
  return env("SETUP_INVITE_MAIL_PROFILE") || "sales";
}

function resolveAppBaseUrl() {
  return String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

/**
 * Invite email for product users onboarded via Setup → People.
 * Link-only (no temporary password). Sent from Worktual platform mail.
 */
export async function notifySetupUserInvite({
  toEmail,
  firstName,
  orgName,
  productNames = [],
  setPasswordUrl,
  expiresAt,
}) {
  const recipient = String(toEmail || "").trim();
  if (!recipient || !setPasswordUrl) {
    throw new Error("Invite email requires recipient and set-password URL.");
  }

  const productsLine = productNames.length
    ? productNames.join(", ")
    : "your assigned Worktual product(s)";
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "72 hours";

  const body = [
    `Hi ${firstName || "there"},`,
    "",
    `${orgName || "Your organization"} has invited you to access ${productsLine} on Worktual.`,
    "",
    "Set your password using this one-time link (do not share it):",
    setPasswordUrl,
    "",
    `This link expires on ${expiryLabel}.`,
    "",
    "After you set your password, you will be able to sign in to the product(s) listed above.",
    "This invitation is not for the My Account admin portal.",
    "",
    "If you did not expect this email, you can ignore it.",
    "",
    "Regards,",
    "Worktual",
  ].join("\n");

  const profile = resolveSetupInviteMailProfile();
  await sendEmail(
    {
      to: [recipient],
      subject: `${orgName || "Worktual"} invited you — set your password`,
      body,
      from: resolveSetupInviteFrom(),
      mailbox: profile,
    },
    profile,
  );

  return {
    sent: true,
    recipient,
    from: resolveSetupInviteFrom(),
    setPasswordUrl: resolveAppBaseUrl(),
  };
}

/**
 * Notify an Active product user that their product access changed.
 * No set-password link — they already have credentials.
 */
export async function notifySetupUserAccessChanged({
  toEmail,
  firstName,
  orgName,
  addedNames = [],
  removedNames = [],
  currentNames = [],
}) {
  const recipient = String(toEmail || "").trim();
  if (!recipient) {
    throw new Error("Access notification requires a recipient email.");
  }

  const added = Array.isArray(addedNames) ? addedNames.filter(Boolean) : [];
  const removed = Array.isArray(removedNames) ? removedNames.filter(Boolean) : [];
  const current = Array.isArray(currentNames) ? currentNames.filter(Boolean) : [];

  const body = [
    `Hi ${firstName || "there"},`,
    "",
    `${orgName || "Your organization"} updated your Worktual product access.`,
    "",
  ];

  if (added.length) {
    body.push("Access granted:", ...added.map((name) => `  • ${name}`), "");
  }
  if (removed.length) {
    body.push("Access removed:", ...removed.map((name) => `  • ${name}`), "");
  }
  if (!added.length && !removed.length) {
    body.push("Your product roles or assignments were updated.", "");
  }

  body.push(
    current.length
      ? `Your current products:\n${current.map((name) => `  • ${name}`).join("\n")}`
      : "You currently have no product access assigned.",
    "",
    "Your existing password still works — you do not need to set a new one.",
    "This message is not for the My Account admin portal.",
    "",
    "If you did not expect this change, contact your organization admin.",
    "",
    "Regards,",
    "Worktual",
  );

  const profile = resolveSetupInviteMailProfile();
  await sendEmail(
    {
      to: [recipient],
      subject: `${orgName || "Worktual"} updated your Worktual product access`,
      body: body.join("\n"),
      from: resolveSetupInviteFrom(),
      mailbox: profile,
    },
    profile,
  );

  return { sent: true, recipient, from: resolveSetupInviteFrom() };
}

export { resolveAppBaseUrl, resolveSetupInviteFrom };
