/**
 * Smoke-test mail To/CC/mailbox routing for quotation, payment, support,
 * cancellation, and auth flows. Uses in-process email capture (no real send).
 *
 * Run: node scripts/smoke-test-mail-routing.mjs
 * Optional: DATABASE_URL enables finance / sales-admin CC coverage.
 */
import "../src/config/load-env.js";

process.env.MAIL_DRY_RUN = "true";
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || "platform.admin@example.com";
process.env.ADMIN_LOGIN_EMAIL = process.env.ADMIN_LOGIN_EMAIL || process.env.ADMIN_EMAIL;

import { beginEmailCapture, endEmailCapture } from "../src/modules/mail/mail-runtime.js";
import {
  resolveCustomerCcEmails,
  resolveCustomerRecipients,
  resolveOutboundRecipients,
  resolvePortalLoginEmail,
  resolveQuotationCustomerRecipients,
  resolveResellerRecipients,
} from "../src/lib/customer-contact.js";
import {
  buildSalesCcExcluding,
  notifyAdminBranchCancellationAlert,
  notifyAdminCancellationRequested,
  notifyAdminQuotationDecision,
  notifyCustomerCancellationResolved,
  resolveBranchDropSalesRecipients,
  notifyCustomerInvoiceApproved,
  notifyCustomerPaymentLinkFromSales,
  notifyCustomerPaymentReported,
  notifyCustomerProductRequest,
  notifyCustomerProductRequestCancelled,
  notifyCustomerWelcomeEmail,
  notifyInternalPaymentSummary,
  notifyPaymentReported,
  notifyPortalCredentialsWithInvoice,
  notifySalesQuotationApproved,
  notifySalesQuotationRejected,
  notifySalesSupportTicketCreated,
  notifySupportTicketCreated,
} from "../src/modules/notifications/service.js";
import { requestPasswordResetOtp } from "../src/modules/auth/password-reset.js";

const marker = `mail-route-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sameSet(actual = [], expected = []) {
  const a = [...actual].map((e) => String(e).toLowerCase()).sort();
  const e = [...expected].map((x) => String(x).toLowerCase()).sort();
  return a.length === e.length && a.every((v, i) => v === e[i]);
}

function assertRouting(label, captured, { to, cc = [], mailbox, replyTo }) {
  assert(captured.length >= 1, `${label}: expected at least one captured email`);
  const last = captured[captured.length - 1];
  assert(sameSet(last.to, to), `${label}: To expected ${JSON.stringify(to)}, got ${JSON.stringify(last.to)}`);
  assert(sameSet(last.cc, cc), `${label}: CC expected ${JSON.stringify(cc)}, got ${JSON.stringify(last.cc)}`);
  if (mailbox) {
    assert(
      last.mailbox === mailbox,
      `${label}: mailbox expected ${mailbox}, got ${last.mailbox}`,
    );
  }
  if (replyTo !== undefined) {
    const actualReply = last.replyTo ? String(last.replyTo).toLowerCase() : null;
    const expectedReply = replyTo ? String(replyTo).toLowerCase() : null;
    assert(
      actualReply === expectedReply,
      `${label}: replyTo expected ${expectedReply}, got ${actualReply}`,
    );
  }
  console.log(`  ✓ ${label}`);
}

function pdfStub() {
  return Buffer.from("%PDF-1.4 smoke").toString("base64");
}

function directLead(overrides = {}) {
  return {
    companyName: `Direct Co ${marker}`,
    contactName: "Alex Customer",
    adminEmail: "admin.login@customer.com",
    workEmail: "work@customer.com",
    tenantId: "T-DIRECT",
    ...overrides,
  };
}

function resellerLead(overrides = {}) {
  return {
    companyName: `Reseller Co ${marker}`,
    contactName: "End Customer",
    adminEmail: "end.admin@customer.com",
    workEmail: "end.work@customer.com",
    tenantId: "T-RESELLER",
    reseller: {
      contactName: "Pat Partner",
      invoiceEmail: "billing@reseller.com",
      workEmail: "office@reseller.com",
      invoiceCcEmails: ["ops@reseller.com", "billing@reseller.com"],
    },
    ...overrides,
  };
}

function baseQuotation(lead, overrides = {}) {
  return {
    id: `qt-${marker}`,
    leadId: null,
    submittedBy: "sales.rep@example.com",
    submittedAt: new Date().toISOString(),
    reviewedBy: "finance@example.com",
    reviewedAt: new Date().toISOString(),
    financeNote: "Looks good",
    lead,
    pdfBase64: pdfStub(),
    payment: {
      paymentLinkUrl: "https://pay.example.com/link",
      amountLabel: "INR 1,000",
      grandTotal: 1000,
      currency: "INR",
      provider: "stripe",
      providerPaymentId: "pi_smoke",
      paymentReportedAt: new Date().toISOString(),
    },
    productSummary: [{ name: "CRM", priceLabel: "INR 1,000" }],
    branchSummary: { productCount: 1, branchCount: 1, billingGroupCount: 1, branchLabels: ["HQ"] },
    ...overrides,
  };
}

async function withCapture(fn) {
  beginEmailCapture();
  try {
    await fn();
    return endEmailCapture();
  } catch (error) {
    endEmailCapture();
    throw error;
  }
}

function testRecipientHelpers() {
  console.log("\n== Recipient helpers ==");

  const login = resolvePortalLoginEmail(directLead());
  assert(login === "admin.login@customer.com", "portal login prefers adminEmail");
  assert(
    sameSet(resolveCustomerCcEmails(directLead()), ["work@customer.com"]),
    "CC work when different from login",
  );
  assert(
    sameSet(resolveCustomerCcEmails(directLead({ workEmail: "admin.login@customer.com" })), []),
    "no CC when work equals login",
  );

  const customer = resolveCustomerRecipients(directLead());
  assert(sameSet(customer.to, ["admin.login@customer.com"]), "customer To = login");
  assert(sameSet(customer.cc, ["work@customer.com"]), "customer CC = work");

  const reseller = resolveResellerRecipients(resellerLead().reseller);
  assert(sameSet(reseller.to, ["billing@reseller.com"]), "reseller To = invoiceEmail");
  assert(sameSet(reseller.cc, ["ops@reseller.com"]), "reseller CC excludes invoice To");

  const outboundDirect = resolveOutboundRecipients(directLead());
  assert(sameSet(outboundDirect.to, customer.to), "outbound direct uses customer");
  const outboundReseller = resolveOutboundRecipients(resellerLead());
  assert(sameSet(outboundReseller.to, ["billing@reseller.com"]), "outbound reseller uses billing");

  const hqQuoteRecipients = resolveQuotationCustomerRecipients({
    lead: directLead(),
    branchSummary: { billingBranchId: "hq" },
  });
  assert(
    sameSet(hqQuoteRecipients.to, ["work@customer.com"]),
    "quotation HQ To = branch work email",
  );
  assert(
    sameSet(hqQuoteRecipients.cc, ["admin.login@customer.com"]),
    "quotation HQ CC = company admin",
  );

  const branchQuoteRecipients = resolveQuotationCustomerRecipients({
    lead: directLead({
      additionalAddresses: [
        {
          id: "b-chennai",
          label: "Chennai",
          workEmail: "chennai@customer.com",
          contactName: "Chennai Contact",
        },
      ],
    }),
    assignments: [{ productId: "crm", branchId: "b-chennai", billingBranchId: "b-chennai" }],
  });
  assert(
    sameSet(branchQuoteRecipients.to, ["chennai@customer.com"]),
    "quotation branch To = that branch work email",
  );
  assert(
    sameSet(branchQuoteRecipients.cc, ["admin.login@customer.com", "work@customer.com"]),
    "quotation branch CC includes company admin and HQ work",
  );
  console.log("  ✓ customer / reseller / outbound / per-branch quotation recipient rules");
}

async function testQuotationPaymentFlow() {
  console.log("\n== Quotation / payment flow ==");
  const lead = directLead();
  const quotation = baseQuotation(lead);
  const salesRep = "sales.rep@example.com";

  let captured = await withCapture(() => notifySalesQuotationRejected(quotation));
  // Sales admin CC only if active sales_admin exists in DB — allow empty or extra.
  assert(sameSet(captured[0].to, [salesRep]), "reject: To sales owner");
  assert(captured[0].mailbox === "finance", "reject: finance mailbox");
  console.log(
    `  ✓ Finance rejects quotation → To ${captured[0].to.join(", ")} CC ${captured[0].cc.join(", ") || "—"} mailbox=${captured[0].mailbox}`,
  );

  captured = await withCapture(() => notifyCustomerPaymentLinkFromSales(quotation));
  assertRouting("Finance approves → payment link (main)", captured, {
    to: ["work@customer.com"],
    cc: ["admin.login@customer.com", salesRep],
    mailbox: "sales",
    replyTo: salesRep,
  });

  captured = await withCapture(() => notifySalesQuotationApproved(quotation));
  assertRouting("Finance approved → sales-only payment link ready", captured, {
    to: [salesRep],
    cc: [],
    mailbox: "finance",
  });

  captured = await withCapture(() => notifyCustomerInvoiceApproved(quotation));
  assertRouting("Customer invoice approved job", captured, {
    to: ["work@customer.com"],
    cc: ["admin.login@customer.com"],
    mailbox: "sales",
    replyTo: salesRep,
  });

  captured = await withCapture(() => notifyAdminQuotationDecision(quotation, "approved"));
  assertRouting("Admin quotation decision alert", captured, {
    to: [String(process.env.ADMIN_EMAIL).toLowerCase()],
    cc: [],
    mailbox: "admin",
  });

  const resellerQuotation = baseQuotation(resellerLead());
  captured = await withCapture(() => notifyCustomerPaymentLinkFromSales(resellerQuotation));
  assertRouting("Payment link (reseller deal)", captured, {
    to: ["billing@reseller.com"],
    cc: ["ops@reseller.com", salesRep],
    mailbox: "sales",
    replyTo: salesRep,
  });

  // Payment reported — needs finance users in DB
  beginEmailCapture();
  const reported = await notifyPaymentReported(quotation, { source: "stripe" });
  captured = endEmailCapture();
  if (reported.notified) {
    assert(captured[0].mailbox === "finance", "payment reported: finance mailbox");
    assert(captured[0].to.length > 0, "payment reported: finance To not empty");
    assert(sameSet(captured[0].cc, []), "payment reported: no CC");
    console.log(
      `  ✓ Payment reported → To ${captured[0].to.join(", ")} mailbox=finance`,
    );
  } else {
    console.log(`  ~ Payment reported skipped (${reported.reason}) — seed active finance users to cover`);
  }

  captured = await withCapture(() => notifyCustomerPaymentReported(quotation, { source: "stripe" }));
  assertRouting("Customer payment received — verifying", captured, {
    to: ["work@customer.com"],
    cc: ["admin.login@customer.com", salesRep],
    mailbox: "sales",
  });

  beginEmailCapture();
  const summary = await notifyInternalPaymentSummary(quotation, { source: "stripe" });
  captured = endEmailCapture();
  if (summary.notified) {
    assert(captured[0].to.includes(salesRep), "internal summary includes sales");
    assert(sameSet(captured[0].cc, []), "internal summary: no CC");
    console.log(
      `  ✓ Payment confirmed internal summary → To ${captured[0].to.join(", ")}`,
    );
  } else {
    console.log(`  ~ Internal payment summary skipped (${summary.reason})`);
  }

  beginEmailCapture();
  const creds = await notifyPortalCredentialsWithInvoice(quotation, {
    email: "admin.login@customer.com",
    temporaryPassword: "TempPass123!",
  });
  captured = endEmailCapture();
  if (creds.sent) {
    assertRouting("Portal credentials to sales (internal)", captured, {
      to: [salesRep],
      cc: [],
      mailbox: "sales",
    });
  } else {
    console.log(`  ~ Portal credentials-to-sales skipped (${creds.reason})`);
  }

  // Welcome — direct customer
  beginEmailCapture();
  const welcomeDirect = await notifyCustomerWelcomeEmail(quotation, {
    portalAccess: {
      email: "branch.hq@customer.com",
      temporaryPassword: "Welcome1!",
    },
    recipientMode: "default",
  });
  captured = endEmailCapture();
  assert(welcomeDirect.customerNotified, "welcome direct should notify");
  assert(sameSet(captured[0].to, ["branch.hq@customer.com"]), "welcome direct To = portal email");
  assert(
    !captured[0].cc.includes("branch.hq@customer.com"),
    "welcome direct CC excludes To",
  );
  console.log(
    `  ✓ Welcome (direct) → To ${captured[0].to.join(", ")} CC ${captured[0].cc.join(", ") || "—"}`,
  );

  // Welcome — reseller
  beginEmailCapture();
  const welcomeReseller = await notifyCustomerWelcomeEmail(resellerQuotation, {
    portalAccess: {
      email: "end.admin@customer.com",
      temporaryPassword: "Welcome2!",
    },
  });
  captured = endEmailCapture();
  assert(welcomeReseller.customerNotified, "welcome reseller should notify");
  assert(sameSet(captured[0].to, ["billing@reseller.com"]), "welcome reseller To = invoice");
  assert(captured[0].cc.includes("ops@reseller.com"), "welcome reseller includes invoice CC");
  console.log(
    `  ✓ Welcome (reseller) → To ${captured[0].to.join(", ")} CC ${captured[0].cc.join(", ") || "—"}`,
  );

  // Welcome — customer_only (resend path requires a mailbox context)
  beginEmailCapture();
  const welcomeOnly = await notifyCustomerWelcomeEmail(quotation, {
    portalAccess: {
      email: "portal.only@customer.com",
      temporaryPassword: "Welcome3!",
    },
    recipientMode: "customer_only",
    mailContext: {
      accountType: "internal",
      accountId: "smoke-sales",
      mailboxProfile: "sales",
      accountEmail: "sales.rep@example.com",
    },
  });
  captured = endEmailCapture();
  assert(welcomeOnly.customerNotified, `welcome customer_only failed: ${welcomeOnly.customerEmailError}`);
  assertRouting("Welcome customer_only retry", captured, {
    to: ["portal.only@customer.com"],
    cc: [],
    mailbox: "sales",
  });
}

async function testSupportAndProductRequests() {
  console.log("\n== Support & product requests ==");

  beginEmailCapture();
  const support = await notifySupportTicketCreated({
    ticketNumber: "TKT-1",
    organizationId: null,
    companyName: "Acme",
    tenantId: "T1",
    productLabel: "CRM",
    category: "billing",
    priority: "normal",
    subject: "Need help",
    contactEmail: "user@acme.com",
    description: "Invoice question",
  });
  let captured = endEmailCapture();
  if (support.sent) {
    // Legacy alias → same SA→SE routing (no lead → sales admin fallback)
    assert(support.routedTo === "sales_admin", "support ticket without lead routes to sales_admin");
    assert(captured[0].to.length === 1, "support ticket: single To");
    assert(sameSet(captured[0].cc, []), "support ticket: no CC");
    assert(captured[0].mailbox === "sales_admin", "support ticket: sales_admin From mailbox");
    console.log(`  ✓ Support ticket (legacy alias) → To ${captured[0].to.join(", ")} from sales_admin`);
  } else {
    console.log(`  ~ Support ticket skipped (${support.reason}) — needs sales admin`);
  }

  beginEmailCapture();
  const salesSupport = await notifySalesSupportTicketCreated({
    ticketNumber: "TKT-2",
    organizationId: null,
    companyName: "Acme",
    subject: "Help",
    category: "billing",
    priority: "high",
    description: "x",
  });
  captured = endEmailCapture();
  if (salesSupport.sent) {
    assert(salesSupport.routedTo === "sales_admin", "sales support without lead routes to sales_admin");
    assert(salesSupport.fromMailbox === "sales_admin", "sales support From is sales_admin");
    assert(sameSet(captured[0].cc, []), "sales support: no CC");
    assert(captured[0].mailbox === "sales_admin", "sales support: sales_admin mailbox");
    console.log(`  ✓ Support → sales → To ${captured[0].to.join(", ")} from sales_admin`);
  } else {
    console.log(`  ~ Support → sales skipped (${salesSupport.reason}) — needs sales admin`);
  }

  beginEmailCapture();
  const productReq = await notifyCustomerProductRequest({
    sourceLeadId: null,
    requestNumber: "PR-1",
    companyName: "Acme",
    requestType: "new",
  });
  let capturedProduct = endEmailCapture();
  if (productReq.sent) {
    // No lead ownership → falls back to active sales admin
    assert(productReq.routedTo === "sales_admin", "product request without lead routes to sales_admin");
    assert(capturedProduct[0].to.length === 1, "product request: single To");
    assert(sameSet(capturedProduct[0].cc, []), "product request: no CC");
    console.log(
      `  ✓ Product request (no lead) → sales admin fallback To ${capturedProduct[0].to.join(", ")}`,
    );
  } else {
    console.log(`  ~ Product request skipped (${productReq.reason})`);
  }

  beginEmailCapture();
  const productCancel = await notifyCustomerProductRequestCancelled({
    sourceLeadId: null,
    requestNumber: "PR-2",
    companyName: "Acme",
  });
  capturedProduct = endEmailCapture();
  if (productCancel.sent) {
    assert(sameSet(capturedProduct[0].cc, []), "product cancel: no CC");
    console.log(
      `  ✓ Product request cancelled (no lead) → To ${capturedProduct[0].to.join(", ")}`,
    );
  } else {
    console.log(`  ~ Product cancel skipped (${productCancel.reason})`);
  }
}

async function testCancellationAndAuth() {
  console.log("\n== Cancellation / auth ==");
  const adminEmail = String(process.env.ADMIN_EMAIL).toLowerCase();

  const cancelSales = await resolveBranchDropSalesRecipients(null);
  const cancelTo = cancelSales.salesExecutive?.email
    ? [cancelSales.salesExecutive.email]
    : [];
  const cancelCc = buildSalesCcExcluding(
    cancelTo,
    cancelSales.salesAdmin?.email ? [cancelSales.salesAdmin.email] : [],
  );
  let captured = await withCapture(() =>
    notifyAdminCancellationRequested({
      requestNumber: "CR-1",
      requestKind: "cancel_product",
      companyName: "Acme",
      tenantId: "T1",
      branchId: "b1",
      productId: "crm",
      contactEmail: "user@acme.com",
    }),
  );
  if (cancelTo.length) {
    assertRouting("Customer product cancellation → sales (admin From)", captured, {
      to: cancelTo,
      cc: cancelCc,
      mailbox: "admin",
    });
  } else {
    assert(captured.length === 0, "product cancel with no sales recipient sends nothing");
    console.log("  ~ Product cancellation skipped (no sales recipient)");
  }

  const dropSales = await resolveBranchDropSalesRecipients(null);
  const dropRaiseCc = buildSalesCcExcluding([adminEmail], dropSales.cc);
  captured = await withCapture(() =>
    notifyAdminCancellationRequested({
      requestNumber: "CR-1B",
      requestKind: "drop_branch",
      companyName: "Acme",
      tenantId: "T1",
      branchId: "b1",
      contactEmail: "user@acme.com",
      sourceLeadId: null,
    }),
  );
  assertRouting("Branch drop request → admin + sales CC", captured, {
    to: [adminEmail],
    cc: dropRaiseCc,
    mailbox: "admin",
  });

  captured = await withCapture(() =>
    notifyAdminBranchCancellationAlert(
      {
        requestNumber: "CR-2",
        requestKind: "drop_branch",
        companyName: "Acme",
        tenantId: "T1",
        branchId: "b1",
      },
      { scenario: "renewal_unpaid", amountDue: "5000", currency: "INR" },
    ),
  );
  assertRouting("Auto grace unpaid escalation → admin", captured, {
    to: [adminEmail],
    cc: [],
    mailbox: "admin",
  });

  const resolveSales = await resolveBranchDropSalesRecipients(null);
  const resolveCc = buildSalesCcExcluding(
    ["user@acme.com", resolveSales.salesExecutive?.email],
    resolveSales.cc,
  );
  captured = await withCapture(() =>
    notifyCustomerCancellationResolved(
      {
        requestNumber: "CR-3",
        requestKind: "cancel_product",
        companyName: "Acme",
        contactEmail: "user@acme.com",
        adminNote: "Approved",
      },
      "approved",
    ),
  );
  assertRouting("Cancellation resolved → contact + sales CC", captured, {
    to: ["user@acme.com"],
    cc: resolveCc,
    mailbox: "sales",
  });

  const rejectCc = buildSalesCcExcluding(
    ["fallback@customer.com", resolveSales.salesExecutive?.email],
    resolveSales.cc,
  );
  captured = await withCapture(() =>
    notifyCustomerCancellationResolved(
      {
        requestNumber: "CR-4",
        requestKind: "cancel_product",
        companyName: "Reseller Co",
        contactEmail: "fallback@customer.com",
        sourceLeadId: null,
      },
      "rejected",
    ),
  );
  assertRouting("Cancellation resolved without lead uses contactEmail", captured, {
    to: ["fallback@customer.com"],
    cc: rejectCc,
    mailbox: "sales",
  });

  // Password reset OTP — unknown email should no-op without sending (privacy)
  beginEmailCapture();
  const reset = await requestPasswordResetOtp(`${marker}-unknown@example.com`);
  captured = endEmailCapture();
  assert(reset?.ok !== false || reset?.sent === false || captured.length === 0, "unknown reset no leak");
  assert(captured.length === 0, "password reset for unknown email sends nothing");
  console.log("  ✓ Password reset OTP (unknown email) sends nothing");
}

async function main() {
  console.log(`[smoke-test-mail-routing] marker=${marker}`);
  console.log(`[smoke-test-mail-routing] ADMIN_EMAIL=${process.env.ADMIN_EMAIL}`);
  console.log(
    `[smoke-test-mail-routing] DATABASE_URL=${process.env.DATABASE_URL ? "set" : "not set"}`,
  );

  testRecipientHelpers();
  await testQuotationPaymentFlow();
  await testSupportAndProductRequests();
  await testCancellationAndAuth();

  console.log("\n[smoke-test-mail-routing] All asserted routing scenarios passed.");
}

main().catch((error) => {
  console.error("\n[smoke-test-mail-routing] FAILED:", error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
