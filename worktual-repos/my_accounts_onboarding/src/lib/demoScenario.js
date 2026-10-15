import { INVOICE_MODES } from "./assignments.js";
import { CHANGE_TYPES } from "./activeProducts.js";
import { createId } from "./id.js";
import { buildModulesFromPlan } from "./ccaasModules.js";
import { createDefaultCcaasAddons, createDefaultUsageDetails } from "./ccaasConfiguration.js";
import { DEFAULT_PRICING_CATALOG } from "./pricingCatalogDefaults.js";
import { createLead, getLeadById, getLeads, HQ_BRANCH_ID, updateLead } from "./leads.js";

export const DEMO_SCENARIO_KEY = "multi-branch-retail";
export const DEMO_COMPANY_NAME = "Horizon Retail Group";

const BRANCH_MUMBAI_ID = "a1000001-0000-4000-8000-000000000001";
const BRANCH_CHENNAI_ID = "a1000002-0000-4000-8000-000000000002";

function demoContactCenterConfig() {
  const modules = buildModulesFromPlan("pro", DEFAULT_PRICING_CATALOG, "India");
  modules.digitalChannels = {
    optionId: "ai-auto-attendant-live",
    price: "15000",
  };
  modules.dashboard = { optionId: "dynamic", price: "5000" };

  return {
    productId: "contact-center",
    pricingMode: "ccaas",
    licenseTier: "pro",
    modules,
    usageDetails: {
      ...createDefaultUsageDetails(),
      agentCount: "5",
      smsCount: "10000",
      emailCount: "5000",
    },
    addons: {
      ...createDefaultCcaasAddons(),
      sessionBundle: "1000",
      sessionCount: "1000",
      sessionPrice: "27000",
      multilingualOption: "addon",
      multilingualPrice: "5000",
    },
    billingCycle: "monthly",
    region: "India",
    currency: "INR",
    taxLabel: "GST",
    discountType: "percentage",
    discountValue: "",
  };
}

function demoCdpConfig() {
  return {
    productId: "cdp",
    pricingMode: "cdp",
    platformEnabled: true,
    billingCycle: "monthly",
    region: "India",
    currency: "INR",
    taxLabel: "GST",
    monthlyBasePrice: "7650000",
    customerProfiles: "250000",
    dataSources: "6",
    pricingNotes: "Deployed at Mumbai; billed to head office.",
    discountType: "percentage",
    discountValue: "5",
  };
}

function demoValueManagementConfig() {
  return {
    productId: "value-management",
    pricingMode: "value-management",
    subscriptionEnabled: true,
    implementationEnabled: true,
    billingCycle: "monthly",
    region: "India",
    currency: "INR",
    taxLabel: "GST",
    implementationFee: "560000",
    monthlyBasePrice: "100000",
    monthlyActiveUsers: "75000",
    discountType: "percentage",
    discountValue: "",
  };
}

function buildDemoProductDraft() {
  return {
    selectedProductIds: ["contact-center", "cdp", "value-management"],
    invoiceMode: INVOICE_MODES.PER_BRANCH,
    stage: "assign-branches",
    assignments: [
      {
        id: createId(),
        productId: "contact-center",
        branchId: BRANCH_MUMBAI_ID,
        billingTargetId: BRANCH_MUMBAI_ID,
        changeType: CHANGE_TYPES.NEW,
        config: demoContactCenterConfig(),
      },
      {
        id: createId(),
        productId: "cdp",
        branchId: BRANCH_MUMBAI_ID,
        billingTargetId: BRANCH_MUMBAI_ID,
        changeType: CHANGE_TYPES.NEW,
        config: demoCdpConfig(),
      },
      {
        id: createId(),
        productId: "value-management",
        branchId: BRANCH_CHENNAI_ID,
        billingTargetId: BRANCH_CHENNAI_ID,
        changeType: CHANGE_TYPES.NEW,
        config: demoValueManagementConfig(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function buildDemoLeadPayload() {
  return {
    companyName: DEMO_COMPANY_NAME,
    industryType: "Retail & E-commerce",
    contactName: "Priya Sharma",
    designation: "Head of Digital Operations",
    workEmail: "priya.sharma@horizonretail.demo",
    mobileCountryCode: "+91",
    mobileNumber: "9876543210",
    billingAddress:
      "Horizon Retail HQ, 12 MG Road, Bengaluru, Karnataka 560001, India",
    websiteUrl: "https://horizonretail.demo",
    additionalAddresses: [
      {
        id: BRANCH_MUMBAI_ID,
        label: "Mumbai Branch",
        address: "Unit 402, One BKC, Bandra Kurla Complex, Mumbai, Maharashtra 400051, India",
      },
      {
        id: BRANCH_CHENNAI_ID,
        label: "Chennai Branch",
        address: "Level 8, TIDEL Park, Taramani, Chennai, Tamil Nadu 600113, India",
      },
    ],
    adminEmail: "priya.sharma@horizonretail.demo",
    taxNumber: "29AABCH1234A1Z5",
  };
}

export async function findDemoLead() {
  const leads = await getLeads();
  return (
    leads.find(
      (lead) => lead.demoScenario === DEMO_SCENARIO_KEY || lead.companyName === DEMO_COMPANY_NAME,
    ) || null
  );
}

export async function loadMultiBranchDemoScenario() {
  const productDraft = buildDemoProductDraft();
  const existing = await findDemoLead();

  if (existing) {
    await updateLead(existing.id, {
      ...buildDemoLeadPayload(),
      productDraft,
      status: "Approved",
    });
    return getLeadById(existing.id);
  }

  const lead = await createLead(buildDemoLeadPayload());
  return updateLead(lead.id, {
    productDraft,
    status: "Approved",
  });
}

export function getDemoScenarioSummary() {
  return {
    company: DEMO_COMPANY_NAME,
    branches: ["Head office (Bengaluru)", "Mumbai Branch", "Chennai Branch"],
    assignments: [
      "Contact Center → Mumbai Branch (bill to Mumbai)",
      "CDP → Mumbai Branch (bill to Head office)",
      "Customer Value Management → Chennai Branch (bill to Chennai)",
    ],
  };
}
