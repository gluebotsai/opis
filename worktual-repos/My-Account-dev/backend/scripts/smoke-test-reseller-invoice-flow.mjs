/**
 * Reseller invoice flow smoke tests: outbound email routing + lead snapshot.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import {
  resolveCustomerRecipients,
  resolveOutboundRecipients,
} from "../src/lib/customer-contact.js";
import { pool } from "../src/db/pool.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { createQuotation } from "../src/modules/quotations/quotation-store.js";
import { createReseller } from "../src/modules/resellers/reseller-store.js";
import { resolveInvoiceBillingParty } from "../src/lib/invoice.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";

const marker = `reseller-invoice-smoke-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup({ leadId, quotationId, resellerId }) {
  const client = await pool.connect();
  try {
    if (quotationId) {
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
    }
    if (leadId) {
      await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
    if (resellerId) {
      await client.query(`DELETE FROM reseller_users WHERE reseller_id = $1`, [resellerId]);
      await client.query(`DELETE FROM resellers WHERE id = $1`, [resellerId]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-reseller-invoice] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const resellerLead = {
    companyName: "End Customer Co",
    workEmail: "customer-work@example.com",
    adminEmail: "customer-admin@example.com",
    reseller: {
      companyName: "Partner Reseller Ltd",
      invoiceEmail: "billing@reseller-partner.com",
      workEmail: "ops@reseller-partner.com",
      invoiceCcEmails: ["finance@reseller-partner.com"],
      billingAddress: "99 Partner Road",
      country: "India",
      taxNumber: "29RESELL0001Z1",
      contactName: "Reseller Contact",
    },
  };

  const resellerRecipients = resolveOutboundRecipients(resellerLead);
  assert(
    resellerRecipients.to[0] === "billing@reseller-partner.com",
    `Expected reseller invoice email, got ${resellerRecipients.to[0]}`,
  );
  assert(
    resellerRecipients.cc.includes("finance@reseller-partner.com"),
    "Expected reseller CC on invoice email",
  );

  const directCustomerRecipients = resolveOutboundRecipients({
    companyName: "Direct Co",
    workEmail: "direct@example.com",
    adminEmail: "direct@example.com",
  });
  assert(
    directCustomerRecipients.to[0] === "direct@example.com",
    "Direct leads should still route to customer email",
  );

  const customerOnly = resolveCustomerRecipients({
    workEmail: "billing@acme.com",
    adminEmail: "admin@acme.com",
  });
  assert(customerOnly.to[0] === "admin@acme.com", "Customer recipients prefer admin email");

  const resellerLeadForPdf = {
    companyName: "End Customer Co",
    billingAddress: "2 Customer Street",
    country: "India",
    taxNumber: "29CUST0001Z1",
    reseller: resellerLead.reseller,
  };
  const branchGroupAddress = "Branch HQ, Customer City";
  const branchGroupTax = "29BRANCH0001Z1";

  const billingParty = resolveInvoiceBillingParty(resellerLeadForPdf);
  assert(
    billingParty.companyName === "Partner Reseller Ltd",
    "PDF bill-to company should be reseller",
  );
  assert(
    billingParty.billingAddress === "99 Partner Road",
    "PDF bill-to address should be reseller billing address, not customer branch",
  );
  assert(
    billingParty.taxNumber === "29RESELL0001Z1",
    "PDF bill-to tax should be reseller tax, not customer branch tax",
  );
  assert(
    billingParty.serviceForCompanyName === "End Customer Co",
    "PDF should retain end customer as service-for label",
  );

  const billingPartyWithBranchArgs = resolveInvoiceBillingParty(resellerLeadForPdf, {
    billingBranchId: "branch-1",
  });
  assert(
    billingPartyWithBranchArgs.billingAddress !== branchGroupAddress,
    "Branch group address must not override reseller bill-to",
  );
  assert(
    billingPartyWithBranchArgs.taxNumber !== branchGroupTax,
    "Branch group tax must not override reseller bill-to",
  );
  assert(
    billingPartyWithBranchArgs.contactName === "Reseller Contact",
    "Reseller Primary Contact must stay reseller even when billingBranchId is set",
  );

  const branchId = "branch-contact-smoke-1";
  const directLeadForPdf = {
    companyName: "Direct Co",
    billingAddress: "1 Head Office Road",
    country: "India",
    taxNumber: "29HQ0001Z1A",
    contactName: "HQ Contact",
    designation: "HQ Manager",
    workEmail: "hq@direct.example.com",
    mobileCountryCode: "+91",
    mobileNumber: "9000000001",
    additionalAddresses: [
      {
        id: branchId,
        label: "Chennai Branch",
        address: "22 Branch Street",
        country: "India",
        taxNumber: "29BR0001Z1A",
        contactName: "Branch Contact",
        designation: "Branch Manager",
        workEmail: "branch@direct.example.com",
        mobileCountryCode: "+91",
        mobileNumber: "9000000002",
      },
    ],
  };

  const hqParty = resolveInvoiceBillingParty(directLeadForPdf, { billingBranchId: "hq" });
  assert(hqParty.contactName === "HQ Contact", "HQ billing should use HQ Primary Contact");
  assert(hqParty.workEmail === "hq@direct.example.com", "HQ billing should use HQ email");

  const branchParty = resolveInvoiceBillingParty(directLeadForPdf, { billingBranchId: branchId });
  assert(
    branchParty.contactName === "Branch Contact",
    "Branch billing should use branch Primary Contact name",
  );
  assert(
    branchParty.workEmail === "branch@direct.example.com",
    "Branch billing should use branch Primary Contact email",
  );
  assert(
    branchParty.mobileNumber === "9000000002",
    "Branch billing should use branch Primary Contact phone",
  );
  assert(
    branchParty.designation === "Branch Manager",
    "Branch billing should use branch Primary Contact title",
  );

  const defaultParty = resolveInvoiceBillingParty(directLeadForPdf);
  assert(
    defaultParty.contactName === "HQ Contact",
    "Without billingBranchId, Primary Contact should remain HQ",
  );

  console.log("[smoke-test-reseller-invoice] OK — branch vs HQ Primary Contact resolution");

  let resellerId;
  let leadId;
  let quotationId;
  const stamp = String(Date.now()).slice(-4);
  const resellerTaxNumber = gstinWithChecksum(`29RSLRA${stamp}A1Z`);
  const customerTaxNumber = gstinWithChecksum(`29CSTMR${stamp}A1Z`);

  try {
    const reseller = await createReseller({
      companyName: `Reseller Smoke ${marker}`,
      contactName: "Smoke Contact",
      workEmail: `ops-${marker}@reseller.test`,
      invoiceEmail: `billing-${marker}@reseller.test`,
      invoiceCcEmails: [`finance-${marker}@reseller.test`],
      taxNumber: resellerTaxNumber,
      billingAddress: "1 Reseller Park",
      country: "India",
      mobileCountryCode: "+91",
      mobileNumber: String(9200000000 + (Date.now() % 79999999)),
      loginEmail: `portal-${marker}@reseller.test`,
      password: "Aa1!SmokeTest99",
      displayName: "Smoke Reseller",
    });
    resellerId = reseller.id;

    const lead = await createLead(
      {
        companyName: `Customer ${marker}`,
        industryType: "Technology & Software",
        businessType: "B2B",
        country: "India",
        companySize: "11-50 employees",
        contactName: "Customer Contact",
        designation: "CEO",
        workEmail: `work-${marker}@customer.test`,
        adminEmail: `admin-${marker}@customer.test`,
        billingAddress: "2 Customer Street",
        taxNumber: customerTaxNumber,
        state: "Karnataka",
        mobileCountryCode: "+91",
        mobileNumber: String(9100000000 + (Date.now() % 89999999)),
        resellerId,
      },
      { createdByUserId: null },
    );
    leadId = lead.id;

    assert(lead.resellerId === resellerId, "Lead should store resellerId");
    assert(lead.reseller?.invoiceEmail === `billing-${marker}@reseller.test`, "Lead should hydrate reseller snapshot");

    const outboundFromLead = resolveOutboundRecipients(lead);
    assert(
      outboundFromLead.to[0] === `billing-${marker}@reseller.test`,
      "Hydrated lead should route billing email to reseller",
    );
    assert(
      !outboundFromLead.to.includes(`admin-${marker}@customer.test`),
      "End customer admin email must not be billing recipient",
    );

    const quotation = await createQuotation({
      leadId,
      lead,
      fileName: `${marker}.pdf`,
      pdfBase64: "dGVzdA==",
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      assignments: [
        {
          productId: "product-reseller-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    quotationId = quotation.id;

    const snapshot = quotation.lead || quotation.leadSnapshot;
    assert(snapshot?.resellerId === resellerId, "Quotation snapshot should include resellerId");
    assert(
      snapshot?.reseller?.invoiceEmail === `billing-${marker}@reseller.test`,
      "Quotation snapshot should freeze reseller billing email",
    );

    const outboundFromSnapshot = resolveOutboundRecipients(snapshot);
    assert(
      outboundFromSnapshot.to[0] === `billing-${marker}@reseller.test`,
      "Frozen quotation snapshot should route finance emails to reseller",
    );

    const snapshotBilling = resolveInvoiceBillingParty(snapshot);
    assert(
      snapshotBilling.companyName === `Reseller Smoke ${marker}`,
      "Quotation snapshot PDF bill-to should use reseller company",
    );
    assert(
      snapshotBilling.billingAddress === "1 Reseller Park",
      "Quotation snapshot PDF bill-to should use reseller address",
    );
    assert(
      snapshotBilling.taxNumber === resellerTaxNumber,
      "Quotation snapshot PDF bill-to should use reseller tax",
    );
    assert(
      snapshotBilling.serviceForCompanyName === `Customer ${marker}`,
      "Quotation snapshot PDF should show end customer as service-for",
    );

    console.log(
      "[smoke-test-reseller-invoice] OK — outbound routing, snapshots, and reseller PDF billing",
    );
  } finally {
    await cleanup({ leadId, quotationId, resellerId });
  }
}

main().catch((error) => {
  console.error("[smoke-test-reseller-invoice] FAILED:", error);
  process.exit(1);
});
