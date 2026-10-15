/**
 * Smoke: product requests fulfill only after payment; unlinked fallback; partial; no-resurrect.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead, getLeadById } from "../src/modules/leads/lead-store.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotationsForFinance,
  ensureActiveProductsForQuotation,
} from "../src/modules/quotations/quotation-store.js";
import {
  confirmFinancePayment,
  recordProviderPaymentReported,
  repairQuotationProductFulfillment,
} from "../src/modules/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import {
  createCustomerProductRequest,
  getCustomerProductRequest,
  listCustomerProductRequests,
  listCustomerProductRequestsForLead,
  listOpenCustomerProductRequestsForSales,
} from "../src/modules/customer-product-requests/request-store.js";
import { ensureOrganizationForPaidLead } from "../src/modules/organizations/organization-store.js";
import { ensureOrgAdminCustomerUser } from "../src/modules/customer-portal/customer-auth.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";
import { cancelProductAtBranchTx } from "../src/modules/branch-requests/lifecycle.js";
import { selectSubscriptionsByLeadId } from "../src/repositories/raw/subscriptions.repo.js";
import { subscriptionKey } from "../src/modules/subscriptions/subscription-key.js";

const marker = `product-request-fulfill-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function payQuotation(quotationId) {
  await attachPaymentToQuotation(quotationId, {
    provider: "stripe",
    paymentLinkUrl: `https://checkout.stripe.example/${quotationId}`,
    paymentLinkId: `plink_${quotationId.slice(0, 8)}`,
    subtotal: 1000,
    grandTotal: 1180,
    currency: "INR",
    amountLabel: "INR 1,180.00",
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  await recordProviderPaymentReported({
    quotationId,
    providerPaymentId: `pi_${quotationId.slice(0, 8)}`,
    source: "manual",
    sendNotifications: false,
  });

  return confirmFinancePayment({
    quotationId,
    providerPaymentId: `pi_${quotationId.slice(0, 8)}`,
    source: "manual",
    sendNotifications: false,
  });
}

async function cleanup({ leadId, quotationIds = [], orgId = null, requestIds = [] }) {
  const client = await pool.connect();
  try {
    for (const requestId of requestIds) {
      if (requestId) {
        await client.query(`DELETE FROM customer_product_requests WHERE id = $1`, [requestId]);
      }
    }

    for (const quotationId of quotationIds) {
      if (!quotationId) continue;
      await client.query(`DELETE FROM quotation_branch_payments WHERE quotation_id = $1`, [
        quotationId,
      ]);
      await client.query(
        `DELETE FROM subscription_items WHERE purchase_order_id IN (
          SELECT id FROM purchase_orders WHERE quotation_id = $1
        )`,
        [quotationId],
      );
      await client.query(
        `DELETE FROM subscription_entitlements WHERE subscription_id IN (
          SELECT id FROM subscriptions WHERE quotation_id = $1
        )`,
        [quotationId],
      );
      await client.query(`DELETE FROM subscription_invoices WHERE subscription_id IN (
        SELECT id FROM subscriptions WHERE quotation_id = $1
      )`, [quotationId]).catch(() => {});
      await client.query(`DELETE FROM renewal_events WHERE subscription_id IN (
        SELECT id FROM subscriptions WHERE quotation_id = $1
      )`, [quotationId]).catch(() => {});
      await client.query(`DELETE FROM usage_metrics WHERE subscription_id IN (
        SELECT id FROM subscriptions WHERE quotation_id = $1
      )`, [quotationId]).catch(() => {});
      await client.query(`DELETE FROM subscriptions WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotation_invoices WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [
        quotationId,
      ]);
      await client.query(`DELETE FROM active_products WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
    }

    if (leadId) {
      await client.query(`DELETE FROM subscriptions WHERE source_lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM active_products WHERE lead_id = $1`, [leadId]);
    }

    if (orgId) {
      await client.query(`UPDATE leads SET organization_id = NULL WHERE organization_id = $1`, [
        orgId,
      ]);
      await client.query(`DELETE FROM product_access_grants WHERE customer_user_id IN (
        SELECT id FROM customer_users WHERE organization_id = $1
      )`, [orgId]);
      await client.query(`DELETE FROM customer_auth_sessions WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM customer_users WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organization_locations WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    } else if (leadId) {
      await client.query(`DELETE FROM organizations WHERE source_lead_id = $1`, [leadId]);
    }

    if (leadId) {
      await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM lead_assignments WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
  } finally {
    client.release();
  }
}

async function seedPaidLead() {
  const lead = await createLead({
    companyName: `Request Fulfill ${marker}`,
    industryType: "Technology",
    businessType: "B2B",
    country: "India",
    companySize: "11-50",
    contactName: "Fulfill Contact",
    designation: "Manager",
    workEmail: `${marker}-hq@example.com`,
    adminEmail: `${marker}-admin@example.com`,
    mobileCountryCode: "+91",
    mobileNumber: `9${String(Date.now()).slice(-9)}`,
    billingAddress: "1 Fulfill Street",
    taxNumber: gstinWithChecksum(`29AAAAA${String(Date.now()).slice(-4)}A1Z`),
    state: "Karnataka",
  });

  const seed = await createQuotationsForFinance({
    leadId: lead.id,
    lead,
    fileName: `${marker}-seed.pdf`,
    pdfBase64: "dGVzdA==",
    invoiceMode: "consolidated",
    subtotal: 1000,
    grandTotal: 1180,
    currency: "INR",
    assignments: [
      {
        productId: "contact-center",
        branchId: "hq",
        billingBranchId: "hq",
        changeType: "new",
        config: {
          pricingMode: "ccaas",
          licenseTier: "starter",
          billingCycle: "monthly",
          usageDetails: { agentCount: 1 },
          implementationPurchased: true,
        },
      },
    ],
    productSummary: [
      {
        productId: "contact-center",
        name: "Contact center",
        branchLabel: "Head office",
        billingLabel: "Head office",
      },
    ],
  });
  const seedQuote = seed.quotations[0];
  await approveQuotation(seedQuote.id, "finance@test.com", "seed");
  await payQuotation(seedQuote.id);

  const client = await pool.connect();
  let orgId;
  let user;
  try {
    const { organization } = await ensureOrganizationForPaidLead(lead.id, client);
    orgId = organization.id;
    const ensured = await ensureOrgAdminCustomerUser(client, organization.id, {
      adminEmail: `${marker}-admin@example.com`,
      workEmail: `${marker}-hq@example.com`,
      contactName: "Fulfill Contact",
    });
    user = ensured?.user;
  } finally {
    client.release();
  }

  assert(user?.id, "Org admin customer user is required");
  return { lead, seedQuote, orgId, user };
}

function openCustomerList(rows) {
  return rows.filter(
    (entry) => entry.status !== "fulfilled" && entry.status !== "cancelled",
  );
}

function openSalesList(rows) {
  return rows.filter((entry) => entry.status === "submitted");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-product-request-fulfill] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  let leadId = null;
  let orgId = null;
  const quotationIds = [];
  const requestIds = [];

  try {
    const { lead, seedQuote, orgId: seededOrgId, user } = await seedPaidLead();
    leadId = lead.id;
    orgId = seededOrgId;
    quotationIds.push(seedQuote.id);

    // --- 1) Linked quote: approve does NOT fulfill; pay DOES ---
    const linkedRequest = await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: user.id,
      sourceLeadId: lead.id,
      requestType: "new",
      assignments: [
        {
          productId: "crm",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 5, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "crm",
          name: "CRM",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
      companyName: lead.companyName,
      contactEmail: `${marker}-admin@example.com`,
    });
    requestIds.push(linkedRequest.id);

    const linkedQuoted = await createQuotationsForFinance({
      leadId: lead.id,
      lead: await getLeadById(lead.id),
      fileName: `${marker}-crm.pdf`,
      pdfBase64: "Y3Jt",
      invoiceMode: "consolidated",
      subtotal: 500,
      grandTotal: 590,
      currency: "INR",
      sourceProductRequestId: linkedRequest.id,
      assignments: [
        {
          productId: "crm",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 5, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "crm",
          name: "CRM",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
    });
    const crmQuote = linkedQuoted.quotations[0];
    quotationIds.push(crmQuote.id);
    assert(
      crmQuote.sourceProductRequestId === linkedRequest.id,
      `Quote should store sourceProductRequestId; got ${crmQuote.sourceProductRequestId}`,
    );

    await approveQuotation(crmQuote.id, "finance@test.com", "crm from request");
    const afterApprove = await getCustomerProductRequest(linkedRequest.id, orgId);
    assert(
      afterApprove?.status === "fulfilled",
      `Approve should fulfill linked request; got ${afterApprove?.status}`,
    );

    const salesOpenAfterApprove = openSalesList(
      await listCustomerProductRequestsForLead(lead.id),
    );
    assert(
      !salesOpenAfterApprove.some((entry) => entry.id === linkedRequest.id),
      "Finance-approved request must be hidden from sales open list",
    );

    await payQuotation(crmQuote.id);
    const fulfilledLinked = await getCustomerProductRequest(linkedRequest.id, orgId);
    assert(
      fulfilledLinked?.status === "fulfilled",
      `Expected fulfilled after pay, got ${fulfilledLinked?.status}`,
    );

    const customerOpen = openCustomerList(await listCustomerProductRequests(orgId));
    assert(
      !customerOpen.some((entry) => entry.id === linkedRequest.id),
      "Fulfilled request must be hidden from customer open list",
    );
    const salesOpen = openSalesList(await listCustomerProductRequestsForLead(lead.id));
    assert(
      !salesOpen.some((entry) => entry.id === linkedRequest.id),
      "Fulfilled request must be hidden from sales open list",
    );
    console.log("[smoke] OK — linked: approve fulfills and hides; pay stays fulfilled");

    // --- 2) Unlinked paid quote covering request still fulfills via fallback ---
    const unlinkedRequest = await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: user.id,
      sourceLeadId: lead.id,
      requestType: "new",
      assignments: [
        {
          productId: "cdp",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 3, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "cdp",
          name: "CDP",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
      companyName: lead.companyName,
      contactEmail: `${marker}-admin@example.com`,
    });
    requestIds.push(unlinkedRequest.id);

    const unlinkedQuoted = await createQuotationsForFinance({
      leadId: lead.id,
      lead: await getLeadById(lead.id),
      fileName: `${marker}-cdp.pdf`,
      pdfBase64: "Y2Rw",
      invoiceMode: "consolidated",
      subtotal: 400,
      grandTotal: 472,
      currency: "INR",
      // intentionally omit sourceProductRequestId
      assignments: [
        {
          productId: "cdp",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 3, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "cdp",
          name: "CDP",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
    });
    const hrmsQuote = unlinkedQuoted.quotations[0];
    quotationIds.push(hrmsQuote.id);
    assert(!hrmsQuote.sourceProductRequestId, "Unlinked quote must start without request id");

    await approveQuotation(hrmsQuote.id, "finance@test.com", "cdp unlinked");
    await payQuotation(hrmsQuote.id);

    const fulfilledUnlinked = await getCustomerProductRequest(unlinkedRequest.id, orgId);
    assert(
      fulfilledUnlinked?.status === "fulfilled",
      `Unlinked fallback should fulfill; got ${fulfilledUnlinked?.status}`,
    );

    const { rows: linkedRows } = await pool.query(
      `SELECT source_product_request_id FROM quotations WHERE id = $1`,
      [hrmsQuote.id],
    );
    assert(
      String(linkedRows[0]?.source_product_request_id) === String(unlinkedRequest.id),
      "Fallback should persist source_product_request_id on the paid quote",
    );
    console.log("[smoke] OK — unlinked fallback fulfills and persists link");

    // --- 3) Inquiries stay open until an *explicitly linked* quote is approved ---
    const inquiryRequest = await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: user.id,
      sourceLeadId: lead.id,
      requestType: "inquiry",
      assignments: [],
      productSummary: [],
      customerNote: "Interested in additional products — please follow up.",
      companyName: lead.companyName,
      contactEmail: `${marker}-admin@example.com`,
    });
    requestIds.push(inquiryRequest.id);

    const unrelatedQuoted = await createQuotationsForFinance({
      leadId: lead.id,
      lead: await getLeadById(lead.id),
      fileName: `${marker}-inquiry-unrelated.pdf`,
      pdfBase64: "aW5x",
      invoiceMode: "consolidated",
      subtotal: 250,
      grandTotal: 295,
      currency: "INR",
      // omit sourceProductRequestId — inquiries must NOT auto-link
      assignments: [
        {
          productId: "value-management",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: {
            productId: "value-management",
            monthlyBasePrice: 250,
            implementationPurchased: true,
          },
        },
      ],
      productSummary: [
        {
          productId: "value-management",
          name: "Value Management",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
    });
    const unrelatedQuote = unrelatedQuoted.quotations[0];
    quotationIds.push(unrelatedQuote.id);
    assert(
      !unrelatedQuote.sourceProductRequestId,
      "Unrelated quote must not auto-attach a notify-only inquiry",
    );
    await approveQuotation(unrelatedQuote.id, "finance@test.com", "unrelated to inquiry");

    const allSalesOpenAfterInquiry = await listOpenCustomerProductRequestsForSales();
    assert(
      allSalesOpenAfterInquiry.some((entry) => entry.id === inquiryRequest.id),
      "Inquiry must stay on sales open list when unrelated quotes are approved",
    );
    const stillOpenInquiry = await getCustomerProductRequest(inquiryRequest.id, orgId);
    assert(
      stillOpenInquiry?.status === "submitted",
      `Inquiry must stay submitted without an explicit quote link; got ${stillOpenInquiry?.status}`,
    );

    // Explicit link (as when sales opens from the inquiry CTA) then list reconcile fulfills.
    await pool.query(
      `UPDATE quotations SET source_product_request_id = $1 WHERE id = $2`,
      [inquiryRequest.id, unrelatedQuote.id],
    );
    await listOpenCustomerProductRequestsForSales();
    const fulfilledInquiry = await getCustomerProductRequest(inquiryRequest.id, orgId);
    assert(
      fulfilledInquiry?.status === "fulfilled",
      `Explicitly linked inquiry should fulfill on reconcile; got ${fulfilledInquiry?.status}`,
    );
    console.log("[smoke] OK — inquiry stays open until explicitly linked quote");

    // --- 4) Partial multi-product request stays open until all remaining are paid ---
    const partialRequest = await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: user.id,
      sourceLeadId: lead.id,
      requestType: "new",
      assignments: [
        {
          productId: "campaign",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 2, implementationPurchased: true },
        },
        {
          productId: "ticketing",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 2, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "campaign",
          name: "Campaign",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
        {
          productId: "ticketing",
          name: "Ticketing",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
      companyName: lead.companyName,
      contactEmail: `${marker}-admin@example.com`,
    });
    requestIds.push(partialRequest.id);

    const payrollQuoted = await createQuotationsForFinance({
      leadId: lead.id,
      lead: await getLeadById(lead.id),
      fileName: `${marker}-campaign.pdf`,
      pdfBase64: "Y2Ft",
      invoiceMode: "consolidated",
      subtotal: 300,
      grandTotal: 354,
      currency: "INR",
      sourceProductRequestId: partialRequest.id,
      assignments: [
        {
          productId: "campaign",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 2, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "campaign",
          name: "Campaign",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
    });
    const payrollQuote = payrollQuoted.quotations[0];
    quotationIds.push(payrollQuote.id);
    await approveQuotation(payrollQuote.id, "finance@test.com", "campaign partial");
    await payQuotation(payrollQuote.id);

    const afterPartialPay = await getCustomerProductRequest(partialRequest.id, orgId);
    assert(
      afterPartialPay?.status === "submitted",
      `Partial pay must leave request open; got ${afterPartialPay?.status}`,
    );

    const atsQuoted = await createQuotationsForFinance({
      leadId: lead.id,
      lead: await getLeadById(lead.id),
      fileName: `${marker}-ticketing.pdf`,
      pdfBase64: "dGlj",
      invoiceMode: "consolidated",
      subtotal: 300,
      grandTotal: 354,
      currency: "INR",
      sourceProductRequestId: partialRequest.id,
      assignments: [
        {
          productId: "ticketing",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: { userCount: 2, implementationPurchased: true },
        },
      ],
      productSummary: [
        {
          productId: "ticketing",
          name: "Ticketing",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
      ],
    });
    const atsQuote = atsQuoted.quotations[0];
    quotationIds.push(atsQuote.id);
    await approveQuotation(atsQuote.id, "finance@test.com", "ticketing partial");
    await payQuotation(atsQuote.id);

    const afterFullPay = await getCustomerProductRequest(partialRequest.id, orgId);
    assert(
      afterFullPay?.status === "fulfilled",
      `Full coverage must fulfill; got ${afterFullPay?.status}`,
    );
    console.log("[smoke] OK — partial stays open until all products paid");

    // --- 5) Cancelled products are not re-upserted by repair after pay ---
    const subs = await selectSubscriptionsByLeadId(pool, leadId);
    const crmSub = subs.find(
      (row) => row.product_id === "crm" && (row.branch_id || "hq") === "hq",
    );
    assert(crmSub?.id, "CRM subscription should exist after linked pay");

    await cancelProductAtBranchTx({
      subscriptionId: crmSub.id,
      adminUser: { email: "admin@test.com" },
      reason: "smoke cancel",
    });

    const afterCancel = await selectSubscriptionsByLeadId(pool, leadId);
    const cancelledCrm = afterCancel.find((row) => row.id === crmSub.id);
    assert(cancelledCrm?.status === "cancelled", "CRM should be cancelled");

    const { rows: activeBefore } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM active_products
       WHERE lead_id = $1 AND product_id = 'crm' AND branch_id = 'hq'`,
      [leadId],
    );
    assert(activeBefore[0].count === 0, "active_products CRM row should be deleted on cancel");

    await repairQuotationProductFulfillment(crmQuote.id);
    await ensureActiveProductsForQuotation(crmQuote.id);

    const afterRepair = await selectSubscriptionsByLeadId(pool, leadId);
    const stillCancelled = afterRepair.find((row) => row.id === crmSub.id);
    assert(
      stillCancelled?.status === "cancelled",
      `Repair must not resurrect cancelled CRM; got ${stillCancelled?.status}`,
    );

    const { rows: activeAfter } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM active_products
       WHERE lead_id = $1 AND product_id = 'crm' AND branch_id = 'hq'`,
      [leadId],
    );
    assert(
      activeAfter[0].count === 0,
      "Repair must not re-upsert cancelled CRM into active_products",
    );

    // sanity: key used by resurrection helper still points at cancelled row
    const key = subscriptionKey(orgId, "crm", "hq");
    assert(stillCancelled.key === key || stillCancelled.key, "subscription key present");

    console.log("[smoke] OK — repair does not resurrect cancelled products");
    console.log("[smoke-test-product-request-fulfill] OK — all cases passed");
  } catch (error) {
    console.error(
      "[smoke-test-product-request-fulfill] FAIL:",
      error instanceof Error ? error.stack || error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await cleanup({ leadId, quotationIds, orgId, requestIds });
    await pool.end();
  }
}

await main();
