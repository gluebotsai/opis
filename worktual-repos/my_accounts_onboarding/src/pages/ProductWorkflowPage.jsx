import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Crown,
  Database,
  Headphones,
  Megaphone,
  Ticket,
  Trash2,
  UserRoundCog,
} from "lucide-react";

import { InvoiceReviewModal } from "../components/InvoiceReviewModal.jsx";
import {
  assignmentDisplayLabel,
  buildBranchSummary,
  buildProductSummary,
  createAssignment,
  createAssignmentsForProducts,
  INVOICE_MODES,
  normalizeAssignmentsBilling,
  requiresPerBranchInvoicing,
  resolveInvoiceMode,
  validateInvoiceModeForAssignments,
} from "../lib/assignments.js";
import {
  CHANGE_TYPE_OPTIONS,
  CHANGE_TYPES,
  findActiveProductByKey,
  findDuplicateNewPurchase,
  getActiveAtBranch,
  getActiveProducts,
  getChangeTypeLabel,
  getImplementationPurchaseNote,
  getProductCardStatus,
  inferDefaultChangeType,
  isProductActiveAnywhere,
  normalizeProductKeyParam,
  suggestChangeTypeFromPrices,
  applyPurchaseHistoryToConfig,
} from "../lib/activeProducts.js";
import { buildQuotationInvoice, computeQuotationPaymentTotals } from "../lib/invoice.js";
import { CCAAS_PLANS, getCcaasPlanLabel } from "../lib/ccaasPlans.js";
import {
  buildModulesFromPlan,
  clampModulesToLicenseTier,
  getModuleOptionPrice,
  hasAnyActiveModule,
  modulesAreComplete,
  NONE_OPTION_ID,
  sumModulePrices,
} from "../lib/ccaasModules.js";
import { getPlanModuleRows, resolvePlanModuleKey } from "../lib/planModules.js";
import {
  CCAAS_MULTILINGUAL_ADDON_OPTIONS,
  applyTierDefaultVolumes,
  createDefaultCcaasAddons,
  createDefaultUsageDetails,
  formatSessionBundleLabel,
  getConfigurationSummary,
  getCcaasConfigurationFields,
  getMultilingualCatalogPrice,
  getUsageDetailDisplayValue,
  normalizeUsageDetailValue,
  sumCcaasAddonPrices,
} from "../lib/ccaasConfiguration.js";
import { getPricingRegionForCountry } from "../lib/countryDefaults.js";
import { fetchPricingCatalog, getCachedPricingCatalog, setCachedPricingCatalog } from "../lib/pricingCatalog.js";
import {
  applyCatalogFeatureDefaults,
  createInitialConfigFromCatalog,
  getAdditionalMinuteBundlePlans,
  getChatbotBundleDefaults,
  getContactChargeSlabs,
  getRegionDefaults,
  getTicketSlabs,
} from "../lib/pricingRuntime.js";
import { isFeatureEnabled } from "../lib/pricingFeatures.js";
import {
  clearProductDraft,
  formatBranchOptionLabel,
  getBranchCountry,
  getLeadBranches,
  getLeadById,
  leadHasMultipleBranches,
  saveProductDraft,
} from "../lib/leads.js";
import { saveQuoteSession } from "../lib/quoteSession.js";
import {
  createCustomerProductRequest,
  deriveRequestType,
} from "../lib/customerProductRequests.js";
import { getCustomerSession } from "../lib/customerAuth.js";
import companyLogo from "../../image.png";

const currencyByRegion = {
  India: "INR",
  UK: "GBP",
  Dubai: "AED",
};

const taxLabelByRegion = {
  India: "GST",
  UK: "VAT",
  Dubai: "VAT",
};

const paidLanguageOptions = ["Tamil", "Telugu", "Kannada", "Malayalam", "Hindi"];

const FEATURE_TOGGLE_FIELDS = new Set([
  "voiceEnabled",
  "chatbotEnabled",
  "liveAgentEnabled",
  "usersEnabled",
  "implementationEnabled",
  "platformEnabled",
  "basePlanEnabled",
  "channelsEnabled",
  "subscriptionEnabled",
]);

const products = [
  {
    id: "contact-center",
    name: "AI - Native Contact Center as a Service",
    description:
      "Deliver intelligent support with AI-powered automation and seamless customer interactions.",
    icon: Headphones,
    pricingBasis: "Voice minutes, chatbot sessions, live agents, telco charges, languages",
    usageLabel: "Committed package",
    usagePlaceholder: "Example: 3000 minutes + 1000 sessions + 5 agents",
    notes: [
      "India sheet includes voice minutes, chatbot sessions, additional minutes, additional sessions, live agent, telco and language setup charges.",
      "UK and Dubai pricing use regional currencies and separate minute/session/agent bundles.",
    ],
  },
  {
    id: "crm",
    name: "AI Native CRM",
    description: "Manage relationships smarter with AI-driven insights and automation.",
    icon: UserRoundCog,
    pricingBasis: "Implementation cost, user license, contact slabs",
    usageLabel: "Users / contacts",
    usagePlaceholder: "Example: 25 users, 50,000 contacts",
    notes: [
      "Sheet references implementation cost, monthly user license, and additional contact charges.",
    ],
  },
  {
    id: "cdp",
    name: "Cognitive Customer Data Platform (CDP)",
    description: "Unify customer data from all sources and create real-time customer profiles.",
    icon: Database,
    pricingBasis: "Customer profiles and data sources",
    usageLabel: "Profiles / data sources",
    usagePlaceholder: "Example: 100,000 profiles, 4 data sources",
    notes: ["Sheet says charges depend on customer profiles and connected data sources."],
  },
  {
    id: "campaign",
    name: "AI Native Campaign Management",
    description: "Create, execute, and optimize campaigns with AI-driven intelligence.",
    icon: Megaphone,
    pricingBasis: "Contacts plus channel-wise usage",
    usageLabel: "Contacts / channels",
    usagePlaceholder: "Example: 50,000 contacts, email + SMS + WhatsApp",
    notes: [
      "Sheet includes base monthly plan with 50k contacts and channel usage for email, SMS, WhatsApp, web push, app push, and in-app campaigns.",
    ],
  },
  {
    id: "value-management",
    name: "AI Native Customer Value Management",
    description: "Maximize customer lifetime value with predictive insights and engagement.",
    icon: Crown,
    pricingBasis: "Implementation fee and monthly active users",
    usageLabel: "Monthly active users",
    usagePlaceholder: "Example: 100,000 MAU",
    notes: ["Sheet references implementation fee and pricing for monthly active users."],
  },
  {
    id: "ticketing",
    name: "AI Native Ticketing System",
    description: "Automate ticket management and resolution with AI intelligence.",
    icon: Ticket,
    pricingBasis: "User license and included ticket volume",
    usageLabel: "Users / tickets",
    usagePlaceholder: "Example: 15 users, 2,000 included tickets",
    notes: [
      "Sheet includes monthly user pricing with included tickets and additional ticket bundles.",
    ],
  },
];

function createGenericInitialConfig(product, region = "India") {
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "generic",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    basePrice: "",
    setupFee: "",
    discountType: "percentage",
    discountValue: "",
    billingCycle: "monthly",
    usagePackage: "",
    pricingNotes: product.notes.join("\n"),
  };
}

function buildInitialConfigForBranch(lead, branchId) {
  const region = getPricingRegionForCountry(getBranchCountry(lead, branchId));
  return (product) =>
    createInitialConfigFromCatalog(product, region) ?? createGenericInitialConfig(product, region);
}

function applyFeatureToggle(config, field, enabled) {
  return applyCatalogFeatureDefaults(config, field, enabled);
}

const productPricingRegistry = {
  "contact-center": {
    isConfigured: isCcaasConfigured,
    getPrice: (config) => calculateCcaasPricing(config).finalMonthlyTotal,
  },
  crm: {
    isConfigured: isCrmConfigured,
    getPrice: (config) => calculateCrmPricing(config).finalMonthlyTotal,
  },
  cdp: {
    isConfigured: (config) =>
      isFeatureEnabled(config, "platformEnabled") && Boolean(config.monthlyBasePrice),
    getPrice: (config) => calculateSimpleProductPricing(config).finalMonthlyTotal,
  },
  campaign: {
    isConfigured: isCampaignConfigured,
    getPrice: (config) => calculateCampaignPricing(config).finalMonthlyTotal,
  },
  "value-management": {
    isConfigured: isValueManagementConfigured,
    getPrice: (config) => calculateValueManagementPricing(config).finalMonthlyTotal,
  },
  ticketing: {
    isConfigured: isTicketingConfigured,
    getPrice: (config) => calculateTicketingPricing(config).finalMonthlyTotal,
  },
};

function getChatbotSessionCount(config) {
  if (config.chatbotBundle === "none") {
    return 0;
  }

  if (config.chatbotBundle === "custom") {
    return toNumber(config.customChatbotSessions);
  }

  return toNumber(config.chatbotBundle);
}

function syncChatbotMonthlyPrice(config) {
  if (config.chatbotBundle === "none") {
    config.chatbotMonthlyPrice = "0";
    config.chatbotPerSessionRate = "0";
    return config;
  }

  const sessions = getChatbotSessionCount(config);
  const rate = toNumber(config.chatbotPerSessionRate);

  if (sessions > 0 && rate >= 0) {
    config.chatbotMonthlyPrice = String(sessions * rate);
  }

  return config;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPricingFieldLabel(label = "") {
  return /\b(price|rate|cost|fee|discount|setup)\b/i.test(label);
}

function formatSessionBundleLabelForCustomer(bundleKey, bundleDefaults) {
  if (!bundleDefaults) {
    return `${bundleKey} sessions`;
  }

  return `${Number(bundleKey).toLocaleString()} sessions`;
}

function calculateDiscount(config, amount) {
  const discountValue = toNumber(config.discountValue);

  if (config.discountType === "fixed") {
    return Math.min(discountValue, amount);
  }

  return Math.min(amount * (discountValue / 100), amount);
}

function calculateGenericNetPrice(config) {
  const basePrice = toNumber(config.basePrice);
  return Math.max(basePrice - calculateDiscount(config, basePrice), 0);
}

function calculateGenericPricing(config) {
  const baseMonthlyTotal = toNumber(config.basePrice);
  const setupTotal = toNumber(config.setupFee);
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const finalMonthlyTotal = Math.max(baseMonthlyTotal - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal: 0,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
  };
}

function calculateCcaasPricing(config) {
  const agentCount = Math.max(1, toNumber(config.usageDetails?.agentCount) || 0);
  const baseMonthlyTotal = sumModulePrices(config.modules, { agentCount });
  const additionalUsageTotal = sumCcaasAddonPrices(config);
  const setupTotal = 0;
  const monthlyBeforeDiscount = baseMonthlyTotal + additionalUsageTotal;
  const discountAmount = calculateDiscount(config, monthlyBeforeDiscount);
  const finalMonthlyTotal = Math.max(monthlyBeforeDiscount - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
  };
}

function calculateSimpleProductPricing(config) {
  const baseMonthlyTotal = isFeatureEnabled(config, "platformEnabled")
    ? toNumber(config.monthlyBasePrice)
    : 0;
  const setupTotal = toNumber(config.setupFee);
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const finalMonthlyTotal = Math.max(baseMonthlyTotal - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal: 0,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
  };
}

function calculateCrmPricing(config) {
  const baseMonthlyTotal = isFeatureEnabled(config, "usersEnabled")
    ? toNumber(config.userCount) * toNumber(config.userLicenseRate)
    : 0;
  const additionalUsageTotal = config.additionalContactsEnabled && config.additionalContactSlab
    ? toNumber(getContactChargeSlabs(config.region)[config.additionalContactSlab]?.monthlyPrice)
    : 0;
  const setupTotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationCost)
    : 0;
  const monthlyBeforeDiscount = baseMonthlyTotal + additionalUsageTotal;
  const discountAmount = calculateDiscount(config, monthlyBeforeDiscount);
  const finalMonthlyTotal = Math.max(monthlyBeforeDiscount - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
  };
}

function calculateCampaignPricing(config) {
  const baseMonthlyTotal = isFeatureEnabled(config, "basePlanEnabled")
    ? toNumber(config.monthlyBasePrice)
    : 0;
  const channelUsageTotal = isFeatureEnabled(config, "channelsEnabled")
    ? toNumber(config.emailCount) * toNumber(config.emailRate) +
      toNumber(config.smsCount) * toNumber(config.smsRate) +
      toNumber(config.whatsappCredits) * toNumber(config.whatsappRate) +
      toNumber(config.webPushSubscribers) * toNumber(config.webPushRate) +
      toNumber(config.appPushSubscribers) * toNumber(config.appPushRate) +
      toNumber(config.inAppSubscribers) * toNumber(config.inAppRate)
    : 0;
  const additionalContacts =
    config.additionalContactsEnabled && config.additionalContactSlab
      ? toNumber(getContactChargeSlabs(config.region)[config.additionalContactSlab]?.monthlyPrice)
      : 0;
  const additionalUsageTotal = channelUsageTotal + additionalContacts;
  const monthlyBeforeDiscount = baseMonthlyTotal + additionalUsageTotal;
  const discountAmount = calculateDiscount(config, monthlyBeforeDiscount);
  const finalMonthlyTotal = Math.max(monthlyBeforeDiscount - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal: 0,
    additionalUsageTotal,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal,
  };
}

function calculateValueManagementPricing(config) {
  const baseMonthlyTotal = isFeatureEnabled(config, "subscriptionEnabled")
    ? toNumber(config.monthlyBasePrice)
    : 0;
  const setupTotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const finalMonthlyTotal = Math.max(baseMonthlyTotal - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal: 0,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
  };
}

function calculateTicketingPricing(config) {
  const baseMonthlyTotal = isFeatureEnabled(config, "usersEnabled")
    ? toNumber(config.userCount) * toNumber(config.userLicenseRate)
    : 0;
  const additionalUsageTotal = config.additionalTicketsEnabled && config.additionalTicketSlab
    ? toNumber(getTicketSlabs(config.region)[config.additionalTicketSlab]?.monthlyPrice)
    : 0;
  const monthlyBeforeDiscount = baseMonthlyTotal + additionalUsageTotal;
  const discountAmount = calculateDiscount(config, monthlyBeforeDiscount);
  const finalMonthlyTotal = Math.max(monthlyBeforeDiscount - discountAmount, 0);

  return {
    baseMonthlyTotal,
    setupTotal: 0,
    additionalUsageTotal,
    discountAmount,
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal,
  };
}

function getBillingMultiplier(billingCycle) {
  return billingCycle === "yearly" ? 12 : 1;
}

function applyBillingCycle(amount, billingCycle) {
  return amount * getBillingMultiplier(billingCycle);
}

function getConfiguredPrice(config) {
  const productHandler = productPricingRegistry[config.productId];
  const monthlyPrice = productHandler
    ? productHandler.getPrice(config)
    : calculateGenericNetPrice(config);

  return applyBillingCycle(monthlyPrice, config.billingCycle);
}

function getAssignmentPayableTotal(config) {
  if (!config) {
    return 0;
  }

  return getPricingTotals(config).finalPayableEstimate;
}

function canCreateQuotationInvoice(assignments, { metricsOnly = false } = {}) {
  if (!assignments.length) {
    return false;
  }

  if (metricsOnly) {
    return assignments.every((entry) => isProductConfigured(entry.config, { metricsOnly: true }));
  }

  return assignments.some((entry) => getAssignmentPayableTotal(entry.config) > 0);
}

function getPricingTotals(config) {
  let totals;
  if (config.pricingMode === "ccaas") {
    totals = calculateCcaasPricing(config);
  } else if (config.pricingMode === "crm") {
    totals = calculateCrmPricing(config);
  } else if (config.pricingMode === "cdp") {
    totals = calculateSimpleProductPricing(config);
  } else if (config.pricingMode === "campaign") {
    totals = calculateCampaignPricing(config);
  } else if (config.pricingMode === "value-management") {
    totals = calculateValueManagementPricing(config);
  } else if (config.pricingMode === "ticketing") {
    totals = calculateTicketingPricing(config);
  } else {
    totals = calculateGenericPricing(config);
  }

  const multiplier = getBillingMultiplier(config.billingCycle);
  const billingLabel = config.billingCycle === "yearly" ? "Yearly" : "Monthly";

  if (multiplier === 1) {
    return { ...totals, billingLabel };
  }

  return {
    baseMonthlyTotal: totals.baseMonthlyTotal * multiplier,
    setupTotal: totals.setupTotal,
    additionalUsageTotal: totals.additionalUsageTotal * multiplier,
    discountAmount: totals.discountAmount * multiplier,
    finalMonthlyTotal: totals.finalMonthlyTotal * multiplier,
    finalPayableEstimate: totals.finalPayableEstimate * multiplier,
    billingLabel,
  };
}

function isCcaasConfigured(config) {
  if (!config.licenseTier) {
    return false;
  }

  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";

  if (!modulesAreComplete(config.modules, config.licenseTier, catalog, region)) {
    return false;
  }

  return hasAnyActiveModule(config.modules, config.licenseTier, catalog, region);
}

function isCrmConfigured(config) {
  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const implOn = isFeatureEnabled(config, "implementationEnabled") && !config.implementationPurchased;
  const contactsOn = config.additionalContactsEnabled;

  if (!usersOn && !implOn && !contactsOn) {
    return false;
  }

  if (usersOn && !(config.userCount && config.userLicenseRate)) {
    return false;
  }

  return true;
}

function isCampaignConfigured(config) {
  const baseOn = isFeatureEnabled(config, "basePlanEnabled");
  const channelsOn = isFeatureEnabled(config, "channelsEnabled");
  const contactsOn = config.additionalContactsEnabled;

  if (!baseOn && !channelsOn && !contactsOn) {
    return false;
  }

  if (baseOn && !config.monthlyBasePrice) {
    return false;
  }

  if (channelsOn && !config.emailCount) {
    return false;
  }

  return true;
}

function isValueManagementConfigured(config) {
  const subOn = isFeatureEnabled(config, "subscriptionEnabled");
  const implOn = isFeatureEnabled(config, "implementationEnabled") && !config.implementationPurchased;

  if (!subOn && !implOn) {
    return false;
  }

  if (subOn && !config.monthlyBasePrice) {
    return false;
  }

  return true;
}

function isTicketingConfigured(config) {
  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const ticketsOn = config.additionalTicketsEnabled;

  if (!usersOn && !ticketsOn) {
    return false;
  }

  if (usersOn && !(config.userCount && config.userLicenseRate)) {
    return false;
  }

  return true;
}

function isCrmConfiguredMetrics(config) {
  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const contactsOn = config.additionalContactsEnabled;

  if (!usersOn && !contactsOn) {
    return false;
  }

  if (usersOn && !config.userCount) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  return true;
}

function isCampaignConfiguredMetrics(config) {
  const baseOn = isFeatureEnabled(config, "basePlanEnabled");
  const channelsOn = isFeatureEnabled(config, "channelsEnabled");
  const contactsOn = config.additionalContactsEnabled;

  if (!baseOn && !channelsOn && !contactsOn) {
    return false;
  }

  if (baseOn && !config.includedContacts) {
    return false;
  }

  if (
    channelsOn &&
    !(
      config.emailCount ||
      config.smsCount ||
      config.whatsappCredits ||
      config.webPushSubscribers ||
      config.appPushSubscribers ||
      config.inAppSubscribers
    )
  ) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  return true;
}

function isValueManagementConfiguredMetrics(config) {
  const subOn = isFeatureEnabled(config, "subscriptionEnabled");

  if (!subOn) {
    return false;
  }

  return Boolean(config.monthlyActiveUsers);
}

function isTicketingConfiguredMetrics(config) {
  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const ticketsOn = config.additionalTicketsEnabled;

  if (!usersOn && !ticketsOn) {
    return false;
  }

  if (usersOn && !config.userCount) {
    return false;
  }

  if (ticketsOn && !config.additionalTicketSlab) {
    return false;
  }

  return true;
}

function isCdpConfiguredMetrics(config) {
  if (!isFeatureEnabled(config, "platformEnabled")) {
    return false;
  }

  return Boolean(config.customerProfiles || config.dataSources);
}

function isProductConfigured(config, { metricsOnly = false } = {}) {
  if (metricsOnly) {
    if (config.pricingMode === "ccaas") {
      return isCcaasConfigured(config);
    }

    if (config.pricingMode === "crm") {
      return isCrmConfiguredMetrics(config);
    }

    if (config.pricingMode === "cdp") {
      return isCdpConfiguredMetrics(config);
    }

    if (config.pricingMode === "campaign") {
      return isCampaignConfiguredMetrics(config);
    }

    if (config.pricingMode === "value-management") {
      return isValueManagementConfiguredMetrics(config);
    }

    if (config.pricingMode === "ticketing") {
      return isTicketingConfiguredMetrics(config);
    }

    return Boolean(config.usagePackage);
  }

  const productHandler = productPricingRegistry[config.productId];

  return productHandler ? productHandler.isConfigured(config) : Boolean(config.basePrice);
}

export function ProductWorkflowPage({
  workflowMode = "sales",
  embeddedLead = null,
  cancelPath = null,
  requestIntent = "all",
  preselectedProductKey = "",
  customerBranchId = null,
} = {}) {
  const { leadId: routeLeadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isCustomerRequest = workflowMode === "customer";
  const leadId = isCustomerRequest ? embeddedLead?.id : routeLeadId;
  const exitPath = cancelPath || (isCustomerRequest ? "/customer/products" : `/products/${leadId}`);
  const [lead, setLead] = useState(isCustomerRequest ? embeddedLead : null);
  const [leadLoading, setLeadLoading] = useState(true);
  const branches = useMemo(() => {
    const all = getLeadBranches(lead);
    if (!customerBranchId) {
      return all;
    }

    return all.filter((branch) => branch.id === customerBranchId);
  }, [customerBranchId, lead]);
  const multipleBranches = !customerBranchId && leadHasMultipleBranches(lead);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [stage, setStage] = useState("select");
  const [assignments, setAssignments] = useState([]);
  const [activeAssignmentIndex, setActiveAssignmentIndex] = useState(0);
  const [invoiceMode, setInvoiceMode] = useState(INVOICE_MODES.CONSOLIDATED);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState("");
  const [invoiceFileName, setInvoiceFileName] = useState("");
  const [invoicePdfBase64, setInvoicePdfBase64] = useState("");
  const [invoicePreviews, setInvoicePreviews] = useState([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [configError, setConfigError] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [, setPricingCatalogVersion] = useState(0);
  const workflowInitializedRef = useRef(false);
  const suppressDraftRestoreRef = useRef(false);

  useEffect(() => {
    workflowInitializedRef.current = false;
    suppressDraftRestoreRef.current = false;
  }, [leadId]);

  useEffect(() => {
    if (isCustomerRequest) {
      setLead(embeddedLead);
      setLeadLoading(false);
      return undefined;
    }

    let cancelled = false;

    getLeadById(routeLeadId).then((loadedLead) => {
      if (!cancelled) {
        setLead(loadedLead);
        setLeadLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [embeddedLead, isCustomerRequest, routeLeadId]);

  useEffect(() => {
    let cancelled = false;

    fetchPricingCatalog().then((catalog) => {
      if (cancelled) {
        return;
      }
      setCachedPricingCatalog(catalog);
      setPricingCatalogVersion((current) => current + 1);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function normalizeAssignmentsWithPurchaseHistory(nextAssignments) {
    const billingNormalized = normalizeAssignmentsBilling(nextAssignments);

    if (!lead?.activeProducts?.length) {
      return billingNormalized;
    }

    return billingNormalized.map((assignment) => ({
      ...assignment,
      config: applyPurchaseHistoryToConfig(assignment.config, lead, assignment.productId),
    }));
  }

  useEffect(() => {
    if (!lead || workflowInitializedRef.current || !isCustomerRequest) {
      return;
    }

    if (requestIntent === "upgrade" && preselectedProductKey) {
      const activeProducts = getActiveProducts(lead);
      const existing = findActiveProductByKey(
        activeProducts,
        normalizeProductKeyParam(preselectedProductKey),
      );

      if (existing) {
        workflowInitializedRef.current = true;
        setSelectedProductIds([existing.productId]);
        setAssignments(
          normalizeAssignmentsWithPurchaseHistory([
            createAssignment(
              existing.productId,
              existing.branchId,
              existing.billingTargetId || existing.branchId,
              { ...(existing.config || {}) },
              CHANGE_TYPES.UPGRADE,
            ),
          ]),
        );
        setStage("configure");
        setActiveAssignmentIndex(0);
        return;
      }
    }

    if (requestIntent === "new") {
      workflowInitializedRef.current = true;
    }
  }, [isCustomerRequest, lead, preselectedProductKey, requestIntent]);

  useEffect(() => {
    if (!lead || workflowInitializedRef.current || isCustomerRequest) {
      return;
    }

    workflowInitializedRef.current = true;

    if (location.state?.freshQuote) {
      suppressDraftRestoreRef.current = true;
      setSelectedProductIds([]);
      setAssignments([]);
      setStage("select");
      setActiveAssignmentIndex(0);
      setConfigError("");
      navigate(location.pathname, { replace: true, state: {} });
      void clearProductDraft(leadId);
      return;
    }

    if (suppressDraftRestoreRef.current) {
      return;
    }

    const draft = lead.productDraft;
    if (!draft?.assignments?.length) {
      return;
    }

    setAssignments(normalizeAssignmentsWithPurchaseHistory(draft.assignments));
    setInvoiceMode(draft.invoiceMode || INVOICE_MODES.CONSOLIDATED);
    setSelectedProductIds(draft.selectedProductIds || []);
    setActiveAssignmentIndex(0);
    setStage(draft.stage || (multipleBranches ? "assign-branches" : "configure"));
  }, [lead, leadId, location.pathname, location.state?.freshQuote, multipleBranches, navigate]);

  const activeAssignment = assignments[activeAssignmentIndex] ?? assignments[0];
  const activeProduct = activeAssignment
    ? products.find((product) => product.id === activeAssignment.productId)
    : null;
  const activeConfig = activeAssignment?.config ?? null;
  const visibleProducts = useMemo(() => {
    if (!isCustomerRequest || !lead) {
      return products;
    }

    if (requestIntent === "new") {
      return products.filter((product) => !isProductActiveAnywhere(lead, product.id));
    }

    if (requestIntent === "upgrade") {
      return products.filter((product) => isProductActiveAnywhere(lead, product.id));
    }

    return products;
  }, [isCustomerRequest, lead, requestIntent]);
  const allSelected = selectedProductIds.length === visibleProducts.length;
  const configuredCount = assignments.filter((entry) =>
    isProductConfigured(entry.config, { metricsOnly: isCustomerRequest }),
  ).length;
  const canCreateInvoice = useMemo(
    () => canCreateQuotationInvoice(assignments, { metricsOnly: isCustomerRequest }),
    [assignments, isCustomerRequest],
  );
  const perBranchInvoicingRequired = useMemo(
    () => requiresPerBranchInvoicing(assignments, lead),
    [assignments, lead],
  );
  const effectiveInvoiceMode = useMemo(
    () => resolveInvoiceMode(assignments, lead, invoiceMode),
    [assignments, lead, invoiceMode],
  );

  useEffect(() => {
    if (perBranchInvoicingRequired && invoiceMode !== INVOICE_MODES.PER_BRANCH) {
      setInvoiceMode(INVOICE_MODES.PER_BRANCH);
    }
  }, [perBranchInvoicingRequired, invoiceMode]);

  function toggleProduct(productId) {
    if (stage !== "select") {
      return;
    }

    setSelectedProductIds((current) => {
      if (current.includes(productId)) {
        return current.filter((id) => id !== productId);
      }

      return [...current, productId];
    });
  }

  function selectAllProducts() {
    if (stage !== "select") {
      return;
    }

    setSelectedProductIds((current) =>
      current.length === visibleProducts.length ? [] : visibleProducts.map((product) => product.id),
    );
  }

  function updateActiveConfig(field, value) {
    if (!activeAssignment) {
      return;
    }

    setAssignments((current) =>
      current.map((entry, index) => {
        if (index !== activeAssignmentIndex) {
          return entry;
        }

        const nextConfig = {
          ...entry.config,
          [field]: value,
        };

        if (FEATURE_TOGGLE_FIELDS.has(field) && typeof value === "boolean") {
          if (field === "implementationEnabled" && entry.config.implementationPurchased) {
            return entry;
          }

          return {
            ...entry,
            config: applyFeatureToggle(entry.config, field, value),
          };
        }

      if (field === "region") {
        nextConfig.currency = currencyByRegion[value];
        if ("taxLabel" in nextConfig) {
          nextConfig.taxLabel = taxLabelByRegion[value];
        }
      }

      if (field === "licenseTier" && entry.config.pricingMode === "ccaas") {
        nextConfig.licenseTier = value;
        if (value) {
          const catalog = getCachedPricingCatalog();
          const region = nextConfig.region || "India";
          nextConfig.modules = clampModulesToLicenseTier(
            buildModulesFromPlan(value, catalog, region),
            value,
            catalog,
            region,
          );
          nextConfig.usageDetails = applyTierDefaultVolumes(
            nextConfig.usageDetails || createDefaultUsageDetails(),
            value,
            catalog.products?.["contact-center"]?.tierDefaultVolumes,
          );
        } else {
          nextConfig.modules = {};
          nextConfig.usageDetails = createDefaultUsageDetails();
        }
      }

      if (field === "usageDetails" && entry.config.pricingMode === "ccaas" && entry.config.licenseTier) {
        const catalog = getCachedPricingCatalog();
        const previousAgentCount = entry.config.usageDetails?.agentCount;
        nextConfig.usageDetails = value;
        if (value?.agentCount !== previousAgentCount) {
          nextConfig.usageDetails = applyTierDefaultVolumes(
            value,
            entry.config.licenseTier,
            catalog.products?.["contact-center"]?.tierDefaultVolumes,
          );
        }
      }

      if (field === "modules" && value && typeof value === "object") {
        nextConfig.modules = value;
      }

      if (field === "liveAgentPlan") {
        if (value === "none") {
          nextConfig.liveAgentCount = "";
          nextConfig.additionalLiveAgentsEnabled = false;
        }
      }

      if (field === "chatbotBundle") {
        if (value === "none") {
          nextConfig.chatbotMonthlyPrice = "0";
          nextConfig.chatbotPerSessionRate = "0";
          nextConfig.customChatbotSessions = "";
          nextConfig.additionalSessionsEnabled = false;
        } else {
          const bundleDefaults = getChatbotBundleDefaults(nextConfig.region || config.region)[value];
          nextConfig.customChatbotSessions = value === "custom" ? nextConfig.customChatbotSessions : "";

          if (bundleDefaults) {
            nextConfig.chatbotMonthlyPrice = bundleDefaults.monthlyPrice;
            nextConfig.chatbotPerSessionRate = bundleDefaults.perSessionRate;
            nextConfig.additionalSessionRate = bundleDefaults.additionalSessionRate;
          } else if (value === "custom") {
            syncChatbotMonthlyPrice(nextConfig);
          }
        }
      }

      if (field === "customChatbotSessions") {
        if (value) {
          nextConfig.chatbotBundle = "custom";
        }
        syncChatbotMonthlyPrice(nextConfig);
      }

      if (field === "chatbotPerSessionRate") {
        syncChatbotMonthlyPrice(nextConfig);
      }

      if (field === "chatChannels" && value && typeof value === "object") {
        nextConfig.chatChannels = value;
      }

      if (field === "additionalMinutePlan") {
        const plan = getAdditionalMinuteBundlePlans(nextConfig.region || config.region)[value];
        if (plan) {
          nextConfig.additionalMinuteRate = plan.rate;
        } else {
          nextConfig.additionalMinuteQuantity = "";
          nextConfig.additionalMinuteRate = "";
        }
      }

      if (field === "additionalContactSlab") {
        nextConfig.additionalContactRate = getContactChargeSlabs(nextConfig.region || config.region)[value]?.perContactRate ?? "";
      }

      if (field === "additionalTicketSlab") {
        nextConfig.additionalTicketRate = getTicketSlabs(nextConfig.region || config.region)[value]?.perTicketRate ?? "";
      }

        let changeType = entry.changeType;
        if (lead) {
          const existing = getActiveAtBranch(lead, entry.productId, entry.branchId);
          if (existing?.config) {
            changeType = suggestChangeTypeFromPrices(
              getConfiguredPrice(existing.config),
              getConfiguredPrice(nextConfig),
            );
          }
        }

        return {
          ...entry,
          changeType,
          config: nextConfig,
        };
      }),
    );
  }

  function updateAssignmentField(assignmentId, field, value) {
    setAssignments((current) =>
      current.map((entry) => {
        if (entry.id !== assignmentId) {
          return entry;
        }

        const next = { ...entry, [field]: value };

        if (field === "branchId") {
          next.billingTargetId = value;
          next.changeType = inferDefaultChangeType(lead, entry.productId, value);
          const existing = getActiveAtBranch(lead, entry.productId, value);
          if (existing?.config && next.changeType !== CHANGE_TYPES.NEW) {
            next.config = applyPurchaseHistoryToConfig({ ...existing.config }, lead, entry.productId);
          } else if (next.changeType === CHANGE_TYPES.NEW) {
            const product = products.find((item) => item.id === entry.productId);
            if (product) {
              next.config = buildInitialConfigForBranch(lead, value)(product);
            }
          } else if (next.config) {
            next.config = applyPurchaseHistoryToConfig(next.config, lead, entry.productId);
          }
        }

        return next;
      }),
    );
  }

  function duplicateAssignment(assignmentId) {
    setAssignments((current) => {
      const source = current.find((entry) => entry.id === assignmentId);
      if (!source) {
        return current;
      }

      const product = products.find((entry) => entry.id === source.productId);
      const duplicate = createAssignment(
        source.productId,
        source.branchId,
        source.branchId,
        product ? buildInitialConfigForBranch(lead, source.branchId)(product) : source.config,
        inferDefaultChangeType(lead, source.productId, source.branchId),
      );

      const index = current.findIndex((entry) => entry.id === assignmentId);
      const next = [...current];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
  }

  function removeAssignments(assignmentIds) {
    if (!assignmentIds.length) {
      return;
    }

    setAssignments((current) => {
      const next = current.filter((entry) => !assignmentIds.includes(entry.id));
      const remainingProductIds = [...new Set(next.map((entry) => entry.productId))];

      setSelectedProductIds(remainingProductIds);
      setConfigError("");

      if (next.length === 0) {
        setStage("select");
        setActiveAssignmentIndex(0);
        return next;
      }

      const activeId = current[activeAssignmentIndex]?.id;
      if (activeId && !assignmentIds.includes(activeId)) {
        const newIndex = next.findIndex((entry) => entry.id === activeId);
        setActiveAssignmentIndex(Math.max(0, newIndex));
      } else {
        setActiveAssignmentIndex(Math.min(activeAssignmentIndex, next.length - 1));
      }

      return next;
    });
  }

  function draftMatchesSelection(draft, productIds) {
    const draftProductIds = draft?.selectedProductIds || [];
    if (draftProductIds.length !== productIds.length) {
      return false;
    }

    return draftProductIds.every((id) => productIds.includes(id));
  }

  function startConfiguration() {
    if (selectedProductIds.length === 0) {
      return;
    }

    const currentProductIds = [...new Set(assignments.map((entry) => entry.productId))].sort();
    const nextProductIds = [...selectedProductIds].sort();
    const selectionUnchanged =
      assignments.length > 0 &&
      currentProductIds.length === nextProductIds.length &&
      currentProductIds.every((id, index) => id === nextProductIds[index]);

    if (selectionUnchanged) {
      setActiveAssignmentIndex(0);
      setStage(multipleBranches ? "assign-branches" : "configure");
      return;
    }

    const draft = lead?.productDraft;
    if (draft?.assignments?.length && draftMatchesSelection(draft, selectedProductIds)) {
      setAssignments(normalizeAssignmentsWithPurchaseHistory(draft.assignments));
      setInvoiceMode(draft.invoiceMode || INVOICE_MODES.CONSOLIDATED);
      setSelectedProductIds(draft.selectedProductIds || selectedProductIds);
      setActiveAssignmentIndex(0);
      setStage(draft.stage || (multipleBranches ? "assign-branches" : "configure"));
      return;
    }

    const newAssignments = createAssignmentsForProducts(
      selectedProductIds,
      branches,
      (product, branchId) => buildInitialConfigForBranch(lead, branchId)(product),
      (productId) => products.find((product) => product.id === productId),
      lead,
      inferDefaultChangeType,
    );

    setAssignments(normalizeAssignmentsWithPurchaseHistory(newAssignments));
    setActiveAssignmentIndex(0);
    setStage(multipleBranches ? "assign-branches" : "configure");
  }

  function proceedFromAssignBranches() {
    setActiveAssignmentIndex(0);
    setStage("configure");
  }

  async function submitCustomerProductRequest() {
    if (!canCreateInvoice) {
      setConfigError(
        "Configure the required product metrics before submitting your request.",
      );
      return;
    }

    const session = getCustomerSession();
    setSubmittingRequest(true);
    setConfigError("");

    try {
      const productSummary = buildProductSummary(assignments, lead, products, getConfiguredPrice).map(
        (entry) => ({
          ...entry,
          priceLabel: "Pending sales review",
        }),
      );
      const branchSummary = buildBranchSummary(assignments, lead);

      await createCustomerProductRequest({
        requestType: deriveRequestType(assignments),
        assignments,
        productSummary,
        branchSummary,
        customerNote: customerNote.trim(),
        domainId: lead?.domainId || "",
        companyName: lead?.companyName || "",
        contactEmail: lead?.workEmail || session?.email || "",
      });

      navigate(exitPath, {
        replace: true,
        state: { requestSubmitted: true },
      });
    } catch (error) {
      setConfigError(
        error instanceof Error ? error.message : "Could not submit your product request.",
      );
    } finally {
      setSubmittingRequest(false);
    }
  }

  function handleConfigSubmit(event) {
    event.preventDefault();
    setConfigError("");

    if (activeConfig?.pricingMode === "ccaas" && !activeConfig.licenseTier) {
      setConfigError("Select a license plan above to continue.");
      return;
    }

    if (activeConfig?.pricingMode === "ccaas") {
      const agentCount = Math.max(0, toNumber(activeConfig.usageDetails?.agentCount));
      if (agentCount < 1) {
        setConfigError("Enter agent count after selecting a plan.");
        return;
      }
    }

    if (activeAssignmentIndex < assignments.length - 1) {
      setActiveAssignmentIndex((current) => current + 1);
      return;
    }

    if (!canCreateInvoice) {
      setConfigError(
        isCustomerRequest
          ? "Configure the required product metrics before submitting your request."
          : "Cannot create an invoice with zero purchase. Enable and configure at least one product feature with pricing.",
      );
      return;
    }

    if (isCustomerRequest) {
      void submitCustomerProductRequest();
      return;
    }

    setStage("invoice-review");
  }

  useEffect(() => {
    if (isCustomerRequest || !leadId || !assignments.length || stage === "select") {
      return;
    }

    saveProductDraft(leadId, {
      assignments: normalizeAssignmentsBilling(assignments),
      invoiceMode: effectiveInvoiceMode,
      selectedProductIds,
      stage,
      updatedAt: new Date().toISOString(),
    });
  }, [assignments, effectiveInvoiceMode, isCustomerRequest, leadId, selectedProductIds, stage]);

  useEffect(() => {
    if (stage !== "invoice-review" || !lead) {
      return undefined;
    }

    let cancelled = false;

    async function prepareInvoicePreview() {
      setInvoiceError("");
      setInvoiceLoading(true);
      setInvoicePreviewUrl("");
      setInvoiceFileName("");
      setInvoicePdfBase64("");

      try {
        const result = await buildQuotationInvoice({
          lead,
          logoUrl: companyLogo,
          products,
          assignments,
          invoiceMode: effectiveInvoiceMode,
        });

        if (cancelled) {
          return;
        }

        const previews = result.invoices || [];
        setInvoicePreviews(previews);
        setActivePreviewIndex(0);
        setInvoicePreviewUrl(previews[0]?.dataUrl || result.dataUrl);
        setInvoiceFileName(previews[0]?.fileName || result.fileName);
        setInvoicePdfBase64(previews[0]?.pdfBase64 || result.pdfBase64);
      } catch (error) {
        if (!cancelled) {
          setInvoiceError(
            error instanceof Error
              ? error.message
              : "Could not generate the PDF invoice. Check your connection and try again.",
          );
        }
      } finally {
        if (!cancelled) {
          setInvoiceLoading(false);
        }
      }
    }

    prepareInvoicePreview();

    return () => {
      cancelled = true;
    };
  }, [assignments, effectiveInvoiceMode, lead, leadId, stage]);

  async function handleProceedToEmail() {
    if (!canCreateInvoice) {
      setInvoiceError(
        "Cannot proceed with a zero purchase. Enable and configure at least one product feature with pricing.",
      );
      return;
    }

    const invoiceValidationError = validateInvoiceModeForAssignments(
      assignments,
      lead,
      effectiveInvoiceMode,
    );

    if (invoiceValidationError) {
      setInvoiceError(invoiceValidationError);
      return;
    }

    const duplicate = assignments.find(
      (entry) =>
        (entry.changeType || CHANGE_TYPES.NEW) === CHANGE_TYPES.NEW &&
        findDuplicateNewPurchase(lead, entry.productId, entry.branchId),
    );

    if (duplicate) {
      const conflict = findDuplicateNewPurchase(lead, duplicate.productId, duplicate.branchId);
      setInvoiceError(
        `${duplicate.productId} is already an active paid subscription at this location until ${new Date(conflict.renewsAt).toLocaleDateString("en-IN")}. Choose upgrade, downgrade, or add-on instead.`,
      );
      return;
    }

    const primaryPreview = invoicePreviews[activePreviewIndex] || {
      fileName: invoiceFileName,
      pdfBase64: invoicePdfBase64,
    };

    if (!primaryPreview.pdfBase64 || !primaryPreview.fileName) {
      return;
    }

    const productSummary = buildProductSummary(assignments, lead, products, getConfiguredPrice);
    const branchSummary = buildBranchSummary(assignments, lead);
    const paymentTotals = computeQuotationPaymentTotals({ assignments, products, lead });

    await saveQuoteSession(leadId, {
      leadId,
      fileName: primaryPreview.fileName,
      pdfBase64: primaryPreview.pdfBase64,
      productSummary,
      assignments: normalizeAssignmentsBilling(assignments),
      invoiceMode: effectiveInvoiceMode,
      branchSummary,
      invoices: invoicePreviews,
      paymentTotals,
      lead,
      createdAt: new Date().toISOString(),
    });

    navigate(`/products/${leadId}/compose`);
  }

  function closeInvoiceReview() {
    setStage("configure");
  }

  function moveToPreviousAssignment() {
    setActiveAssignmentIndex((current) => Math.max(current - 1, 0));
  }

  function returnToSelection() {
    setSelectedProductIds([...new Set(assignments.map((entry) => entry.productId))]);
    setStage("select");
    setActiveAssignmentIndex(0);
    setConfigError("");
  }

  function handlePanelBack() {
    if (stage === "select") {
      navigate(exitPath);
      return;
    }

    if (stage === "configure") {
      if (multipleBranches) {
        setStage("assign-branches");
      } else {
        returnToSelection();
      }
      return;
    }

    if (stage === "assign-branches") {
      returnToSelection();
      return;
    }

    if (stage === "invoice-review") {
      setStage("configure");
    }
  }

  if (leadLoading) {
    return null;
  }

  if (!lead) {
    return <Navigate replace to={exitPath} />;
  }

  return (
    <section className={`products-page products-page--${stage}`}>
      <div className={`products-panel ${stage !== "select" ? "products-panel--configuring" : ""}`}>
        <button
          className="products-panel__back"
          onClick={handlePanelBack}
          type="button"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {multipleBranches && stage !== "invoice-review" ? (
          <WorkflowSteps
            currentStage={stage}
            onStepClick={(targetStage) => {
              if (targetStage === "select" || assignments.length) {
                setStage(targetStage);
              }
            }}
          />
        ) : null}

        <header className="products-header">
          <p className="eyebrow">{isCustomerRequest ? "Customer portal" : lead.companyName}</p>
          <h1>
            {isCustomerRequest
              ? requestIntent === "upgrade"
                ? "Request product upgrade"
                : "Request new product"
              : stage === "select"
                ? "Choose products"
                : stage === "assign-branches"
                  ? "Set location for each product"
                  : "Set pricing"}
          </h1>
          <p>
            {isCustomerRequest
              ? "Choose products and configure capacity. Your request is sent to sales for quotation — no payment is processed here."
              : stage === "select"
                ? getActiveProducts(lead).length
                  ? "Products marked Active are already purchased. Select to upgrade, downgrade, or add new products."
                  : "Pick what this customer will subscribe to."
                : stage === "assign-branches"
                  ? "Choose where each product runs and who gets the invoice."
                  : `${configuredCount} of ${assignments.length} products ready.`}
          </p>
        </header>

        <div className="products-toolbar">
          <span>
            {stage === "select"
              ? `${selectedProductIds.length} products selected`
              : isCustomerRequest
                ? `${assignments.length} product${assignments.length === 1 ? "" : "s"} in request`
                : `${assignments.length} product${assignments.length === 1 ? "" : "s"} in quote`}
          </span>
          {stage === "select" ? (
            <button className="secondary-button" onClick={selectAllProducts} type="button">
              {allSelected ? "Deselect all products" : "Select all products"}
            </button>
          ) : null}
        </div>

        {stage === "select" ? (
          <div className="products-selection-stage">
            {isCustomerRequest && requestIntent === "new" && !visibleProducts.length ? (
              <p className="sales-oversight-empty">
                You already have all available products on your account. Open an existing product to
                request an upgrade.
              </p>
            ) : null}
            <div className="products-grid" aria-label="Available products">
            {visibleProducts.map((product) => {
              const isSelected = selectedProductIds.includes(product.id);
              const Icon = product.icon;
              const cardStatus = getProductCardStatus(lead, product.id);

              return (
                <button
                  aria-pressed={isSelected}
                  className={`product-card ${isSelected ? "is-selected" : ""} ${
                    cardStatus ? "has-active-status" : ""
                  }`}
                  data-product-id={product.id}
                  key={product.id}
                  onClick={() => toggleProduct(product.id)}
                  type="button"
                >
                  {cardStatus ? (
                    <span className={`product-card__status product-card__status--${cardStatus.tone}`}>
                      {cardStatus.label}
                    </span>
                  ) : null}
                    <span className="product-card__check" aria-hidden="true">
                      ✓
                    </span>
                    <span className="product-card__icon">
                      <Icon size={34} strokeWidth={1.9} />
                      <small>AI</small>
                    </span>
                    <strong>{product.name}</strong>
                    <span>{product.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {stage === "assign-branches" ? (
          <BranchAssignmentStep
            assignments={assignments}
            branches={branches}
            onDuplicate={duplicateAssignment}
            onUpdate={updateAssignmentField}
            perBranchInvoicingRequired={perBranchInvoicingRequired}
            products={products}
          />
        ) : null}

        {stage === "configure" && activeProduct && activeConfig ? (
          <div className="pricing-stage">
            <div className="pricing-progress-bar">
              <div className="pricing-progress">
                {assignments.map((assignment, index) => (
                  <div
                    className={`pricing-progress__item ${
                      index === activeAssignmentIndex ? "is-active" : ""
                    } ${isProductConfigured(assignment.config, { metricsOnly: isCustomerRequest }) ? "is-complete" : ""}`}
                    key={assignment.id}
                  >
                    <button
                      className="pricing-progress__item-select"
                      onClick={() => setActiveAssignmentIndex(index)}
                      type="button"
                    >
                      {isProductConfigured(assignment.config, { metricsOnly: isCustomerRequest }) ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        index + 1
                      )}
                      <span className="pricing-progress__item-label">
                        {assignmentDisplayLabel(assignment, lead, products)}
                      </span>
                    </button>
                    <button
                      aria-label={`Remove ${assignmentDisplayLabel(assignment, lead, products)}`}
                      className="pricing-progress__remove"
                      onClick={() => removeAssignments([assignment.id])}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="pricing-layout">
              <form className="pricing-form" onSubmit={handleConfigSubmit}>
                <div className="pricing-form__title">
                  <activeProduct.icon size={26} />
                  <span className="pricing-form__title-copy">
                    <strong>{activeProduct.name}</strong>
                    <small>
                      {activeConfig.pricingMode === "ccaas" && activeConfig.licenseTier
                        ? getCcaasPlanLabel(activeConfig.licenseTier)
                        : activeProduct.pricingBasis}
                      {multipleBranches
                        ? ` · Deployed at ${assignmentDisplayLabel(activeAssignment, lead, products).split(" — ")[1] || "—"}`
                        : ""}
                    </small>
                  </span>
                  {!isCustomerRequest ? (
                    <BillingCycleToggle
                      onChange={(value) => updateActiveConfig("billingCycle", value)}
                      value={activeConfig.billingCycle || "monthly"}
                    />
                  ) : null}
                </div>

                {activeConfig.pricingMode === "ccaas" ? (
                  <>
                    <CcaasPlanPicker
                      onSelectPlan={(planId) => {
                        updateActiveConfig("licenseTier", planId);
                        setConfigError("");
                      }}
                      selectedPlanId={activeConfig.licenseTier || ""}
                    />
                    <CcaasAgentConfiguration
                      config={activeConfig}
                      metricsOnly={isCustomerRequest}
                      onChange={updateActiveConfig}
                    />
                  </>
                ) : null}

                <ProductPricingForm
                  config={activeConfig}
                  lead={lead}
                  metricsOnly={isCustomerRequest}
                  onChange={updateActiveConfig}
                  product={activeProduct}
                />

                {!isCustomerRequest ? (
                  <ChangeTypeField
                    assignment={activeAssignment}
                    lead={lead}
                    onChange={(value) =>
                      setAssignments((current) =>
                        current.map((entry, index) =>
                          index === activeAssignmentIndex ? { ...entry, changeType: value } : entry,
                        ),
                      )
                    }
                  />
                ) : null}

                {isCustomerRequest && activeAssignmentIndex === assignments.length - 1 ? (
                  <label className="field field--full">
                    <span>Note for sales (optional)</span>
                    <textarea
                      onChange={(event) => setCustomerNote(event.target.value)}
                      placeholder="Share timing, business context, or anything sales should know."
                      rows={3}
                      value={customerNote}
                    />
                  </label>
                ) : null}

                <div className="pricing-actions">
                  {configError ? <p className="form-error pricing-actions__error">{configError}</p> : null}
                  <button
                    className="secondary-button"
                    disabled={activeAssignmentIndex === 0}
                    onClick={moveToPreviousAssignment}
                    type="button"
                  >
                    <ArrowLeft size={16} />
                    Previous
                  </button>
                  <button
                    className="primary-button products-next"
                    disabled={
                      submittingRequest ||
                      (activeAssignmentIndex === assignments.length - 1 && !canCreateInvoice)
                    }
                    type="submit"
                  >
                    <span>
                      {activeAssignmentIndex === assignments.length - 1
                        ? isCustomerRequest
                          ? submittingRequest
                            ? "Submitting request..."
                            : "Submit request to sales"
                          : "Review invoice"
                        : "Save & Next"}
                    </span>
                    <ArrowRight size={19} />
                  </button>
                </div>
              </form>

              {isCustomerRequest ? (
                <CustomerMetricsSummary
                  activeAssignmentIndex={activeAssignmentIndex}
                  activeConfig={activeConfig}
                  activeProduct={activeProduct}
                  assignments={assignments}
                  lead={lead}
                  onSelectAssignment={setActiveAssignmentIndex}
                  products={products}
                />
              ) : (
                <ComputedPriceSummary
                  activeAssignmentIndex={activeAssignmentIndex}
                  activeConfig={activeConfig}
                  activeProduct={activeProduct}
                  assignments={assignments}
                  lead={lead}
                  onSelectAssignment={setActiveAssignmentIndex}
                  products={products}
                />
              )}
            </div>
          </div>
        ) : null}

        {stage === "select" ? (
          <footer className="products-actions">
            <button
              className="primary-button products-next"
              disabled={selectedProductIds.length === 0}
              onClick={startConfiguration}
              type="button"
            >
              <span>Next</span>
              <ArrowRight size={19} />
            </button>
          </footer>
        ) : null}

        {stage === "assign-branches" ? (
          <footer className="products-actions">
            <button
              className="secondary-button"
              onClick={returnToSelection}
              type="button"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button className="primary-button products-next" onClick={proceedFromAssignBranches} type="button">
              <span>Next: Set pricing</span>
              <ArrowRight size={19} />
            </button>
          </footer>
        ) : null}
      </div>

      {stage === "invoice-review" ? (
        <InvoiceReviewModal
          error={invoiceError}
          fileName={invoiceFileName}
          invoiceFormat={
            multipleBranches && !perBranchInvoicingRequired
              ? { value: invoiceMode, onChange: setInvoiceMode }
              : null
          }
          invoiceFormatNote={
            perBranchInvoicingRequired
              ? "Separate invoices are required because this quote spans multiple branches or countries."
              : ""
          }
          loading={invoiceLoading}
          onClose={closeInvoiceReview}
          onProceed={handleProceedToEmail}
          pdfDataUrl={invoicePreviewUrl}
          previewTabs={
            invoicePreviews.length > 1
              ? invoicePreviews.map((preview, index) => ({
                  id: preview.fileName,
                  label: preview.label || `Invoice ${index + 1}`,
                  dataUrl: preview.dataUrl,
                  fileName: preview.fileName,
                  active: index === activePreviewIndex,
                  onSelect: () => {
                    setActivePreviewIndex(index);
                    setInvoicePreviewUrl(preview.dataUrl);
                    setInvoiceFileName(preview.fileName);
                    setInvoicePdfBase64(preview.pdfBase64);
                  },
                }))
              : null
          }
        />
      ) : null}
    </section>
  );
}

function ChangeTypeField({ assignment, lead, onChange }) {
  const atBranch = getActiveAtBranch(lead, assignment.productId, assignment.branchId);
  const activeElsewhere = isProductActiveAnywhere(lead, assignment.productId);
  const duplicateNew = findDuplicateNewPurchase(lead, assignment.productId, assignment.branchId);

  if (!atBranch && !activeElsewhere) {
    return (
      <div className="change-type-field change-type-field--new">
        <span className="change-type-pill change-type-pill--new">New purchase</span>
      </div>
    );
  }

  const options = atBranch
    ? CHANGE_TYPE_OPTIONS.filter((option) => option.value !== CHANGE_TYPES.NEW)
    : CHANGE_TYPE_OPTIONS.filter((option) =>
        [CHANGE_TYPES.NEW, CHANGE_TYPES.ADDON].includes(option.value),
      );

  return (
    <fieldset className="change-type-field">
      <legend>Purchase type</legend>
      {duplicateNew ? (
        <p className="change-type-field__note change-type-field__note--warning">
          This product is already paid and active at this location until{" "}
          {new Date(duplicateNew.renewsAt).toLocaleDateString("en-IN")}. New purchase is blocked —
          use upgrade, downgrade, or add-on.
        </p>
      ) : atBranch ? (
        <p className="change-type-field__note">
          This product is already active at this location. Choose upgrade, downgrade, or add-on.
        </p>
      ) : (
        <p className="change-type-field__note">
          This product is active at another location. Mark as new purchase or add-on.
        </p>
      )}
      <div className="change-type-field__options">
        {options.map((option) => (
          <button
            aria-pressed={assignment.changeType === option.value}
            className={`change-type-option ${
              assignment.changeType === option.value ? "is-active" : ""
            }`}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function WorkflowSteps({ currentStage, onStepClick }) {
  const steps = [
    { id: "select", label: "Products" },
    { id: "assign-branches", label: "Locations" },
    { id: "configure", label: "Pricing" },
  ];
  const order = steps.map((step) => step.id);
  const currentIndex = order.indexOf(currentStage);

  return (
    <nav aria-label="Quote steps" className="workflow-steps">
      {steps.map((step, index) => (
        <button
          className={`workflow-steps__item ${
            step.id === currentStage ? "is-active" : index < currentIndex ? "is-done" : ""
          }`}
          key={step.id}
          onClick={() => onStepClick(step.id)}
          type="button"
        >
          <span>{index + 1}</span>
          {step.label}
        </button>
      ))}
    </nav>
  );
}

function BranchAssignmentStep({
  assignments,
  branches,
  onDuplicate,
  onUpdate,
  perBranchInvoicingRequired = false,
  products,
}) {
  const branchCountries = [...new Set(branches.map((branch) => branch.country).filter(Boolean))];
  const hasMixedCountries = branchCountries.length > 1;

  return (
    <div className="branch-assignment-stage">
      <p className="branch-assignment-stage__intro">
        For each product, pick the branch where it runs. Invoices are always issued to that same
        branch using its local address, tax ID, and pricing region.
      </p>
      {hasMixedCountries ? (
        <p className="branch-assignment-stage__note">
          This customer has branches in multiple countries ({branchCountries.join(", ")}).
          Each branch gets its own pricing and invoice — combined cross-country billing is not
          allowed.
        </p>
      ) : null}
      {perBranchInvoicingRequired ? (
        <p className="branch-assignment-stage__note">
          This quote spans multiple branches, so separate PDF invoices will be generated for each
          branch.
        </p>
      ) : null}
      <div className="branch-assignment-table" role="table" aria-label="Product branch assignments">
        <div className="branch-assignment-table__header" role="row">
          <span role="columnheader">Product</span>
          <span role="columnheader">Branch location</span>
          <span role="columnheader" />
        </div>

        {assignments.map((assignment) => {
          const product = products.find((entry) => entry.id === assignment.productId);
          const branch = branches.find((entry) => entry.id === assignment.branchId);

          return (
            <div className="branch-assignment-table__row" key={assignment.id} role="row">
              <span className="branch-assignment-table__product" role="cell">
                <strong>{product?.name || assignment.productId}</strong>
              </span>

              <label className="field branch-assignment-table__field" role="cell">
                <span className="sr-only">Branch location</span>
                <select
                  onChange={(event) => onUpdate(assignment.id, "branchId", event.target.value)}
                  value={assignment.branchId}
                >
                  {branches.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {formatBranchOptionLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="branch-assignment-table__actions" role="cell">
                <button
                  className="link-button"
                  onClick={() => onDuplicate(assignment.id)}
                  type="button"
                >
                  + Same product, another branch
                </button>
                {branch ? (
                  <small className="branch-assignment-table__billing-note">
                    Invoiced to {formatBranchOptionLabel(branch)}
                  </small>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BillingCycleToggle({ onChange, value }) {
  const isYearly = value === "yearly";

  function setBillingCycle(nextValue) {
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }

  function handleContainerClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextValue = event.clientX - rect.left > rect.width / 2 ? "yearly" : "monthly";
    setBillingCycle(nextValue);
  }

  return (
    <div
      className="segmented-toggle segmented-toggle--compact"
      onClick={handleContainerClick}
      role="group"
      aria-label="Billing frequency"
    >
      <span
        aria-hidden="true"
        className="segmented-toggle__slider"
        data-position={isYearly ? "yearly" : "monthly"}
      />
      <button
        aria-pressed={!isYearly}
        className={`segmented-toggle__option ${!isYearly ? "is-active" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          setBillingCycle("monthly");
        }}
        type="button"
      >
        Monthly
      </button>
      <button
        aria-pressed={isYearly}
        className={`segmented-toggle__option ${isYearly ? "is-active" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          setBillingCycle("yearly");
        }}
        type="button"
      >
        Yearly
      </button>
    </div>
  );
}

function FeatureEnableToggle({ ariaLabel = "Feature", enabled, onChange }) {
  return (
    <button
      aria-checked={enabled}
      aria-label={ariaLabel}
      className={`feature-switch ${enabled ? "is-on" : ""}`}
      onClick={() => onChange(!enabled)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="feature-switch__thumb" />
    </button>
  );
}

function PricingSection({ children, description, title }) {
  return (
    <fieldset className="pricing-section">
      <legend>{title}</legend>
      {description ? <p>{description}</p> : null}
      <div className="pricing-section__grid">{children}</div>
    </fieldset>
  );
}

function PricingPackage({
  children,
  description,
  disabledHint,
  featureEnabled,
  index,
  onFeatureChange,
  title,
  toggleLabel,
}) {
  const enabled = featureEnabled ?? true;

  return (
    <section className={`pricing-package ${enabled ? "" : "is-feature-disabled"}`}>
      <div className="pricing-package__header">
        <span className="pricing-package__index">{index}</span>
        <div className="pricing-package__heading">
          <h3 className="pricing-package__title">{title}</h3>
          {description ? <p className="pricing-package__description">{description}</p> : null}
        </div>
        {onFeatureChange ? (
          <FeatureEnableToggle
            ariaLabel={toggleLabel || title}
            enabled={enabled}
            onChange={onFeatureChange}
          />
        ) : null}
      </div>
      <div className="pricing-package__body">
        {enabled ? (
          children
        ) : (
          <p className="feature-disabled-hint">
            {disabledHint || "Turn on this feature to include it in the quote."}
          </p>
        )}
      </div>
    </section>
  );
}

function PricingPackageBase({ children, label = "Base package" }) {
  return (
    <div className="pricing-package__base">
      <span className="pricing-package__base-label">{label}</span>
      <div className="pricing-section__grid">{children}</div>
    </div>
  );
}

function PricingAddonGroup({ addonCount, children, title = "Add-ons" }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`pricing-addon-group ${expanded ? "is-expanded" : ""}`}>
      <button
        aria-expanded={expanded}
        className="pricing-addon-group__toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <ChevronRight className="pricing-addon-group__chevron" size={18} />
        <span>{title}</span>
        <span className="pricing-addon-group__count">
          {addonCount} add-on{addonCount === 1 ? "" : "s"}
        </span>
      </button>
      {expanded ? <div className="pricing-addon-group__content">{children}</div> : null}
    </div>
  );
}

function PricingAddon({ children, description, title }) {
  return (
    <div className="pricing-addon">
      <div className="pricing-addon__header">
        <span aria-hidden="true" className="pricing-addon__marker" />
        <div>
          <strong>{title}</strong>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className="pricing-section__grid pricing-addon__grid">{children}</div>
    </div>
  );
}

function MoneyInput({
  disabled = false,
  label,
  metricsOnly = false,
  onChange,
  placeholder = "0",
  required = false,
  value,
}) {
  if (metricsOnly && isPricingFieldLabel(label)) {
    return null;
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        disabled={disabled}
        min="0"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        step="any"
        type="number"
        value={value}
      />
    </label>
  );
}

function AddonPlanDropdown({
  config,
  metricsOnly = false,
  onChange,
  planField,
  planOptions,
  quantityField,
  rateField,
}) {
  const selectedPlan = config[planField];
  const planDetails = planOptions[selectedPlan];

  return (
    <div className="addon-plan-selector">
      <label className="field field--full">
        <span>Bundle plan</span>
        <select
          onChange={(event) => onChange(planField, event.target.value)}
          value={selectedPlan || ""}
        >
          <option value="">None</option>
          {Object.entries(planOptions).map(([value, plan]) => (
            <option key={value} value={value}>
              {metricsOnly ? plan.label : `${plan.label} — ₹${Number(plan.rate).toLocaleString()} each`}
            </option>
          ))}
        </select>
      </label>

      {planDetails ? (
        <>
          <MoneyInput
            label={planDetails.quantityLabel}
            metricsOnly={metricsOnly}
            onChange={(value) => onChange(quantityField, value)}
            required
            value={config[quantityField]}
          />
          <MoneyInput
            label={planDetails.rateLabel}
            metricsOnly={metricsOnly}
            onChange={(value) => onChange(rateField, value)}
            required
            value={config[rateField]}
          />
        </>
      ) : null}
    </div>
  );
}

function ToggleQuantityRateRow({
  enabled,
  enabledField,
  label,
  metricsOnly = false,
  onChange,
  quantity,
  quantityField,
  quantityLabel,
  rate,
  rateField,
  rateLabel,
}) {
  return (
    <div className="quantity-rate-row">
      <label className="checkbox-field field--full">
        <input
          checked={enabled}
          onChange={(event) => onChange(enabledField, event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
      <MoneyInput
        disabled={!enabled}
        label={quantityLabel}
        metricsOnly={metricsOnly}
        onChange={(value) => onChange(quantityField, value)}
        required={enabled}
        value={quantity}
      />
      <MoneyInput
        disabled={!enabled}
        label={rateLabel}
        metricsOnly={metricsOnly}
        onChange={(value) => onChange(rateField, value)}
        required={enabled}
        value={rate}
      />
    </div>
  );
}

function BundleSelector({ config, onChange }) {
  const isCustom = config.chatbotBundle === "custom";
  const isNone = config.chatbotBundle === "none";

  return (
    <>
      <label className="field field--full">
        <span>Session Bundle</span>
        <select
          onChange={(event) => onChange("chatbotBundle", event.target.value)}
          value={config.chatbotBundle}
        >
          <option value="none">None</option>
          {Object.entries(getChatbotBundleDefaults(config.region)).map(([bundle, defaults]) => (
            <option key={bundle} value={bundle}>
              {Number(bundle).toLocaleString()} sessions — ₹
              {Number(defaults.monthlyPrice).toLocaleString()} @ ₹{defaults.perSessionRate}/session
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>

      {isCustom ? (
        <MoneyInput
          label="Number of Sessions"
          onChange={(value) => onChange("customChatbotSessions", value)}
          placeholder="Enter number of sessions"
          required
          value={config.customChatbotSessions}
        />
      ) : null}

      {!isNone ? (
        <>
          <MoneyInput
            label="Bundle Price"
            onChange={(value) => onChange("chatbotMonthlyPrice", value)}
            required
            value={config.chatbotMonthlyPrice}
          />
          <MoneyInput
            label="Per-session Rate"
            onChange={(value) => onChange("chatbotPerSessionRate", value)}
            value={config.chatbotPerSessionRate}
          />
        </>
      ) : null}
    </>
  );
}

function LiveAgentSelector({ config, onChange }) {
  const isCustom = (config.liveAgentPlan ?? (config.liveAgentCount ? "custom" : "none")) === "custom";

  return (
    <>
      <label className="field field--full">
        <span>Agent Package</span>
        <select
          onChange={(event) => onChange("liveAgentPlan", event.target.value)}
          value={config.liveAgentPlan ?? (config.liveAgentCount ? "custom" : "none")}
        >
          <option value="none">None</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      {isCustom ? (
        <>
          <MoneyInput
            label="Committed Agent Count"
            onChange={(value) => onChange("liveAgentCount", value)}
            required
            value={config.liveAgentCount}
          />
          <MoneyInput
            label="Charge / Agent"
            onChange={(value) => onChange("liveAgentRate", value)}
            value={config.liveAgentRate}
          />
          <MoneyInput
            label="Telco Line Charge / Agent"
            onChange={(value) => onChange("telcoLineCharge", value)}
            value={config.telcoLineCharge}
          />
          <label className="field field--full">
            <span>Use-case Notes</span>
            <textarea
              onChange={(event) => onChange("useCaseNotes", event.target.value)}
              placeholder="Industry, routing complexity, support coverage, or any pricing exception."
              rows="3"
              value={config.useCaseNotes}
            />
          </label>
        </>
      ) : null}
    </>
  );
}

function CheckboxDropdown({ disabled = false, label, onChange, options, value }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedText = value.length ? value.join(", ") : "Select languages";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleOutsideClick(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen]);

  function toggleOption(option) {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option));
      return;
    }

    onChange([...value, option]);
  }

  return (
    <div className="checkbox-dropdown field field--full" ref={dropdownRef}>
      <span>{label}</span>
      <button
        className="checkbox-dropdown__trigger"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>{selectedText}</span>
        <small>{value.length} selected</small>
      </button>
      {isOpen && !disabled ? (
        <div className="checkbox-dropdown__menu">
          {options.map((option) => (
            <label className="checkbox-dropdown__option" key={option}>
              <input
                checked={value.includes(option)}
                onChange={() => toggleOption(option)}
                type="checkbox"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RegionCurrencyFields({ config, metricsOnly = false, onChange }) {
  if (metricsOnly) {
    return null;
  }

  return (
    <>
      <label className="field">
        <span>Region</span>
        <select onChange={(event) => onChange("region", event.target.value)} value={config.region}>
          {Object.keys(currencyByRegion).map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Currency</span>
        <input readOnly value={config.currency} />
      </label>
    </>
  );
}

function DiscountFields({ config, onChange }) {
  return (
    <>
      <label className="field">
        <span>Discount Type</span>
        <select
          onChange={(event) => onChange("discountType", event.target.value)}
          value={config.discountType}
        >
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </select>
      </label>
      <MoneyInput
        label="Discount"
        onChange={(value) => onChange("discountValue", value)}
        placeholder={config.discountType === "percentage" ? "Example: 10" : "Amount"}
        value={config.discountValue}
      />
    </>
  );
}

function ProductPricingForm({ config, lead, metricsOnly = false, onChange, product }) {
  if (config.pricingMode === "ccaas") {
    return <CcaasPricingForm config={config} metricsOnly={metricsOnly} onChange={onChange} />;
  }

  if (config.pricingMode === "crm") {
    return <CrmPricingForm config={config} lead={lead} metricsOnly={metricsOnly} onChange={onChange} />;
  }

  if (config.pricingMode === "cdp") {
    return <CdpPricingForm config={config} metricsOnly={metricsOnly} onChange={onChange} />;
  }

  if (config.pricingMode === "campaign") {
    return <CampaignPricingForm config={config} metricsOnly={metricsOnly} onChange={onChange} />;
  }

  if (config.pricingMode === "value-management") {
    return (
      <ValueManagementPricingForm
        config={config}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  if (config.pricingMode === "ticketing") {
    return <TicketingPricingForm config={config} metricsOnly={metricsOnly} onChange={onChange} />;
  }

  return <GenericPricingForm config={config} metricsOnly={metricsOnly} onChange={onChange} product={product} />;
}

function CcaasAgentConfiguration({ config, metricsOnly = false, onChange }) {
  if (!config.licenseTier) {
    return null;
  }

  const usageDetails = config.usageDetails || createDefaultUsageDetails();

  return (
    <section className="ccaas-pricing-panel is-open ccaas-agent-configuration">
      <div className="ccaas-agent-configuration__copy">
        <strong>Agent configuration</strong>
        <small>
          {metricsOnly
            ? "Set agent count for the selected plan before choosing modules."
            : "Set agent count for the selected plan before configuring modules and pricing."}
        </small>
      </div>
      <label className="field">
        <span>Agent count *</span>
        <input
          min={1}
          onChange={(event) =>
            onChange("usageDetails", {
              ...usageDetails,
              agentCount: normalizeUsageDetailValue("agentCount", event.target.value),
            })
          }
          placeholder="1"
          required
          step="1"
          type="number"
          value={getUsageDetailDisplayValue(usageDetails, "agentCount")}
        />
      </label>
    </section>
  );
}

function CcaasPlanPicker({ onSelectPlan, selectedPlanId }) {
  const [plansOpen, setPlansOpen] = useState(!selectedPlanId);

  useEffect(() => {
    if (!selectedPlanId) {
      setPlansOpen(true);
    }
  }, [selectedPlanId]);

  function handleSelectPlan(planId) {
    onSelectPlan(planId);
    setPlansOpen(false);
  }

  return (
    <section className={`ccaas-plan-picker ${plansOpen ? "is-open" : "is-collapsed"}`}>
      <button
        aria-expanded={plansOpen}
        className="ccaas-collapse-toggle"
        onClick={() => setPlansOpen((current) => !current)}
        type="button"
      >
        <span className="ccaas-collapse-toggle__copy">
          <strong>Choose a plan</strong>
          <small>
            {selectedPlanId
              ? getCcaasPlanLabel(selectedPlanId)
              : "Select one license plan to pre-fill modules."}
          </small>
        </span>
        <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
      </button>

      {plansOpen ? (
        <div className="ccaas-plan-picker__grid" role="listbox" aria-label="AI CCaaS plans">
          {CCAAS_PLANS.map((plan) => {
            const isSelected = selectedPlanId === plan.id;
            return (
              <button
                aria-selected={isSelected}
                className={`ccaas-plan-card ${isSelected ? "is-selected" : ""}`}
                key={plan.id}
                onClick={() => handleSelectPlan(plan.id)}
                role="option"
                type="button"
              >
                <span className="ccaas-plan-card__check" aria-hidden="true">
                  ✓
                </span>
                <strong className="ccaas-plan-card__title">
                  {plan.label}
                  {plan.subtitle ? ` (${plan.subtitle})` : ""}
                </strong>
                <span className="ccaas-plan-card__description">{plan.description}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function CcaasPricingForm({ config, metricsOnly = false, onChange }) {
  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";
  const modulesConfig = config.modules || {};
  const usageDetails = config.usageDetails || createDefaultUsageDetails();
  const addons = config.addons || createDefaultCcaasAddons();
  const planSelected = Boolean(config.licenseTier);
  const agentCount = Math.max(0, toNumber(usageDetails.agentCount) || 0);
  const agentConfigured = agentCount >= 1;
  const canConfigureModules = planSelected && agentConfigured;
  const tierDefaultVolumes = catalog.products?.["contact-center"]?.tierDefaultVolumes || {};
  const planModuleRows = useMemo(
    () => getPlanModuleRows(catalog.products?.["contact-center"], config.licenseTier),
    [catalog, config.licenseTier],
  );
  const visibleUsageFields = useMemo(
    () =>
      getCcaasConfigurationFields(modulesConfig, config.licenseTier, tierDefaultVolumes),
    [modulesConfig, config.licenseTier, tierDefaultVolumes],
  );
  const configurationSummary = useMemo(
    () =>
      visibleUsageFields.length > 0
        ? getConfigurationSummary(modulesConfig, config.licenseTier, tierDefaultVolumes)
        : "Agent count is configured above. Other usage counts appear when relevant modules are selected.",
    [modulesConfig, config.licenseTier, tierDefaultVolumes, visibleUsageFields.length],
  );
  const [pricingOpen, setPricingOpen] = useState(planSelected);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [addonsOpen, setAddonsOpen] = useState(false);
  const sessionBundles = getChatbotBundleDefaults(region);

  useEffect(() => {
    if (canConfigureModules) {
      setPricingOpen(true);
    } else {
      setPricingOpen(false);
    }
  }, [canConfigureModules, config.licenseTier]);

  function updateModule(moduleId, patch) {
    const current = modulesConfig[moduleId] || { optionId: NONE_OPTION_ID, price: "0" };
    onChange("modules", {
      ...modulesConfig,
      [moduleId]: { ...current, ...patch },
    });
  }

  function updateUsageDetail(fieldId, value) {
    onChange("usageDetails", {
      ...usageDetails,
      [fieldId]: normalizeUsageDetailValue(fieldId, value),
    });
  }

  function updateAddons(patch) {
    onChange("addons", {
      ...addons,
      ...patch,
    });
  }

  function handleSessionBundleChange(bundleKey) {
    if (bundleKey === "none") {
      updateAddons({
        sessionBundle: "none",
        sessionCount: "",
        sessionPrice: "0",
      });
      return;
    }

    if (bundleKey === "custom") {
      updateAddons({
        sessionBundle: "custom",
        sessionCount: addons.sessionCount || "",
        sessionPrice: addons.sessionPrice || "0",
      });
      return;
    }

    const bundleDefaults = sessionBundles[bundleKey];
    updateAddons({
      sessionBundle: bundleKey,
      sessionCount: bundleKey,
      sessionPrice: bundleDefaults?.monthlyPrice ?? "0",
    });
  }

  function handleMultilingualOptionChange(optionId) {
    if (optionId === "none") {
      updateAddons({
        multilingualOption: "none",
        multilingualPrice: "0",
      });
      return;
    }

    updateAddons({
      multilingualOption: optionId,
      multilingualPrice: getMultilingualCatalogPrice(catalog, region),
    });
  }

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <section className={`ccaas-pricing-panel ${pricingOpen ? "is-open" : "is-collapsed"}`}>
        <button
          aria-expanded={pricingOpen}
          className="ccaas-collapse-toggle"
          disabled={!canConfigureModules}
          onClick={() => {
            if (!canConfigureModules) {
              return;
            }
            setPricingOpen((current) => !current);
          }}
          type="button"
        >
          <span className="ccaas-collapse-toggle__copy">
            <strong>Modules & features</strong>
            <small>
              {canConfigureModules
                ? `Modules and capabilities for ${getCcaasPlanLabel(config.licenseTier)}. Adjust prices below as needed.`
                : planSelected
                  ? "Enter agent count above to configure modules."
                  : metricsOnly
                    ? "Select a plan above to configure module capabilities."
                    : "Select a plan above to configure module capabilities and prices."}
            </small>
          </span>
          <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
        </button>

        {pricingOpen && canConfigureModules ? (
          <div className={`ccaas-module-matrix ${metricsOnly ? "ccaas-module-matrix--metrics-only" : ""}`}>
            <div className="ccaas-module-matrix__header" aria-hidden="true">
              <span>Module</span>
              <span>Capability</span>
              {!metricsOnly ? <span>Price</span> : null}
            </div>
            <div className="ccaas-module-matrix__body">
              {planModuleRows.map((row) => {
                const moduleId = resolvePlanModuleKey(row);
                const selection = modulesConfig[moduleId] || {
                  optionId: NONE_OPTION_ID,
                  price: "0",
                };
                const isNone = selection.optionId === NONE_OPTION_ID;

                return (
                  <div className="ccaas-module-matrix__row" key={row.id}>
                    <span className="ccaas-module-matrix__label">{row.moduleName}</span>
                    <span className="ccaas-module-matrix__capability">{row.capability}</span>
                    {!metricsOnly ? (
                      <label className="field ccaas-module-matrix__price">
                        <span className="sr-only">{row.moduleName} price</span>
                        <input
                          disabled={isNone}
                          min="0"
                          onChange={(event) => updateModule(moduleId, { price: event.target.value })}
                          placeholder="0"
                          step="any"
                          type="number"
                          value={isNone ? "0" : selection.price ?? "0"}
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className={`ccaas-pricing-panel ${configurationOpen ? "is-open" : "is-collapsed"}`}>
        <button
          aria-expanded={configurationOpen}
          className="ccaas-collapse-toggle"
          disabled={!canConfigureModules}
          onClick={() => {
            if (!canConfigureModules) {
              return;
            }
            setConfigurationOpen((current) => !current);
          }}
          type="button"
        >
          <span className="ccaas-collapse-toggle__copy">
            <strong>Configuration</strong>
            <small>{configurationSummary}</small>
          </span>
          <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
        </button>

        {configurationOpen && canConfigureModules ? (
          visibleUsageFields.length > 0 ? (
            <div className="ccaas-config-grid">
              {visibleUsageFields.map((field) => (
                <label className="field" key={field.id}>
                  <span>{field.label}</span>
                  <input
                    min={field.min ?? 0}
                    onChange={(event) => updateUsageDetail(field.id, event.target.value)}
                    placeholder={field.placeholder}
                    step="1"
                    type="number"
                    value={getUsageDetailDisplayValue(usageDetails, field.id)}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="ccaas-config-grid__empty">{configurationSummary}</p>
          )
        ) : null}
      </section>

      <section className={`ccaas-pricing-panel ${addonsOpen ? "is-open" : "is-collapsed"}`}>
        <button
          aria-expanded={addonsOpen}
          className="ccaas-collapse-toggle"
          disabled={!canConfigureModules}
          onClick={() => {
            if (!canConfigureModules) {
              return;
            }
            setAddonsOpen((current) => !current);
          }}
          type="button"
        >
          <span className="ccaas-collapse-toggle__copy">
            <strong>Add-ons</strong>
            <small>
              {metricsOnly
                ? "Optional session bundles and multilingual support."
                : "Optional session bundles and multilingual support with editable prices."}
            </small>
          </span>
          <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
        </button>

        {addonsOpen && canConfigureModules ? (
          <div className="ccaas-addons">
            <div className="ccaas-addon-block">
              <strong>Sessions</strong>
              <div className="ccaas-addon-block__grid">
                <label className="field field--full">
                  <span>Session bundle</span>
                  <select
                    onChange={(event) => handleSessionBundleChange(event.target.value)}
                    value={addons.sessionBundle || "none"}
                  >
                    <option value="none">None</option>
                    {Object.entries(sessionBundles).map(([bundleKey, bundleDefaults]) => (
                      <option key={bundleKey} value={bundleKey}>
                        {metricsOnly
                          ? formatSessionBundleLabelForCustomer(bundleKey, bundleDefaults)
                          : formatSessionBundleLabel(bundleKey, bundleDefaults)}
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </label>

                {addons.sessionBundle === "custom" ? (
                  <label className="field">
                    <span>Session count</span>
                    <input
                      min="0"
                      onChange={(event) => updateAddons({ sessionCount: event.target.value })}
                      placeholder="Enter session count"
                      step="1"
                      type="number"
                      value={addons.sessionCount ?? ""}
                    />
                  </label>
                ) : null}

                {!metricsOnly && addons.sessionBundle !== "none" ? (
                  <label className="field">
                    <span>Session price</span>
                    <input
                      min="0"
                      onChange={(event) => updateAddons({ sessionPrice: event.target.value })}
                      placeholder="0"
                      step="any"
                      type="number"
                      value={addons.sessionPrice ?? "0"}
                    />
                  </label>
                ) : null}
              </div>
            </div>

            <div className="ccaas-addon-block">
              <strong>Multilingual</strong>
              <div className="ccaas-addon-block__grid">
                <label className="field field--full">
                  <span>Multilingual option</span>
                  <select
                    onChange={(event) => handleMultilingualOptionChange(event.target.value)}
                    value={addons.multilingualOption || "none"}
                  >
                    {CCAAS_MULTILINGUAL_ADDON_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {!metricsOnly && addons.multilingualOption === "addon" ? (
                  <label className="field">
                    <span>Multilingual price</span>
                    <input
                      min="0"
                      onChange={(event) => updateAddons({ multilingualPrice: event.target.value })}
                      placeholder="0"
                      step="any"
                      type="number"
                      value={addons.multilingualPrice ?? "0"}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {!metricsOnly ? (
        <PricingSection title="Discount">
          <DiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}
    </div>
  );
}

function ContactSlabSelector({ config, metricsOnly = false, onChange, enabledField = "additionalContactsEnabled" }) {
  const selectedSlab = getContactChargeSlabs(config.region)[config.additionalContactSlab];

  return (
    <>
      <label className="checkbox-field field--full">
        <input
          checked={config[enabledField]}
          onChange={(event) => onChange(enabledField, event.target.checked)}
          type="checkbox"
        />
        <span>Enable additional contact charges</span>
      </label>
      <label className="field">
        <span>Contact slab</span>
        <select
          disabled={!config[enabledField]}
          onChange={(event) => onChange("additionalContactSlab", event.target.value)}
          value={config.additionalContactSlab}
        >
          <option value="">None</option>
          {Object.entries(getContactChargeSlabs(config.region)).map(([slab, details]) => (
            <option key={slab} value={slab}>
              {Number(details.contacts).toLocaleString()} contacts
            </option>
          ))}
        </select>
      </label>
      {!metricsOnly ? (
        <>
          <label className="field">
            <span>Slab price</span>
            <input
              disabled
              value={selectedSlab ? `${config.currency} ${Number(selectedSlab.monthlyPrice).toLocaleString()}` : ""}
            />
          </label>
          <label className="field">
            <span>Per-contact rate</span>
            <input disabled value={selectedSlab ? selectedSlab.perContactRate : ""} />
          </label>
        </>
      ) : null}
    </>
  );
}

function TicketSlabSelector({ config, metricsOnly = false, onChange }) {
  const selectedSlab = getTicketSlabs(config.region)[config.additionalTicketSlab];

  return (
    <>
      <label className="checkbox-field field--full">
        <input
          checked={config.additionalTicketsEnabled}
          onChange={(event) => onChange("additionalTicketsEnabled", event.target.checked)}
          type="checkbox"
        />
        <span>Enable additional ticket bundle</span>
      </label>
      <label className="field">
        <span>Ticket slab</span>
        <select
          disabled={!config.additionalTicketsEnabled}
          onChange={(event) => onChange("additionalTicketSlab", event.target.value)}
          value={config.additionalTicketSlab}
        >
          <option value="">None</option>
          {Object.entries(getTicketSlabs(config.region)).map(([slab, details]) => (
            <option key={slab} value={slab}>
              {Number(details.tickets).toLocaleString()} tickets
            </option>
          ))}
        </select>
      </label>
      {!metricsOnly ? (
        <>
          <label className="field">
            <span>Slab price</span>
            <input
              disabled
              value={selectedSlab ? `${config.currency} ${Number(selectedSlab.monthlyPrice).toLocaleString()}` : ""}
            />
          </label>
          <label className="field">
            <span>Per-ticket rate</span>
            <input disabled value={selectedSlab ? selectedSlab.perTicketRate : ""} />
          </label>
        </>
      ) : null}
    </>
  );
}

function CrmPricingForm({ config, lead, metricsOnly = false, onChange }) {
  const usersEnabled = isFeatureEnabled(config, "usersEnabled");
  const implementationEnabled = isFeatureEnabled(config, "implementationEnabled");
  const implementationLocked = Boolean(config.implementationPurchased);

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        description="Core CRM user licensing and included contacts."
        disabledHint="Enable user licenses to configure seat count and rates."
        featureEnabled={usersEnabled}
        index={1}
        onFeatureChange={(value) => onChange("usersEnabled", value)}
        title="User Licenses"
        toggleLabel="CRM users"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            label="User Count"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("userCount", value)}
            required
            value={config.userCount}
          />
          <MoneyInput
            label="User License Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("userLicenseRate", value)}
            required
            value={config.userLicenseRate}
          />
          <MoneyInput
            label="Included Contacts"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("includedContacts", value)}
            value={config.includedContacts}
          />
        </PricingPackageBase>

        <PricingAddonGroup addonCount={1}>
          <PricingAddon description="Charge for contacts above the included limit." title="Additional Contacts">
            <ContactSlabSelector config={config} metricsOnly={metricsOnly} onChange={onChange} />
          </PricingAddon>
        </PricingAddonGroup>
      </PricingPackage>

      {!metricsOnly && implementationLocked ? (
        <p className="feature-locked-note">
          {getImplementationPurchaseNote(lead, config.productId)}
        </p>
      ) : !metricsOnly ? (
        <PricingPackage
          description="One-time implementation and onboarding charges."
          disabledHint="Enable implementation to add setup fees to the quote."
          featureEnabled={implementationEnabled}
          index={2}
          onFeatureChange={(value) => onChange("implementationEnabled", value)}
          title="Implementation"
          toggleLabel="CRM implementation"
        >
          <PricingPackageBase>
            <MoneyInput
              label="Implementation Cost"
              metricsOnly={metricsOnly}
              onChange={(value) => onChange("implementationCost", value)}
              value={config.implementationCost}
            />
          </PricingPackageBase>
        </PricingPackage>
      ) : null}

      {!metricsOnly ? (
        <PricingSection title="Discount">
          <DiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}
    </div>
  );
}

function CdpPricingForm({ config, metricsOnly = false, onChange }) {
  const platformEnabled = isFeatureEnabled(config, "platformEnabled");

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        description="Charges depend on customer profiles and connected data sources."
        disabledHint="Enable the CDP platform to configure base price, profiles, and data sources."
        featureEnabled={platformEnabled}
        index={1}
        onFeatureChange={(value) => onChange("platformEnabled", value)}
        title="CDP Platform"
        toggleLabel="CDP platform"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            label="Base Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyBasePrice", value)}
            required
            value={config.monthlyBasePrice}
          />
          <MoneyInput
            label="Customer Profiles"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("customerProfiles", value)}
            value={config.customerProfiles}
          />
          <MoneyInput
            label="Data Sources"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("dataSources", value)}
            value={config.dataSources}
          />
          {!metricsOnly ? (
            <label className="field field--full">
              <span>Pricing Notes</span>
              <textarea
                onChange={(event) => onChange("pricingNotes", event.target.value)}
                rows="3"
                value={config.pricingNotes}
              />
            </label>
          ) : null}
        </PricingPackageBase>
      </PricingPackage>

      {!metricsOnly ? (
        <PricingSection title="Discount">
          <DiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}
    </div>
  );
}

function CampaignPricingForm({ config, metricsOnly = false, onChange }) {
  const basePlanEnabled = isFeatureEnabled(config, "basePlanEnabled");
  const channelsEnabled = isFeatureEnabled(config, "channelsEnabled");

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        description="Campaign plan with included contacts."
        disabledHint="Enable the base plan to configure monthly price and included contacts."
        featureEnabled={basePlanEnabled}
        index={1}
        onFeatureChange={(value) => onChange("basePlanEnabled", value)}
        title="Base Plan"
        toggleLabel="Campaign base plan"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            label="Base Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyBasePrice", value)}
            required
            value={config.monthlyBasePrice}
          />
          <MoneyInput
            label="Included Contacts"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("includedContacts", value)}
            value={config.includedContacts}
          />
        </PricingPackageBase>

        <PricingAddonGroup addonCount={1}>
          <PricingAddon description="Charge for contacts above the included limit." title="Additional Contacts">
            <ContactSlabSelector config={config} metricsOnly={metricsOnly} onChange={onChange} />
          </PricingAddon>
        </PricingAddonGroup>
      </PricingPackage>

      <PricingPackage
        description="Enter only billable usage above free or included limits."
        disabledHint="Enable channels to configure email, SMS, WhatsApp, and push usage."
        featureEnabled={channelsEnabled}
        index={2}
        onFeatureChange={(value) => onChange("channelsEnabled", value)}
        title="Channels"
        toggleLabel="Campaign channels"
      >
        <PricingPackageBase label="Channel usage">
          <MoneyInput label="Email Count" metricsOnly={metricsOnly} onChange={(value) => onChange("emailCount", value)} value={config.emailCount} />
          <MoneyInput label="Email Rate" metricsOnly={metricsOnly} onChange={(value) => onChange("emailRate", value)} value={config.emailRate} />
          <MoneyInput label="SMS Count" metricsOnly={metricsOnly} onChange={(value) => onChange("smsCount", value)} value={config.smsCount} />
          <MoneyInput label="SMS Rate" metricsOnly={metricsOnly} onChange={(value) => onChange("smsRate", value)} value={config.smsRate} />
          <MoneyInput
            label="WhatsApp Credits"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("whatsappCredits", value)}
            value={config.whatsappCredits}
          />
          <MoneyInput
            label="WhatsApp Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("whatsappRate", value)}
            value={config.whatsappRate}
          />
          <MoneyInput
            label="Web Push Subscribers"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("webPushSubscribers", value)}
            value={config.webPushSubscribers}
          />
          <MoneyInput
            label="Web Push Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("webPushRate", value)}
            value={config.webPushRate}
          />
          <MoneyInput
            label="App Push Subscribers"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("appPushSubscribers", value)}
            value={config.appPushSubscribers}
          />
          <MoneyInput
            label="App Push Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("appPushRate", value)}
            value={config.appPushRate}
          />
          <MoneyInput
            label="In-App Subscribers"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("inAppSubscribers", value)}
            value={config.inAppSubscribers}
          />
          <MoneyInput
            label="In-App Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("inAppRate", value)}
            value={config.inAppRate}
          />
        </PricingPackageBase>
      </PricingPackage>

      {!metricsOnly ? (
        <PricingSection title="Discount">
          <DiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}
    </div>
  );
}

function ValueManagementPricingForm({ config, lead, metricsOnly = false, onChange }) {
  const subscriptionEnabled = isFeatureEnabled(config, "subscriptionEnabled");
  const implementationEnabled = isFeatureEnabled(config, "implementationEnabled");
  const implementationLocked = Boolean(config.implementationPurchased);

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        description="Monthly subscription based on active users."
        disabledHint="Enable subscription to configure base price and MAU."
        featureEnabled={subscriptionEnabled}
        index={1}
        onFeatureChange={(value) => onChange("subscriptionEnabled", value)}
        title="Subscription"
        toggleLabel="Value management subscription"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            label="Base Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyBasePrice", value)}
            required
            value={config.monthlyBasePrice}
          />
          <MoneyInput
            label="Active Users"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyActiveUsers", value)}
            value={config.monthlyActiveUsers}
          />
        </PricingPackageBase>
      </PricingPackage>

      {!metricsOnly && implementationLocked ? (
        <p className="feature-locked-note">
          {getImplementationPurchaseNote(lead, config.productId)}
        </p>
      ) : !metricsOnly ? (
        <PricingPackage
          description="One-time implementation and onboarding charges."
          disabledHint="Enable implementation to add setup fees to the quote."
          featureEnabled={implementationEnabled}
          index={2}
          onFeatureChange={(value) => onChange("implementationEnabled", value)}
          title="Implementation"
          toggleLabel="Value management implementation"
        >
          <PricingPackageBase>
            <MoneyInput
              label="Implementation Fee"
              metricsOnly={metricsOnly}
              onChange={(value) => onChange("implementationFee", value)}
              value={config.implementationFee}
            />
          </PricingPackageBase>
        </PricingPackage>
      ) : null}

      {!metricsOnly ? (
        <PricingSection title="Discount">
          <DiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}
    </div>
  );
}

function TicketingPricingForm({ config, metricsOnly = false, onChange }) {
  const usersEnabled = isFeatureEnabled(config, "usersEnabled");

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        description="Core ticketing user licensing and included tickets."
        disabledHint="Enable user licenses to configure seat count and included tickets."
        featureEnabled={usersEnabled}
        index={1}
        onFeatureChange={(value) => onChange("usersEnabled", value)}
        title="User Licenses"
        toggleLabel="Ticketing users"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            label="User Count"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("userCount", value)}
            required
            value={config.userCount}
          />
          <MoneyInput
            label="User License Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("userLicenseRate", value)}
            required
            value={config.userLicenseRate}
          />
          <MoneyInput
            label="Included Tickets"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("includedTickets", value)}
            value={config.includedTickets}
          />
          <MoneyInput
            label="Included Ticket Rate"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("includedTicketRate", value)}
            value={config.includedTicketRate}
          />
        </PricingPackageBase>

        <PricingAddonGroup addonCount={1}>
          <PricingAddon description="Charge for tickets above the included bundle." title="Additional Tickets">
            <TicketSlabSelector config={config} metricsOnly={metricsOnly} onChange={onChange} />
          </PricingAddon>
        </PricingAddonGroup>
      </PricingPackage>

      {!metricsOnly ? (
        <PricingSection title="Discount">
          <DiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}
    </div>
  );
}

function GenericPricingForm({ config, metricsOnly = false, onChange, product }) {
  if (metricsOnly) {
    return (
      <div className="pricing-form-grid">
        <label className="field">
          <span>{product.usageLabel}</span>
          <input
            onChange={(event) => onChange("usagePackage", event.target.value)}
            placeholder={product.usagePlaceholder}
            required
            value={config.usagePackage}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="pricing-form-grid">
      <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
      <MoneyInput
        label="Base Price"
        metricsOnly={metricsOnly}
        onChange={(value) => onChange("basePrice", value)}
        placeholder="Enter base price"
        required
        value={config.basePrice}
      />
      <MoneyInput
        label="Setup Fee"
        metricsOnly={metricsOnly}
        onChange={(value) => onChange("setupFee", value)}
        placeholder="Optional setup fee"
        value={config.setupFee}
      />
      <DiscountFields config={config} onChange={onChange} />
      <label className="field">
        <span>{product.usageLabel}</span>
        <input
          onChange={(event) => onChange("usagePackage", event.target.value)}
          placeholder={product.usagePlaceholder}
          value={config.usagePackage}
        />
      </label>
      <label className="field field--full">
        <span>Pricing Notes</span>
        <textarea
          onChange={(event) => onChange("pricingNotes", event.target.value)}
          rows="5"
          value={config.pricingNotes}
        />
      </label>
    </div>
  );
}

function CustomerMetricsSummary({
  activeAssignmentIndex,
  activeConfig,
  activeProduct,
  assignments,
  lead,
  onSelectAssignment,
  products,
}) {
  const configured = isProductConfigured(activeConfig, { metricsOnly: true });
  const configurationSummary =
    activeConfig.pricingMode === "ccaas" && activeConfig.modules
      ? getConfigurationSummary(activeConfig.modules)
      : null;

  return (
    <aside className="pricing-summary pricing-summary--metrics-only" aria-label="Configuration summary">
      <p>Current Product</p>
      <h2>{activeProduct.name}</h2>
      {!configured ? (
        <p className="pricing-summary__disabled-note">
          Turn on at least one feature and fill in the required metrics to submit your request.
        </p>
      ) : (
        <p className="pricing-summary__disabled-note">
          Pricing will be confirmed by sales after review.
        </p>
      )}
      {configurationSummary ? (
        <dl>
          <div>
            <dt>Configuration</dt>
            <dd>{configurationSummary}</dd>
          </div>
        </dl>
      ) : null}

      <div className="configured-products">
        {assignments.map((assignment, index) => {
          const config = assignment.config;
          const isConfigured = isProductConfigured(config, { metricsOnly: true });
          const isActive = index === activeAssignmentIndex;

          return (
            <button
              aria-current={isActive ? "true" : undefined}
              className={`configured-product ${isConfigured ? "is-complete" : ""} ${
                isActive ? "is-active" : ""
              }`}
              key={assignment.id}
              onClick={() => onSelectAssignment(index)}
              type="button"
            >
              <span>{assignmentDisplayLabel(assignment, lead, products)}</span>
              <strong>{isConfigured ? "Ready" : "Pending"}</strong>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ComputedPriceSummary({
  activeAssignmentIndex,
  activeConfig,
  activeProduct,
  assignments,
  lead,
  onSelectAssignment,
  products,
}) {
  const pricingTotals = getPricingTotals(activeConfig);
  const configured = isProductConfigured(activeConfig);

  return (
    <aside className="pricing-summary" aria-label="Pricing summary">
      <p>Current Product</p>
      <h2>{activeProduct.name}</h2>
      {pricingTotals.billingLabel ? (
        <p className="pricing-summary__cycle">{pricingTotals.billingLabel} billing</p>
      ) : null}
      {!configured ? (
        <p className="pricing-summary__disabled-note">
          Turn on at least one feature to include this product in the quote.
        </p>
      ) : null}
      <dl>
        <div>
          <dt>Base Price</dt>
          <dd>
            {activeConfig.currency} {pricingTotals.baseMonthlyTotal.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Setup Total</dt>
          <dd>
            {activeConfig.currency} {pricingTotals.setupTotal.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Additional Usage</dt>
          <dd>
            {activeConfig.currency} {pricingTotals.additionalUsageTotal.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Discount Amount</dt>
          <dd>
            {activeConfig.currency} {pricingTotals.discountAmount.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Final Price</dt>
          <dd>
            {activeConfig.currency} {pricingTotals.finalMonthlyTotal.toLocaleString()}
          </dd>
        </div>
        <div className="pricing-summary__total">
          <dt>Final Payable Estimate</dt>
          <dd>
            {activeConfig.currency} {pricingTotals.finalPayableEstimate.toLocaleString()}
          </dd>
        </div>
      </dl>

      <div className="configured-products">
        {assignments.map((assignment, index) => {
          const product = products.find((entry) => entry.id === assignment.productId);
          const config = assignment.config;
          const isConfigured = isProductConfigured(config);
          const isActive = index === activeAssignmentIndex;

          return (
            <button
              aria-current={isActive ? "true" : undefined}
              className={`configured-product ${isConfigured ? "is-complete" : ""} ${
                isActive ? "is-active" : ""
              }`}
              key={assignment.id}
              onClick={() => onSelectAssignment(index)}
              type="button"
            >
              <span>{assignmentDisplayLabel(assignment, lead, products)}</span>
              <span className={`change-type-pill change-type-pill--${assignment.changeType || "new"}`}>
                {getChangeTypeLabel(assignment.changeType || CHANGE_TYPES.NEW)}
              </span>
              <strong>
                {isConfigured && config?.currency
                  ? `${config.currency} ${getConfiguredPrice(config).toLocaleString()}`
                  : "Pending"}
              </strong>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
