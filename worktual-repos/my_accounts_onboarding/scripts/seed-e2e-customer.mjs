/**
 * @deprecated Legacy JSON/localStorage seed — use Postgres via API or scripts/smoke-test-db.mjs.
 * Seeds a returning-customer baseline for end-to-end GUI testing.
 * - Clears quotation queue and inserts one approved first purchase.
 * - Prints localStorage payload for the matching sales lead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quotationsFile = path.join(root, "server/data/quotations.json");

export const E2E_LEAD_ID = "e2e-horizon-retail-001";
const BRANCH_MUMBAI_ID = "a1000001-0000-4000-8000-000000000001";
const BRANCH_CHENNAI_ID = "a1000002-0000-4000-8000-000000000002";
const FIRST_QUOTATION_ID = "e2e-quotation-first-purchase";

const lead = {
  id: E2E_LEAD_ID,
  domainId: "4821",
  companyName: "Horizon Retail Group",
  industryType: "Retail & E-commerce",
  contactName: "Priya Sharma",
  designation: "Head of Digital Operations",
  workEmail: "priya.sharma@horizonretail.demo",
  mobileCountryCode: "+91",
  mobileNumber: "9876543210",
  secondaryMobileCountryCode: "+91",
  secondaryMobileNumber: "",
  billingAddress:
    "Horizon Retail HQ, 12 MG Road, Bengaluru, Karnataka 560001, India",
  websiteUrl: "https://horizonretail.demo",
  additionalAddresses: [
    {
      id: BRANCH_MUMBAI_ID,
      label: "Mumbai Branch",
      address:
        "Unit 402, One BKC, Bandra Kurla Complex, Mumbai, Maharashtra 400051, India",
    },
    {
      id: BRANCH_CHENNAI_ID,
      label: "Chennai Branch",
      address: "Level 8, TIDEL Park, Taramani, Chennai, Tamil Nadu 600113, India",
    },
  ],
  adminEmail: "priya.sharma@horizonretail.demo",
  taxNumber: "29AABCH1234A1Z5",
  status: "Approved",
  isActive: true,
  demoScenario: "e2e-returning-customer",
  productDraft: null,
  activeProducts: [
    {
      key: `contact-center:${BRANCH_MUMBAI_ID}`,
      productId: "contact-center",
      branchId: BRANCH_MUMBAI_ID,
      billingTargetId: BRANCH_MUMBAI_ID,
      changeType: "new",
      config: {
        productId: "contact-center",
        pricingMode: "ccaas",
        voiceEnabled: true,
        voiceMonthlyPrice: "55000",
        implementationPurchased: true,
        implementationEnabled: false,
        region: "India",
        currency: "INR",
      },
      implementationPurchased: true,
      priceLabel: "INR 55,000",
      approvedAt: "2026-06-01T10:00:00.000Z",
      quotationId: FIRST_QUOTATION_ID,
    },
    {
      key: `cdp:${BRANCH_MUMBAI_ID}`,
      productId: "cdp",
      branchId: BRANCH_MUMBAI_ID,
      billingTargetId: "hq",
      changeType: "new",
      config: {
        productId: "cdp",
        pricingMode: "cdp",
        platformEnabled: true,
        monthlyBasePrice: "7650000",
        region: "India",
        currency: "INR",
      },
      priceLabel: "INR 7,650,000",
      approvedAt: "2026-06-01T10:00:00.000Z",
      quotationId: FIRST_QUOTATION_ID,
    },
  ],
  createdAt: "2026-05-15T08:00:00.000Z",
  updatedAt: "2026-06-01T10:30:00.000Z",
};

const firstPurchaseQuotation = {
  id: FIRST_QUOTATION_ID,
  leadId: E2E_LEAD_ID,
  lead: {
    id: E2E_LEAD_ID,
    companyName: lead.companyName,
    contactName: lead.contactName,
    workEmail: lead.workEmail,
  },
  fileName: "Horizon-Retail-Group-initial-quote.pdf",
  pdfBase64: "",
  productSummary: [
    { productId: "contact-center", name: "Contact Center", priceLabel: "INR 55,000" },
    { productId: "cdp", name: "CDP", priceLabel: "INR 7,650,000" },
  ],
  assignments: [
    {
      id: "e2e-assignment-cc-mumbai",
      productId: "contact-center",
      branchId: BRANCH_MUMBAI_ID,
      billingTargetId: BRANCH_MUMBAI_ID,
      changeType: "new",
      config: lead.activeProducts[0].config,
    },
    {
      id: "e2e-assignment-cdp-mumbai",
      productId: "cdp",
      branchId: BRANCH_MUMBAI_ID,
      billingTargetId: "hq",
      changeType: "new",
      config: lead.activeProducts[1].config,
    },
  ],
  invoiceMode: "consolidated",
  branchSummary: null,
  invoices: [],
  submittedBy: "ajsworktual@gmail.com",
  submittedAt: "2026-06-01T09:45:00.000Z",
  status: "Approved",
  financeNote: "Initial purchase approved — voice + CDP at Mumbai.",
  reviewedAt: "2026-06-01T10:00:00.000Z",
  reviewedBy: "ajs3worktual@gmail.com",
};

fs.mkdirSync(path.dirname(quotationsFile), { recursive: true });
fs.writeFileSync(quotationsFile, JSON.stringify([firstPurchaseQuotation], null, 2), "utf8");

console.log("Seeded approved first purchase quotation:", FIRST_QUOTATION_ID);
console.log("Lead ID for browser localStorage:", E2E_LEAD_ID);
console.log("---LOCALSTORAGE_LEAD_JSON---");
console.log(JSON.stringify([lead]));
