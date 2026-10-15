// @ts-nocheck
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
  Plus,
  Ticket,
  Trash2,
  UserRoundCog,
} from "lucide-react";

import { InvoiceReviewModal } from "../components/InvoiceReviewModal.tsx";
import { OpenProductRequestConflictModal } from "../components/customer/OpenProductRequestConflictModal.tsx";
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
  unusedBranchesForProduct,
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
  isActivePaidSubscription,
  isMidPeriodAddonOnlyQuote,
  isProductActiveAnywhere,
  getSubscriptionRenewsAt,
  shouldShowImplementationNote,
  normalizeProductKeyParam,
  suggestChangeTypeFromPrices,
  applyPurchaseHistoryToConfig,
} from "../lib/activeProducts.js";
import { buildQuotationInvoice, buildInvoicePdfFromSheet, computeQuotationPaymentTotals, prepareInvoiceLogo } from "../lib/invoice.js";
import { fetchPublicInvoiceSettings } from "../lib/invoiceSettings.js";
import { CCAAS_PLANS, getCcaasPlanLabel, getHigherPlansThan, getHighestPlanId, isHigherPlanThan } from "../lib/ccaasPlans.js";
import {
  buildModulesFromPlan,
  clampModulesToLicenseTier,
  getModuleOption,
  getModuleOptionPrice,
  getModuleOptionsForLicenseTier,
  hasAnyActiveModule,
  isModuleBillable,
  modulesAreComplete,
  NONE_OPTION_ID,
  resolveModuleOptionPricingPlan,
  resolveModulesWithCatalogPrices,
  sumModulePrices,
  syncAgentRateIntoPerAgentModules,
  getContactCenterPlanImplementationFee,
  zeroModuleCatalogPrices,
} from "../lib/ccaasModules.js";
import { getPlanModuleRows, resolvePlanModuleKey } from "../lib/planModules.js";
import {
  applyConfigurationPricingEdit,
  commitConfigurationPricingQty,
  createDefaultUsageDetails,
  getConfigurationLineAmount,
  getConfigurationSummary,
  getCcaasConfigurationPricingRows,
  seedConfigurationPricingFromCatalog,
  sumCcaasAddonPrices,
} from "../lib/ccaasConfiguration.js";
import { buildSidebarPricingBreakdown } from "../lib/ccaasSidebarBreakdown.js";
import { getPricingRegionForCountry } from "../lib/countryDefaults.js";
import { preventEnterFormSubmit } from "../lib/formEnterKey.js";
import { fetchPricingCatalog, getCachedPricingCatalog, setCachedPricingCatalog } from "../lib/pricingCatalog.js";
import { getProductNumberAddOn, getProductStorageAddOn } from "../lib/pricingCatalogDefaults.js";
import { getProductName } from "../lib/productCatalog.js";
import {
  applyCatalogFeatureDefaults,
  createInitialConfigFromCatalog,
  getAdditionalMinuteBundlePlans,
  getCatalog,
  getChatbotBundleDefaults,
  getContactChargeSlabs,
  getRegionDefaults,
  getTicketSlabs,
} from "../lib/pricingRuntime.js";
import {
  ensureMidPeriodAddons,
  hasAnyMidPeriodAddonSelected,
  isMidPeriodAddonBilling,
  resolveTelcoLineCharge,
  seedCcaasMidPeriodAddons,
  sumCcaasMidPeriodAddonPrices,
  sumCrmMidPeriodAddonPrices,
} from "../lib/midPeriodAddons.js";
import {
  getPlanAgentAddon,
  getPlanQueueCapacityAddon,
  getVisiblePlanAddonChannels,
} from "../lib/planAddons.js";
import { isFeatureEnabled } from "../lib/pricingFeatures.js";
import { applyInvoicePeriodPricing, resolveSkipInvoiceProration } from "../lib/proration.js";
import {
  clearProductDraft,
  COUNTRY_OPTIONS,
  formatBranchOptionLabel,
  getBranchCountry,
  getLeadBranches,
  getLeadById,
  HQ_BRANCH_ID,
  leadHasMultipleBranches,
  saveProductDraft,
} from "../lib/leads.js";
import { createEmptyBranchAddress, resolveBranchIndustry } from "../lib/branchProfile.js";
import { getLeadAddressFormatError } from "../lib/leadAddresses.js";
import {
  getDivisionLabelForCountry,
  getDivisionPlaceholderForCountry,
  getLeadCountryDefaults,
  getStateOptionsForCountry,
  MOBILE_VALIDATION_RULES,
  requiresStateForCountry,
  validateMobileForDialCode,
} from "../lib/countryDefaults.js";
import { validateTaxNumberForCountry } from "../lib/taxNumber.js";
import { saveQuoteSession } from "../lib/quoteSession.js";
import { isTemporaryLead } from "../lib/workspaceViews.js";
import {
  createCustomerProductRequest,
  deriveRequestType,
  findOpenProductRequestConflict,
  findOpenProductRequestForProduct,
  listMyProductRequests,
  materializeProductRequestBranches,
  notifyMyProductRequestAgain,
  updateMyProductRequest,
} from "../lib/customerProductRequests.js";
import {
  applyAddonRenewalSelection,
  defaultRenewalAddonSelection,
  listRenewableAddons,
} from "../lib/renewalAddons.js";
import { getCustomerSession } from "../lib/customerAuth.js";
import { resolvePortalLoginEmail } from "../lib/customerContact.js";
import companyLogo from "../assets/worktual-logo.png";

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
    notes: ["Sheet says charges depend on customer profiles."],
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
      "Sheet includes base monthly plan with 50k contacts and channel usage for web push, app push, email, SMS, and WhatsApp campaigns.",
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

function createGenericInitialConfig(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  return {
    productId: product.id,
    pricingMode: "generic",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    basePrice: zero ? "0" : "",
    setupFee: zero ? "0" : "",
    discountType: "percentage",
    discountValue: "",
    billingCycle: "monthly",
    usagePackage: "",
    pricingNotes: zero ? "" : product.notes.join("\n"),
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

function buildInitialConfigForBranch(lead, branchId) {
  const region = getPricingRegionForCountry(getBranchCountry(lead, branchId));
  const zeroCatalogDefaults = isTemporaryLead(lead);
  return (product) =>
    createInitialConfigFromCatalog(product, region, { zeroCatalogDefaults }) ??
    createGenericInitialConfig(product, region, { zeroCatalogDefaults });
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
    isConfigured: isCdpConfigured,
    getPrice: (config) => calculateCdpPricing(config).finalMonthlyTotal,
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

function calculateDiscount(config, amount) {
  const discountValue = toNumber(config.discountValue);

  if (config.discountType === "fixed") {
    return Math.min(Math.max(discountValue, 0), amount);
  }

  const percent = Math.min(Math.max(discountValue, 0), 100);
  return Math.min(amount * (percent / 100), amount);
}

function calculateImplementationDiscount(config, amount) {
  const discountValue = toNumber(config.implementationDiscountValue);
  if (!amount || amount <= 0 || !discountValue) {
    return 0;
  }

  if (config.implementationDiscountType === "fixed") {
    return Math.min(Math.max(discountValue, 0), amount);
  }

  const percent = Math.min(Math.max(discountValue, 0), 100);
  return Math.min(amount * (percent / 100), amount);
}

function calculateAddonDiscount(config, amount) {
  const discountValue = toNumber(config.addonDiscountValue);
  if (!amount || amount <= 0 || !discountValue) {
    return 0;
  }

  if (config.addonDiscountType === "fixed") {
    return Math.min(Math.max(discountValue, 0), amount);
  }

  const percent = Math.min(Math.max(discountValue, 0), 100);
  return Math.min(amount * (percent / 100), amount);
}

function netImplementationSetupTotal(config, setupGross) {
  const gross = Math.max(toNumber(setupGross), 0);
  return Math.max(gross - calculateImplementationDiscount(config, gross), 0);
}

function getMaxFixedImplementationDiscount(config) {
  if (!isFeatureEnabled(config, "implementationEnabled")) {
    return 0;
  }
  if (config.pricingMode === "crm") {
    return Math.max(0, toNumber(config.implementationCost));
  }
  return Math.max(0, toNumber(config.implementationFee));
}

function getMaxFixedDiscount(config) {
  const probe = {
    ...config,
    discountType: "fixed",
    discountValue: String(Number.MAX_SAFE_INTEGER),
    addonDiscountType: "percentage",
    addonDiscountValue: "",
  };
  return Math.max(0, toNumber(getPricingTotals(probe).discountAmount));
}

function getMaxFixedAddonDiscount(config) {
  const probe = {
    ...config,
    addonDiscountType: "percentage",
    addonDiscountValue: "",
  };
  const totals = getPricingTotals(probe);
  return Math.max(0, toNumber(totals.additionalUsageTotal ?? totals.addonAmount ?? 0));
}

function sanitizeDiscountInput(discountType, value, previousValue = "", { maxFixedAmount = null } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  // Reject leading zeros like "010" / "00". Allow "0" and decimals like "0.5".
  if (/^0\d/.test(raw)) {
    return String(previousValue ?? "");
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return String(previousValue ?? "");
  }

  if (parsed < 0) {
    return "0";
  }

  if (discountType === "percentage" && parsed > 100) {
    return String(previousValue ?? "");
  }

  if (
    discountType === "fixed" &&
    maxFixedAmount !== null &&
    Number.isFinite(maxFixedAmount) &&
    parsed > maxFixedAmount
  ) {
    return String(maxFixedAmount);
  }

  return raw;
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
  if (isMidPeriodAddonBilling(config)) {
    const additionalUsageTotal = sumCcaasMidPeriodAddonPrices(config);
    const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
    const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
    return {
      baseMonthlyTotal: 0,
      setupTotal: 0,
      additionalUsageTotal,
      discountAmount: 0,
      addonDiscountAmount,
      finalMonthlyTotal: addonNet,
      finalPayableEstimate: addonNet,
      coreMonthlyAmount: 0,
      addonAmount: addonNet,
    };
  }

  const agentCountRaw = toNumber(config.usageDetails?.agentCount);
  const agentCount =
    config.zeroCatalogDefaults && !(agentCountRaw > 0)
      ? 0
      : Math.max(1, agentCountRaw || 0);
  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";
  const pricedModules = resolveModulesWithCatalogPrices(
    config.modules,
    config.licenseTier,
    catalog,
    region,
    config.usageDetails?.agentRate,
    { preferStoredPrices: Boolean(config.zeroCatalogDefaults) },
  );
  // Agent billing includes per-seat telco (same formula as invoice).
  const baseMonthlyTotal =
    sumModulePrices(pricedModules, { agentCount }) +
    resolveTelcoLineCharge(config) * agentCount;
  const contactCenterProduct = catalog.products?.["contact-center"];
  const tierDefaultVolumes = contactCenterProduct?.tierDefaultVolumes || {};
  const usageDetails = config.usageDetails || createDefaultUsageDetails();
  const configurationUsageTotal = getCcaasConfigurationPricingRows(
    config.modules || {},
    config.licenseTier,
    tierDefaultVolumes,
    contactCenterProduct,
  ).reduce((sum, row) => sum + getConfigurationLineAmount(usageDetails, row), 0);
  // Prefer channel/human-agent add-ons when seeded; fall back to legacy sessions/multilingual.
  const channelAddonTotal = sumCcaasMidPeriodAddonPrices(config);
  const additionalUsageTotal =
    (channelAddonTotal > 0 || config.midPeriodAddons?.active
      ? channelAddonTotal
      : sumCcaasAddonPrices(config)) + configurationUsageTotal;
  const setupGross = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const setupTotal = netImplementationSetupTotal(config, setupGross);
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const coreNet = Math.max(baseMonthlyTotal - discountAmount, 0);
  const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
  const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
  const finalMonthlyTotal = coreNet + addonNet;

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    addonDiscountAmount,
    implementationDiscountAmount: calculateImplementationDiscount(config, setupGross),
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
  };
}

function calculateCdpPricing(config) {
  const baseMonthlyTotal = isFeatureEnabled(config, "platformEnabled")
    ? toNumber(config.monthlyBasePrice)
    : 0;
  const additionalContactsTotal =
    config.additionalContactsEnabled && config.additionalContactSlab
      ? toNumber(
          getContactChargeSlabs(config.region, config.productId || "cdp")[config.additionalContactSlab]
            ?.monthlyPrice,
        )
      : 0;
  const additionalStorageTotal =
    config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0
      ? toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate)
      : 0;
  const additionalUsageTotal = additionalContactsTotal + additionalStorageTotal;
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const coreNet = Math.max(baseMonthlyTotal - discountAmount, 0);
  const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
  const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
  const finalMonthlyTotal = coreNet + addonNet;
  const setupGross = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const setupTotal = netImplementationSetupTotal(config, setupGross);

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    addonDiscountAmount,
    implementationDiscountAmount: calculateImplementationDiscount(config, setupGross),
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
  };
}

function calculateCrmPricing(config) {
  if (isMidPeriodAddonBilling(config)) {
    const additionalUsageTotal = sumCrmMidPeriodAddonPrices(config);
    const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
    const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
    return {
      baseMonthlyTotal: 0,
      setupTotal: 0,
      additionalUsageTotal,
      discountAmount: 0,
      addonDiscountAmount,
      finalMonthlyTotal: addonNet,
      finalPayableEstimate: addonNet,
      coreMonthlyAmount: 0,
      addonAmount: addonNet,
    };
  }

  const baseMonthlyTotal = isFeatureEnabled(config, "usersEnabled")
    ? toNumber(config.userCount) * toNumber(config.userLicenseRate)
    : 0;
  const additionalUsersTotal =
    config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0
      ? toNumber(config.additionalUserCount) *
        toNumber(config.additionalUserLicenseRate || config.userLicenseRate)
      : 0;
  const additionalNumbersTotal =
    config.additionalNumbersEnabled && toNumber(config.additionalNumberCount) > 0
      ? toNumber(config.additionalNumberCount) * toNumber(config.additionalNumberRate)
      : 0;
  const additionalStorageTotal =
    config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0
      ? toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate)
      : 0;
  const additionalContactsTotal =
    config.additionalContactsEnabled && config.additionalContactSlab
      ? toNumber(
          getContactChargeSlabs(config.region, config.productId || "crm")[config.additionalContactSlab]
            ?.monthlyPrice,
        )
      : 0;
  const additionalUsageTotal =
    additionalUsersTotal + additionalNumbersTotal + additionalStorageTotal + additionalContactsTotal;
  const setupGross = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationCost)
    : 0;
  const setupTotal = netImplementationSetupTotal(config, setupGross);
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const coreNet = Math.max(baseMonthlyTotal - discountAmount, 0);
  const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
  const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
  const finalMonthlyTotal = coreNet + addonNet;

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    addonDiscountAmount,
    implementationDiscountAmount: calculateImplementationDiscount(config, setupGross),
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
  };
}

function calculateCampaignChannelUsage(config) {
  return (
    toNumber(config.emailCount) * toNumber(config.emailRate) +
    toNumber(config.smsCount) * toNumber(config.smsRate) +
    toNumber(config.whatsappCredits) * toNumber(config.whatsappRate) +
    toNumber(config.webPushSubscribers) * toNumber(config.webPushRate) +
    toNumber(config.appPushSubscribers) * toNumber(config.appPushRate) +
    toNumber(config.inAppSubscribers) * toNumber(config.inAppRate)
  );
}

function calculateCampaignPricing(config) {
  const midPeriodOnly = isMidPeriodAddonBilling(config);
  const channelUsageTotal = midPeriodOnly
    ? calculateCampaignChannelUsage(config)
    : isFeatureEnabled(config, "basePlanEnabled")
      ? calculateCampaignChannelUsage(config)
      : 0;
  const additionalContacts =
    config.additionalContactsEnabled && config.additionalContactSlab
      ? toNumber(
          getContactChargeSlabs(config.region, config.productId || "campaign")[
            config.additionalContactSlab
          ]?.monthlyPrice,
        )
      : 0;

  if (midPeriodOnly) {
    // Campaign numbers removed — do not bill mid-period number add-ons.
    const additionalNumbersTotal = 0;
    const storageEnabled =
      config.midPeriodAddons?.storage?.enabled === true || config.additionalStorageEnabled === true;
    const additionalStorageTotal = storageEnabled
      ? toNumber(config.midPeriodAddons?.storage?.count || config.additionalStorageCount) *
        toNumber(config.midPeriodAddons?.storage?.rate || config.additionalStorageRate)
      : 0;
    const additionalUsageTotal =
      channelUsageTotal + additionalContacts + additionalNumbersTotal + additionalStorageTotal;
    const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
    const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
    return {
      baseMonthlyTotal: 0,
      setupTotal: 0,
      additionalUsageTotal,
      discountAmount: 0,
      addonDiscountAmount,
      finalMonthlyTotal: addonNet,
      finalPayableEstimate: addonNet,
      coreMonthlyAmount: 0,
      addonAmount: addonNet,
    };
  }

  const basePrice = isFeatureEnabled(config, "basePlanEnabled")
    ? toNumber(config.monthlyBasePrice)
    : 0;
  // Channels live in Base Plan — include with core when base is enabled.
  // Campaign numberCount / additional numbers are no longer billed.
  const baseMonthlyTotal = basePrice + channelUsageTotal;
  const additionalNumbersTotal = 0;
  const additionalStorageTotal =
    config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0
      ? toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate)
      : 0;
  const additionalUsageTotal = additionalContacts + additionalNumbersTotal + additionalStorageTotal;
  const setupGross = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const setupTotal = netImplementationSetupTotal(config, setupGross);
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const coreNet = Math.max(baseMonthlyTotal - discountAmount, 0);
  const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
  const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
  const finalMonthlyTotal = coreNet + addonNet;

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    addonDiscountAmount,
    implementationDiscountAmount: calculateImplementationDiscount(config, setupGross),
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
  };
}

function calculateValueManagementPricing(config) {
  const midPeriodOnly = isMidPeriodAddonBilling(config);
  const additionalContacts =
    config.additionalContactsEnabled && config.additionalContactSlab
      ? toNumber(
          getContactChargeSlabs(config.region, config.productId || "value-management")[
            config.additionalContactSlab
          ]?.monthlyPrice,
        )
      : 0;

  const additionalStorageTotal =
    config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0
      ? toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate)
      : 0;

  if (midPeriodOnly) {
    const additionalUsageTotal = additionalContacts + additionalStorageTotal;
    const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
    const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
    return {
      baseMonthlyTotal: 0,
      setupTotal: 0,
      additionalUsageTotal,
      discountAmount: 0,
      addonDiscountAmount,
      finalMonthlyTotal: addonNet,
      finalPayableEstimate: addonNet,
      coreMonthlyAmount: 0,
      addonAmount: addonNet,
    };
  }

  const baseMonthlyTotal = isFeatureEnabled(config, "subscriptionEnabled")
    ? toNumber(config.monthlyBasePrice)
    : 0;
  const setupGross = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const setupTotal = netImplementationSetupTotal(config, setupGross);
  const additionalUsageTotal = additionalContacts + additionalStorageTotal;
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const coreNet = Math.max(baseMonthlyTotal - discountAmount, 0);
  const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
  const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
  const finalMonthlyTotal = coreNet + addonNet;

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    addonDiscountAmount,
    implementationDiscountAmount: calculateImplementationDiscount(config, setupGross),
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
  };
}

function calculateTicketingPricing(config) {
  const midPeriodOnly = isMidPeriodAddonBilling(config);
  const additionalUsersTotal =
    config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0
      ? toNumber(config.additionalUserCount) * toNumber(config.userLicenseRate)
      : 0;
  const additionalTicketsTotal =
    config.additionalTicketsEnabled && config.additionalTicketSlab
      ? toNumber(getTicketSlabs(config.region)[config.additionalTicketSlab]?.monthlyPrice)
      : 0;
  const additionalStorageTotal =
    config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0
      ? toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate)
      : 0;
  const additionalUsageTotal = additionalUsersTotal + additionalTicketsTotal + additionalStorageTotal;

  if (midPeriodOnly) {
    const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
    const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
    return {
      baseMonthlyTotal: 0,
      setupTotal: 0,
      additionalUsageTotal,
      discountAmount: 0,
      addonDiscountAmount,
      finalMonthlyTotal: addonNet,
      finalPayableEstimate: addonNet,
      coreMonthlyAmount: 0,
      addonAmount: addonNet,
    };
  }

  const baseMonthlyTotal = isFeatureEnabled(config, "usersEnabled")
    ? toNumber(config.userCount) * toNumber(config.userLicenseRate)
    : 0;
  const setupGross = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const setupTotal = netImplementationSetupTotal(config, setupGross);
  const discountAmount = calculateDiscount(config, baseMonthlyTotal);
  const coreNet = Math.max(baseMonthlyTotal - discountAmount, 0);
  const addonDiscountAmount = calculateAddonDiscount(config, additionalUsageTotal);
  const addonNet = Math.max(additionalUsageTotal - addonDiscountAmount, 0);
  const finalMonthlyTotal = coreNet + addonNet;

  return {
    baseMonthlyTotal,
    setupTotal,
    additionalUsageTotal,
    discountAmount,
    addonDiscountAmount,
    implementationDiscountAmount: calculateImplementationDiscount(config, setupGross),
    finalMonthlyTotal,
    finalPayableEstimate: finalMonthlyTotal + setupTotal,
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
  };
}

function getBillingMultiplier(billingCycle) {
  return billingCycle === "yearly" ? 12 : 1;
}

function applyBillingCycle(amount, billingCycle) {
  return amount * getBillingMultiplier(billingCycle);
}

function getConfiguredPrice(config, { implementationOnly = false } = {}) {
  return getPricingTotals(config, { implementationOnly }).finalMonthlyTotal;
}

function getAssignmentPayableTotal(config, { implementationOnly = false } = {}) {
  if (!config) {
    return 0;
  }

  return getPricingTotals(config, { implementationOnly }).finalPayableEstimate;
}

function canCreateQuotationInvoice(
  assignments,
  { metricsOnly = false, temporaryLead = false } = {},
) {
  if (!assignments.length) {
    return false;
  }

  if (metricsOnly) {
    return assignments.every((entry) => isProductConfigured(entry.config, { metricsOnly: true }));
  }

  // Temporary Lead: finance-only invoice — any product assignment may proceed at zero.
  if (temporaryLead) {
    return assignments.every((entry) =>
      isProductConfigured(entry.config, { temporaryLead: true }),
    );
  }

  // Every product must be fully configured.
  const allConfigured = assignments.every((entry) => isProductConfigured(entry.config));
  if (!allConfigured) {
    return false;
  }

  // OTC phase: gross implementation fee > 0 is enough (net may be 0 after 100% discount).
  const needsImplementation = assignments.some((entry) =>
    assignmentNeedsImplementationInvoice(entry.config || {}),
  );
  if (needsImplementation) {
    return true;
  }

  return assignments.some(
    (entry) => getAssignmentPayableTotal(entry.config, { implementationOnly: false }) > 0,
  );
}

function assignmentNeedsImplementationInvoice(config = {}) {
  if (config.implementationPurchased === true || config.implementationEnabled === false) {
    return false;
  }
  const fee = toNumber(config.implementationFee ?? config.implementationCost ?? 0);
  return fee > 0;
}

function getPricingTotals(config, { asOf = new Date(), implementationOnly = false } = {}) {
  let totals;
  if (config.pricingMode === "ccaas") {
    totals = calculateCcaasPricing(config);
  } else if (config.pricingMode === "crm") {
    totals = calculateCrmPricing(config);
  } else if (config.pricingMode === "cdp") {
    totals = calculateCdpPricing(config);
  } else if (config.pricingMode === "campaign") {
    totals = calculateCampaignPricing(config);
  } else if (config.pricingMode === "value-management") {
    totals = calculateValueManagementPricing(config);
  } else if (config.pricingMode === "ticketing") {
    totals = calculateTicketingPricing(config);
  } else {
    totals = calculateGenericPricing(config);
  }

  const addonAmount = toNumber(totals.addonAmount ?? 0);
  const coreMonthlyAmount = toNumber(
    totals.coreMonthlyAmount ?? Math.max(totals.finalMonthlyTotal - addonAmount, 0),
  );

  const periodPricing = applyInvoicePeriodPricing({
    coreMonthlyAmount,
    addonAmount,
    setupAmount: totals.setupTotal,
    billingCycle: config.billingCycle || "monthly",
    asOf,
    implementationOnly,
    skipProration: resolveSkipInvoiceProration(config),
    periodStart: config.periodStart || null,
    periodEnd: config.periodEnd || null,
  });

  return {
    ...totals,
    billingLabel: periodPricing.implementationOnly
      ? "One-time"
      : periodPricing.billingCycle === "yearly"
        ? "Yearly"
        : "Monthly",
    finalMonthlyTotal: periodPricing.recurringDue,
    finalPayableEstimate: periodPricing.totalDue,
    prorationNote: periodPricing.prorationNote,
    periodLabel: periodPricing.periodLabel,
    isProrated: periodPricing.isProrated,
    periodStart: periodPricing.periodStart,
    periodEnd: periodPricing.periodEnd,
    implementationOnly: Boolean(periodPricing.implementationOnly),
  };
}

function isImplementationFeeMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  const amount = Number(value);
  // Gross implementation cost must be > 0. Empty/0 is invalid; 100% discount (net 0) is separate.
  if (!Number.isFinite(amount) || amount <= 0) return true;
  return false;
}

function isCcaasConfigured(config) {
  if (isMidPeriodAddonBilling(config)) {
    return hasAnyMidPeriodAddonSelected(config);
  }

  if (!config.licenseTier) {
    return false;
  }

  // Implementation is compulsory with Base Plan unless already purchased.
  // Gross fee must be > 0 (100% discount / net 0 is allowed later at invoice time).
  if (!config.implementationPurchased && isImplementationFeeMissing(config.implementationFee)) {
    return false;
  }

  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";

  if (!modulesAreComplete(config.modules, config.licenseTier, catalog, region)) {
    return false;
  }

  return hasAnyActiveModule(config.modules, config.licenseTier, catalog, region);
}

/** Customer portal / metrics-only: plan + modules, no implementation fee or rates. */
function isCcaasConfiguredMetrics(config) {
  if (isMidPeriodAddonBilling(config)) {
    return hasAnyMidPeriodAddonSelected(config);
  }

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
  if (isMidPeriodAddonBilling(config)) {
    return hasAnyMidPeriodAddonSelected(config);
  }

  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const contactsOn = config.additionalContactsEnabled;
  const additionalUsersOn = config.additionalUsersEnabled;
  const additionalNumbersOn = config.additionalNumbersEnabled;
  const additionalStorageOn = config.additionalStorageEnabled;

  // New / full CRM quotes require the base plan (user seats).
  if (!usersOn) {
    return false;
  }

  if (!(config.userCount && config.userLicenseRate)) {
    return false;
  }

  // Implementation is compulsory with Base Plan unless already purchased.
  if (!config.implementationPurchased && isImplementationFeeMissing(config.implementationCost)) {
    return false;
  }

  if (additionalUsersOn && !(config.additionalUserCount && (config.additionalUserLicenseRate || config.userLicenseRate))) {
    return false;
  }

  if (additionalNumbersOn && !(toNumber(config.additionalNumberCount) > 0)) {
    return false;
  }

  if (additionalStorageOn && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  return true;
}

function isCampaignConfigured(config) {
  if (isMidPeriodAddonBilling(config)) {
    const contactsOn = config.additionalContactsEnabled && config.additionalContactSlab;
    const channelUsage = calculateCampaignChannelUsage(config) > 0;
    // Campaign numbers removed — mid-period uses storage / contacts / channels only.
    const storageOn =
      (config.midPeriodAddons?.storage?.enabled || config.additionalStorageEnabled) &&
      toNumber(config.midPeriodAddons?.storage?.count || config.additionalStorageCount) > 0;
    return Boolean(contactsOn || channelUsage || storageOn);
  }

  const baseOn = isFeatureEnabled(config, "basePlanEnabled");
  const contactsOn = config.additionalContactsEnabled;
  const additionalStorageOn = config.additionalStorageEnabled;

  // New / full Campaign quotes require the base plan.
  if (!baseOn) {
    return false;
  }

  if (!config.monthlyBasePrice) {
    return false;
  }

  // Implementation is compulsory with Base Plan unless already purchased.
  if (!config.implementationPurchased && isImplementationFeeMissing(config.implementationFee)) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  if (additionalStorageOn && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isValueManagementConfigured(config) {
  if (isMidPeriodAddonBilling(config)) {
    const contactsOn = config.additionalContactsEnabled && config.additionalContactSlab;
    const storageOn =
      config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
    return Boolean(contactsOn || storageOn);
  }

  const subOn = isFeatureEnabled(config, "subscriptionEnabled");
  const contactsOn = config.additionalContactsEnabled;

  // New / full Value Management quotes require the base subscription.
  if (!subOn) {
    return false;
  }

  if (!config.monthlyBasePrice) {
    return false;
  }

  // Implementation is compulsory with Base Plan unless already purchased.
  if (!config.implementationPurchased && isImplementationFeeMissing(config.implementationFee)) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isTicketingConfigured(config) {
  if (isMidPeriodAddonBilling(config)) {
    const usersOn = config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0;
    const ticketsOn = config.additionalTicketsEnabled && config.additionalTicketSlab;
    const storageOn =
      config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
    return Boolean(usersOn || ticketsOn || storageOn);
  }

  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const ticketsOn = config.additionalTicketsEnabled;
  const additionalUsersOn = config.additionalUsersEnabled;

  // New / full Ticketing quotes require the base plan (user seats).
  if (!usersOn) {
    return false;
  }

  if (!(config.userCount && config.userLicenseRate)) {
    return false;
  }

  // Implementation is compulsory with Base Plan unless already purchased.
  if (!config.implementationPurchased && isImplementationFeeMissing(config.implementationFee)) {
    return false;
  }

  if (additionalUsersOn && !(config.additionalUserCount && config.userLicenseRate)) {
    return false;
  }

  if (ticketsOn && !config.additionalTicketSlab) {
    return false;
  }

  if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isCdpConfigured(config) {
  if (isMidPeriodAddonBilling(config)) {
    const contactsOn = config.additionalContactsEnabled && config.additionalContactSlab;
    const storageOn =
      config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
    return Boolean(contactsOn || storageOn);
  }

  const platformOn = isFeatureEnabled(config, "platformEnabled");
  const contactsOn = config.additionalContactsEnabled;

  // New / full CDP quotes require the platform base plan.
  if (!platformOn) {
    return false;
  }

  if (!config.monthlyBasePrice) {
    return false;
  }

  // Implementation is compulsory with Base Plan unless already purchased.
  if (!config.implementationPurchased && isImplementationFeeMissing(config.implementationFee)) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isCrmConfiguredMetrics(config) {
  if (isMidPeriodAddonBilling(config)) {
    return hasAnyMidPeriodAddonSelected(config);
  }

  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const contactsOn = config.additionalContactsEnabled;
  const additionalUsersOn = config.additionalUsersEnabled;
  const additionalNumbersOn = config.additionalNumbersEnabled;
  const additionalStorageOn = config.additionalStorageEnabled;

  // Customer upgrade/new requests still need base seats unless mid-period add-ons only.
  if (!usersOn) {
    return false;
  }

  if (!config.userCount) {
    return false;
  }

  if (additionalUsersOn && !config.additionalUserCount) {
    return false;
  }

  if (additionalNumbersOn && !(toNumber(config.additionalNumberCount) > 0)) {
    return false;
  }

  if (additionalStorageOn && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  return true;
}

function isCampaignConfiguredMetrics(config) {
  if (isMidPeriodAddonBilling(config)) {
    const contactsOn = config.additionalContactsEnabled && config.additionalContactSlab;
    const hasChannel =
      config.emailCount ||
      config.smsCount ||
      config.whatsappCredits ||
      config.webPushSubscribers ||
      config.appPushSubscribers;
    // Campaign numbers removed — mid-period uses storage / contacts / channels only.
    const storageOn =
      (config.midPeriodAddons?.storage?.enabled || config.additionalStorageEnabled) &&
      toNumber(config.midPeriodAddons?.storage?.count || config.additionalStorageCount) > 0;
    return Boolean(contactsOn || hasChannel || storageOn);
  }

  const baseOn = isFeatureEnabled(config, "basePlanEnabled");
  const contactsOn = config.additionalContactsEnabled;
  const additionalStorageOn = config.additionalStorageEnabled;

  if (!baseOn) {
    return false;
  }

  if (!config.includedContacts) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  if (additionalStorageOn && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isValueManagementConfiguredMetrics(config) {
  if (isMidPeriodAddonBilling(config)) {
    const contactsOn = config.additionalContactsEnabled && config.additionalContactSlab;
    const storageOn =
      config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
    return Boolean(contactsOn || storageOn);
  }

  const subOn = isFeatureEnabled(config, "subscriptionEnabled");
  const contactsOn = config.additionalContactsEnabled;

  if (!subOn) {
    return false;
  }

  if (!config.monthlyActiveUsers) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isTicketingConfiguredMetrics(config) {
  if (isMidPeriodAddonBilling(config)) {
    const usersOn = config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0;
    const ticketsOn = config.additionalTicketsEnabled && config.additionalTicketSlab;
    const storageOn =
      config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
    return Boolean(usersOn || ticketsOn || storageOn);
  }

  const usersOn = isFeatureEnabled(config, "usersEnabled");
  const ticketsOn = config.additionalTicketsEnabled;
  const additionalUsersOn = config.additionalUsersEnabled;

  if (!usersOn) {
    return false;
  }

  if (!config.userCount) {
    return false;
  }

  if (additionalUsersOn && !config.additionalUserCount) {
    return false;
  }

  if (ticketsOn && !config.additionalTicketSlab) {
    return false;
  }

  if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isCdpConfiguredMetrics(config) {
  if (isMidPeriodAddonBilling(config)) {
    const contactsOn = config.additionalContactsEnabled && config.additionalContactSlab;
    const storageOn =
      config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
    return Boolean(contactsOn || storageOn);
  }

  const platformOn = isFeatureEnabled(config, "platformEnabled");
  const contactsOn = config.additionalContactsEnabled;

  if (!platformOn) {
    return false;
  }

  if (!config.customerProfiles) {
    return false;
  }

  if (contactsOn && !config.additionalContactSlab) {
    return false;
  }

  if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
    return false;
  }

  return true;
}

function isProductConfigured(config, { metricsOnly = false, temporaryLead = false } = {}) {
  if (metricsOnly) {
    if (config.pricingMode === "ccaas") {
      return isCcaasConfiguredMetrics(config);
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

  // Temporary Lead Set pricing: nothing mandatory — empty/zero rates are allowed.
  if (temporaryLead || config?.zeroCatalogDefaults) {
    return Boolean(config?.productId || config?.pricingMode);
  }

  const productHandler = productPricingRegistry[config.productId];

  return productHandler ? productHandler.isConfigured(config) : Boolean(config.basePrice);
}

function getCcaasConfigFieldErrors(config, { metricsOnly = false } = {}) {
  const errors = {
    modules: {},
    usageDetails: {},
    addons: {},
    implementationFee: false,
    licenseTier: false,
    needsConfigurationExpand: false,
    needsAddonsExpand: false,
    needsModulesHighlight: false,
  };

  if (!config) {
    return errors;
  }

  if (isMidPeriodAddonBilling(config)) {
    if (hasAnyMidPeriodAddonSelected(config)) {
      return errors;
    }

    errors.needsAddonsExpand = true;
    const mid = config.midPeriodAddons || ensureMidPeriodAddons(config, { addonsOnly: true }).midPeriodAddons;
    let markedPartial = false;

    if (mid.humanAgent?.enabled && !(toNumber(mid.humanAgent.count) > 0)) {
      errors.addons.humanAgentCount = true;
      markedPartial = true;
    }
    if (mid.queueCapacity?.enabled && !(toNumber(mid.queueCapacity.count) > 0)) {
      errors.addons.queueCapacityCount = true;
      markedPartial = true;
    }
    if (mid.storage?.enabled && !(toNumber(mid.storage.count) > 0)) {
      errors.addons.storageCount = true;
      markedPartial = true;
    }

    const catalog = getCachedPricingCatalog();
    const contactCenter = catalog.products?.["contact-center"] || {};
    for (const channel of getVisiblePlanAddonChannels(config, contactCenter)) {
      const entry = mid.channels?.[channel.id];
      if (entry?.enabled && !entry.slabId) {
        errors.addons[`channel:${channel.id}`] = true;
        markedPartial = true;
      }
    }

    if (!markedPartial) {
      errors.addons.section = true;
    }
    return errors;
  }

  if (!config.licenseTier) {
    errors.licenseTier = true;
    return errors;
  }

  if (
    !metricsOnly &&
    !config.implementationPurchased &&
    isImplementationFeeMissing(config.implementationFee)
  ) {
    errors.implementationFee = true;
  }

  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";
  const modulesConfig = config.modules || {};
  const planModuleRows = getPlanModuleRows(catalog.products?.["contact-center"], config.licenseTier);

  for (const row of planModuleRows) {
    const moduleId = resolvePlanModuleKey(row);
    if (!modulesConfig[moduleId]?.optionId) {
      errors.modules[moduleId] = true;
      errors.needsModulesHighlight = true;
    }
  }

  if (!hasAnyActiveModule(modulesConfig, config.licenseTier, catalog, region)) {
    errors.needsModulesHighlight = true;
    for (const row of planModuleRows) {
      const moduleId = resolvePlanModuleKey(row);
      if (!isModuleBillable(modulesConfig[moduleId])) {
        errors.modules[moduleId] = true;
      }
    }
  }

  const agentCount = Math.max(0, toNumber(config.usageDetails?.agentCount));
  if (agentCount < 1) {
    errors.usageDetails.agentCount = true;
    errors.needsConfigurationExpand = true;
  }

  return errors;
}

function getCcaasConfigErrorMessage(errors, { metricsOnly = false } = {}) {
  if (!errors) {
    return metricsOnly
      ? "Configure the required product metrics before continuing."
      : "Complete the required base plan and add-on fields before continuing.";
  }
  if (errors.licenseTier) return "Select a license plan above to continue.";
  if (errors.needsAddonsExpand) {
    return "Select at least one mid-period add-on with quantity before continuing.";
  }
  if (errors.needsModulesHighlight) {
    return "Complete the required base plan module selections before continuing.";
  }
  if (errors.usageDetails?.agentCount) {
    return "Enter agent count in Configuration before continuing.";
  }
  if (errors.implementationFee) {
    return "Enter an implementation fee greater than zero before continuing.";
  }
  return metricsOnly
    ? "Configure the required product metrics before continuing."
    : "Complete the required base plan and add-on fields before continuing.";
}

function ccaasFieldErrorsHaveIssues(errors) {
  if (!errors) return false;
  if (errors.licenseTier || errors.implementationFee) return true;
  if (errors.needsConfigurationExpand || errors.needsAddonsExpand || errors.needsModulesHighlight) {
    return true;
  }
  if (Object.keys(errors.modules || {}).length > 0) return true;
  if (Object.keys(errors.usageDetails || {}).length > 0) return true;
  if (Object.keys(errors.addons || {}).length > 0) return true;
  return false;
}

const IMPLEMENTATION_FEE_REQUIRED_MSG = "Enter an implementation fee greater than zero.";

function pricingFieldErrorText(fieldErrors, key, fallback = "This field is required.") {
  const value = fieldErrors?.[key];
  if (!value) {
    return "";
  }
  return typeof value === "string" ? value : fallback;
}

function productFieldErrorsHaveIssues(errors) {
  if (!errors) {
    return false;
  }
  return Object.keys(errors).some((key) => {
    const value = errors[key];
    if (value == null || value === false) {
      return false;
    }
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return Boolean(value);
  });
}

function getFirstProductFieldErrorMessage(errors, { metricsOnly = false } = {}) {
  if (!errors) {
    return metricsOnly
      ? "Configure the required product metrics before continuing."
      : "Complete the required base plan and add-on fields before continuing.";
  }
  for (const value of Object.values(errors)) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return metricsOnly
    ? "Configure the required product metrics before continuing."
    : "Complete the required base plan and add-on fields before continuing.";
}

/** Field-level errors for CRM / CDP / Campaign / VM / Ticketing / Generic (non-CCAAS). */
function getProductConfigFieldErrors(config, { metricsOnly = false } = {}) {
  const errors = {};
  if (!config || config.pricingMode === "ccaas") {
    return errors;
  }

  const requireImplementation = () => {
    if (metricsOnly || config.implementationPurchased) {
      return;
    }
    if (config.pricingMode === "crm") {
      if (isImplementationFeeMissing(config.implementationCost)) {
        errors.implementationCost = IMPLEMENTATION_FEE_REQUIRED_MSG;
      }
      return;
    }
    if (isImplementationFeeMissing(config.implementationFee)) {
      errors.implementationFee = IMPLEMENTATION_FEE_REQUIRED_MSG;
    }
  };

  if (isMidPeriodAddonBilling(config)) {
    if (!isProductConfigured(config, { metricsOnly })) {
      errors.addons = "Select at least one mid-period add-on before continuing.";
    }
    return errors;
  }

  if (config.pricingMode === "crm") {
    if (!(toNumber(config.userCount) > 0)) {
      errors.userCount = "Enter a user count greater than zero.";
    }
    if (!metricsOnly && !(toNumber(config.userLicenseRate) > 0)) {
      errors.userLicenseRate = "Enter a user license rate greater than zero.";
    }
    requireImplementation();
    if (config.additionalUsersEnabled && !(toNumber(config.additionalUserCount) > 0)) {
      errors.additionalUserCount = "Enter an additional user count greater than zero.";
    }
    if (config.additionalNumbersEnabled && !(toNumber(config.additionalNumberCount) > 0)) {
      errors.additionalNumberCount = "Enter an additional number count greater than zero.";
    }
    if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
      errors.additionalStorageCount = "Enter an add-on storage amount greater than zero.";
    }
    if (config.additionalContactsEnabled && !config.additionalContactSlab) {
      errors.additionalContactSlab = "Select a contact slab.";
    }
    return errors;
  }

  if (config.pricingMode === "campaign") {
    if (!metricsOnly && !(toNumber(config.monthlyBasePrice) > 0)) {
      errors.monthlyBasePrice = "Enter a base price greater than zero.";
    }
    if (metricsOnly && !(toNumber(config.includedContacts) > 0)) {
      errors.includedContacts = "Enter included contacts greater than zero.";
    }
    requireImplementation();
    if (config.additionalContactsEnabled && !config.additionalContactSlab) {
      errors.additionalContactSlab = "Select a contact slab.";
    }
    // Campaign additional numbers removed — do not validate number count.
    if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
      errors.additionalStorageCount = "Enter an add-on storage amount greater than zero.";
    }
    return errors;
  }

  if (config.pricingMode === "cdp") {
    if (!metricsOnly && !(toNumber(config.monthlyBasePrice) > 0)) {
      errors.monthlyBasePrice = "Enter a base price greater than zero.";
    }
    if (metricsOnly && !(toNumber(config.customerProfiles) > 0)) {
      errors.customerProfiles = "Enter customer profiles greater than zero.";
    }
    requireImplementation();
    if (config.additionalContactsEnabled && !config.additionalContactSlab) {
      errors.additionalContactSlab = "Select a contact slab.";
    }
    if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
      errors.additionalStorageCount = "Enter an add-on storage amount greater than zero.";
    }
    return errors;
  }

  if (config.pricingMode === "value-management") {
    if (!metricsOnly && !(toNumber(config.monthlyBasePrice) > 0)) {
      errors.monthlyBasePrice = "Enter a base price greater than zero.";
    }
    if (metricsOnly && !(toNumber(config.monthlyActiveUsers) > 0)) {
      errors.monthlyActiveUsers = "Enter active users greater than zero.";
    }
    requireImplementation();
    if (config.additionalContactsEnabled && !config.additionalContactSlab) {
      errors.additionalContactSlab = "Select a contact slab.";
    }
    if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
      errors.additionalStorageCount = "Enter an add-on storage amount greater than zero.";
    }
    return errors;
  }

  if (config.pricingMode === "ticketing") {
    if (!(toNumber(config.userCount) > 0)) {
      errors.userCount = "Enter a user count greater than zero.";
    }
    if (!metricsOnly && !(toNumber(config.userLicenseRate) > 0)) {
      errors.userLicenseRate = "Enter a user license rate greater than zero.";
    }
    requireImplementation();
    if (config.additionalUsersEnabled && !(toNumber(config.additionalUserCount) > 0)) {
      errors.additionalUserCount = "Enter an additional user count greater than zero.";
    }
    if (config.additionalTicketsEnabled && !config.additionalTicketSlab) {
      errors.additionalTicketSlab = "Select a ticket slab.";
    }
    if (config.additionalStorageEnabled && !(toNumber(config.additionalStorageCount) > 0)) {
      errors.additionalStorageCount = "Enter an add-on storage amount greater than zero.";
    }
    return errors;
  }

  if (!metricsOnly && !(toNumber(config.basePrice) > 0)) {
    errors.basePrice = "Enter a base price greater than zero.";
  }
  if (metricsOnly && !String(config.usagePackage || "").trim()) {
    errors.usagePackage = "Enter a usage package.";
  }
  return errors;
}

function scrollToFirstPricingInvalidField() {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      document
        .querySelector("[data-pricing-invalid='true']")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  });
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
  const exitPath =
    cancelPath ||
    location.state?.returnTo ||
    (isCustomerRequest ? "/customer/products" : `/products/${leadId}`);
  const [lead, setLead] = useState(isCustomerRequest ? embeddedLead : null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [draftNewBranches, setDraftNewBranches] = useState([]);
  const existingBranches = useMemo(() => {
    const all = getLeadBranches(lead);
    if (!customerBranchId) {
      return all;
    }

    return all.filter((branch) => branch.id === customerBranchId);
  }, [customerBranchId, lead]);
  const branches = useMemo(() => {
    const byId = new Map(existingBranches.map((branch) => [String(branch.id), branch]));
    for (const entry of draftNewBranches) {
      byId.set(String(entry.id), {
        id: entry.id,
        label: String(entry.label || "").trim() || "New location",
        address: String(entry.address || "").trim(),
        country: String(entry.country || "").trim(),
        taxNumber: String(entry.taxNumber || "").trim(),
        isPrimary: false,
        status: "active",
        isDraft: true,
      });
    }
    return [...byId.values()];
  }, [draftNewBranches, existingBranches]);
  const multipleBranches = !customerBranchId && leadHasMultipleBranches(lead);
  // Hidden for now — single-location UI. Original:
  // const showBranchAssignment =
  //   isCustomerRequest || multipleBranches || draftNewBranches.length > 0;
  const showBranchAssignment = false;
  const leadWithDrafts = useMemo(() => {
    if (!lead || !draftNewBranches.length) {
      return lead;
    }
    const draftIds = new Set(draftNewBranches.map((entry) => String(entry.id)));
    return {
      ...lead,
      additionalAddresses: [
        ...(lead.additionalAddresses || []).filter(
          (entry) => !draftIds.has(String(entry.id)),
        ),
        ...draftNewBranches,
      ],
    };
  }, [draftNewBranches, lead]);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [stage, setStage] = useState("select");
  const [assignments, setAssignments] = useState([]);
  const [activeAssignmentIndex, setActiveAssignmentIndex] = useState(0);
  const [invoiceMode, setInvoiceMode] = useState(INVOICE_MODES.CONSOLIDATED);
  const [temporaryInvoiceContents, setTemporaryInvoiceContents] = useState("all");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [isRenewalQuote, setIsRenewalQuote] = useState(false);
  const [purchaseIntent, setPurchaseIntent] = useState(""); // "new" | "addon" | ""
  const [lockedToProductRequest, setLockedToProductRequest] = useState(false);
  const [sourceProductRequestId, setSourceProductRequestId] = useState(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState("");
  const [invoiceFileName, setInvoiceFileName] = useState("");
  const [invoicePdfBase64, setInvoicePdfBase64] = useState("");
  const [invoicePreviews, setInvoicePreviews] = useState([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [configError, setConfigError] = useState("");
  const [pricingFieldErrors, setPricingFieldErrors] = useState(null);
  const [ccaasPanelExpandRequest, setCcaasPanelExpandRequest] = useState(0);
  const [customerNote, setCustomerNote] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [proceedingToFinance, setProceedingToFinance] = useState(false);
  const [pricingCatalogVersion, setPricingCatalogVersion] = useState(0);
  const [openProductRequests, setOpenProductRequests] = useState([]);
  const [customerRequestsReady, setCustomerRequestsReady] = useState(!isCustomerRequest);
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [conflictRequest, setConflictRequest] = useState(null);
  const [conflictProductId, setConflictProductId] = useState("");
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState("");
  const catalogProducts = useMemo(
    () =>
      products.map((product) => ({
        ...product,
        name: getProductName(product.id),
      })),
    [pricingCatalogVersion],
  );
  const workflowInitializedRef = useRef(false);
  const suppressDraftRestoreRef = useRef(false);
  const suppressInvoicePreviewOnceRef = useRef(false);

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
    const temporary = isTemporaryLead(lead);

    const stamped = temporary
      ? billingNormalized.map((assignment) => {
          const config = { ...(assignment.config || {}), zeroCatalogDefaults: true };
          if (typeof config.proratedBilling !== "boolean") {
            config.proratedBilling = false;
            config.skipInvoiceProration = true;
          } else {
            config.skipInvoiceProration = !config.proratedBilling;
          }
          return { ...assignment, config };
        })
      : billingNormalized;

    if (!lead?.activeProducts?.length) {
      return stamped;
    }

    return stamped.map((assignment) => ({
      ...assignment,
      config: applyPurchaseHistoryToConfig(assignment.config, lead, assignment.productId),
    }));
  }

  useEffect(() => {
    if (!isCustomerRequest) {
      setCustomerRequestsReady(true);
      return;
    }

    let cancelled = false;
    setCustomerRequestsReady(false);
    void listMyProductRequests()
      .then((rows) => {
        if (!cancelled) {
          setOpenProductRequests(Array.isArray(rows) ? rows : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOpenProductRequests([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCustomerRequestsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isCustomerRequest]);

  useEffect(() => {
    if (!lead || workflowInitializedRef.current || !isCustomerRequest || !customerRequestsReady) {
      return;
    }

    const productRequest = location.state?.seedFromProductRequest;
    if (productRequest?.id && location.state?.customerEditRequest) {
      workflowInitializedRef.current = true;
      const requestAssignments = Array.isArray(productRequest.assignments)
        ? productRequest.assignments.filter((entry) => entry?.productId)
        : [];
      const seeded = requestAssignments.map((entry) =>
        createAssignment(
          entry.productId,
          entry.branchId,
          entry.billingBranchId || entry.branchId,
          { ...(entry.config || {}) },
          entry.changeType || CHANGE_TYPES.UPGRADE,
        ),
      );
      setEditingRequestId(productRequest.id);
      setLockedToProductRequest(true);
      setSourceProductRequestId(productRequest.id);
      setSelectedProductIds([...new Set(seeded.map((entry) => entry.productId))]);
      setAssignments(normalizeAssignmentsWithPurchaseHistory(seeded));
      setCustomerNote(String(productRequest.customerNote || ""));
      setDraftNewBranches(
        Array.isArray(productRequest.newBranches) ? productRequest.newBranches : [],
      );
      setStage("configure");
      setActiveAssignmentIndex(0);
      navigate(location.pathname, { replace: true, state: {} });
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
        const openConflict = findOpenProductRequestForProduct(
          openProductRequests,
          existing.productId,
          existing.branchId,
        );
        if (openConflict) {
          setConflictRequest(openConflict);
          setConflictProductId(existing.productId);
          setConflictError("");
          return;
        }

        const changeType =
          existing.productId === "contact-center" &&
          isMidPeriodAddonOnlyQuote(lead, existing.productId, existing.branchId, {
            renewal: false,
          })
            ? CHANGE_TYPES.ADDON
            : CHANGE_TYPES.UPGRADE;
        const existingConfig = { ...(existing.config || {}) };
        const configForAssignment =
          existing.productId === "contact-center" &&
          changeType === CHANGE_TYPES.UPGRADE &&
          existingConfig.pricingMode === "ccaas"
            ? { ...existingConfig, licenseTier: "" }
            : existingConfig;

        setSelectedProductIds([existing.productId]);
        setAssignments(
          normalizeAssignmentsWithPurchaseHistory([
            createAssignment(
              existing.productId,
              existing.branchId,
              existing.billingBranchId || existing.branchId,
              configForAssignment,
              changeType,
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
  }, [
    customerRequestsReady,
    isCustomerRequest,
    lead,
    location.pathname,
    location.state,
    navigate,
    openProductRequests,
    preselectedProductKey,
    requestIntent,
  ]);

  useEffect(() => {
    if (!lead || workflowInitializedRef.current || isCustomerRequest) {
      return;
    }

    workflowInitializedRef.current = true;

    if (location.state?.freshQuote) {
      suppressDraftRestoreRef.current = true;
      void clearProductDraft(leadId);

      if (location.state?.renewal) {
        const activeProducts = getActiveProducts(lead);
        const subscriptionId = location.state.subscriptionId;
        const productId = location.state.productId;
        const existing =
          (subscriptionId
            ? activeProducts.find((entry) => entry.subscriptionId === subscriptionId)
            : null) ||
          (productId
            ? activeProducts.find((entry) => entry.productId === productId)
            : null);

        if (existing) {
          const seededConfig = { ...(existing.config || {}) };
          const renewalAddonIds = defaultRenewalAddonSelection(existing.productId, seededConfig);
          seededConfig.renewalAddonSelection = renewalAddonIds;

          setIsRenewalQuote(true);
          setPurchaseIntent("");
          setLockedToProductRequest(false);
          setSourceProductRequestId(null);
          setSelectedProductIds([existing.productId]);
          setAssignments(
            normalizeAssignmentsWithPurchaseHistory([
              createAssignment(
                existing.productId,
                existing.branchId,
                existing.billingBranchId || existing.branchId,
                seededConfig,
                CHANGE_TYPES.UPGRADE,
              ),
            ]),
          );
          setStage("configure");
          setActiveAssignmentIndex(0);
          setConfigError("");
          navigate(location.pathname, { replace: true, state: {} });
          return;
        }
      }

      if (location.state?.changeTypeIntent === "addon") {
        const activeProducts = getActiveProducts(lead);
        const subscriptionId = location.state.subscriptionId;
        const productId = location.state.productId;
        const uniqueProductIds = [...new Set(activeProducts.map((entry) => entry.productId))];
        // Prefer an explicit product/subscription. Never hard-default to activeProducts[0]
        // (catalog/merge order often surfaces value-management / CVM first).
        let existing = null;
        if (subscriptionId) {
          existing =
            activeProducts.find((entry) => entry.subscriptionId === subscriptionId) || null;
        }
        if (!existing && productId) {
          existing = activeProducts.find((entry) => entry.productId === productId) || null;
        }
        if (!existing && !subscriptionId && !productId && uniqueProductIds.length === 1) {
          existing =
            activeProducts.find((entry) => entry.productId === uniqueProductIds[0]) ||
            activeProducts[0] ||
            null;
        }

        if (existing) {
          setIsRenewalQuote(false);
          setPurchaseIntent("addon");
          setLockedToProductRequest(false);
          setSourceProductRequestId(null);
          setSelectedProductIds([existing.productId]);
          setAssignments(
            normalizeAssignmentsWithPurchaseHistory([
              createAssignment(
                existing.productId,
                existing.branchId,
                existing.billingBranchId || existing.branchId,
                { ...(existing.config || {}) },
                CHANGE_TYPES.ADDON,
              ),
            ]),
          );
          setStage("configure");
          setActiveAssignmentIndex(0);
          setConfigError("");
          navigate(location.pathname, { replace: true, state: {} });
          return;
        }

        // Multiple active products and no target chosen — pick on Choose products (active only).
        if (activeProducts.length > 0) {
          setIsRenewalQuote(false);
          setPurchaseIntent("addon");
          setLockedToProductRequest(false);
          setSourceProductRequestId(null);
          setSelectedProductIds([]);
          setAssignments([]);
          setStage("select");
          setActiveAssignmentIndex(0);
          setConfigError("");
          navigate(location.pathname, { replace: true, state: {} });
          return;
        }
      }

      if (location.state?.changeTypeIntent === "new") {
        setIsRenewalQuote(false);
        setPurchaseIntent("new");
        setLockedToProductRequest(false);
        setSourceProductRequestId(null);
        setSelectedProductIds([]);
        setAssignments([]);
        setStage("select");
        setActiveAssignmentIndex(0);
        setConfigError("");
        navigate(location.pathname, { replace: true, state: {} });
        return;
      }

      const productRequest = location.state?.seedFromProductRequest;
      const requestAssignments = Array.isArray(productRequest?.assignments)
        ? productRequest.assignments.filter((entry) => entry?.productId)
        : [];
      const isInquirySeed =
        String(productRequest?.requestType || "").trim().toLowerCase() === "inquiry";

      if (productRequest?.id && isInquirySeed && requestAssignments.length === 0) {
        setIsRenewalQuote(false);
        setLockedToProductRequest(true);
        setSourceProductRequestId(productRequest.id);
        setSelectedProductIds([]);
        setAssignments([]);
        setStage("select");
        setActiveAssignmentIndex(0);
        setConfigError("");
        navigate(location.pathname, { replace: true, state: {} });
        return;
      }

      if (requestAssignments.length > 0) {
        const applySeed = (refreshedLead = null) => {
          if (refreshedLead) {
            setLead(refreshedLead);
          }

          const seeded = requestAssignments.map((entry) =>
            createAssignment(
              entry.productId,
              entry.branchId,
              entry.billingBranchId || entry.branchId,
              { ...(entry.config || {}) },
              entry.changeType || CHANGE_TYPES.UPGRADE,
            ),
          );

          setIsRenewalQuote(false);
          setLockedToProductRequest(true);
          setSourceProductRequestId(productRequest?.id || null);
          setSelectedProductIds([...new Set(seeded.map((entry) => entry.productId))]);
          setAssignments(normalizeAssignmentsWithPurchaseHistory(seeded));
          setStage("configure");
          setActiveAssignmentIndex(0);
          setConfigError("");
          navigate(location.pathname, { replace: true, state: {} });
        };

        const requestId = productRequest?.id || null;
        const hasNewBranches =
          Array.isArray(productRequest?.newBranches) && productRequest.newBranches.length > 0;

        if (requestId && hasNewBranches) {
          void materializeProductRequestBranches(leadId, requestId)
            .then((data) => applySeed(data?.lead || null))
            .catch((error) => {
              console.warn(
                "[workflow] Could not materialize product-request branches:",
                error instanceof Error ? error.message : error,
              );
              applySeed(null);
            });
          return;
        }

        applySeed(null);
        return;
      }

      // Finance reject → sales "Redo pricing": resume same products at Set pricing.
      const rejectedQuote = location.state?.seedFromRejectedQuotation;
      const redoAssignments = Array.isArray(rejectedQuote?.assignments)
        ? rejectedQuote.assignments.filter((entry) => entry?.productId)
        : [];
      const redoProductIds = Array.isArray(rejectedQuote?.productIds)
        ? rejectedQuote.productIds.filter(Boolean)
        : [];

      if (location.state?.redoQuotationId && (redoAssignments.length > 0 || redoProductIds.length > 0)) {
        const seeded =
          redoAssignments.length > 0
            ? redoAssignments.map((entry) =>
                createAssignment(
                  entry.productId,
                  entry.branchId,
                  entry.billingBranchId || entry.branchId,
                  { ...(entry.config || {}) },
                  entry.changeType || CHANGE_TYPES.NEW,
                ),
              )
            : createAssignmentsForProducts(
                redoProductIds,
                branches,
                (product, branchId) => buildInitialConfigForBranch(lead, branchId)(product),
                (productId) => catalogProducts.find((product) => product.id === productId),
                lead,
                inferDefaultChangeType,
              );
        const requestId = rejectedQuote?.sourceProductRequestId || null;

        setIsRenewalQuote(false);
        setPurchaseIntent("");
        setLockedToProductRequest(Boolean(requestId));
        setSourceProductRequestId(requestId);
        setSelectedProductIds([...new Set(seeded.map((entry) => entry.productId))]);
        setAssignments(normalizeAssignmentsWithPurchaseHistory(seeded));
        setStage("configure");
        setActiveAssignmentIndex(0);
        setConfigError("");
        navigate(location.pathname, { replace: true, state: {} });
        return;
      }

      setIsRenewalQuote(false);
      setLockedToProductRequest(false);
      setSourceProductRequestId(null);
      setSelectedProductIds([]);
      setAssignments([]);
      setStage("select");
      setActiveAssignmentIndex(0);
      setConfigError("");
      navigate(location.pathname, { replace: true, state: {} });
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
    if (draft.sourceProductRequestId) {
      setSourceProductRequestId(draft.sourceProductRequestId);
      setLockedToProductRequest(draft.lockedToProductRequest !== false);
    }
    setActiveAssignmentIndex(0);
    setStage(draft.stage || (showBranchAssignment ? "assign-branches" : "configure"));
  }, [lead, leadId, location.pathname, location.state?.freshQuote, showBranchAssignment, navigate]);

  const activeAssignment = assignments[activeAssignmentIndex] ?? assignments[0];
  const activeProduct = activeAssignment
    ? catalogProducts.find((product) => product.id === activeAssignment.productId)
    : null;
  const activeConfig = activeAssignment?.config ?? null;
  const isCustomerCcaasUpgrade =
    isCustomerRequest &&
    requestIntent === "upgrade" &&
    activeAssignment?.productId === "contact-center";
  const customerCcaasAddonsOnly =
    isCustomerCcaasUpgrade && activeAssignment?.changeType === CHANGE_TYPES.ADDON;
  const midPeriodAddonsOnly = useMemo(() => {
    if (!lead || !activeAssignment || isCustomerRequest) {
      return false;
    }
    return isMidPeriodAddonOnlyQuote(lead, activeAssignment.productId, activeAssignment.branchId, {
      renewal: isRenewalQuote,
    });
  }, [activeAssignment, isCustomerRequest, isRenewalQuote, lead]);
  const effectiveAddonsOnly = isCustomerRequest ? customerCcaasAddonsOnly : midPeriodAddonsOnly;
  const customerUpgradeBaselineTier = useMemo(() => {
    if (!isCustomerCcaasUpgrade || !lead || !activeAssignment) {
      return "";
    }

    const atBranch = getActiveAtBranch(lead, activeAssignment.productId, activeAssignment.branchId);
    return String(atBranch?.config?.licenseTier || "").trim();
  }, [activeAssignment, isCustomerCcaasUpgrade, lead]);
  const customerCcaasPlanChangeAvailable =
    !customerUpgradeBaselineTier || customerUpgradeBaselineTier !== getHighestPlanId();
  const customerCcaasUpgradePlans = useMemo(() => {
    if (!isCustomerCcaasUpgrade || !customerUpgradeBaselineTier) {
      return CCAAS_PLANS;
    }

    return getHigherPlansThan(customerUpgradeBaselineTier);
  }, [customerUpgradeBaselineTier, isCustomerCcaasUpgrade]);

  useEffect(() => {
    if (
      !isCustomerCcaasUpgrade ||
      !customerUpgradeBaselineTier ||
      !activeAssignment ||
      customerCcaasPlanChangeAvailable
    ) {
      return;
    }

    if (activeAssignment.changeType !== CHANGE_TYPES.UPGRADE) {
      return;
    }

    setAssignments((current) =>
      current.map((entry, index) =>
        index === activeAssignmentIndex
          ? {
              ...entry,
              changeType: CHANGE_TYPES.ADDON,
              config: { ...entry.config, licenseTier: customerUpgradeBaselineTier },
            }
          : entry,
      ),
    );
  }, [
    activeAssignment,
    activeAssignmentIndex,
    customerCcaasPlanChangeAvailable,
    customerUpgradeBaselineTier,
    isCustomerCcaasUpgrade,
  ]);

  const customerCcaasRenewsAt = useMemo(() => {
    if (!isCustomerCcaasUpgrade || !lead || !activeAssignment) {
      return null;
    }
    const atBranch = getActiveAtBranch(lead, activeAssignment.productId, activeAssignment.branchId);
    if (!atBranch || !isActivePaidSubscription(atBranch)) {
      return null;
    }
    return getSubscriptionRenewsAt(atBranch);
  }, [activeAssignment, isCustomerCcaasUpgrade, lead]);

  useEffect(() => {
    if (!midPeriodAddonsOnly || !activeAssignment) {
      return;
    }
    if (activeAssignment.changeType === CHANGE_TYPES.ADDON) {
      return;
    }
    setAssignments((current) =>
      current.map((entry, index) =>
        index === activeAssignmentIndex ? { ...entry, changeType: CHANGE_TYPES.ADDON } : entry,
      ),
    );
  }, [activeAssignment, activeAssignmentIndex, midPeriodAddonsOnly]);

  useEffect(() => {
    if (!activeAssignment?.config) {
      return;
    }

    const mode = activeAssignment.config.pricingMode;
    const currentBilling = activeAssignment.config.midPeriodAddons?.billingMode;
    const isActive = activeAssignment.config.midPeriodAddons?.active === true;

    const needsMidPeriodSeed =
      effectiveAddonsOnly &&
      (mode === "ccaas" ||
        mode === "crm" ||
        mode === "campaign" ||
        mode === "value-management" ||
        mode === "ticketing") &&
      currentBilling !== "addons-only";

    const needsCcaasFirstPurchaseSeed =
      !effectiveAddonsOnly &&
      mode === "ccaas" &&
      Boolean(activeAssignment.config.licenseTier) &&
      (!isActive || currentBilling !== "with-core");

    const needsLeaveMidPeriod =
      !effectiveAddonsOnly &&
      isActive &&
      (mode === "ccaas" ||
        mode === "crm" ||
        mode === "campaign" ||
        mode === "value-management" ||
        mode === "ticketing") &&
      currentBilling !== "with-core" &&
      !needsCcaasFirstPurchaseSeed;

    if (!needsMidPeriodSeed && !needsCcaasFirstPurchaseSeed && !needsLeaveMidPeriod) {
      return;
    }

    setAssignments((current) =>
      current.map((entry, index) => {
        if (index !== activeAssignmentIndex) {
          return entry;
        }
        return {
          ...entry,
          config: ensureMidPeriodAddons(entry.config, {
            addonsOnly: effectiveAddonsOnly,
            seedCcaas: needsCcaasFirstPurchaseSeed,
          }),
        };
      }),
    );
  }, [activeAssignment, activeAssignmentIndex, effectiveAddonsOnly]);
  const visibleProducts = useMemo(() => {
    if (!lead) {
      return catalogProducts;
    }

    if (isCustomerRequest) {
      if (requestIntent === "new") {
        return catalogProducts.filter((product) => !isProductActiveAnywhere(lead, product.id));
      }

      if (requestIntent === "upgrade") {
        return catalogProducts.filter((product) => isProductActiveAnywhere(lead, product.id));
      }

      return catalogProducts;
    }

    if (purchaseIntent === "new") {
      return catalogProducts.filter((product) => !isProductActiveAnywhere(lead, product.id));
    }

    if (purchaseIntent === "addon") {
      return catalogProducts.filter((product) => isProductActiveAnywhere(lead, product.id));
    }

    return catalogProducts;
  }, [catalogProducts, isCustomerRequest, lead, purchaseIntent, requestIntent]);
  const allSelected = selectedProductIds.length === visibleProducts.length;
  const canCreateInvoice = useMemo(
    () =>
      canCreateQuotationInvoice(assignments, {
        metricsOnly: isCustomerRequest,
        temporaryLead: isTemporaryLead(lead),
      }),
    [assignments, isCustomerRequest, lead],
  );
  const customerCcaasNeedsPlanHint =
    isCustomerRequest &&
    stage === "configure" &&
    activeConfig?.pricingMode === "ccaas" &&
    !effectiveAddonsOnly &&
    !activeConfig?.licenseTier &&
    activeAssignmentIndex === Math.max(assignments.length - 1, 0);
  const configureFooterError = customerCcaasNeedsPlanHint
    ? "Select a license plan above to continue."
    : configError;
  const perBranchInvoicingRequired = useMemo(
    () => requiresPerBranchInvoicing(assignments, lead),
    [assignments, lead],
  );
  const quoteUsesMultipleBranches = useMemo(() => {
    const branchIds = new Set(
      (assignments || []).map((entry) => entry.branchId || HQ_BRANCH_ID),
    );
    return branchIds.size > 1;
  }, [assignments]);
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

    setPricingFieldErrors(null);
    setConfigError("");

    setAssignments((current) =>
      current.map((entry, index) => {
        if (index !== activeAssignmentIndex) {
          return entry;
        }

        const nextConfig = {
          ...entry.config,
          [field]: value,
        };

        // Temporary Lead: keep zero-catalog sticky so plan/module seeding never rehydrates catalog.
        if (isTemporaryLead(lead)) {
          nextConfig.zeroCatalogDefaults = true;
        }

        if (field === "proratedBilling") {
          nextConfig.proratedBilling = Boolean(value);
          nextConfig.skipInvoiceProration = !Boolean(value);
        } else if (field === "skipInvoiceProration") {
          nextConfig.skipInvoiceProration = Boolean(value);
          nextConfig.proratedBilling = !Boolean(value);
        } else if (typeof nextConfig.proratedBilling === "boolean") {
          nextConfig.skipInvoiceProration = !nextConfig.proratedBilling;
        }

        if (FEATURE_TOGGLE_FIELDS.has(field) && typeof value === "boolean") {
          if (field === "implementationEnabled" && entry.config.implementationPurchased) {
            return entry;
          }

          const baseConfig = isTemporaryLead(lead)
            ? { ...entry.config, zeroCatalogDefaults: true }
            : entry.config;

          return {
            ...entry,
            config: applyFeatureToggle(baseConfig, field, value),
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
          const zeroDefaults = Boolean(nextConfig.zeroCatalogDefaults);
          let modules = clampModulesToLicenseTier(
            buildModulesFromPlan(value, catalog, region),
            value,
            catalog,
            region,
          );
          if (zeroDefaults) {
            modules = zeroModuleCatalogPrices(modules);
          }
          nextConfig.modules = modules;
          nextConfig.usageDetails = seedConfigurationPricingFromCatalog(
            createDefaultUsageDetails(),
            {
              licenseTier: value,
              modulesConfig: nextConfig.modules,
              catalog,
              region,
              tierDefaultVolumes: catalog.products?.["contact-center"]?.tierDefaultVolumes,
              zeroRates: zeroDefaults,
            },
          );
          nextConfig.modules = syncAgentRateIntoPerAgentModules(
            nextConfig.modules,
            nextConfig.usageDetails.agentRate,
          );
          const billingMode =
            nextConfig.midPeriodAddons?.billingMode === "addons-only" ? "addons-only" : "with-core";
          nextConfig.midPeriodAddons = seedCcaasMidPeriodAddons(nextConfig, { billingMode });
          if (!nextConfig.implementationPurchased) {
            nextConfig.implementationEnabled = true;
            if (zeroDefaults) {
              nextConfig.implementationFee = "";
            } else {
              const catalogFee = getContactCenterPlanImplementationFee(
                getCatalog(region).products?.["contact-center"],
                value,
              );
              nextConfig.implementationFee = catalogFee;
            }
          }
        } else {
          nextConfig.modules = {};
          nextConfig.usageDetails = zeroDefaults
            ? (() => {
                const empty = createDefaultUsageDetails();
                for (const key of Object.keys(empty)) empty[key] = "";
                return empty;
              })()
            : createDefaultUsageDetails();
        }
      }

      if (field === "modules" && value && typeof value === "object") {
        nextConfig.modules = value;
        if (nextConfig.pricingMode === "ccaas" && nextConfig.licenseTier) {
          const catalog = getCachedPricingCatalog();
          const region = nextConfig.region || "India";
          const zeroDefaults = Boolean(nextConfig.zeroCatalogDefaults);
          nextConfig.usageDetails = seedConfigurationPricingFromCatalog(
            nextConfig.usageDetails || createDefaultUsageDetails(),
            {
              licenseTier: nextConfig.licenseTier,
              modulesConfig: value,
              catalog,
              region,
              tierDefaultVolumes: catalog.products?.["contact-center"]?.tierDefaultVolumes,
              zeroRates: zeroDefaults,
            },
          );
          nextConfig.modules = syncAgentRateIntoPerAgentModules(
            nextConfig.modules,
            nextConfig.usageDetails.agentRate,
          );
          const billingMode =
            nextConfig.midPeriodAddons?.billingMode === "addons-only" ? "addons-only" : "with-core";
          nextConfig.midPeriodAddons = seedCcaasMidPeriodAddons(nextConfig, { billingMode });
        }
      }

      if (field === "usageDetails" && value && typeof value === "object") {
        nextConfig.usageDetails = value;
        if (nextConfig.pricingMode === "ccaas") {
          nextConfig.modules = syncAgentRateIntoPerAgentModules(
            nextConfig.modules,
            value.agentRate,
          );
        }
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

          if (nextConfig.zeroCatalogDefaults) {
            nextConfig.chatbotMonthlyPrice = "0";
            nextConfig.chatbotPerSessionRate = "0";
            nextConfig.additionalSessionRate = "0";
          } else if (bundleDefaults) {
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
          nextConfig.additionalMinuteRate = nextConfig.zeroCatalogDefaults ? "0" : plan.rate;
        } else {
          nextConfig.additionalMinuteQuantity = "";
          nextConfig.additionalMinuteRate = "";
        }
      }

      if (field === "additionalContactSlab") {
        nextConfig.additionalContactRate = nextConfig.zeroCatalogDefaults
          ? "0"
          : getContactChargeSlabs(nextConfig.region || config.region, nextConfig.productId || config.productId)[
              value
            ]?.perContactRate ?? "";
      }

      if (field === "additionalTicketSlab") {
        nextConfig.additionalTicketRate = nextConfig.zeroCatalogDefaults
          ? "0"
          : getTicketSlabs(nextConfig.region || config.region)[value]?.perTicketRate ?? "";
      }

        let changeType = entry.changeType;
        if (lead) {
          const preserveCustomerCcaasChoice =
            isCustomerRequest &&
            requestIntent === "upgrade" &&
            entry.productId === "contact-center" &&
            (entry.changeType === CHANGE_TYPES.UPGRADE || entry.changeType === CHANGE_TYPES.ADDON);

          if (preserveCustomerCcaasChoice) {
            changeType = entry.changeType;
          } else if (
            isMidPeriodAddonOnlyQuote(lead, entry.productId, entry.branchId, {
              renewal: isRenewalQuote,
            })
          ) {
            changeType = CHANGE_TYPES.ADDON;
          } else {
            const existing = getActiveAtBranch(lead, entry.productId, entry.branchId);
            if (existing?.config) {
              changeType = suggestChangeTypeFromPrices(
                getConfiguredPrice(existing.config),
                getConfiguredPrice(nextConfig),
              );
            }
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
    setAssignments((current) => {
      if (field === "branchId") {
        const target = current.find((entry) => entry.id === assignmentId);
        const taken = current.some(
          (entry) =>
            entry.id !== assignmentId &&
            entry.productId === target?.productId &&
            entry.branchId === value,
        );
        if (taken) {
          return current;
        }
      }

      return current.map((entry) => {
        if (entry.id !== assignmentId) {
          return entry;
        }

        const next = { ...entry, [field]: value };

        if (field === "branchId") {
          next.billingBranchId = value;
          next.changeType = inferDefaultChangeType(leadWithDrafts, entry.productId, value);
          const existing = getActiveAtBranch(leadWithDrafts, entry.productId, value);
          if (existing?.config && next.changeType !== CHANGE_TYPES.NEW) {
            next.config = applyPurchaseHistoryToConfig({ ...existing.config }, leadWithDrafts, entry.productId);
          } else if (next.changeType === CHANGE_TYPES.NEW) {
            const product = catalogProducts.find((item) => item.id === entry.productId);
            if (product) {
              next.config = buildInitialConfigForBranch(leadWithDrafts, value)(product);
            }
          } else if (next.config) {
            next.config = applyPurchaseHistoryToConfig(next.config, leadWithDrafts, entry.productId);
          }
        }

        return next;
      });
    });
  }

  function duplicateAssignment(assignmentId) {
    setAssignments((current) => {
      const source = current.find((entry) => entry.id === assignmentId);
      if (!source) {
        return current;
      }

      // Auto-assign the first branch not already running this product.
      const nextBranch = unusedBranchesForProduct(current, branches, source.productId)[0];
      if (!nextBranch) {
        return current;
      }

      const product = catalogProducts.find((entry) => entry.id === source.productId);
      const duplicate = createAssignment(
        source.productId,
        nextBranch.id,
        nextBranch.id,
        product ? buildInitialConfigForBranch(leadWithDrafts, nextBranch.id)(product) : source.config,
        inferDefaultChangeType(leadWithDrafts, source.productId, nextBranch.id),
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

  function openExistingRequestConflict(request, productId = "") {
    setConflictRequest(request || null);
    setConflictProductId(productId || "");
    setConflictError("");
  }

  function findCustomerSelectionConflict(productIds = selectedProductIds) {
    if (!isCustomerRequest || editingRequestId) {
      return null;
    }
    const branchScope =
      customerBranchId || (branches.length === 1 ? branches[0]?.id || null : null);
    // Multi-branch HQ: wait until branch assignment so product+branch can match.
    if (!branchScope && branches.length > 1) {
      return null;
    }
    for (const productId of productIds) {
      const existing = findOpenProductRequestForProduct(
        openProductRequests,
        productId,
        branchScope,
      );
      if (existing) {
        return { request: existing, productId };
      }
    }
    return null;
  }

  function startConfiguration() {
    if (selectedProductIds.length === 0) {
      return;
    }

    const selectionConflict = findCustomerSelectionConflict(selectedProductIds);
    if (selectionConflict) {
      openExistingRequestConflict(selectionConflict.request, selectionConflict.productId);
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
      setStage(showBranchAssignment ? "assign-branches" : "configure");
      return;
    }

    const draft = lead?.productDraft;
    if (draft?.assignments?.length && draftMatchesSelection(draft, selectedProductIds)) {
      setAssignments(normalizeAssignmentsWithPurchaseHistory(draft.assignments));
      setInvoiceMode(draft.invoiceMode || INVOICE_MODES.CONSOLIDATED);
      setSelectedProductIds(draft.selectedProductIds || selectedProductIds);
      setActiveAssignmentIndex(0);
      setStage(draft.stage || (showBranchAssignment ? "assign-branches" : "configure"));
      return;
    }

    // Add-ons-only purchase: seed from the purchased product/branch config, not a fresh base plan.
    if (purchaseIntent === "addon" && leadWithDrafts) {
      const activeProducts = getActiveProducts(leadWithDrafts);
      const defaultBranchId = branches[0]?.id || HQ_BRANCH_ID;
      const addonAssignments = selectedProductIds.map((productId) => {
        const existing =
          activeProducts.find(
            (entry) => entry.productId === productId && entry.branchId === defaultBranchId,
          ) || activeProducts.find((entry) => entry.productId === productId);
        if (existing) {
          return createAssignment(
            existing.productId,
            existing.branchId,
            existing.billingBranchId || existing.branchId,
            { ...(existing.config || {}) },
            CHANGE_TYPES.ADDON,
          );
        }
        const product = catalogProducts.find((entry) => entry.id === productId);
        return createAssignment(
          productId,
          defaultBranchId,
          defaultBranchId,
          product
            ? buildInitialConfigForBranch(leadWithDrafts, defaultBranchId)(product)
            : null,
          CHANGE_TYPES.ADDON,
        );
      });

      setAssignments(normalizeAssignmentsWithPurchaseHistory(addonAssignments));
      setActiveAssignmentIndex(0);
      setStage(showBranchAssignment ? "assign-branches" : "configure");
      return;
    }

    const newAssignments = createAssignmentsForProducts(
      selectedProductIds,
      branches,
      (product, branchId) => buildInitialConfigForBranch(leadWithDrafts, branchId)(product),
      (productId) => catalogProducts.find((product) => product.id === productId),
      leadWithDrafts,
      inferDefaultChangeType,
    );

    setAssignments(normalizeAssignmentsWithPurchaseHistory(newAssignments));
    setActiveAssignmentIndex(0);
    setStage(showBranchAssignment ? "assign-branches" : "configure");
  }

  function validateCustomerDraftBranches() {
    if (!draftNewBranches.length) {
      return "";
    }

    const assignedIds = new Set(assignments.map((entry) => String(entry.branchId || "")));

    for (const branch of draftNewBranches) {
      const label = String(branch.label || "").trim() || "New location";
      if (!String(branch.address || "").trim()) {
        return `Address is required for "${label}".`;
      }
      const addressFormatError = getLeadAddressFormatError(branch.address, `Address for "${label}"`);
      if (addressFormatError) {
        return addressFormatError;
      }
      if (!String(branch.country || "").trim()) {
        return `Country is required for "${label}".`;
      }
      if (
        requiresStateForCountry(branch.country) &&
        !String(branch.state || "").trim()
      ) {
        return `State is required for "${label}".`;
      }
      if (!String(branch.taxNumber || "").trim()) {
        return `Tax number is required for "${label}".`;
      }
      const taxError = validateTaxNumberForCountry(branch.country, branch.taxNumber, {
        state: branch.state || "",
      });
      if (taxError) {
        return `${label}: ${taxError}`;
      }
      if (!String(branch.mobileNumber || "").trim()) {
        return `Mobile number is required for "${label}".`;
      }
      const mobileError = validateMobileForDialCode(
        branch.mobileCountryCode || "+91",
        branch.mobileNumber,
      );
      if (mobileError) {
        return `${label}: ${mobileError}`;
      }
      if (!String(branch.workEmail || "").trim()) {
        return `Work email is required for "${label}".`;
      }
      if (!assignedIds.has(String(branch.id))) {
        return `New location "${label}" must include at least one product in this request.`;
      }
    }

    return "";
  }

  function proceedFromAssignBranches() {
    // Defensive: UI rules should already prevent duplicate product+branch pairs.
    const seen = new Set();
    for (const entry of assignments) {
      const key = `${entry.productId}::${entry.branchId}`;
      if (seen.has(key)) {
        setConfigError(
          "The same product is assigned to one branch more than once. Pick a different branch for each copy.",
        );
        return;
      }
      seen.add(key);
    }

    if (isCustomerRequest) {
      const draftError = validateCustomerDraftBranches();
      if (draftError) {
        setConfigError(draftError);
        return;
      }

      const assignmentConflict = findOpenProductRequestConflict(
        openProductRequests,
        assignments,
        { ignoreRequestId: editingRequestId },
      );
      if (assignmentConflict) {
        openExistingRequestConflict(assignmentConflict.request, assignmentConflict.productId);
        return;
      }
    }

    setConfigError("");
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

    const draftError = validateCustomerDraftBranches();
    if (draftError) {
      setConfigError(draftError);
      return;
    }

    if (!editingRequestId) {
      const assignmentConflict = findOpenProductRequestConflict(
        openProductRequests,
        assignments,
      );
      if (assignmentConflict) {
        openExistingRequestConflict(assignmentConflict.request, assignmentConflict.productId);
        return;
      }
    }

    const session = getCustomerSession();
    setSubmittingRequest(true);
    setConfigError("");

    try {
      const productSummary = buildProductSummary(
        assignments,
        leadWithDrafts,
        catalogProducts,
        getConfiguredPrice,
      ).map((entry) => ({
          ...entry,
          priceLabel: "Pending sales review",
        }));
      const branchSummary = buildBranchSummary(assignments, leadWithDrafts);
      const newBranches = draftNewBranches.map((entry) => ({
        ...entry,
        industryType: resolveBranchIndustry(entry),
        label: String(entry.label || "").trim() || "Branch",
      }));
      const payload = {
        requestType: deriveRequestType(assignments),
        assignments,
        productSummary,
        branchSummary,
        newBranches,
        customerNote: customerNote.trim(),
        tenantId: lead?.tenantId || "",
        companyName: lead?.companyName || "",
        contactEmail: resolvePortalLoginEmail(lead) || session?.email || "",
      };

      const savedRequest = editingRequestId
        ? await updateMyProductRequest(editingRequestId, payload)
        : await createCustomerProductRequest(payload);

      navigate(exitPath, {
        replace: true,
        state: {
          requestSubmitted: true,
          requestUpdated: Boolean(editingRequestId),
          productRequest: savedRequest || null,
        },
      });
    } catch (error) {
      if (error?.code === "OPEN_PRODUCT_REQUEST" && error.existingRequest) {
        openExistingRequestConflict(error.existingRequest, error.productId || "");
        return;
      }
      setConfigError(
        error instanceof Error ? error.message : "Could not submit your product request.",
      );
    } finally {
      setSubmittingRequest(false);
    }
  }

  function handleConflictCancel() {
    setConflictRequest(null);
    setConflictProductId("");
    setConflictError("");
    if (requestIntent === "upgrade" && !editingRequestId && assignments.length === 0) {
      navigate(exitPath);
    }
  }

  function handleConflictEdit() {
    if (!conflictRequest) {
      return;
    }
    const productRequest = conflictRequest;
    setConflictRequest(null);
    setConflictProductId("");
    setConflictError("");

    if (location.pathname !== "/customer/products/request") {
      workflowInitializedRef.current = false;
      navigate("/customer/products/request", {
        replace: true,
        state: {
          seedFromProductRequest: productRequest,
          customerEditRequest: true,
        },
      });
      return;
    }

    const requestAssignments = Array.isArray(productRequest.assignments)
      ? productRequest.assignments.filter((entry) => entry?.productId)
      : [];
    const seeded = requestAssignments.map((entry) =>
      createAssignment(
        entry.productId,
        entry.branchId,
        entry.billingBranchId || entry.branchId,
        { ...(entry.config || {}) },
        entry.changeType || CHANGE_TYPES.UPGRADE,
      ),
    );

    workflowInitializedRef.current = true;
    setEditingRequestId(productRequest.id);
    setLockedToProductRequest(true);
    setSourceProductRequestId(productRequest.id);
    setSelectedProductIds([...new Set(seeded.map((entry) => entry.productId))]);
    setAssignments(normalizeAssignmentsWithPurchaseHistory(seeded));
    setCustomerNote(String(productRequest.customerNote || ""));
    setDraftNewBranches(
      Array.isArray(productRequest.newBranches) ? productRequest.newBranches : [],
    );
    setStage("configure");
    setActiveAssignmentIndex(0);
    setConfigError("");
  }

  async function handleConflictNotifyAgain() {
    if (!conflictRequest?.id) {
      return;
    }
    setConflictBusy(true);
    setConflictError("");
    try {
      await notifyMyProductRequestAgain(conflictRequest.id);
      setConflictRequest(null);
      setConflictProductId("");
      navigate(exitPath, {
        replace: true,
        state: { requestNotifiedAgain: true },
      });
    } catch (error) {
      setConflictError(
        error instanceof Error ? error.message : "Could not notify sales again.",
      );
    } finally {
      setConflictBusy(false);
    }
  }

  function handleConfigSubmit(event) {
    event.preventDefault();
    setConfigError("");

    const temporaryLead = isTemporaryLead(lead);

    if (
      !temporaryLead &&
      activeConfig?.pricingMode === "ccaas" &&
      !activeConfig.licenseTier &&
      !isMidPeriodAddonBilling(activeConfig)
    ) {
      setPricingFieldErrors({ licenseTier: true });
      setConfigError("Select a license plan above to continue.");
      return;
    }

    if (
      isCustomerCcaasUpgrade &&
      !effectiveAddonsOnly &&
      activeConfig?.pricingMode === "ccaas" &&
      customerUpgradeBaselineTier &&
      !isHigherPlanThan(customerUpgradeBaselineTier, activeConfig.licenseTier)
    ) {
      setConfigError("Select a plan higher than your current plan.");
      return;
    }

    if (!temporaryLead) {
      if (activeConfig?.pricingMode === "ccaas") {
        const fieldErrors = getCcaasConfigFieldErrors(activeConfig, {
          metricsOnly: isCustomerRequest,
        });
        const configured = isProductConfigured(activeConfig, { metricsOnly: isCustomerRequest });
        if (!configured || ccaasFieldErrorsHaveIssues(fieldErrors)) {
          setPricingFieldErrors(fieldErrors);
          setCcaasPanelExpandRequest((current) => current + 1);
          setConfigError(getCcaasConfigErrorMessage(fieldErrors, { metricsOnly: isCustomerRequest }));
          scrollToFirstPricingInvalidField();
          return;
        }
        setPricingFieldErrors(null);
      } else {
        const fieldErrors = getProductConfigFieldErrors(activeConfig, {
          metricsOnly: isCustomerRequest,
        });
        const configured = isProductConfigured(activeConfig, { metricsOnly: isCustomerRequest });
        if (!configured || productFieldErrorsHaveIssues(fieldErrors)) {
          setPricingFieldErrors(fieldErrors);
          setCcaasPanelExpandRequest((current) => current + 1);
          setConfigError(
            getFirstProductFieldErrorMessage(fieldErrors, { metricsOnly: isCustomerRequest }),
          );
          scrollToFirstPricingInvalidField();
          return;
        }
        setPricingFieldErrors(null);
      }
    } else {
      setPricingFieldErrors(null);
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
      sourceProductRequestId: sourceProductRequestId || null,
      lockedToProductRequest: Boolean(lockedToProductRequest && sourceProductRequestId),
      updatedAt: new Date().toISOString(),
    });
  }, [
    assignments,
    effectiveInvoiceMode,
    isCustomerRequest,
    leadId,
    lockedToProductRequest,
    selectedProductIds,
    sourceProductRequestId,
    stage,
  ]);

  useEffect(() => {
    setPricingFieldErrors(null);
  }, [activeAssignmentIndex]);

  useEffect(() => {
    if (stage !== "invoice-review" || !lead) {
      return undefined;
    }

    if (suppressInvoicePreviewOnceRef.current) {
      suppressInvoicePreviewOnceRef.current = false;
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
        let invoiceNumber = "";
        let invoicePrefix = "WIPL";
        let bankDetails = null;
        try {
          const settings = await fetchPublicInvoiceSettings();
          invoiceNumber = settings?.draftNumber || "";
          invoicePrefix = settings?.prefix || "WIPL";
          bankDetails = settings?.bankDetails || null;
        } catch {
          // Preview still works with local draft number when settings API is unavailable.
        }

        const result = await buildQuotationInvoice({
          lead,
          logoUrl: companyLogo,
          products: catalogProducts,
          assignments,
          invoiceMode: effectiveInvoiceMode,
          temporaryInvoiceContents: isTemporaryLead(lead)
            ? temporaryInvoiceContents || null
            : null,
          invoiceNumber,
          invoicePrefix,
          bankDetails,
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
  }, [
    assignments,
    catalogProducts,
    effectiveInvoiceMode,
    lead,
    leadId,
    stage,
    temporaryInvoiceContents,
  ]);

  async function handleProceedToEmail() {
    if (proceedingToFinance) {
      return;
    }

    if (!canCreateInvoice && !isTemporaryLead(lead)) {
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
        `${duplicate.productId} is already an active paid subscription at this location until ${new Date(conflict.renewsAt).toLocaleDateString("en-IN")}. Choose upgrade or add-on instead.`,
      );
      return;
    }

    if (isTemporaryLead(lead) && !temporaryInvoiceContents) {
      setInvoiceError(
        "Select invoice contents: Implementation only, Configuration only, Implementation and configuration, Add-on only, or All in one.",
      );
      return;
    }

    const missingCustomPeriod = assignments.find((entry) => {
      const config = entry.config || {};
      if (!resolveSkipInvoiceProration(config)) {
        return false;
      }
      // Custom period is required for implementation→UAT→Accept go-live scheduling.
      if (!assignmentNeedsImplementationInvoice(config) && !config.implementationPurchased) {
        return false;
      }
      return !String(config.periodStart || "").trim() || !String(config.periodEnd || "").trim();
    });
    if (missingCustomPeriod) {
      setInvoiceError(
        "Prorated billing is off — set Period Start and Period End for each implementation product (used after UAT Accept).",
      );
      return;
    }

    const primaryPreview = invoicePreviews[activePreviewIndex] || {
      fileName: invoiceFileName,
      pdfBase64: invoicePdfBase64,
    };

    if (!primaryPreview.pdfBase64 || !primaryPreview.fileName) {
      setInvoiceError("Invoice PDF is still preparing. Wait a moment and try again.");
      return;
    }

    const temporaryMode = isTemporaryLead(lead) ? temporaryInvoiceContents : null;
    const implementationOnly =
      temporaryMode === "implementation"
        ? true
        : temporaryMode === "configuration" || temporaryMode === "both"
          ? false
          : assignments.some((entry) => assignmentNeedsImplementationInvoice(entry.config || {}));
    const billingAssignments =
      temporaryMode === "configuration"
        ? assignments.map((entry) => ({
            ...entry,
            config: {
              ...(entry.config || {}),
              implementationPurchased: true,
              implementationEnabled: false,
            },
          }))
        : assignments;
    const productSummary = buildProductSummary(
      billingAssignments,
      lead,
      catalogProducts,
      implementationOnly
        ? (config) => getAssignmentPayableTotal(config, { implementationOnly: true })
        : getConfiguredPrice,
    ).map((item, index) => {
      if (!implementationOnly) {
        return item;
      }
      const name = String(item.name || "");
      const hasImplementationFee = assignmentNeedsImplementationInvoice(
        assignments[index]?.config || {},
      );
      return {
        ...item,
        name:
          hasImplementationFee && !name.includes("(implementation")
            ? `${name} (implementation fee)`
            : name,
        periodLabel: hasImplementationFee ? "Implementation fee" : item.periodLabel || null,
        periodStart: assignments[index]?.config?.periodStart || null,
        periodEnd: assignments[index]?.config?.periodEnd || null,
      };
    });
    const branchSummary = buildBranchSummary(assignments, lead);
    const paymentTotals = computeQuotationPaymentTotals({
      assignments,
      products: catalogProducts,
      lead,
      temporaryInvoiceContents: temporaryMode,
    });

    const quoteSession = {
      leadId,
      fileName: primaryPreview.fileName,
      pdfBase64: primaryPreview.pdfBase64,
      productSummary,
      assignments: normalizeAssignmentsBilling(assignments),
      invoiceMode: effectiveInvoiceMode,
      branchSummary,
      invoices: invoicePreviews,
      paymentTotals,
      billingPhase: paymentTotals.billingPhase || "standard",
      temporaryInvoiceContents: temporaryMode,
      skipPaymentLink: isTemporaryLead(lead),
      lead: isTemporaryLead(lead) ? { ...lead, leadKind: "temporary" } : lead,
      sourceProductRequestId: sourceProductRequestId || null,
      createdAt: new Date().toISOString(),
    };

    setProceedingToFinance(true);
    setInvoiceError("");
    try {
      // Persist first — navigating with multi-MB PDF in router state drops/aborts the session.
      await saveQuoteSession(leadId, quoteSession);
      navigate(`/products/${leadId}/compose`, { state: { financeHandoff: true } });
    } catch (error) {
      setInvoiceError(
        error instanceof Error
          ? error.message
          : "Could not prepare the finance submission. Try again.",
      );
      setProceedingToFinance(false);
    }
  }

  function closeInvoiceReview() {
    setStage("configure");
  }

  function moveToPreviousAssignment() {
    setActiveAssignmentIndex((current) => Math.max(current - 1, 0));
  }

  function returnToSelection() {
    if (lockedToProductRequest) {
      navigate(exitPath);
      return;
    }

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
      if (lockedToProductRequest) {
        navigate(exitPath);
        return;
      }
      if (showBranchAssignment) {
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

        {showBranchAssignment && stage !== "invoice-review" && !lockedToProductRequest ? (
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
              : lockedToProductRequest
                ? "Customer product request"
                : stage === "select"
                  ? purchaseIntent === "addon"
                    ? "Choose product for add-ons"
                    : "Choose products"
                  : stage === "assign-branches"
                    ? "Set location for each product"
                    : "Set pricing"}
          </h1>
          {stage !== "configure" ? (
            <p>
              {isCustomerRequest
                ? "Choose products and configure capacity. Your request is sent to sales for quotation — no payment is processed here."
                : lockedToProductRequest
                  ? "Quote the product the customer requested. Other catalog products are not included."
                  : stage === "select"
                    ? purchaseIntent === "addon"
                      ? "Select an existing active product to purchase add-ons or capacity for. Base plans stay locked."
                      : getActiveProducts(lead).length
                        ? "Products marked Active are already purchased. Select to upgrade or add new products."
                        : "Pick what this customer will subscribe to."
                    : "Choose where each product runs and who gets the invoice."}
            </p>
          ) : null}
        </header>

        {stage !== "configure" ? (
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
        ) : null}

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

        {/* Hidden for now — single-location UI.
        {stage === "assign-branches" ? (
          <BranchAssignmentStep
            assignments={assignments}
            branches={branches}
            defaultCountry={lead?.country || "India"}
            draftBranches={isCustomerRequest ? draftNewBranches : []}
            isCustomerRequest={isCustomerRequest}
            onAddDraftBranch={() => {
              const next = {
                ...createEmptyBranchAddress(lead?.country || "India"),
                id: crypto.randomUUID(),
                label: "",
              };
              setDraftNewBranches((current) => [...current, next]);
              setConfigError("");
            }}
            onDuplicate={duplicateAssignment}
            onRemove={(assignmentId) => removeAssignments([assignmentId])}
            onRemoveDraftBranch={(branchId) => {
              setDraftNewBranches((current) =>
                current.filter((entry) => String(entry.id) !== String(branchId)),
              );
              setAssignments((current) =>
                current.filter((entry) => String(entry.branchId) !== String(branchId)),
              );
              setConfigError("");
            }}
            onUpdate={updateAssignmentField}
            onUpdateDraftBranch={(branchId, field, value) => {
              setDraftNewBranches((current) =>
                current.map((entry) =>
                  String(entry.id) === String(branchId) ? { ...entry, [field]: value } : entry,
                ),
              );
              setConfigError("");
            }}
            perBranchInvoicingRequired={perBranchInvoicingRequired}
            products={catalogProducts}
          />
        ) : null}
        */}

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
                        {assignmentDisplayLabel(assignment, lead, catalogProducts)}
                      </span>
                    </button>
                    <button
                      aria-label={`Remove ${assignmentDisplayLabel(assignment, lead, catalogProducts)}`}
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
              <form
                className="pricing-form"
                onKeyDown={preventEnterFormSubmit}
                onSubmit={(event) => {
                  // Never advance via implicit Enter submit — only the explicit Next button.
                  event.preventDefault();
                }}
              >
                <div className="pricing-form__title">
                  <activeProduct.icon size={26} />
                  <span className="pricing-form__title-copy">
                    <strong>{activeProduct.name}</strong>
                    <small>
                      {activeConfig.pricingMode === "ccaas" && activeConfig.licenseTier
                        ? getCcaasPlanLabel(activeConfig.licenseTier)
                        : isCustomerRequest
                          ? activeProduct.usageLabel || "Configure capacity for this request"
                          : activeProduct.pricingBasis}
                      {/* Hidden for now — single-location UI.
                      {multipleBranches
                        ? ` · Deployed at ${assignmentDisplayLabel(activeAssignment, lead, catalogProducts).split(" — ")[1] || "—"}`
                        : ""}
                      */}
                    </small>
                  </span>
                  {!isCustomerRequest ? (
                    <BillingCycleToggle
                      disabled={midPeriodAddonsOnly}
                      onChange={(value) => updateActiveConfig("billingCycle", value)}
                      value={activeConfig.billingCycle || "monthly"}
                    />
                  ) : null}
                </div>

                {isCustomerCcaasUpgrade ? (
                  <CustomerCcaasUpgradeModeField
                    addonsOnly={customerCcaasAddonsOnly}
                    onChange={(mode) =>
                      setAssignments((current) =>
                        current.map((entry, index) =>
                          index === activeAssignmentIndex
                            ? {
                                ...entry,
                                changeType:
                                  mode === "addons-only" ? CHANGE_TYPES.ADDON : CHANGE_TYPES.UPGRADE,
                                config:
                                  mode === "addons-only" && customerUpgradeBaselineTier
                                    ? {
                                        ...entry.config,
                                        licenseTier: customerUpgradeBaselineTier,
                                      }
                                    : mode === "change-plan"
                                      ? { ...entry.config, licenseTier: "" }
                                      : entry.config,
                              }
                            : entry,
                        ),
                      )
                    }
                    planChangeAvailable={customerCcaasPlanChangeAvailable}
                    renewsAt={customerCcaasRenewsAt}
                  />
                ) : null}

                {activeConfig.pricingMode === "ccaas" &&
                !effectiveAddonsOnly &&
                !(isCustomerCcaasUpgrade && !customerCcaasPlanChangeAvailable) ? (
                  <>
                    {isCustomerCcaasUpgrade && customerUpgradeBaselineTier ? (
                      <p className="change-type-field__note">
                        Current plan: {getCcaasPlanLabel(customerUpgradeBaselineTier)}
                      </p>
                    ) : null}
                    <CcaasPlanPicker
                      emptyMessage="You are already on the highest plan. Use Add-ons only to request extras."
                      locked={false}
                      onSelectPlan={(planId) => {
                        updateActiveConfig("licenseTier", planId);
                        setConfigError("");
                      }}
                      plans={customerCcaasUpgradePlans}
                      selectedPlanId={activeConfig.licenseTier || ""}
                      subtitle={
                        isCustomerCcaasUpgrade
                          ? "Select a higher license plan to pre-fill modules."
                          : "Select one license plan to pre-fill modules."
                      }
                      title={isCustomerCcaasUpgrade ? "Choose a higher plan" : "Choose a plan"}
                    />
                  </>
                ) : null}

                <ProductPricingForm
                  addonsOnly={effectiveAddonsOnly}
                  changeType={activeAssignment?.changeType || CHANGE_TYPES.NEW}
                  config={activeConfig}
                  fieldErrors={pricingFieldErrors}
                  forceExpandRequest={ccaasPanelExpandRequest}
                  isRenewalQuote={isRenewalQuote}
                  lead={lead}
                  metricsOnly={isCustomerRequest}
                  onChange={updateActiveConfig}
                  product={activeProduct}
                />

                {!isCustomerRequest ? (
                  <ChangeTypeField
                    assignment={activeAssignment}
                    lead={lead}
                    renewal={isRenewalQuote}
                    onChange={(value) =>
                      setAssignments((current) =>
                        current.map((entry, index) =>
                          index === activeAssignmentIndex ? { ...entry, changeType: value } : entry,
                        ),
                      )
                    }
                  />
                ) : null}

                {isRenewalQuote && activeAssignment ? (
                  <RenewalAddonSelectionField
                    assignment={activeAssignment}
                    onChange={(selectedIds) => {
                      setAssignments((current) =>
                        current.map((entry, index) => {
                          if (index !== activeAssignmentIndex) {
                            return entry;
                          }
                          return {
                            ...entry,
                            config: applyAddonRenewalSelection(
                              entry.productId,
                              entry.config,
                              selectedIds,
                            ),
                          };
                        }),
                      );
                    }}
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
              </form>

              {isCustomerRequest ? (
                <CustomerMetricsSummary
                  activeAssignmentIndex={activeAssignmentIndex}
                  activeConfig={activeConfig}
                  activeProduct={activeProduct}
                  assignments={assignments}
                  lead={lead}
                  onSelectAssignment={setActiveAssignmentIndex}
                  products={catalogProducts}
                />
              ) : (
                <ComputedPriceSummary
                  activeAssignmentIndex={activeAssignmentIndex}
                  activeConfig={activeConfig}
                  activeProduct={activeProduct}
                  assignments={assignments}
                  lead={lead}
                  onSelectAssignment={setActiveAssignmentIndex}
                  onPeriodChange={(field, value) => updateActiveConfig(field, value)}
                  products={catalogProducts}
                />
              )}
            </div>
          </div>
        ) : null}

        {stage === "configure" && activeProduct && activeConfig ? (
          <footer className="products-actions pricing-actions">
            {configureFooterError ? (
              <p className="form-error pricing-actions__error">{configureFooterError}</p>
            ) : null}
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
              onClick={handleConfigSubmit}
              type="button"
            >
              <span>
                {activeAssignmentIndex === assignments.length - 1
                  ? isCustomerRequest
                    ? submittingRequest
                      ? editingRequestId
                        ? "Updating request..."
                        : "Submitting request..."
                      : editingRequestId
                        ? "Update request & notify sales"
                        : "Submit request to sales"
                    : "Review invoice"
                  : "Save & Next"}
              </span>
              <ArrowRight size={19} />
            </button>
          </footer>
        ) : null}

        {stage === "select" ? (
          <footer className="products-actions">
            <button
              className="primary-button products-next"
              disabled={
                selectedProductIds.length === 0 ||
                (isCustomerRequest && !customerRequestsReady)
              }
              onClick={startConfiguration}
              type="button"
            >
              <span>Next</span>
              <ArrowRight size={19} />
            </button>
          </footer>
        ) : null}

        {/* Hidden for now — single-location UI.
        {stage === "assign-branches" ? (
          <footer className="products-actions">
            {configError ? (
              <p className="form-error pricing-actions__error">{configError}</p>
            ) : null}
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
        */}
      </div>

      {conflictRequest ? (
        <OpenProductRequestConflictModal
          busy={conflictBusy}
          error={conflictError}
          onCancel={handleConflictCancel}
          onEdit={handleConflictEdit}
          onNotifyAgain={handleConflictNotifyAgain}
          productName={getProductName(conflictProductId) || "This product"}
          request={conflictRequest}
        />
      ) : null}

      {stage === "invoice-review" ? (
        <InvoiceReviewModal
          error={invoiceError}
          fileName={invoiceFileName}
          invoiceFormat={
            quoteUsesMultipleBranches && !perBranchInvoicingRequired
              ? { value: invoiceMode, onChange: setInvoiceMode }
              : null
          }
          invoiceFormatNote={
            perBranchInvoicingRequired
              ? "Separate invoices are required because this quote spans multiple branches or countries."
              : ""
          }
          loading={invoiceLoading || proceedingToFinance}
          onClose={proceedingToFinance ? () => {} : closeInvoiceReview}
          onProceed={handleProceedToEmail}
          pdfDataUrl={invoicePreviewUrl}
          proceedLabel={
            proceedingToFinance
              ? "Preparing finance email…"
              : isTemporaryLead(lead)
                ? "Proceed to finance review"
                : "Proceed to finance review"
          }
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
          temporaryInvoiceContents={
            isTemporaryLead(lead)
              ? {
                  value: temporaryInvoiceContents,
                  onChange: setTemporaryInvoiceContents,
                }
              : null
          }
          contentEdit={{
            sheet:
              invoicePreviews[activePreviewIndex]?.sheet ||
              invoicePreviews[0]?.sheet ||
              null,
            onApplySheet: async (sheet) => {
              const logo = companyLogo ? await prepareInvoiceLogo(companyLogo) : null;
              const rebuilt = await buildInvoicePdfFromSheet(sheet, logo);
              setInvoicePreviews((current) => {
                if (!current.length) {
                  return [
                    {
                      label: "Invoice",
                      fileName: rebuilt.fileName,
                      dataUrl: rebuilt.dataUrl,
                      pdfBase64: rebuilt.pdfBase64,
                      blob: rebuilt.blob,
                      sheet,
                    },
                  ];
                }
                return current.map((entry, index) =>
                  index === activePreviewIndex
                    ? {
                        ...entry,
                        ...rebuilt,
                        dataUrl: rebuilt.dataUrl,
                        sheet,
                      }
                    : entry,
                );
              });
              setInvoicePreviewUrl(rebuilt.dataUrl);
              setInvoiceFileName(rebuilt.fileName || sheet.fileName || invoiceFileName);
              setInvoicePdfBase64(rebuilt.pdfBase64);
              // Avoid regenerating from catalog config (would wipe freeform sheet edits).
              suppressInvoicePreviewOnceRef.current = true;
              setAssignments((current) =>
                current.map((entry) => ({
                  ...entry,
                  config: {
                    ...(entry.config || {}),
                    dueDate: sheet.dueDateIso || "",
                    periodStart: sheet.periodStartIso || "",
                    periodEnd: sheet.periodEndIso || "",
                  },
                })),
              );
            },
          }}
          title={
            isTemporaryLead(lead)
              ? "Review temporary lead invoice before finance submission"
              : "Review invoice before finance submission"
          }
        />
      ) : null}
    </section>
  );
}

function CustomerCcaasUpgradeModeField({ addonsOnly, onChange, planChangeAvailable = true, renewsAt }) {
  const renewsLabel = renewsAt
    ? new Date(renewsAt).toLocaleDateString("en-IN")
    : null;

  return (
    <fieldset className="change-type-field">
      <legend>What do you want to request?</legend>
      <div className="change-type-field__options">
        {planChangeAvailable ? (
          <button
            aria-pressed={!addonsOnly}
            className={`change-type-option ${!addonsOnly ? "is-active" : ""}`}
            onClick={() => onChange("change-plan")}
            type="button"
          >
            <strong>Change current plan</strong>
            <span>Update plan, modules, configuration, and add-ons for sales to quote.</span>
          </button>
        ) : null}
        <button
          aria-pressed={addonsOnly}
          className={`change-type-option ${addonsOnly ? "is-active" : ""}`}
          onClick={() => onChange("addons-only")}
          type="button"
        >
          <strong>Add-ons only</strong>
          <span>Request optional extras while keeping your current plan as-is.</span>
        </button>
      </div>
      {!addonsOnly && planChangeAvailable ? (
        <p className="change-type-field__note change-type-field__note--warning">
          {renewsLabel
            ? `Your current plan is active until ${renewsLabel}. If you change the plan, your current plan will be replaced.`
            : "If you change the plan, your current plan will be replaced."}
        </p>
      ) : null}
      {!planChangeAvailable ? (
        <p className="change-type-field__note">
          You are already on the highest plan. Request add-ons to expand your subscription.
        </p>
      ) : null}
    </fieldset>
  );
}

function RenewalAddonSelectionField({ assignment, onChange }) {
  const addons = listRenewableAddons(assignment.productId, assignment.config);
  const selected = new Set(
    assignment.config?.renewalAddonSelection ||
      defaultRenewalAddonSelection(assignment.productId, assignment.config),
  );

  if (!addons.length) {
    return (
      <fieldset className="change-type-field">
        <legend>Renewal add-ons</legend>
        <p className="change-type-field__note">
          No optional add-ons on this subscription. Renewing the base plan only. If the base plan is
          not renewed, all add-ons expire with it.
        </p>
      </fieldset>
    );
  }

  return (
    <fieldset className="change-type-field">
      <legend>Renewal add-ons</legend>
      <p className="change-type-field__note">
        Choose which add-ons to renew with the base plan. Deselected add-ons expire at the end of the
        current period. Add-ons cannot continue without an active base plan.
      </p>
      <div className="renewal-addon-list">
        {addons.map((addon) => {
          const checked = selected.has(addon.id);
          return (
            <label className="renewal-addon-list__item" key={addon.id}>
              <input
                checked={checked}
                onChange={() => {
                  const next = new Set(selected);
                  if (checked) {
                    next.delete(addon.id);
                  } else {
                    next.add(addon.id);
                  }
                  onChange([...next]);
                }}
                type="checkbox"
              />
              <span>
                <strong>{addon.label}</strong>
                <small>{addon.group}</small>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ChangeTypeField({ assignment, lead, onChange, renewal = false }) {
  const atBranch = getActiveAtBranch(lead, assignment.productId, assignment.branchId);
  const paidAtBranch = Boolean(atBranch && isActivePaidSubscription(atBranch));
  const activeElsewhere = isProductActiveAnywhere(lead, assignment.productId);
  const duplicateNew = findDuplicateNewPurchase(lead, assignment.productId, assignment.branchId);
  const midPeriodAddonOnly = isMidPeriodAddonOnlyQuote(lead, assignment.productId, assignment.branchId, {
    renewal,
  });

  if (!paidAtBranch && !activeElsewhere) {
    return (
      <div className="change-type-field change-type-field--new">
        <span className="change-type-pill change-type-pill--new">New purchase</span>
      </div>
    );
  }

  if (midPeriodAddonOnly) {
    const renewsAt = duplicateNew?.renewsAt || (atBranch ? getSubscriptionRenewsAt(atBranch) : null);
    return (
      <fieldset className="change-type-field">
        <legend>Purchase type</legend>
        <p className="change-type-field__note change-type-field__note--warning">
          This product is already paid and active at this location
          {renewsAt ? (
            <>
              {" "}
              until {new Date(renewsAt).toLocaleDateString("en-IN")}. Add-ons only — base configuration is
              locked until renewal. Add-on validity ends with the base plan.
            </>
          ) : (
            <>.</>
          )}
        </p>
        <div className="change-type-field__options">
          <button
            aria-pressed
            className="change-type-option is-active"
            type="button"
          >
            <strong>Add-on</strong>
            <span>Optional extras alongside the existing subscription.</span>
          </button>
        </div>
      </fieldset>
    );
  }

  const options = paidAtBranch
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
          use upgrade or add-on.
        </p>
      ) : paidAtBranch ? (
        <p className="change-type-field__note">
          This product is already paid and active at this location. Choose upgrade or add-on.
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
    // Hidden for now — single-location UI.
    // { id: "assign-branches", label: "Locations" },
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
  defaultCountry = "India",
  draftBranches = [],
  isCustomerRequest = false,
  onAddDraftBranch,
  onDuplicate,
  onRemove,
  onRemoveDraftBranch,
  onUpdate,
  onUpdateDraftBranch,
  perBranchInvoicingRequired = false,
  products,
}) {
  const branchCountries = [...new Set(branches.map((branch) => branch.country).filter(Boolean))];
  const hasMixedCountries = branchCountries.length > 1;
  const mobileCountryCodes = Object.keys(MOBILE_VALIDATION_RULES);

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

      {isCustomerRequest ? (
        <div className="branch-assignment-stage__new-location">
          <div className="branch-assignment-stage__new-location-header">
            <div>
              <strong>Add a new location</strong>
              <p>
                New locations must include at least one product in this request. They appear in your
                Locations list after payment is completed.
              </p>
            </div>
            <button className="secondary-button" onClick={onAddDraftBranch} type="button">
              <Plus size={16} />
              Add new location
            </button>
          </div>

          {draftBranches.map((entry, index) => {
            const taxDefaults = getLeadCountryDefaults(entry.country || defaultCountry);
            const stateOptions = getStateOptionsForCountry(entry.country || defaultCountry);
            const title = String(entry.label || "").trim() || `New location ${index + 1}`;

            return (
              <div className="address-card address-card--branch" key={entry.id}>
                <div className="address-card__header">
                  <strong className="address-card__title">{title}</strong>
                  <button
                    aria-label={`Remove ${title}`}
                    className="address-card__remove"
                    onClick={() => onRemoveDraftBranch(entry.id)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <label className="field">
                  <span>Branch label</span>
                  <input
                    onChange={(event) => onUpdateDraftBranch(entry.id, "label", event.target.value)}
                    placeholder="Example: Mumbai branch"
                    type="text"
                    value={entry.label || ""}
                  />
                </label>

                <label className="field">
                  <span>Country *</span>
                  <select
                    onChange={(event) =>
                      onUpdateDraftBranch(entry.id, "country", event.target.value)
                    }
                    value={entry.country || defaultCountry || ""}
                  >
                    <option value="">Select country</option>
                    {COUNTRY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>
                    {getDivisionLabelForCountry(entry.country || defaultCountry)}
                    {requiresStateForCountry(entry.country || defaultCountry) ? " *" : ""}
                  </span>
                  {stateOptions ? (
                    <select
                      onChange={(event) =>
                        onUpdateDraftBranch(entry.id, "state", event.target.value)
                      }
                      value={entry.state || ""}
                    >
                      <option value="">{`Select ${getDivisionLabelForCountry(
                        entry.country || defaultCountry,
                      ).toLowerCase()}`}</option>
                      {(entry.state && !stateOptions.includes(entry.state)
                        ? [entry.state, ...stateOptions]
                        : stateOptions
                      ).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      onChange={(event) =>
                        onUpdateDraftBranch(entry.id, "state", event.target.value)
                      }
                      placeholder={getDivisionPlaceholderForCountry(entry.country || defaultCountry)}
                      type="text"
                      value={entry.state || ""}
                    />
                  )}
                </label>

                <label className="field field--full">
                  <span>Address *</span>
                  <textarea
                    onChange={(event) =>
                      onUpdateDraftBranch(entry.id, "address", event.target.value)
                    }
                    placeholder="Enter the full address"
                    rows={3}
                    value={entry.address || ""}
                  />
                </label>

                <label className="field">
                  <span>{`Branch ${taxDefaults.taxFieldLabel} *`}</span>
                  <input
                    autoCapitalize="characters"
                    maxLength={(entry.country || defaultCountry) === "India" ? 15 : 64}
                    onChange={(event) =>
                      onUpdateDraftBranch(entry.id, "taxNumber", event.target.value)
                    }
                    placeholder={taxDefaults.taxPlaceholder}
                    type="text"
                    value={entry.taxNumber || ""}
                  />
                </label>

                <label className="field">
                  <span>Contact name</span>
                  <input
                    onChange={(event) =>
                      onUpdateDraftBranch(entry.id, "contactName", event.target.value)
                    }
                    type="text"
                    value={entry.contactName || ""}
                  />
                </label>

                <label className="field">
                  <span>Work email *</span>
                  <input
                    onChange={(event) =>
                      onUpdateDraftBranch(entry.id, "workEmail", event.target.value)
                    }
                    type="email"
                    value={entry.workEmail || ""}
                  />
                </label>

                <label className="field">
                  <span>Mobile number *</span>
                  <div className="mobile-number-field">
                    <select
                      aria-label="Mobile country code"
                      onChange={(event) =>
                        onUpdateDraftBranch(entry.id, "mobileCountryCode", event.target.value)
                      }
                      value={entry.mobileCountryCode || "+91"}
                    >
                      {mobileCountryCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                    <input
                      inputMode="numeric"
                      onChange={(event) =>
                        onUpdateDraftBranch(entry.id, "mobileNumber", event.target.value)
                      }
                      placeholder="Mobile number"
                      type="tel"
                      value={entry.mobileNumber || ""}
                    />
                  </div>
                </label>
              </div>
            );
          })}
        </div>
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
          const availableBranches = unusedBranchesForProduct(
            assignments,
            branches,
            assignment.productId,
            assignment.id,
          );
          // Keep the row's current branch selectable alongside unused ones.
          const selectableBranches = branches.filter(
            (entry) =>
              entry.id === assignment.branchId ||
              availableBranches.some((candidate) => candidate.id === entry.id),
          );
          const canDuplicate = availableBranches.some(
            (entry) => entry.id !== assignment.branchId,
          );

          return (
            <div className="branch-assignment-table__row" key={assignment.id} role="row">
              <span className="branch-assignment-table__product" role="cell">
                <strong>{product?.name || assignment.productId}</strong>
              </span>

              <label className="field branch-assignment-table__field" role="cell">
                <span className="sr-only">Branch location</span>
                {selectableBranches.length > 1 ? (
                  <select
                    onChange={(event) => onUpdate(assignment.id, "branchId", event.target.value)}
                    value={assignment.branchId}
                  >
                    {selectableBranches.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.isDraft
                          ? `${formatBranchOptionLabel(entry)} (new)`
                          : formatBranchOptionLabel(entry)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="branch-assignment-table__branch-label">
                    {(selectableBranches[0] || branch)?.isDraft
                      ? `${formatBranchOptionLabel(selectableBranches[0] || branch)} (new)`
                      : formatBranchOptionLabel(selectableBranches[0] || branch)}
                  </span>
                )}
              </label>

              <div className="branch-assignment-table__actions" role="cell">
                <div className="branch-assignment-table__controls">
                  <button
                    className="link-button"
                    disabled={!canDuplicate}
                    onClick={() => onDuplicate(assignment.id)}
                    title={
                      canDuplicate ? undefined : "All branches already have this product"
                    }
                    type="button"
                  >
                    + Same product, another branch
                  </button>
                  <button
                    aria-label={`Remove ${product?.name || assignment.productId}${
                      branch ? ` from ${formatBranchOptionLabel(branch)}` : ""
                    }`}
                    className="icon-button branch-assignment-table__remove"
                    onClick={() => onRemove(assignment.id)}
                    title="Remove assignment"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {branch ? (
                  <small className="branch-assignment-table__billing-note">
                    Invoiced to{" "}
                    {branch.isDraft
                      ? `${formatBranchOptionLabel(branch)} (new)`
                      : formatBranchOptionLabel(branch)}
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

function BillingCycleToggle({ disabled = false, onChange, value }) {
  const isYearly = value === "yearly";

  function setBillingCycle(nextValue) {
    if (disabled || nextValue === value) {
      return;
    }
    onChange(nextValue);
  }

  function handleContainerClick(event) {
    if (disabled) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const nextValue = event.clientX - rect.left > rect.width / 2 ? "yearly" : "monthly";
    setBillingCycle(nextValue);
  }

  return (
    <div
      className={`segmented-toggle segmented-toggle--compact${disabled ? " is-disabled" : ""}`}
      onClick={handleContainerClick}
      role="group"
      aria-label="Billing frequency"
      aria-disabled={disabled}
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

/** Always-visible add-on chrome (no switch) — shared by CRM / CDP / Campaign / VM / Ticketing. */
function AddonStaticSection({ caption, children, title }) {
  return (
    <div className="ccaas-addon-section ccaas-addon-section--nested">
      <div className="ccaas-addon-section__header">
        <div className="ccaas-addon-section__copy">
          <strong>{title}</strong>
          {caption ? <span>{caption}</span> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Shared accordion — same chrome as CCAAS (`.ccaas-pricing-panel` / `.ccaas-collapse-toggle`). */
function PricingCollapsePanel({
  children,
  defaultOpen = false,
  description,
  disabled = false,
  headerEnd = null,
  invalid = false,
  title,
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
    }
  }, [defaultOpen]);

  const toggle = (
    <button
      aria-expanded={open}
      className={`ccaas-collapse-toggle${invalid ? " is-invalid" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (disabled) {
          return;
        }
        setOpen((current) => !current);
      }}
      type="button"
    >
      <span className="ccaas-collapse-toggle__copy">
        <strong>{title}</strong>
        <small>{description || "\u00a0"}</small>
      </span>
      <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
    </button>
  );

  return (
    <section className={`ccaas-pricing-panel ${open ? "is-open" : "is-collapsed"}`}>
      {headerEnd ? (
        <div className={`ccaas-collapse-header${invalid ? " is-invalid" : ""}`}>
          {toggle}
          <div className="ccaas-collapse-header__end">{headerEnd}</div>
        </div>
      ) : (
        toggle
      )}
      {open ? <div className="ccaas-pricing-panel__body">{children}</div> : null}
    </section>
  );
}

function PricingSection({ children, defaultOpen = false, description, invalid = false, title }) {
  return (
    <PricingCollapsePanel
      defaultOpen={defaultOpen || invalid}
      description={description}
      invalid={invalid}
      title={title}
    >
      <div className="pricing-section__grid">{children}</div>
    </PricingCollapsePanel>
  );
}

/** Accordion package — always openable; no header FeatureEnableToggle (CCAAS-aligned). */
function PricingPackage({ children, defaultOpen = false, description, invalid = false, title }) {
  return (
    <PricingCollapsePanel
      defaultOpen={defaultOpen || invalid}
      description={description}
      invalid={invalid}
      title={title}
    >
      {children}
    </PricingCollapsePanel>
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

function PricingAddonGroup({ addonCount, children, defaultExpanded = false, title = "Add-ons" }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (defaultExpanded) {
      setExpanded(true);
    }
  }, [defaultExpanded]);

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
  error = "",
  invalid = false,
  label,
  max,
  metricsOnly = false,
  min = "0",
  onChange,
  placeholder = "0",
  readOnly = false,
  required = false,
  value,
}) {
  if (metricsOnly && isPricingFieldLabel(label)) {
    return null;
  }

  const isInvalid = Boolean(invalid || error);
  const message = error || "";

  return (
    <label className={`field${isInvalid ? " field--invalid" : ""}`}>
      <span>{label}</span>
      <input
        aria-invalid={isInvalid || undefined}
        data-pricing-invalid={isInvalid ? "true" : undefined}
        disabled={disabled}
        inputMode="decimal"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        onWheel={(event) => event.currentTarget.blur()}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        step="any"
        type="number"
        value={value}
      />
      {message ? (
        <p className="field__error" role="alert">
          {message}
        </p>
      ) : null}
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

/** Qty + rate fields always visible; `enabledField` tracks count > 0 (no toggle). */
function QuantityRateAddonSection({
  caption,
  enabledField,
  metricsOnly = false,
  onChange,
  quantity,
  quantityError = "",
  quantityField,
  quantityLabel,
  rate,
  rateField,
  rateLabel,
  rateReadOnly = false,
  title,
}) {
  function handleQuantityChange(value) {
    onChange(quantityField, value);
    if (enabledField) {
      onChange(enabledField, toNumber(value) > 0);
    }
  }

  return (
    <AddonStaticSection caption={caption} title={title}>
      <div className="ccaas-addon-section__fields">
        <MoneyInput
          error={quantityError}
          invalid={Boolean(quantityError)}
          label={quantityLabel}
          metricsOnly={metricsOnly}
          onChange={handleQuantityChange}
          required
          value={quantity}
        />
        {!metricsOnly ? (
          rateReadOnly ? (
            <label className="field">
              <span>{rateLabel}</span>
              <input readOnly value={rate ?? ""} />
            </label>
          ) : (
            <MoneyInput
              label={rateLabel}
              onChange={(value) => onChange(rateField, value)}
              value={rate}
            />
          )
        ) : null}
      </div>
    </AddonStaticSection>
  );
}

/** Catalog-driven Add-On Storage (mirrors numbers QuantityRateAddonSection). */
function StorageAddonSection({
  config,
  fieldErrors = null,
  metricsOnly = false,
  onChange,
  product,
  region,
}) {
  const storageAddOn = getProductStorageAddOn(product, region || config.region || "India");
  if (!storageAddOn.enabled) {
    return null;
  }
  const unit = storageAddOn.unit || "GB";
  return (
    <QuantityRateAddonSection
      caption="Purchase additional storage above the base plan"
      enabledField="additionalStorageEnabled"
      metricsOnly={metricsOnly}
      onChange={onChange}
      quantity={config.additionalStorageCount}
      quantityError={pricingFieldErrorText(fieldErrors, "additionalStorageCount")}
      quantityField="additionalStorageCount"
      quantityLabel={`Storage (${unit})`}
      rate={config.additionalStorageRate}
      rateField="additionalStorageRate"
      rateLabel={`Rate per ${unit}`}
      title={storageAddOn.label || "Add-On Storage"}
    />
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

function RegionCurrencyFields({ config, metricsOnly = false, onChange, readOnly = false }) {
  if (metricsOnly) {
    return null;
  }

  return (
    <>
      <label className="field">
        <span>Region</span>
        {readOnly ? (
          <input readOnly value={config.region} />
        ) : (
          <select onChange={(event) => onChange("region", event.target.value)} value={config.region}>
            {Object.keys(currencyByRegion).map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="field">
        <span>Currency</span>
        <input readOnly value={config.currency} />
      </label>
    </>
  );
}

function DiscountFields({ config, onChange }) {
  const isPercentage = config.discountType === "percentage";
  const maxFixedDiscount = getMaxFixedDiscount(config);

  useEffect(() => {
    if (config.discountType !== "fixed") {
      return;
    }
    const parsed = Number(config.discountValue);
    if (!Number.isFinite(parsed) || parsed <= maxFixedDiscount) {
      return;
    }
    onChange("discountValue", maxFixedDiscount > 0 ? String(maxFixedDiscount) : "0");
  }, [config.discountType, config.discountValue, maxFixedDiscount, onChange]);

  function handleDiscountTypeChange(nextType) {
    onChange("discountType", nextType);
    if (nextType === "percentage") {
      const parsed = Number(config.discountValue);
      if (Number.isFinite(parsed) && parsed > 100) {
        onChange("discountValue", "100");
      } else {
        onChange(
          "discountValue",
          sanitizeDiscountInput("percentage", config.discountValue, config.discountValue),
        );
      }
      return;
    }

    onChange(
      "discountValue",
      sanitizeDiscountInput("fixed", config.discountValue, config.discountValue, {
        maxFixedAmount: maxFixedDiscount,
      }),
    );
  }

  return (
    <>
      <label className="field">
        <span>Discount Type</span>
        <select
          onChange={(event) => handleDiscountTypeChange(event.target.value)}
          value={config.discountType}
        >
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </select>
      </label>
      <MoneyInput
        label="Discount"
        max={isPercentage ? "100" : String(maxFixedDiscount)}
        min="0"
        onChange={(value) =>
          onChange(
            "discountValue",
            sanitizeDiscountInput(config.discountType, value, config.discountValue, {
              maxFixedAmount: isPercentage ? null : maxFixedDiscount,
            }),
          )
        }
        placeholder={
          isPercentage
            ? "0–100"
            : maxFixedDiscount > 0
              ? `0–${maxFixedDiscount}`
              : "Amount"
        }
        value={config.discountValue}
      />
    </>
  );
}

function ImplementationDiscountFields({ config, onChange }) {
  const discountType = config.implementationDiscountType || "percentage";
  const isPercentage = discountType === "percentage";
  const maxFixedDiscount = getMaxFixedImplementationDiscount(config);

  useEffect(() => {
    if (discountType !== "fixed") {
      return;
    }
    const parsed = Number(config.implementationDiscountValue);
    if (!Number.isFinite(parsed) || parsed <= maxFixedDiscount) {
      return;
    }
    onChange(
      "implementationDiscountValue",
      maxFixedDiscount > 0 ? String(maxFixedDiscount) : "0",
    );
  }, [config.implementationDiscountValue, discountType, maxFixedDiscount, onChange]);

  function handleDiscountTypeChange(nextType) {
    onChange("implementationDiscountType", nextType);
    if (nextType === "percentage") {
      const parsed = Number(config.implementationDiscountValue);
      if (Number.isFinite(parsed) && parsed > 100) {
        onChange("implementationDiscountValue", "100");
      } else {
        onChange(
          "implementationDiscountValue",
          sanitizeDiscountInput(
            "percentage",
            config.implementationDiscountValue,
            config.implementationDiscountValue,
          ),
        );
      }
      return;
    }

    onChange(
      "implementationDiscountValue",
      sanitizeDiscountInput(
        "fixed",
        config.implementationDiscountValue,
        config.implementationDiscountValue,
        { maxFixedAmount: maxFixedDiscount },
      ),
    );
  }

  return (
    <>
      <label className="field">
        <span>Implementation discount type</span>
        <select
          onChange={(event) => handleDiscountTypeChange(event.target.value)}
          value={discountType}
        >
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </select>
      </label>
      <MoneyInput
        label="Implementation discount"
        max={isPercentage ? "100" : String(maxFixedDiscount)}
        min="0"
        onChange={(value) =>
          onChange(
            "implementationDiscountValue",
            sanitizeDiscountInput(discountType, value, config.implementationDiscountValue, {
              maxFixedAmount: isPercentage ? null : maxFixedDiscount,
            }),
          )
        }
        placeholder={
          isPercentage
            ? "0–100"
            : maxFixedDiscount > 0
              ? `0–${maxFixedDiscount}`
              : "Amount"
        }
        value={config.implementationDiscountValue || ""}
      />
    </>
  );
}

function AddonDiscountFields({ config, onChange }) {
  const discountType = config.addonDiscountType || "percentage";
  const isPercentage = discountType === "percentage";
  const maxFixedDiscount = getMaxFixedAddonDiscount(config);

  useEffect(() => {
    if (discountType !== "fixed") {
      return;
    }
    const parsed = Number(config.addonDiscountValue);
    if (!Number.isFinite(parsed) || parsed <= maxFixedDiscount) {
      return;
    }
    onChange("addonDiscountValue", maxFixedDiscount > 0 ? String(maxFixedDiscount) : "0");
  }, [config.addonDiscountValue, discountType, maxFixedDiscount, onChange]);

  function handleDiscountTypeChange(nextType) {
    onChange("addonDiscountType", nextType);
    if (nextType === "percentage") {
      const parsed = Number(config.addonDiscountValue);
      if (Number.isFinite(parsed) && parsed > 100) {
        onChange("addonDiscountValue", "100");
      } else {
        onChange(
          "addonDiscountValue",
          sanitizeDiscountInput("percentage", config.addonDiscountValue, config.addonDiscountValue),
        );
      }
      return;
    }

    onChange(
      "addonDiscountValue",
      sanitizeDiscountInput("fixed", config.addonDiscountValue, config.addonDiscountValue, {
        maxFixedAmount: maxFixedDiscount,
      }),
    );
  }

  return (
    <>
      <label className="field">
        <span>Add-on discount type</span>
        <select
          onChange={(event) => handleDiscountTypeChange(event.target.value)}
          value={discountType}
        >
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </select>
      </label>
      <MoneyInput
        label="Add-on discount"
        max={isPercentage ? "100" : String(maxFixedDiscount)}
        min="0"
        onChange={(value) =>
          onChange(
            "addonDiscountValue",
            sanitizeDiscountInput(discountType, value, config.addonDiscountValue, {
              maxFixedAmount: isPercentage ? null : maxFixedDiscount,
            }),
          )
        }
        placeholder={
          isPercentage
            ? "0–100"
            : maxFixedDiscount > 0
              ? `0–${maxFixedDiscount}`
              : "Amount"
        }
        value={config.addonDiscountValue || ""}
      />
    </>
  );
}

function PlanDiscountSections({ addonsOnly = false, config, monthlyTitle = "Discount", onChange }) {
  if (addonsOnly) {
    return (
      <PricingSection title="Add-on discount">
        <AddonDiscountFields config={config} onChange={onChange} />
      </PricingSection>
    );
  }

  return (
    <>
      <PricingSection title={monthlyTitle}>
        <DiscountFields config={config} onChange={onChange} />
      </PricingSection>
      <PricingSection title="Add-on discount">
        <AddonDiscountFields config={config} onChange={onChange} />
      </PricingSection>
    </>
  );
}

function ProductPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  forceExpandRequest = 0,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
  product,
}) {
  if (config.pricingMode === "ccaas") {
    return (
      <CcaasPricingForm
        addonsOnly={addonsOnly}
        changeType={changeType}
        config={config}
        fieldErrors={fieldErrors}
        forceExpandRequest={forceExpandRequest}
        isRenewalQuote={isRenewalQuote}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  if (config.pricingMode === "crm") {
    return (
      <CrmPricingForm
        addonsOnly={addonsOnly}
        changeType={changeType}
        config={config}
        fieldErrors={fieldErrors}
        forceExpandRequest={forceExpandRequest}
        isRenewalQuote={isRenewalQuote}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  if (config.pricingMode === "cdp") {
    return (
      <CdpPricingForm
        addonsOnly={addonsOnly}
        changeType={changeType}
        config={config}
        fieldErrors={fieldErrors}
        forceExpandRequest={forceExpandRequest}
        isRenewalQuote={isRenewalQuote}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  if (config.pricingMode === "campaign") {
    return (
      <CampaignPricingForm
        addonsOnly={addonsOnly}
        changeType={changeType}
        config={config}
        fieldErrors={fieldErrors}
        forceExpandRequest={forceExpandRequest}
        isRenewalQuote={isRenewalQuote}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  if (config.pricingMode === "value-management") {
    return (
      <ValueManagementPricingForm
        addonsOnly={addonsOnly}
        changeType={changeType}
        config={config}
        fieldErrors={fieldErrors}
        forceExpandRequest={forceExpandRequest}
        isRenewalQuote={isRenewalQuote}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  if (config.pricingMode === "ticketing") {
    return (
      <TicketingPricingForm
        addonsOnly={addonsOnly}
        changeType={changeType}
        config={config}
        fieldErrors={fieldErrors}
        forceExpandRequest={forceExpandRequest}
        isRenewalQuote={isRenewalQuote}
        lead={lead}
        metricsOnly={metricsOnly}
        onChange={onChange}
      />
    );
  }

  return (
    <GenericPricingForm
      config={config}
      fieldErrors={fieldErrors}
      metricsOnly={metricsOnly}
      onChange={onChange}
      product={product}
    />
  );
}

function CcaasPlanPicker({
  emptyMessage = "",
  locked = false,
  onSelectPlan,
  plans = CCAAS_PLANS,
  selectedPlanId,
  subtitle = "Select one license plan to pre-fill modules.",
  title = "Choose a plan",
}) {
  const [plansOpen, setPlansOpen] = useState(!selectedPlanId && !locked);

  useEffect(() => {
    if (locked) {
      setPlansOpen(false);
      return;
    }
    if (!selectedPlanId) {
      setPlansOpen(true);
    }
  }, [locked, selectedPlanId]);

  function handleSelectPlan(planId) {
    if (locked) {
      return;
    }
    onSelectPlan(planId);
    setPlansOpen(false);
  }

  return (
    <section className={`ccaas-plan-picker ${plansOpen ? "is-open" : "is-collapsed"}`}>
      <button
        aria-expanded={plansOpen}
        className="ccaas-collapse-toggle"
        disabled={locked || plans.length === 0}
        onClick={() => {
          if (locked || plans.length === 0) {
            return;
          }
          setPlansOpen((current) => !current);
        }}
        type="button"
      >
        <span className="ccaas-collapse-toggle__copy">
          <strong>{title}</strong>
          <small>
            {selectedPlanId
              ? locked
                ? `${getCcaasPlanLabel(selectedPlanId)} (locked for mid-period add-on)`
                : getCcaasPlanLabel(selectedPlanId)
              : subtitle}
          </small>
        </span>
        <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
      </button>

      {plansOpen && !locked ? (
        plans.length ? (
          <div className="ccaas-plan-picker__grid" role="listbox" aria-label="AI CCaaS plans">
            {plans.map((plan) => {
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
        ) : emptyMessage ? (
          <p className="change-type-field__note">{emptyMessage}</p>
        ) : null
      ) : null}
    </section>
  );
}

function CcaasPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  forceExpandRequest = 0,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
}) {
  const catalog = getCachedPricingCatalog();
  const modulesConfig = config.modules || {};
  const usageDetails = config.usageDetails || createDefaultUsageDetails();
  const planSelected = Boolean(config.licenseTier);
  const showImplementationNote = shouldShowImplementationNote(lead, config.productId, changeType, {
    renewal: isRenewalQuote,
  });
  const canConfigureModules = planSelected;
  const contactCenterProduct = catalog.products?.["contact-center"];
  const tierDefaultVolumes = contactCenterProduct?.tierDefaultVolumes || {};
  const planModuleRows = useMemo(
    () => getPlanModuleRows(contactCenterProduct, config.licenseTier),
    [contactCenterProduct, config.licenseTier],
  );
  const configurationRows = useMemo(
    () =>
      getCcaasConfigurationPricingRows(
        modulesConfig,
        config.licenseTier,
        tierDefaultVolumes,
        contactCenterProduct,
      ),
    [modulesConfig, config.licenseTier, tierDefaultVolumes, contactCenterProduct],
  );
  const configurationSummary = useMemo(
    () =>
      configurationRows.length > 0
        ? getConfigurationSummary(modulesConfig, config.licenseTier, tierDefaultVolumes, {
            metricsOnly,
          })
        : planSelected
          ? metricsOnly
            ? "Set agent count and usage volumes for this plan."
            : "Set agent count, rates, and usage volumes for this plan."
          : metricsOnly
            ? "Select a plan above to configure agent count and usage volumes."
            : "Select a plan above to configure agent count, rates, and usage volumes.",
    [
      modulesConfig,
      config.licenseTier,
      tierDefaultVolumes,
      configurationRows.length,
      planSelected,
      metricsOnly,
    ],
  );
  const [pricingOpen, setPricingOpen] = useState(planSelected && !addonsOnly);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [addonsOpen, setAddonsOpen] = useState(addonsOnly);

  useEffect(() => {
    if (addonsOnly) {
      setPricingOpen(false);
      setConfigurationOpen(false);
      setAddonsOpen(true);
      return;
    }
    if (canConfigureModules) {
      setPricingOpen(true);
    } else {
      setPricingOpen(false);
    }
  }, [addonsOnly, canConfigureModules, config.licenseTier]);

  useEffect(() => {
    if (!forceExpandRequest) {
      return;
    }
    if (fieldErrors?.needsModulesHighlight) {
      setPricingOpen(true);
    }
    if (fieldErrors?.needsConfigurationExpand) {
      setConfigurationOpen(true);
    }
    if (fieldErrors?.needsAddonsExpand) {
      setAddonsOpen(true);
    }
    scrollToFirstPricingInvalidField();
  }, [forceExpandRequest, fieldErrors]);

  function updateModule(moduleId, patch) {
    const current = modulesConfig[moduleId] || { optionId: NONE_OPTION_ID, price: "0" };
    onChange("modules", {
      ...modulesConfig,
      [moduleId]: { ...current, ...patch },
    });
  }

  function handleCapabilityChange(moduleId, row, optionId) {
    const option = getModuleOption(moduleId, optionId);
    const pricingPlanId = resolveModuleOptionPricingPlan(moduleId, optionId, config.licenseTier);
    const region = config.region || "India";
    const catalogPrice = getModuleOptionPrice(catalog, moduleId, optionId, region, pricingPlanId) || "0";

    updateModule(moduleId, {
      optionId,
      capabilityLabel: option?.label || optionId,
      pricingPlanId,
      moduleName: row.moduleName,
      price: config.zeroCatalogDefaults ? "0" : catalogPrice,
    });
  }

  function updateConfigurationLine(row, editedField, value) {
    onChange(
      "usageDetails",
      applyConfigurationPricingEdit(usageDetails, row, editedField, value),
    );
  }

  function commitConfigurationQty(row) {
    onChange("usageDetails", commitConfigurationPricingQty(usageDetails, row));
  }

  const modulesInvalid = Boolean(fieldErrors?.needsModulesHighlight);
  const configurationInvalid = Boolean(fieldErrors?.needsConfigurationExpand);
  const addonsInvalid = Boolean(fieldErrors?.needsAddonsExpand);

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      {addonsOnly ? (
        <p className="feature-locked-note">
          Base plan, modules, and configuration are locked for this subscription period. Choose add-ons
          only.
        </p>
      ) : null}
      {!addonsOnly ? (
      <section className={`ccaas-pricing-panel ${pricingOpen ? "is-open" : "is-collapsed"}`}>
        <button
          aria-expanded={pricingOpen}
          className={`ccaas-collapse-toggle${modulesInvalid ? " is-invalid" : ""}`}
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
                ? `Modules and capabilities for ${getCcaasPlanLabel(config.licenseTier)}.`
                : metricsOnly
                  ? "Select a plan above to configure module capabilities."
                  : "Select a plan above to configure module capabilities."}
            </small>
          </span>
          <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
        </button>

        {pricingOpen && canConfigureModules ? (
          <div className="ccaas-module-matrix">
            <div className="ccaas-module-matrix__header" aria-hidden="true">
              <span>Module</span>
              <span>Capability</span>
            </div>
            <div className="ccaas-module-matrix__body">
              {planModuleRows.map((row) => {
                const moduleId = resolvePlanModuleKey(row);
                const selection = modulesConfig[moduleId] || {
                  optionId: row.optionId || NONE_OPTION_ID,
                  price: "0",
                };
                const selectedOptionId = selection.optionId || row.optionId || NONE_OPTION_ID;
                const capabilityOptions = row.custom
                  ? []
                  : getModuleOptionsForLicenseTier(moduleId, config.licenseTier);
                const capabilityLabel =
                  selection.capabilityLabel || row.capability || selectedOptionId;
                const moduleInvalid = Boolean(fieldErrors?.modules?.[moduleId]);

                return (
                  <div className="ccaas-module-matrix__row" key={row.id}>
                    <span className="ccaas-module-matrix__label">{row.moduleName}</span>
                    {capabilityOptions.length > 1 ? (
                      <label
                        className={`field ccaas-module-matrix__option${moduleInvalid ? " field--invalid" : ""}`}
                      >
                        <span className="sr-only">{row.moduleName} capability</span>
                        <select
                          data-pricing-invalid={moduleInvalid ? "true" : undefined}
                          onChange={(event) =>
                            handleCapabilityChange(moduleId, row, event.target.value)
                          }
                          value={selectedOptionId}
                        >
                          {capabilityOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span
                        className={`ccaas-module-matrix__capability${moduleInvalid ? " is-invalid" : ""}`}
                        data-pricing-invalid={moduleInvalid ? "true" : undefined}
                      >
                        {capabilityOptions[0]?.label || capabilityLabel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {!addonsOnly ? (
      <section className={`ccaas-pricing-panel ${configurationOpen ? "is-open" : "is-collapsed"}`}>
        <button
          aria-expanded={configurationOpen}
          className={`ccaas-collapse-toggle${configurationInvalid ? " is-invalid" : ""}`}
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
          configurationRows.length > 0 ? (
            <div className="ccaas-config-table-wrap">
              <table
                className={`ccaas-config-table${metricsOnly ? " ccaas-config-table--metrics-only" : ""}`}
              >
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    {!metricsOnly ? (
                      <>
                        <th scope="col">Rate</th>
                        <th scope="col">Total</th>
                      </>
                    ) : (
                      <th scope="col">Qty</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {configurationRows.map((row) => {
                    const qtyInvalid =
                      row.qtyKey === "agentCount" && Boolean(fieldErrors?.usageDetails?.agentCount);
                    const qtyInput = (
                      <input
                        aria-label={`${row.itemLabel} quantity`}
                        className={`ccaas-config-table__qty${qtyInvalid ? " is-invalid" : ""}`}
                        data-pricing-invalid={qtyInvalid ? "true" : undefined}
                        inputMode="numeric"
                        min={row.min ?? 0}
                        onChange={(event) =>
                          updateConfigurationLine(row, "qty", event.target.value)
                        }
                        onBlur={() => commitConfigurationQty(row)}
                        onWheel={(event) => event.currentTarget.blur()}
                        step="1"
                        type="number"
                        value={usageDetails[row.qtyKey] ?? ""}
                      />
                    );
                    return (
                    <tr key={row.id}>
                      <th scope="row">
                        <span className="ccaas-config-table__item-name">{row.itemLabel}</span>
                        {!metricsOnly ? qtyInput : null}
                      </th>
                      {metricsOnly ? <td>{qtyInput}</td> : null}
                      {!metricsOnly ? (
                        <>
                          <td>
                            <label className="ccaas-config-table__cell-label">
                              <span className="ccaas-config-table__hint">{row.rateLabel}</span>
                              <input
                                aria-label={row.rateLabel}
                                inputMode="decimal"
                                min="0"
                                onChange={(event) =>
                                  updateConfigurationLine(row, "rate", event.target.value)
                                }
                                onWheel={(event) => event.currentTarget.blur()}
                                step="any"
                                type="number"
                                value={usageDetails[row.rateKey] ?? ""}
                              />
                            </label>
                          </td>
                          <td>
                            <label className="ccaas-config-table__cell-label">
                              <span className="ccaas-config-table__hint">{row.totalLabel}</span>
                              <input
                                aria-label={row.totalLabel}
                                inputMode="decimal"
                                min="0"
                                onChange={(event) =>
                                  updateConfigurationLine(row, "total", event.target.value)
                                }
                                onWheel={(event) => event.currentTarget.blur()}
                                step="any"
                                type="number"
                                value={usageDetails[row.totalKey] ?? ""}
                              />
                            </label>
                          </td>
                        </>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ccaas-config-grid__empty">{configurationSummary}</p>
          )
        ) : null}
      </section>
      ) : null}

      <section className={`ccaas-pricing-panel ${addonsOpen ? "is-open" : "is-collapsed"}`}>
        <button
          aria-expanded={addonsOpen}
          className={`ccaas-collapse-toggle${addonsInvalid ? " is-invalid" : ""}`}
          disabled={!canConfigureModules && !addonsOnly}
          onClick={() => {
            if (!canConfigureModules && !addonsOnly) {
              return;
            }
            setAddonsOpen((current) => !current);
          }}
          type="button"
        >
          <span className="ccaas-collapse-toggle__copy">
            <strong>Add-ons</strong>
            <small>
              {addonsOnly
                ? "Human agent, storage, and channel-wise packs for this subscription period."
                : "Optional human agent seats, storage, and channel-wise packs."}
            </small>
          </span>
          <ChevronRight className="ccaas-collapse-toggle__chevron" size={18} />
        </button>

        {addonsOpen && (addonsOnly || canConfigureModules) ? (
          <CcaasMidPeriodAddonsPanel
            addonsOnly={addonsOnly}
            config={config}
            fieldErrors={fieldErrors?.addons || null}
            metricsOnly={metricsOnly}
            onChange={onChange}
          />
        ) : null}
      </section>

      {!addonsOnly && !metricsOnly && planSelected ? (
        showImplementationNote ? (
          <p className="feature-locked-note">{getImplementationPurchaseNote(lead, config.productId)}</p>
        ) : (
          <PricingSection
            invalid={Boolean(fieldErrors?.implementationFee)}
            title="Implementation"
          >
            <MoneyInput
              error={
                fieldErrors?.implementationFee
                  ? IMPLEMENTATION_FEE_REQUIRED_MSG
                  : ""
              }
              invalid={Boolean(fieldErrors?.implementationFee)}
              label="Implementation Fee"
              metricsOnly={metricsOnly}
              onChange={(value) => {
                onChange("implementationEnabled", true);
                onChange("implementationFee", value);
              }}
              required
              value={config.implementationFee}
            />
            <ImplementationDiscountFields config={config} onChange={onChange} />
          </PricingSection>
        )
      ) : null}

      {!metricsOnly ? (
        <PlanDiscountSections
          addonsOnly={addonsOnly}
          config={config}
          monthlyTitle="Discount (monthly plan)"
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function CcaasMidPeriodAddonsPanel({
  addonsOnly = false,
  config,
  fieldErrors = null,
  metricsOnly = false,
  onChange,
}) {
  const catalog = getCachedPricingCatalog();
  const contactCenter = catalog.products?.["contact-center"] || {};
  const fallbackBillingMode = addonsOnly ? "addons-only" : "with-core";
  const mid =
    config.midPeriodAddons ||
    seedCcaasMidPeriodAddons(config, { billingMode: fallbackBillingMode });
  const agentAddon = getPlanAgentAddon(config, contactCenter);
  const queueAddon = getPlanQueueCapacityAddon(config, contactCenter);
  const storageAddOn = getProductStorageAddOn(contactCenter, config.region || "India");
  const visibleChannels = getVisiblePlanAddonChannels(config, contactCenter);
  const sectionInvalid = Boolean(fieldErrors?.section);
  const humanAgentInvalid = Boolean(fieldErrors?.humanAgentCount);
  const queueCapacityInvalid = Boolean(fieldErrors?.queueCapacityCount);
  const storageInvalid = Boolean(fieldErrors?.storageCount);

  function patchMidPeriod(next) {
    onChange("midPeriodAddons", {
      ...next,
      active: true,
      billingMode: next.billingMode || mid.billingMode || fallbackBillingMode,
    });
  }

  function updateHumanAgent(patch) {
    patchMidPeriod({
      ...mid,
      humanAgent: { ...mid.humanAgent, ...patch },
    });
  }

  function updateQueueCapacity(patch) {
    patchMidPeriod({
      ...mid,
      queueCapacity: { ...(mid.queueCapacity || {}), ...patch },
    });
  }

  function updateStorage(patch) {
    const nextStorage = { ...(mid.storage || {}), ...patch };
    patchMidPeriod({
      ...mid,
      storage: nextStorage,
    });
    onChange("additionalStorageEnabled", nextStorage.enabled === true);
    if (patch.count !== undefined) {
      onChange("additionalStorageCount", patch.count);
    }
    if (patch.rate !== undefined) {
      onChange("additionalStorageRate", patch.rate);
    }
  }

  function updateChannel(channelId, patch) {
    const current = mid.channels?.[channelId] || {
      enabled: false,
      slabId: "",
      count: "",
      rate: "",
    };
    patchMidPeriod({
      ...mid,
      channels: {
        ...mid.channels,
        [channelId]: { ...current, ...patch },
      },
    });
  }

  function handleChannelSlabChange(channel, slabId) {
    if (!slabId || slabId === "none") {
      updateChannel(channel.id, {
        enabled: false,
        slabId: "",
        count: "",
        rate: "",
        label: channel.label,
      });
      return;
    }

    const slab = (channel.slabs || []).find((entry) => entry.id === slabId);
    updateChannel(channel.id, {
      enabled: true,
      slabId,
      count: slab?.count || "",
      rate: slab?.rate || "",
      label: channel.label,
    });
  }

  return (
    <div
      className={`ccaas-addons mid-period-addons${sectionInvalid ? " is-invalid" : ""}`}
      data-pricing-invalid={sectionInvalid ? "true" : undefined}
    >
      {agentAddon ? (
        <div
          className={`ccaas-addon-section${mid.humanAgent?.enabled ? " is-enabled" : ""}${
            humanAgentInvalid ? " is-invalid" : ""
          }`}
        >
          <div className="ccaas-addon-section__header">
            <div className="ccaas-addon-section__copy">
              <strong>{agentAddon.label || "Agent count increase"}</strong>
              <span>Add agent seats</span>
            </div>
            <FeatureEnableToggle
              ariaLabel="Add agent seats"
              enabled={mid.humanAgent?.enabled === true}
              onChange={(enabled) => {
                updateHumanAgent({
                  enabled,
                  ...(enabled
                    ? {
                        count: mid.humanAgent?.count || agentAddon.defaultCount || "",
                        rate: mid.humanAgent?.rate || agentAddon.defaultRate || "",
                        label: agentAddon.label,
                      }
                    : {}),
                });
              }}
            />
          </div>
          {mid.humanAgent?.enabled ? (
            <div className="ccaas-addon-section__fields">
              <label className={`field${humanAgentInvalid ? " field--invalid" : ""}`}>
                <span>Seat count</span>
                <input
                  data-pricing-invalid={humanAgentInvalid ? "true" : undefined}
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => updateHumanAgent({ count: event.target.value })}
                  onWheel={(event) => event.currentTarget.blur()}
                  placeholder="1"
                  step="1"
                  type="number"
                  value={mid.humanAgent.count ?? ""}
                />
              </label>
              {!metricsOnly ? (
                <label className="field">
                  <span>Rate per seat</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => updateHumanAgent({ rate: event.target.value })}
                    onWheel={(event) => event.currentTarget.blur()}
                    step="any"
                    type="number"
                    value={mid.humanAgent.rate ?? ""}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {queueAddon ? (
        <div
          className={`ccaas-addon-section${mid.queueCapacity?.enabled ? " is-enabled" : ""}${
            queueCapacityInvalid ? " is-invalid" : ""
          }`}
        >
          <div className="ccaas-addon-section__header">
            <div className="ccaas-addon-section__copy">
              <strong>{queueAddon.label || "Queue capacity"}</strong>
              <span>Extra concurrent queue capacity (not a phone-number SKU)</span>
            </div>
            <FeatureEnableToggle
              ariaLabel="Add queue capacity"
              enabled={mid.queueCapacity?.enabled === true}
              onChange={(enabled) => {
                updateQueueCapacity({
                  enabled,
                  ...(enabled
                    ? {
                        count: mid.queueCapacity?.count || queueAddon.defaultCount || "",
                        rate: mid.queueCapacity?.rate || queueAddon.defaultRate || "",
                        label: queueAddon.label,
                      }
                    : {}),
                });
              }}
            />
          </div>
          {mid.queueCapacity?.enabled ? (
            <div className="ccaas-addon-section__fields">
              <label className={`field${queueCapacityInvalid ? " field--invalid" : ""}`}>
                <span>Queue capacity</span>
                <input
                  data-pricing-invalid={queueCapacityInvalid ? "true" : undefined}
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => updateQueueCapacity({ count: event.target.value })}
                  onWheel={(event) => event.currentTarget.blur()}
                  placeholder="1"
                  step="1"
                  type="number"
                  value={mid.queueCapacity.count ?? ""}
                />
              </label>
              {!metricsOnly ? (
                <label className="field">
                  <span>Rate per unit</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => updateQueueCapacity({ rate: event.target.value })}
                    onWheel={(event) => event.currentTarget.blur()}
                    step="any"
                    type="number"
                    value={mid.queueCapacity.rate ?? ""}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {storageAddOn.enabled ? (
        <div
          className={`ccaas-addon-section${mid.storage?.enabled ? " is-enabled" : ""}${
            storageInvalid ? " is-invalid" : ""
          }`}
        >
          <div className="ccaas-addon-section__header">
            <div className="ccaas-addon-section__copy">
              <strong>{storageAddOn.label || "Add-On Storage"}</strong>
              <span>Purchase additional storage above the base plan</span>
            </div>
            <FeatureEnableToggle
              ariaLabel="Add storage"
              enabled={mid.storage?.enabled === true}
              onChange={(enabled) => {
                updateStorage({
                  enabled,
                  ...(enabled
                    ? {
                        count: mid.storage?.count || storageAddOn.defaultCount || "",
                        rate: mid.storage?.rate || storageAddOn.defaultRate || "",
                        label: storageAddOn.label,
                        unit: storageAddOn.unit || "GB",
                      }
                    : {}),
                });
              }}
            />
          </div>
          {mid.storage?.enabled ? (
            <div className="ccaas-addon-section__fields">
              <label className={`field${storageInvalid ? " field--invalid" : ""}`}>
                <span>Storage ({storageAddOn.unit || "GB"})</span>
                <input
                  data-pricing-invalid={storageInvalid ? "true" : undefined}
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => updateStorage({ count: event.target.value })}
                  onWheel={(event) => event.currentTarget.blur()}
                  placeholder="1"
                  step="1"
                  type="number"
                  value={mid.storage?.count ?? ""}
                />
              </label>
              {!metricsOnly ? (
                <label className="field">
                  <span>Rate per {storageAddOn.unit || "GB"}</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => updateStorage({ rate: event.target.value })}
                    onWheel={(event) => event.currentTarget.blur()}
                    step="any"
                    type="number"
                    value={mid.storage?.rate ?? ""}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ccaas-addon-section ccaas-addon-section--channels">
        <div className="ccaas-addon-section__header">
          <div className="ccaas-addon-section__copy">
            <strong>Channel-wise</strong>
            <span>SMS, Email, WhatsApp, and other packs</span>
          </div>
        </div>
        {visibleChannels.length === 0 ? (
          <p className="ccaas-config-grid__empty">
            Select a Digital Channels capability in Modules to see channel add-ons for this plan.
          </p>
        ) : (
          <div className="mid-period-channels">
            {visibleChannels.map((channel) => {
              const entry = mid.channels?.[channel.id] || {
                enabled: false,
                slabId: "",
                count: "",
                rate: "",
              };
              const slabOptions = channel.slabs || [];
              const selectedSlabId = slabOptions.some((slab) => slab.id === entry.slabId)
                ? entry.slabId
                : "none";
              const slabSelected = selectedSlabId !== "none";
              const channelInvalid = Boolean(fieldErrors?.[`channel:${channel.id}`]);
              return (
                <div
                  className={`mid-period-channel-row${slabSelected ? " is-active" : ""}${
                    channelInvalid ? " is-invalid" : ""
                  }`}
                  key={channel.id}
                >
                  <label className={`field${channelInvalid ? " field--invalid" : ""}`}>
                    <span>{channel.label}</span>
                    {slabOptions.length > 0 ? (
                      <select
                        data-pricing-invalid={channelInvalid ? "true" : undefined}
                        onChange={(event) => handleChannelSlabChange(channel, event.target.value)}
                        value={selectedSlabId}
                      >
                        <option value="none">None</option>
                        {slabOptions.map((slab) => (
                          <option key={slab.id} value={slab.id}>
                            {metricsOnly
                              ? Number.isFinite(Number(slab.count))
                                ? `${Number(slab.count).toLocaleString()}`
                                : slab.label || slab.id
                              : slab.optionLabel}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="mid-period-channel-row__static">None</span>
                    )}
                  </label>
                  {slabSelected ? (
                    <>
                      <label className="field">
                        <span>Count</span>
                        <input
                          inputMode="numeric"
                          min="0"
                          onChange={(event) =>
                            updateChannel(channel.id, { count: event.target.value })
                          }
                          onWheel={(event) => event.currentTarget.blur()}
                          placeholder="0"
                          step="1"
                          type="number"
                          value={entry.count ?? ""}
                        />
                      </label>
                      {!metricsOnly ? (
                        <label className="field">
                          <span>Price</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              updateChannel(channel.id, { rate: event.target.value })
                            }
                            onWheel={(event) => event.currentTarget.blur()}
                            step="any"
                            type="number"
                            value={entry.rate ?? ""}
                          />
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactSlabSelector({
  config,
  error = "",
  metricsOnly = false,
  onChange,
  enabledField = "additionalContactsEnabled",
}) {
  const slabs = getContactChargeSlabs(config.region, config.productId);
  const selectedSlab = slabs[config.additionalContactSlab];
  const slabSelected = Boolean(config.additionalContactSlab);
  const isInvalid = Boolean(error);

  return (
    <div className="ccaas-addon-section__fields">
      <label className={`field${isInvalid ? " field--invalid" : ""}`}>
        <span>Contact slab</span>
        <select
          aria-invalid={isInvalid || undefined}
          data-pricing-invalid={isInvalid ? "true" : undefined}
          onChange={(event) => {
            const slab = event.target.value;
            onChange(enabledField, Boolean(slab));
            onChange("additionalContactSlab", slab);
          }}
          value={config.additionalContactSlab || ""}
        >
          <option value="">None</option>
          {Object.entries(slabs).map(([slab, details]) => (
            <option key={slab} value={slab}>
              {Number(details.contacts).toLocaleString()} contacts
            </option>
          ))}
        </select>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </label>
      {slabSelected && !metricsOnly ? (
        <>
          <label className="field">
            <span>Slab price</span>
            <input
              disabled
              value={
                selectedSlab
                  ? `${config.currency} ${Number(selectedSlab.monthlyPrice).toLocaleString()}`
                  : ""
              }
            />
          </label>
          <label className="field">
            <span>Per-contact rate</span>
            <input disabled value={selectedSlab ? selectedSlab.perContactRate : ""} />
          </label>
        </>
      ) : null}
    </div>
  );
}

function TicketSlabSelector({ config, error = "", metricsOnly = false, onChange }) {
  const selectedSlab = getTicketSlabs(config.region)[config.additionalTicketSlab];
  const slabSelected = Boolean(config.additionalTicketSlab);
  const isInvalid = Boolean(error);

  return (
    <div className="ccaas-addon-section__fields">
      <label className={`field${isInvalid ? " field--invalid" : ""}`}>
        <span>Ticket slab</span>
        <select
          aria-invalid={isInvalid || undefined}
          data-pricing-invalid={isInvalid ? "true" : undefined}
          onChange={(event) => {
            const slab = event.target.value;
            onChange("additionalTicketsEnabled", Boolean(slab));
            onChange("additionalTicketSlab", slab);
          }}
          value={config.additionalTicketSlab || ""}
        >
          <option value="">None</option>
          {Object.entries(getTicketSlabs(config.region)).map(([slab, details]) => (
            <option key={slab} value={slab}>
              {Number(details.tickets).toLocaleString()} tickets
            </option>
          ))}
        </select>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </label>
      {slabSelected && !metricsOnly ? (
        <>
          <label className="field">
            <span>Slab price</span>
            <input
              disabled
              value={
                selectedSlab
                  ? `${config.currency} ${Number(selectedSlab.monthlyPrice).toLocaleString()}`
                  : ""
              }
            />
          </label>
          <label className="field">
            <span>Per-ticket rate</span>
            <input disabled value={selectedSlab ? selectedSlab.perTicketRate : ""} />
          </label>
        </>
      ) : null}
    </div>
  );
}

function CrmPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
}) {
  const showImplementationNote = shouldShowImplementationNote(lead, config.productId, changeType, {
    renewal: isRenewalQuote,
  });
  const mid = config.midPeriodAddons || {};
  const catalogProduct = getCatalog(config.region || "India").products?.crm || {};
  const numberAddOn = getProductNumberAddOn(catalogProduct);
  const storageAddOn = getProductStorageAddOn(catalogProduct, config.region || "India");
  const implementationInvalid = Boolean(fieldErrors?.implementationCost);
  const addonsInvalid = Boolean(fieldErrors?.addons);

  function patchMidPeriod(next) {
    const synced = {
      ...mid,
      ...next,
      active: true,
      billingMode: mid.billingMode || "addons-only",
      userLicense: { ...mid.userLicense, ...next.userLicense },
      contacts: { ...mid.contacts, ...next.contacts },
      numbers: { ...mid.numbers, ...next.numbers },
      storage: { ...mid.storage, ...next.storage },
    };
    onChange("midPeriodAddons", synced);
    onChange("additionalContactsEnabled", synced.contacts?.enabled === true);
    onChange("additionalContactSlab", synced.contacts?.slab || "");
    onChange("additionalNumbersEnabled", synced.numbers?.enabled === true);
    if (synced.numbers?.count != null) {
      onChange("additionalNumberCount", synced.numbers.count);
    }
    if (synced.numbers?.rate != null) {
      onChange("additionalNumberRate", synced.numbers.rate);
    }
    onChange("additionalStorageEnabled", synced.storage?.enabled === true);
    if (synced.storage?.count != null) {
      onChange("additionalStorageCount", synced.storage.count);
    }
    if (synced.storage?.rate != null) {
      onChange("additionalStorageRate", synced.storage.rate);
    }
  }

  if (addonsOnly) {
    return (
      <div className="pricing-hierarchy ccaas-pricing-form">
        <p className="feature-locked-note">
          Base plan is locked for this subscription period. Current package: {config.userCount || "0"}{" "}
          users
          {metricsOnly
            ? ""
            : ` @ ${config.userLicenseRate || "0"}`}
          , {Number(config.includedContacts || 0).toLocaleString()} included contacts. Purchase user,
          number, storage, or contact add-ons only.
        </p>

        <PricingCollapsePanel
          defaultOpen
          description="Purchase user, number, storage, or contact add-ons only."
          title="Add-ons"
        >
          <div className="ccaas-addons mid-period-addons">
            <AddonStaticSection caption="Add additional user licenses" title="User License">
              <div className="ccaas-addon-section__fields">
                <label className="field">
                  <span>Additional seats</span>
                  <input
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => {
                      const additionalCount = event.target.value;
                      patchMidPeriod({
                        ...mid,
                        userLicense: {
                          ...mid.userLicense,
                          enabled: toNumber(additionalCount) > 0,
                          additionalCount,
                        },
                      });
                    }}
                    onWheel={(event) => event.currentTarget.blur()}
                    placeholder="1"
                    step="1"
                    type="number"
                    value={mid.userLicense?.additionalCount ?? ""}
                  />
                </label>
                {!metricsOnly ? (
                  <label className="field">
                    <span>Rate per user</span>
                    <input
                      readOnly
                      value={config.additionalUserLicenseRate || config.userLicenseRate || ""}
                    />
                  </label>
                ) : null}
              </div>
            </AddonStaticSection>

            {numberAddOn.enabled ? (
              <AddonStaticSection
                caption="Add additional numbers"
                title={numberAddOn.label || "Additional numbers"}
              >
                <div className="ccaas-addon-section__fields">
                  <MoneyInput
                    label="Number count"
                    metricsOnly={metricsOnly}
                    onChange={(value) =>
                      patchMidPeriod({
                        ...mid,
                        numbers: {
                          ...mid.numbers,
                          enabled: toNumber(value) > 0,
                          count: value,
                          rate: mid.numbers?.rate || numberAddOn.defaultRate || "",
                          label: numberAddOn.label,
                        },
                      })
                    }
                    required
                    value={mid.numbers?.count ?? ""}
                  />
                  <MoneyInput
                    label="Rate per number"
                    metricsOnly={metricsOnly}
                    onChange={(value) =>
                      patchMidPeriod({
                        ...mid,
                        numbers: {
                          ...mid.numbers,
                          enabled: toNumber(mid.numbers?.count) > 0,
                          count: mid.numbers?.count || "",
                          rate: value,
                          label: numberAddOn.label,
                        },
                      })
                    }
                    value={mid.numbers?.rate ?? ""}
                  />
                </div>
              </AddonStaticSection>
            ) : null}

            {storageAddOn.enabled ? (
              <AddonStaticSection
                caption="Purchase additional storage above the base plan"
                title={storageAddOn.label || "Add-On Storage"}
              >
                <div className="ccaas-addon-section__fields">
                  <MoneyInput
                    error={pricingFieldErrorText(fieldErrors, "additionalStorageCount")}
                    invalid={Boolean(fieldErrors?.additionalStorageCount)}
                    label={`Storage (${storageAddOn.unit || "GB"})`}
                    metricsOnly={metricsOnly}
                    onChange={(value) =>
                      patchMidPeriod({
                        ...mid,
                        storage: {
                          ...mid.storage,
                          enabled: toNumber(value) > 0,
                          count: value,
                          rate: mid.storage?.rate || storageAddOn.defaultRate || "",
                          label: storageAddOn.label,
                          unit: storageAddOn.unit,
                        },
                      })
                    }
                    required
                    value={mid.storage?.count ?? ""}
                  />
                  <MoneyInput
                    label={`Rate per ${storageAddOn.unit || "GB"}`}
                    metricsOnly={metricsOnly}
                    onChange={(value) =>
                      patchMidPeriod({
                        ...mid,
                        storage: {
                          ...mid.storage,
                          enabled: toNumber(mid.storage?.count) > 0,
                          count: mid.storage?.count || "",
                          rate: value,
                          label: storageAddOn.label,
                          unit: storageAddOn.unit,
                        },
                      })
                    }
                    value={mid.storage?.rate ?? ""}
                  />
                </div>
              </AddonStaticSection>
            ) : null}

            <AddonStaticSection caption="Optional contact charge packs" title="Contacts">
              <ContactSlabSelector
                config={{
                  ...config,
                  additionalContactsEnabled: mid.contacts?.enabled === true,
                  additionalContactSlab: mid.contacts?.slab || "",
                }}
                error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
                metricsOnly={metricsOnly}
                onChange={(field, value) => {
                  if (field === "additionalContactsEnabled") {
                    patchMidPeriod({
                      ...mid,
                      contacts: {
                        ...mid.contacts,
                        enabled: value,
                        slab: mid.contacts?.slab || config.additionalContactSlab || "",
                      },
                    });
                    return;
                  }
                  if (field === "additionalContactSlab") {
                    patchMidPeriod({
                      ...mid,
                      contacts: {
                        ...mid.contacts,
                        enabled: Boolean(value),
                        slab: value,
                      },
                    });
                  }
                }}
              />
            </AddonStaticSection>
          </div>
        </PricingCollapsePanel>

        {!metricsOnly ? (
          <PlanDiscountSections addonsOnly config={config} onChange={onChange} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        defaultOpen
        description="Core CRM user licensing, included contacts, and numbers."
        invalid={Boolean(fieldErrors?.userCount || fieldErrors?.userLicenseRate)}
        title="Base Plan"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "userCount")}
            invalid={Boolean(fieldErrors?.userCount)}
            label="User Count"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("userCount", value)}
            required
            value={config.userCount}
          />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "userLicenseRate")}
            invalid={Boolean(fieldErrors?.userLicenseRate)}
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
          <MoneyInput
            label="Number Count"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("numberCount", value)}
            value={config.numberCount}
          />
          <MoneyInput
            label="Per Number Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("numberRate", value)}
            value={config.numberRate}
          />
        </PricingPackageBase>
      </PricingPackage>

      <PricingPackage
        description="Additional user seats, numbers, storage, and contact slabs above the base plan."
        invalid={addonsInvalid || Boolean(fieldErrors?.additionalUserCount || fieldErrors?.additionalNumberCount || fieldErrors?.additionalStorageCount || fieldErrors?.additionalContactSlab)}
        title="Add-on"
      >
        <div className="pricing-package-addons">
          <QuantityRateAddonSection
            caption="Add additional user licenses"
            enabledField="additionalUsersEnabled"
            metricsOnly={metricsOnly}
            onChange={onChange}
            quantity={config.additionalUserCount}
            quantityError={pricingFieldErrorText(fieldErrors, "additionalUserCount")}
            quantityField="additionalUserCount"
            quantityLabel="Additional user count"
            rate={config.additionalUserLicenseRate || config.userLicenseRate || ""}
            rateField="additionalUserLicenseRate"
            rateLabel="Rate per user"
            rateReadOnly={metricsOnly}
            title="Additional users"
          />
          {numberAddOn.enabled ? (
            <QuantityRateAddonSection
              caption="Add additional numbers"
              enabledField="additionalNumbersEnabled"
              metricsOnly={metricsOnly}
              onChange={onChange}
              quantity={config.additionalNumberCount}
              quantityError={pricingFieldErrorText(fieldErrors, "additionalNumberCount")}
              quantityField="additionalNumberCount"
              quantityLabel="Number count"
              rate={config.additionalNumberRate}
              rateField="additionalNumberRate"
              rateLabel="Rate per number"
              title={numberAddOn.label || "Additional numbers"}
            />
          ) : null}
          <StorageAddonSection
            config={config}
            fieldErrors={fieldErrors}
            metricsOnly={metricsOnly}
            onChange={onChange}
            product={catalogProduct}
            region={config.region}
          />
          <AddonStaticSection caption="Optional contact charge packs" title="Additional contacts">
            <ContactSlabSelector
              config={config}
              error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
              metricsOnly={metricsOnly}
              onChange={onChange}
            />
          </AddonStaticSection>
        </div>
      </PricingPackage>

      {!metricsOnly && showImplementationNote ? (
        <p className="feature-locked-note">{getImplementationPurchaseNote(lead, config.productId)}</p>
      ) : !metricsOnly ? (
        <PricingSection invalid={implementationInvalid} title="Implementation">
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "implementationCost", IMPLEMENTATION_FEE_REQUIRED_MSG)}
            invalid={implementationInvalid}
            label="Implementation Cost"
            metricsOnly={metricsOnly}
            onChange={(value) => {
              onChange("implementationEnabled", true);
              onChange("implementationCost", value);
            }}
            required
            value={config.implementationCost}
          />
          <ImplementationDiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}

      {!metricsOnly ? (
        <PlanDiscountSections config={config} onChange={onChange} />
      ) : null}
    </div>
  );
}

function CdpPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
}) {
  const showImplementationNote = shouldShowImplementationNote(lead, config.productId, changeType, {
    renewal: isRenewalQuote,
  });
  const implementationInvalid = Boolean(fieldErrors?.implementationFee);
  const catalogProduct = getCatalog(config.region || "India").products?.cdp || {};

  if (addonsOnly) {
    return (
      <div className="pricing-hierarchy ccaas-pricing-form">
        <p className="feature-locked-note">
          Base plan is locked for this subscription period. Purchase contact or storage add-ons only.
        </p>

        <PricingPackage
          defaultOpen
          description="Additional contacts and storage above the included profile base."
          invalid={Boolean(
            fieldErrors?.addons ||
              fieldErrors?.additionalContactSlab ||
              fieldErrors?.additionalStorageCount,
          )}
          title="Add-on"
        >
          <div className="pricing-package-addons">
            <AddonStaticSection caption="Optional contact charge packs" title="Additional contacts">
              <ContactSlabSelector
                config={config}
                error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
                metricsOnly={metricsOnly}
                onChange={onChange}
              />
            </AddonStaticSection>
            <StorageAddonSection
              config={config}
              fieldErrors={fieldErrors}
              metricsOnly={metricsOnly}
              onChange={onChange}
              product={catalogProduct}
              region={config.region}
            />
          </div>
        </PricingPackage>

        {!metricsOnly ? (
          <PlanDiscountSections addonsOnly config={config} onChange={onChange} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        defaultOpen
        description="Charges depend on customer profiles."
        invalid={Boolean(fieldErrors?.monthlyBasePrice || fieldErrors?.customerProfiles)}
        title="Base Plan"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "monthlyBasePrice")}
            invalid={Boolean(fieldErrors?.monthlyBasePrice)}
            label="Base Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyBasePrice", value)}
            required
            value={config.monthlyBasePrice}
          />
          {metricsOnly ? (
            <MoneyInput
              error={pricingFieldErrorText(fieldErrors, "customerProfiles")}
              invalid={Boolean(fieldErrors?.customerProfiles)}
              label="Customer Profiles"
              onChange={(value) => onChange("customerProfiles", value)}
              required
              value={config.customerProfiles}
            />
          ) : (
            <label className="field">
              <span>Customer Profiles</span>
              <input readOnly value={config.customerProfiles} />
            </label>
          )}
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

      <PricingPackage
        description="Additional contacts and storage above the included profile base."
        invalid={Boolean(fieldErrors?.additionalContactSlab || fieldErrors?.additionalStorageCount)}
        title="Add-on"
      >
        <div className="pricing-package-addons">
          <AddonStaticSection caption="Optional contact charge packs" title="Additional contacts">
            <ContactSlabSelector
              config={config}
              error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
              metricsOnly={metricsOnly}
              onChange={onChange}
            />
          </AddonStaticSection>
          <StorageAddonSection
            config={config}
            fieldErrors={fieldErrors}
            metricsOnly={metricsOnly}
            onChange={onChange}
            product={catalogProduct}
            region={config.region}
          />
        </div>
      </PricingPackage>

      {!metricsOnly && showImplementationNote ? (
        <p className="feature-locked-note">{getImplementationPurchaseNote(lead, config.productId)}</p>
      ) : !metricsOnly ? (
        <PricingSection invalid={implementationInvalid} title="Implementation">
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "implementationFee", IMPLEMENTATION_FEE_REQUIRED_MSG)}
            invalid={implementationInvalid}
            label="Implementation Fee"
            metricsOnly={metricsOnly}
            onChange={(value) => {
              onChange("implementationEnabled", true);
              onChange("implementationFee", value);
            }}
            required
            value={config.implementationFee}
          />
          <ImplementationDiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}

      {!metricsOnly ? (
        <PlanDiscountSections config={config} onChange={onChange} />
      ) : null}
    </div>
  );
}

function CampaignChannelFields({ config, metricsOnly = false, onChange }) {
  return (
    <>
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
        label="Email Count"
        metricsOnly={metricsOnly}
        onChange={(value) => onChange("emailCount", value)}
        value={config.emailCount}
      />
      <MoneyInput
        label="Email Rate"
        metricsOnly={metricsOnly}
        onChange={(value) => onChange("emailRate", value)}
        value={config.emailRate}
      />
      <MoneyInput
        label="SMS Count"
        metricsOnly={metricsOnly}
        onChange={(value) => onChange("smsCount", value)}
        value={config.smsCount}
      />
      <MoneyInput
        label="SMS Rate"
        metricsOnly={metricsOnly}
        onChange={(value) => onChange("smsRate", value)}
        value={config.smsRate}
      />
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
    </>
  );
}

function CampaignPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
}) {
  const showImplementationNote = shouldShowImplementationNote(lead, config.productId, changeType, {
    renewal: isRenewalQuote,
  });
  const catalogProduct = getCatalog(config.region || "India").products?.campaign || {};
  // Campaign numberAddOn removed — messaging packs / storage / contacts only.
  // const numberAddOn = getProductNumberAddOn(catalogProduct);
  const storageAddOn = getProductStorageAddOn(catalogProduct, config.region || "India");
  const mid = config.midPeriodAddons || {};
  const implementationInvalid = Boolean(fieldErrors?.implementationFee);

  // function patchMidNumbers(patch) { ... } — Campaign numbers removed

  function patchMidStorage(patch) {
    const storage = {
      ...(mid.storage || {}),
      label: storageAddOn.label,
      unit: storageAddOn.unit,
      ...patch,
    };
    onChange("midPeriodAddons", {
      ...mid,
      active: true,
      billingMode: mid.billingMode || "addons-only",
      storage,
    });
    onChange("additionalStorageEnabled", storage.enabled === true);
    if (storage.count != null) {
      onChange("additionalStorageCount", storage.count);
    }
    if (storage.rate != null) {
      onChange("additionalStorageRate", storage.rate);
    }
  }

  if (addonsOnly) {
    return (
      <div className="pricing-hierarchy ccaas-pricing-form">
        <p className="feature-locked-note">
          Base plan is locked for this subscription period. Purchase storage, contact, or channel
          add-ons only.
        </p>

        <PricingPackage
          defaultOpen
          description="Storage, contacts, and channel packs for the current subscription period."
          invalid={Boolean(fieldErrors?.addons || fieldErrors?.additionalStorageCount)}
          title="Add-on"
        >
          <div className="pricing-package-addons">
            {/* Campaign Additional numbers removed
            {numberAddOn.enabled ? ( ... ) : null}
            */}
            {storageAddOn.enabled ? (
              <AddonStaticSection
                caption="Purchase additional storage above the base plan"
                title={storageAddOn.label || "Add-On Storage"}
              >
                <div className="ccaas-addon-section__fields">
                  <MoneyInput
                    error={pricingFieldErrorText(fieldErrors, "additionalStorageCount")}
                    invalid={Boolean(fieldErrors?.additionalStorageCount)}
                    label={`Storage (${storageAddOn.unit || "GB"})`}
                    metricsOnly={metricsOnly}
                    onChange={(value) =>
                      patchMidStorage({
                        enabled: toNumber(value) > 0,
                        count: value,
                        rate:
                          mid.storage?.rate ||
                          config.additionalStorageRate ||
                          storageAddOn.defaultRate ||
                          "",
                      })
                    }
                    required
                    value={mid.storage?.count || config.additionalStorageCount || ""}
                  />
                  <MoneyInput
                    label={`Rate per ${storageAddOn.unit || "GB"}`}
                    metricsOnly={metricsOnly}
                    onChange={(value) =>
                      patchMidStorage({
                        enabled:
                          toNumber(mid.storage?.count || config.additionalStorageCount) > 0,
                        count: mid.storage?.count || config.additionalStorageCount || "",
                        rate: value,
                      })
                    }
                    value={mid.storage?.rate || config.additionalStorageRate || ""}
                  />
                </div>
              </AddonStaticSection>
            ) : null}
            <AddonStaticSection caption="Optional contact charge packs" title="Contacts">
              <ContactSlabSelector
                config={config}
                error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
                metricsOnly={metricsOnly}
                onChange={onChange}
              />
            </AddonStaticSection>
            <AddonStaticSection caption="Email, SMS, WhatsApp, and push packs" title="Channel packs">
              <div className="pricing-section__grid">
                <CampaignChannelFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
              </div>
            </AddonStaticSection>
          </div>
        </PricingPackage>

        {!metricsOnly ? (
          <PlanDiscountSections addonsOnly config={config} onChange={onChange} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        defaultOpen
        description="Campaign plan with included contacts and channel usage."
        invalid={Boolean(fieldErrors?.monthlyBasePrice || fieldErrors?.includedContacts)}
        title="Base Plan"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "monthlyBasePrice")}
            invalid={Boolean(fieldErrors?.monthlyBasePrice)}
            label="Base Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyBasePrice", value)}
            required
            value={config.monthlyBasePrice}
          />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "includedContacts")}
            invalid={Boolean(fieldErrors?.includedContacts)}
            label="Included Contacts"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("includedContacts", value)}
            value={config.includedContacts}
          />
          {/* Campaign Number Count / Per Number Price removed
          <MoneyInput label="Number Count" ... />
          <MoneyInput label="Per Number Price" ... />
          */}
        </PricingPackageBase>
        <PricingPackageBase label="Channel usage">
          <CampaignChannelFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
        </PricingPackageBase>
      </PricingPackage>

      <PricingPackage
        description="Storage, contacts, and channel packs above the base plan."
        invalid={Boolean(
          fieldErrors?.additionalStorageCount || fieldErrors?.additionalContactSlab,
        )}
        title="Add-on"
      >
        <div className="pricing-package-addons">
          {/* Campaign Additional numbers removed
          {numberAddOn.enabled ? ( <QuantityRateAddonSection ... /> ) : null}
          */}
          <StorageAddonSection
            config={config}
            fieldErrors={fieldErrors}
            metricsOnly={metricsOnly}
            onChange={onChange}
            product={catalogProduct}
            region={config.region}
          />
          <AddonStaticSection caption="Optional contact charge packs" title="Additional contacts">
            <ContactSlabSelector
              config={config}
              error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
              metricsOnly={metricsOnly}
              onChange={onChange}
            />
          </AddonStaticSection>
          <AddonStaticSection caption="Email, SMS, WhatsApp, and push packs" title="Channel packs">
            <div className="pricing-section__grid">
              <CampaignChannelFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
            </div>
          </AddonStaticSection>
        </div>
      </PricingPackage>

      {!metricsOnly && showImplementationNote ? (
        <p className="feature-locked-note">{getImplementationPurchaseNote(lead, config.productId)}</p>
      ) : !metricsOnly ? (
        <PricingSection invalid={implementationInvalid} title="Implementation">
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "implementationFee", IMPLEMENTATION_FEE_REQUIRED_MSG)}
            invalid={implementationInvalid}
            label="Implementation Fee"
            metricsOnly={metricsOnly}
            onChange={(value) => {
              onChange("implementationEnabled", true);
              onChange("implementationFee", value);
            }}
            required
            value={config.implementationFee}
          />
          <ImplementationDiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}

      {!metricsOnly ? (
        <PlanDiscountSections config={config} onChange={onChange} />
      ) : null}
    </div>
  );
}

function ValueManagementPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
}) {
  const showImplementationNote = shouldShowImplementationNote(lead, config.productId, changeType, {
    renewal: isRenewalQuote,
  });
  const implementationInvalid = Boolean(fieldErrors?.implementationFee);
  const catalogProduct = getCatalog(config.region || "India").products?.["value-management"] || {};

  if (addonsOnly) {
    return (
      <div className="pricing-hierarchy ccaas-pricing-form">
        <p className="feature-locked-note">
          Base plan is locked for this subscription period. Purchase contact or storage add-ons only.
        </p>

        <PricingPackage
          defaultOpen
          description="Additional contacts and storage for the current subscription period."
          invalid={Boolean(
            fieldErrors?.addons ||
              fieldErrors?.additionalContactSlab ||
              fieldErrors?.additionalStorageCount,
          )}
          title="Add-on"
        >
          <div className="pricing-package-addons">
            <AddonStaticSection caption="Optional contact charge packs" title="Additional contacts">
              <ContactSlabSelector
                config={config}
                error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
                metricsOnly={metricsOnly}
                onChange={onChange}
              />
            </AddonStaticSection>
            <StorageAddonSection
              config={config}
              fieldErrors={fieldErrors}
              metricsOnly={metricsOnly}
              onChange={onChange}
              product={catalogProduct}
              region={config.region}
            />
          </div>
        </PricingPackage>

        {!metricsOnly ? (
          <PlanDiscountSections addonsOnly config={config} onChange={onChange} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        defaultOpen
        description="Monthly base plan based on active users."
        invalid={Boolean(fieldErrors?.monthlyBasePrice || fieldErrors?.monthlyActiveUsers)}
        title="Base Plan"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "monthlyBasePrice")}
            invalid={Boolean(fieldErrors?.monthlyBasePrice)}
            label="Base Price"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyBasePrice", value)}
            required
            value={config.monthlyBasePrice}
          />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "monthlyActiveUsers")}
            invalid={Boolean(fieldErrors?.monthlyActiveUsers)}
            label="Active Users"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("monthlyActiveUsers", value)}
            value={config.monthlyActiveUsers}
          />
        </PricingPackageBase>
      </PricingPackage>

      <PricingPackage
        description="Additional contacts and storage above the base plan."
        invalid={Boolean(fieldErrors?.additionalContactSlab || fieldErrors?.additionalStorageCount)}
        title="Add-on"
      >
        <div className="pricing-package-addons">
          <AddonStaticSection caption="Optional contact charge packs" title="Additional contacts">
            <ContactSlabSelector
              config={config}
              error={pricingFieldErrorText(fieldErrors, "additionalContactSlab")}
              metricsOnly={metricsOnly}
              onChange={onChange}
            />
          </AddonStaticSection>
          <StorageAddonSection
            config={config}
            fieldErrors={fieldErrors}
            metricsOnly={metricsOnly}
            onChange={onChange}
            product={catalogProduct}
            region={config.region}
          />
        </div>
      </PricingPackage>

      {!metricsOnly && showImplementationNote ? (
        <p className="feature-locked-note">{getImplementationPurchaseNote(lead, config.productId)}</p>
      ) : !metricsOnly ? (
        <PricingSection invalid={implementationInvalid} title="Implementation">
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "implementationFee", IMPLEMENTATION_FEE_REQUIRED_MSG)}
            invalid={implementationInvalid}
            label="Implementation Fee"
            metricsOnly={metricsOnly}
            onChange={(value) => {
              onChange("implementationEnabled", true);
              onChange("implementationFee", value);
            }}
            required
            value={config.implementationFee}
          />
          <ImplementationDiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}

      {!metricsOnly ? (
        <PlanDiscountSections config={config} onChange={onChange} />
      ) : null}
    </div>
  );
}

function TicketingAdditionalUsersFields({
  config,
  metricsOnly = false,
  onChange,
  quantityError = "",
}) {
  return (
    <QuantityRateAddonSection
      caption="Add additional user licenses"
      enabledField="additionalUsersEnabled"
      metricsOnly={metricsOnly}
      onChange={onChange}
      quantity={config.additionalUserCount}
      quantityError={quantityError}
      quantityField="additionalUserCount"
      quantityLabel="Additional user count"
      rate={config.userLicenseRate || ""}
      rateField="userLicenseRate"
      rateLabel="Rate per user"
      rateReadOnly={metricsOnly}
      title="Additional users"
    />
  );
}

function TicketingPricingForm({
  addonsOnly = false,
  changeType = CHANGE_TYPES.NEW,
  config,
  fieldErrors = null,
  isRenewalQuote = false,
  lead,
  metricsOnly = false,
  onChange,
}) {
  const showImplementationNote = shouldShowImplementationNote(lead, config.productId, changeType, {
    renewal: isRenewalQuote,
  });
  const implementationInvalid = Boolean(fieldErrors?.implementationFee);
  const catalogProduct = getCatalog(config.region || "India").products?.ticketing || {};

  if (addonsOnly) {
    return (
      <div className="pricing-hierarchy ccaas-pricing-form">
        <p className="feature-locked-note">
          Base plan is locked for this subscription period. Purchase user, ticket, or storage
          add-ons only.
        </p>

        <PricingPackage
          defaultOpen
          description="Additional user seats, ticket bundles, and storage for the current subscription period."
          invalid={Boolean(fieldErrors?.addons || fieldErrors?.additionalStorageCount)}
          title="Add-on"
        >
          <div className="pricing-package-addons">
            <TicketingAdditionalUsersFields
              config={config}
              metricsOnly={metricsOnly}
              onChange={onChange}
              quantityError={pricingFieldErrorText(fieldErrors, "additionalUserCount")}
            />
            <AddonStaticSection caption="Optional ticket bundles" title="Additional tickets">
              <TicketSlabSelector
                config={config}
                error={pricingFieldErrorText(fieldErrors, "additionalTicketSlab")}
                metricsOnly={metricsOnly}
                onChange={onChange}
              />
            </AddonStaticSection>
            <StorageAddonSection
              config={config}
              fieldErrors={fieldErrors}
              metricsOnly={metricsOnly}
              onChange={onChange}
              product={catalogProduct}
              region={config.region}
            />
          </div>
        </PricingPackage>

        {!metricsOnly ? (
          <PlanDiscountSections addonsOnly config={config} onChange={onChange} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="pricing-hierarchy ccaas-pricing-form">
      <PricingPackage
        defaultOpen
        description="Core ticketing user licensing and included tickets."
        invalid={Boolean(fieldErrors?.userCount || fieldErrors?.userLicenseRate)}
        title="Base Plan"
      >
        <PricingPackageBase>
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "userCount")}
            invalid={Boolean(fieldErrors?.userCount)}
            label="User Count"
            metricsOnly={metricsOnly}
            onChange={(value) => onChange("userCount", value)}
            required
            value={config.userCount}
          />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "userLicenseRate")}
            invalid={Boolean(fieldErrors?.userLicenseRate)}
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
      </PricingPackage>

      <PricingPackage
        description="Additional user seats, ticket bundles, and storage above the base plan."
        invalid={Boolean(
          fieldErrors?.additionalUserCount ||
            fieldErrors?.additionalTicketSlab ||
            fieldErrors?.additionalStorageCount,
        )}
        title="Add-on"
      >
        <div className="pricing-package-addons">
          <TicketingAdditionalUsersFields
            config={config}
            metricsOnly={metricsOnly}
            onChange={onChange}
            quantityError={pricingFieldErrorText(fieldErrors, "additionalUserCount")}
          />
          <AddonStaticSection caption="Optional ticket bundles" title="Additional tickets">
            <TicketSlabSelector
              config={config}
              error={pricingFieldErrorText(fieldErrors, "additionalTicketSlab")}
              metricsOnly={metricsOnly}
              onChange={onChange}
            />
          </AddonStaticSection>
          <StorageAddonSection
            config={config}
            fieldErrors={fieldErrors}
            metricsOnly={metricsOnly}
            onChange={onChange}
            product={catalogProduct}
            region={config.region}
          />
        </div>
      </PricingPackage>

      {!metricsOnly && showImplementationNote ? (
        <p className="feature-locked-note">{getImplementationPurchaseNote(lead, config.productId)}</p>
      ) : !metricsOnly ? (
        <PricingSection invalid={implementationInvalid} title="Implementation">
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "implementationFee", IMPLEMENTATION_FEE_REQUIRED_MSG)}
            invalid={implementationInvalid}
            label="Implementation Fee"
            metricsOnly={metricsOnly}
            onChange={(value) => {
              onChange("implementationEnabled", true);
              onChange("implementationFee", value);
            }}
            required
            value={config.implementationFee}
          />
          <ImplementationDiscountFields config={config} onChange={onChange} />
        </PricingSection>
      ) : null}

      {!metricsOnly ? (
        <PlanDiscountSections config={config} onChange={onChange} />
      ) : null}
    </div>
  );
}

function GenericPricingForm({ config, fieldErrors = null, metricsOnly = false, onChange, product }) {
  if (metricsOnly) {
    const usageInvalid = Boolean(fieldErrors?.usagePackage);
    return (
      <div className="pricing-hierarchy">
        <PricingCollapsePanel
          defaultOpen
          description={product.usageLabel || "Usage package for this product."}
          invalid={usageInvalid}
          title="Base pricing"
        >
          <div className="pricing-form-grid">
            <label className={`field${usageInvalid ? " field--invalid" : ""}`}>
              <span>{product.usageLabel}</span>
              <input
                aria-invalid={usageInvalid || undefined}
                data-pricing-invalid={usageInvalid ? "true" : undefined}
                onChange={(event) => onChange("usagePackage", event.target.value)}
                placeholder={product.usagePlaceholder}
                required
                value={config.usagePackage}
              />
              {usageInvalid ? (
                <p className="field__error" role="alert">
                  {pricingFieldErrorText(fieldErrors, "usagePackage")}
                </p>
              ) : null}
            </label>
          </div>
        </PricingCollapsePanel>
      </div>
    );
  }

  return (
    <div className="pricing-hierarchy">
      <PricingCollapsePanel
        defaultOpen
        description="Base price, setup fee, usage package, and notes."
        invalid={Boolean(fieldErrors?.basePrice)}
        title="Base pricing"
      >
        <div className="pricing-form-grid">
          <RegionCurrencyFields config={config} metricsOnly={metricsOnly} onChange={onChange} />
          <MoneyInput
            error={pricingFieldErrorText(fieldErrors, "basePrice")}
            invalid={Boolean(fieldErrors?.basePrice)}
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
      </PricingCollapsePanel>
      <PricingSection title="Discount">
        <DiscountFields config={config} onChange={onChange} />
      </PricingSection>
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
  const catalog = getCachedPricingCatalog();
  const tierDefaultVolumes = catalog.products?.["contact-center"]?.tierDefaultVolumes || {};
  const configurationSummary =
    activeConfig.pricingMode === "ccaas" && activeConfig.licenseTier
      ? getConfigurationSummary(
          activeConfig.modules,
          activeConfig.licenseTier,
          tierDefaultVolumes,
          { metricsOnly: true },
        )
      : null;

  return (
    <aside className="pricing-summary pricing-summary--metrics-only" aria-label="Configuration summary">
      <div className="pricing-summary__current">
        <p className="pricing-summary__eyebrow">Current product</p>
        <h2 className="pricing-summary__product-name">{activeProduct.name}</h2>
        {!configured ? (
          <p className="pricing-summary__disabled-note">
            Turn on at least one feature and fill in the required metrics to submit your request.
          </p>
        ) : (
          <p className="pricing-summary__disabled-note">
            Pricing will be confirmed by sales after review.
          </p>
        )}
      </div>
      {configurationSummary ? (
        <div className="pricing-summary__hint-card">
          <span className="pricing-summary__hint-card-label">Configuration</span>
          <p className="pricing-summary__hint-card-body">{configurationSummary}</p>
        </div>
      ) : null}

      <div className="configured-products">
        <p className="pricing-summary__eyebrow pricing-summary__eyebrow--section">In this quote</p>
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
              <span className="configured-product__label">
                {assignmentDisplayLabel(assignment, lead, products)}
              </span>
              <div className="configured-product__meta">
                <strong>{isConfigured ? "Ready" : "Pending"}</strong>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function formatSidebarMoney(currency, amount) {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  return `${currency} ${safe.toLocaleString()}`;
}

function formatSidebarQtyRate(line) {
  const parts = [];
  if (line.qty !== undefined && line.qty !== null && line.qty !== "") {
    parts.push(`Qty ${line.qty}`);
  }
  if (line.rate !== undefined && line.rate !== null && line.rate !== "") {
    parts.push(`@ ${line.rate}`);
  }
  return parts.join(" · ");
}

function ComputedPriceSummary({
  activeAssignmentIndex,
  activeConfig,
  activeProduct,
  assignments,
  lead,
  onSelectAssignment,
  onPeriodChange,
  products,
}) {
  const pricingTotals = getPricingTotals(activeConfig);
  const configured = isProductConfigured(activeConfig);
  const currency = activeConfig.currency || "INR";
  const breakdown = buildSidebarPricingBreakdown(activeConfig, {
    productName: activeProduct?.name || "Product",
  });
  const hasDetailedLines = Boolean(breakdown?.sections?.some((section) => section.lines?.length));
  const showPeriodControls = Boolean(onPeriodChange);
  const proratedBillingEnabled = !resolveSkipInvoiceProration(activeConfig || {});

  return (
    <aside className="pricing-summary" aria-label="Pricing summary">
      <div className="pricing-summary__current">
        <p className="pricing-summary__eyebrow">Current product</p>
        <h2 className="pricing-summary__product-name">{activeProduct.name}</h2>
        {pricingTotals.billingLabel ? (
          <p className="pricing-summary__cycle">{pricingTotals.billingLabel} billing</p>
        ) : null}
        {!configured ? (
          <p className="pricing-summary__disabled-note">
            Turn on at least one feature to include this product in the quote.
          </p>
        ) : null}
      </div>

      {hasDetailedLines ? (
        <div className="pricing-summary__breakdown">
          {!breakdown.sections.some((section) => section.showBaseSubtotal) ? (
            <div className="pricing-summary__rollup">
              <span>Base Price</span>
              <strong>{formatSidebarMoney(currency, pricingTotals.baseMonthlyTotal)}</strong>
            </div>
          ) : null}
          {breakdown.sections.map((section) => (
            <section
              className="pricing-summary__section"
              aria-label={section.title}
              key={section.title}
            >
              <p className="pricing-summary__section-title">{section.title}</p>
              <ul className="pricing-summary__lines">
                {section.lines.map((line) => (
                  <li className="pricing-summary__line" key={line.id}>
                    <div className="pricing-summary__line-main">
                      <span className="pricing-summary__line-label">{line.label}</span>
                      {formatSidebarQtyRate(line) || line.includedInBase ? (
                        <span className="pricing-summary__line-meta">
                          {[formatSidebarQtyRate(line), line.includedInBase ? "in base" : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    <strong
                      className={`pricing-summary__line-amount${
                        line.includedInBase ? " pricing-summary__line-amount--in-base" : ""
                      }`}
                    >
                      {formatSidebarMoney(currency, line.amount)}
                    </strong>
                  </li>
                ))}
              </ul>
              {section.showBaseSubtotal ? (
                <div className="pricing-summary__subtotal">
                  <span>Base Price</span>
                  <strong>{formatSidebarMoney(currency, pricingTotals.baseMonthlyTotal)}</strong>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}

      <dl>
        {!hasDetailedLines ? (
          <>
            <div>
              <dt>Base Price</dt>
              <dd>{formatSidebarMoney(currency, pricingTotals.baseMonthlyTotal)}</dd>
            </div>
            <div>
              <dt>Additional Usage</dt>
              <dd>{formatSidebarMoney(currency, pricingTotals.additionalUsageTotal)}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Setup Total</dt>
          <dd>{formatSidebarMoney(currency, pricingTotals.setupTotal)}</dd>
        </div>
        <div>
          <dt>Discount Amount</dt>
          <dd>{formatSidebarMoney(currency, pricingTotals.discountAmount)}</dd>
        </div>
        {toNumber(pricingTotals.addonDiscountAmount) > 0 ? (
          <div>
            <dt>Add-on Discount</dt>
            <dd>{formatSidebarMoney(currency, pricingTotals.addonDiscountAmount)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Final Price</dt>
          <dd>{formatSidebarMoney(currency, pricingTotals.finalMonthlyTotal)}</dd>
        </div>
        {showPeriodControls ? (
          <>
            <div className="pricing-summary__proration-toggle">
              <dt>Prorated Billing</dt>
              <dd>
                <label className="pricing-summary__toggle">
                  <input
                    type="checkbox"
                    checked={proratedBillingEnabled}
                    onChange={(event) =>
                      onPeriodChange?.("proratedBilling", event.target.checked)
                    }
                  />
                  <span>
                    {proratedBillingEnabled
                      ? "On — Accept→EOM (after UAT)"
                      : "Off — custom period (after UAT)"}
                  </span>
                </label>
              </dd>
            </div>
            <div className="pricing-summary__period">
              <dt>Period{proratedBillingEnabled ? "" : " (required)"}</dt>
              <dd>
                <div className="pricing-summary__period-dates">
                  <label
                    className="pricing-summary__date-field"
                    onClick={(event) => {
                      const input = event.currentTarget.querySelector("input[type='date']");
                      input?.focus();
                      try {
                        input?.showPicker?.();
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <span>Start</span>
                    <input
                      type="date"
                      value={String(activeConfig?.periodStart || "").slice(0, 10)}
                      onChange={(event) => onPeriodChange?.("periodStart", event.target.value)}
                    />
                  </label>
                  <label
                    className="pricing-summary__date-field"
                    onClick={(event) => {
                      const input = event.currentTarget.querySelector("input[type='date']");
                      input?.focus();
                      try {
                        input?.showPicker?.();
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <span>End</span>
                    <input
                      type="date"
                      value={String(activeConfig?.periodEnd || "").slice(0, 10)}
                      onChange={(event) => onPeriodChange?.("periodEnd", event.target.value)}
                    />
                  </label>
                </div>
                {pricingTotals.prorationNote ? (
                  <span className="pricing-summary__period-note">{pricingTotals.prorationNote}</span>
                ) : null}
              </dd>
            </div>
            <div className="pricing-summary__due-date">
              <dt>Due date</dt>
              <dd>
                <label
                  className="pricing-summary__date-field"
                  onClick={(event) => {
                    const input = event.currentTarget.querySelector("input[type='date']");
                    input?.focus();
                    try {
                      input?.showPicker?.();
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <input
                    type="date"
                    value={String(activeConfig?.dueDate || "").slice(0, 10)}
                    onChange={(event) => onPeriodChange?.("dueDate", event.target.value)}
                    aria-label="Due date"
                  />
                </label>
              </dd>
            </div>
          </>
        ) : pricingTotals.prorationNote ? (
          <div className="pricing-summary__period">
            <dt>Period</dt>
            <dd>
              <span className="pricing-summary__period-note">{pricingTotals.prorationNote}</span>
              {pricingTotals.periodLabel ? (
                <span className="pricing-summary__period-range">{pricingTotals.periodLabel}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div className="pricing-summary__total">
          <dt>Final Payable Estimate</dt>
          <dd>{formatSidebarMoney(currency, pricingTotals.finalPayableEstimate)}</dd>
        </div>
      </dl>

      <div className="configured-products">
        <p className="pricing-summary__eyebrow pricing-summary__eyebrow--section">In this quote</p>
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
              <span className="configured-product__label">
                {assignmentDisplayLabel(assignment, lead, products)}
              </span>
              <div className="configured-product__meta">
                <span className={`change-type-pill change-type-pill--${assignment.changeType || "new"}`}>
                  {getChangeTypeLabel(assignment.changeType || CHANGE_TYPES.NEW)}
                </span>
                <strong>
                  {isConfigured && config?.currency
                    ? `${config.currency} ${getAssignmentPayableTotal(config).toLocaleString()}`
                    : "Pending"}
                </strong>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
