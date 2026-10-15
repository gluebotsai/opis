import { jsPDF } from "jspdf";

import {
  getLeadCountryDefaults,
  getTaxRateForCountry,
  INDIAN_STATES,
  usesGstTaxSystem,
} from "./countryDefaults.js";
import {
  billingGroupLabel,
  groupAssignmentsByBillingTarget,
  normalizeAssignmentsBilling,
  resolveInvoiceMode,
  validateInvoiceModeForAssignments,
} from "./assignments.js";
import { formatLeadAddresses, getBranchById, getBranchTaxNumber, HQ_BRANCH_ID } from "./leads.js";
import { getCcaasPlanLabel } from "./ccaasPlans.js";
import {
  isModuleBillable,
  isPerAgentModuleOption,
  resolveModulesWithCatalogPrices,
} from "./ccaasModules.js";
import { getModuleDisplayLabel } from "./planModules.js";
import {
  createDefaultCcaasAddons,
  createDefaultUsageDetails,
  getCcaasConfigurationPricingRows,
  getConfigurationLineAmount,
} from "./ccaasConfiguration.js";
import { getCachedPricingCatalog } from "./pricingCatalog.js";
import { emptyInvoiceBreakdown, isFeatureEnabled } from "./pricingFeatures.js";
import { getContactChargeSlabs, getTicketSlabs } from "./pricingRuntime.js";
import {
  applyInvoicePeriodPricing,
  formatPeriodDate,
  resolveSkipInvoiceProration,
  splitPricedLines,
} from "./proration.js";
import {
  buildCcaasMidPeriodInvoiceLines,
  buildCrmMidPeriodInvoiceLines,
  isMidPeriodAddonBilling,
  resolveTelcoLineCharge,
} from "./midPeriodAddons.js";

const PAGE_W = 595.28;
const MARGIN = 34;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 128;

const COLORS = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  tableHeader: [245, 245, 245],
  border: [219, 219, 219],
  card: [252, 252, 252],
  divider: [198, 198, 198],
  label: [120, 120, 120],
};

const TABLE_COLS = [
  { key: "product", label: "Solution", width: 85 },
  { key: "description", label: "Description", width: 244 },
  { key: "qty", label: "Qty", width: 28, align: "center" },
  { key: "unitPrice", label: "Unit Price", width: 85, align: "right" },
  { key: "subtotal", label: "Subtotal", width: 85, align: "right" },
];

const COMPANY = {
  brand: "WORKTUAL",
  name: "WORKTUAL",
  legalName: "WORKTUAL INNOVATIONS PRIVATE LIMITED",
  tagline: "Enterprise Solution Provider",
  address:
    "TS No 125 (North Phase), SIDCO Thiruvika Industrial Estate\nEkkattuthangal, Chennai - 600032, Tamil Nadu",
  phone: "+91 89259 38528",
  email: "finance@worktual.com",
  website: "https://worktual.in",
  taxFieldLabel: "GST",
  taxNumber: "33AADCW3870A1ZO",
};

function resolveSellerCompany(seller = null) {
  if (!seller || typeof seller !== "object") {
    return COMPANY;
  }
  return {
    brand: String(seller.brand || seller.name || COMPANY.brand).trim() || COMPANY.brand,
    name: String(seller.name || COMPANY.name).trim() || COMPANY.name,
    legalName: String(seller.legalName || COMPANY.legalName).trim() || COMPANY.legalName,
    tagline: String(seller.tagline || COMPANY.tagline).trim() || COMPANY.tagline,
    address: String(seller.address || COMPANY.address).trim() || COMPANY.address,
    phone: String(seller.phone || COMPANY.phone).trim() || COMPANY.phone,
    email: String(seller.email || COMPANY.email).trim() || COMPANY.email,
    website: String(seller.website || COMPANY.website).trim() || COMPANY.website,
    taxFieldLabel: String(seller.taxFieldLabel || COMPANY.taxFieldLabel).trim() || COMPANY.taxFieldLabel,
    taxNumber: String(seller.taxNumber || COMPANY.taxNumber).trim() || COMPANY.taxNumber,
  };
}

function rgb(doc, [r, g, b]) {
  doc.setDrawColor(r, g, b);
  doc.setFillColor(r, g, b);
  doc.setTextColor(r, g, b);
}

function setFont(doc, style = "normal", size = 8) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
}

function drawRoundedRect(doc, x, y, w, h, r, stroke = true) {
  if (typeof doc.roundedRect === "function") {
    doc.roundedRect(x, y, w, h, r, r, stroke ? "FD" : "F");
    return;
  }
  doc.rect(x, y, w, h, stroke ? "FD" : "F");
}

function wrapLines(doc, text, maxWidth) {
  return doc.splitTextToSize(String(text || ""), maxWidth);
}

function textToLineArray(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function ensureSpacePt(doc, y, needed) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed <= pageHeight - MARGIN) {
    return y;
  }
  doc.addPage();
  return MARGIN;
}

const GST_RATE = 0.18;
const HSN_SAC = "998315";
const SELLER_STATE = "Tamil Nadu";

function normalizeInvoiceState(value) {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!compact) {
    return "";
  }

  const aliases = {
    tn: "Tamil Nadu",
    tamilnadu: "Tamil Nadu",
  };
  if (aliases[compact]) {
    return aliases[compact];
  }

  const spaced = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  for (const state of INDIAN_STATES) {
    const stateCompact = state.toLowerCase().replace(/[\s_-]+/g, "");
    if (stateCompact === compact || state.toLowerCase() === spaced) {
      return state;
    }
  }

  return "";
}

function formatTaxPercentLabel(rate) {
  const pct = Number(rate) * 100;
  if (!Number.isFinite(pct)) {
    return "0";
  }
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 100) / 100);
}

export function resolveInvoiceGstSplit(subtotal, { buyerState = "", buyerCountry = "India" } = {}) {
  const amount = Math.max(toNumber(subtotal), 0);
  const taxDefaults = getLeadCountryDefaults(buyerCountry);
  const taxRate = getTaxRateForCountry(buyerCountry);
  const taxLabel = String(taxDefaults.taxLabel || "VAT").trim() || "VAT";

  // Non-India: single VAT (or local tax label) line — never CGST/SGST.
  if (!usesGstTaxSystem(buyerCountry)) {
    const vat = amount * taxRate;
    return {
      mode: "vat",
      taxLabel,
      taxRate,
      cgst: 0,
      sgst: 0,
      igst: 0,
      vat,
      taxTotal: vat,
      grandTotal: amount + vat,
    };
  }

  const normalizedBuyer = normalizeInvoiceState(buyerState);
  const isInter = Boolean(normalizedBuyer) && normalizedBuyer !== SELLER_STATE;
  const gstRate = taxRate > 0 ? taxRate : GST_RATE;

  if (isInter) {
    const igst = amount * gstRate;
    return {
      mode: "inter",
      taxLabel: "GST",
      taxRate: gstRate,
      cgst: 0,
      sgst: 0,
      igst,
      vat: 0,
      taxTotal: igst,
      grandTotal: amount + igst,
    };
  }

  const half = amount * (gstRate / 2);
  return {
    mode: "intra",
    taxLabel: "GST",
    taxRate: gstRate,
    cgst: half,
    sgst: half,
    igst: 0,
    vat: 0,
    taxTotal: half * 2,
    grandTotal: amount + half * 2,
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(currency, amount) {
  return formatMoneyDisplay(currency, amount);
}

function formatMoneyDisplay(currency, amount) {
  const value = toNumber(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (currency === "INR") {
    return `Rs. ${value}`;
  }

  return `${currency} ${value}`;
}

/** Human-readable discount rate for invoice descriptions (e.g. "10%" or "fixed"). */
function formatDiscountRateLabel(discountType, discountValue) {
  if (String(discountType || "").toLowerCase() === "fixed") {
    return "fixed";
  }
  const percent = Math.min(Math.max(toNumber(discountValue), 0), 100);
  const label = Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, "");
  return `${label}%`;
}

function discountAmount(config, amount) {
  const discountValue = toNumber(config.discountValue);
  if (config.discountType === "fixed") {
    return Math.min(Math.max(discountValue, 0), amount);
  }
  const percent = Math.min(Math.max(discountValue, 0), 100);
  return Math.min(amount * (percent / 100), amount);
}

function implementationDiscountAmount(config, amount) {
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

function addonDiscountAmount(config, amount) {
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

function netImplementationSetup(config, setupGross) {
  const gross = Math.max(toNumber(setupGross), 0);
  if (gross <= 0) {
    return { setupGross: 0, setupDiscount: 0, setupNet: 0 };
  }
  const setupDiscount = implementationDiscountAmount(config, gross);
  return {
    setupGross: gross,
    setupDiscount,
    setupNet: Math.max(gross - setupDiscount, 0),
  };
}

function ccaasLines(config) {
  if (isMidPeriodAddonBilling(config)) {
    const lines = buildCcaasMidPeriodInvoiceLines(config);
    const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const discount = discountAmount(config, 0);
    return {
      lines,
      currency: config.currency || "INR",
      monthlySubtotal,
      setupSubtotal: 0,
      discount,
    };
  }

  const lines = [];
  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";
  const usageDetails = config.usageDetails || createDefaultUsageDetails();
  const modulesConfig = resolveModulesWithCatalogPrices(
    config.modules,
    config.licenseTier,
    catalog,
    region,
    usageDetails.agentRate,
    { preferStoredPrices: Boolean(config.zeroCatalogDefaults) },
  );
  const addons = config.addons || createDefaultCcaasAddons();

  if (config.licenseTier) {
    lines.push({
      section: "License Plan",
      label: getCcaasPlanLabel(config.licenseTier) || config.licenseTier,
      amount: 0,
    });
  }

  const telcoLineCharge = resolveTelcoLineCharge(config);
  const agentCount = Math.max(1, toNumber(usageDetails.agentCount) || 0);

  for (const [moduleId, selection] of Object.entries(modulesConfig)) {
    if (!isModuleBillable(selection)) {
      continue;
    }

    let amount = toNumber(selection.price);
    let label = getModuleDisplayLabel(moduleId, selection);

    if (isPerAgentModuleOption(moduleId, selection.optionId)) {
      // One agent line: (agentRate + telcoLineCharge) × agentCount — included DIDs are not a separate SKU.
      const unit = toNumber(selection.price) + telcoLineCharge;
      amount = unit * agentCount;
      if (telcoLineCharge > 0) {
        label = `${label} — ${agentCount} agent${agentCount === 1 ? "" : "s"} @ ${selection.price}+${telcoLineCharge} telco`;
      } else {
        label = `${label} — ${agentCount} agent${agentCount === 1 ? "" : "s"} @ ${selection.price}`;
      }
    }

    lines.push({
      section: "CCaaS Modules",
      label,
      amount,
    });
  }

  const contactCenter = catalog.products?.["contact-center"] || {};
  const tierDefaultVolumes = contactCenter.tierDefaultVolumes || {};
  const configurationRows = getCcaasConfigurationPricingRows(
    modulesConfig,
    config.licenseTier,
    tierDefaultVolumes,
    contactCenter,
  );

  for (const row of configurationRows) {
    const qty = toNumber(usageDetails[row.qtyKey]);
    // Invoice shows purchased usage only — omit unused configuration rows.
    if (qty <= 0) {
      continue;
    }

    const amount = getConfigurationLineAmount(usageDetails, row);
    const rate = usageDetails[row.rateKey];
    const ratePart = rate != null && rate !== "" ? ` @ ${rate}` : "";

    lines.push({
      section: "Configuration",
      label: `${row.itemLabel}: ${qty}${ratePart}`,
      amount,
    });
  }

  if (config.midPeriodAddons?.active) {
    lines.push(...buildCcaasMidPeriodInvoiceLines(config));
  } else {
    if (addons.sessionBundle && addons.sessionBundle !== "none") {
      const sessionLabel =
        addons.sessionBundle === "custom"
          ? `${addons.sessionCount || "Custom"} sessions`
          : `${Number(addons.sessionBundle).toLocaleString()} sessions`;

      lines.push({
        section: "Add-ons",
        label: `Sessions — ${sessionLabel}`,
        amount: toNumber(addons.sessionPrice),
        isAddon: true,
      });
    }

    if (addons.multilingualOption === "addon") {
      lines.push({
        section: "Add-ons",
        label: "Multilingual add-on",
        amount: toNumber(addons.multilingualPrice),
        isAddon: true,
      });
    }
  }

  const monthlySubtotal = lines
    .filter((line) => line.type !== "setup")
    .reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const coreForDiscount = lines
    .filter((line) => line.type !== "setup" && !line.isAddon)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, coreForDiscount);

  return { lines, currency: config.currency || "INR", monthlySubtotal, setupSubtotal, discount };
}

function simpleLines(config, sectionLabel) {
  const currency = config.currency || "INR";
  const monthlySubtotal = toNumber(config.monthlyBasePrice);
  const setupSubtotal = toNumber(config.setupFee || config.implementationCost || config.implementationFee);
  const discount = discountAmount(config, monthlySubtotal);

  return {
    lines: [{ section: sectionLabel, label: "Monthly base price", amount: monthlySubtotal }],
    currency,
    monthlySubtotal,
    setupSubtotal,
    discount,
  };
}

function crmLines(config) {
  if (isMidPeriodAddonBilling(config)) {
    const lines = buildCrmMidPeriodInvoiceLines(config);
    const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const discount = discountAmount(config, monthlySubtotal);
    return {
      lines,
      currency: config.currency || "INR",
      monthlySubtotal,
      setupSubtotal: 0,
      discount,
    };
  }

  const currency = config.currency || "INR";
  const lines = [];

  if (isFeatureEnabled(config, "usersEnabled")) {
    lines.push({
      section: "CRM License",
      label: `${config.userCount} users @ ${config.userLicenseRate}/user`,
      amount: toNumber(config.userCount) * toNumber(config.userLicenseRate),
    });

    const numberCount = toNumber(config.numberCount);
    if (numberCount > 0) {
      lines.push({
        section: "CRM License",
        label: `${numberCount} number${numberCount === 1 ? "" : "s"} @ ${config.numberRate}/number`,
        amount: numberCount * toNumber(config.numberRate),
      });
    }
  }

  if (config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0) {
    const rate = config.additionalUserLicenseRate || config.userLicenseRate;
    lines.push({
      section: "Add-ons",
      label: `Additional users — ${config.additionalUserCount} @ ${rate}/user`,
      amount: toNumber(config.additionalUserCount) * toNumber(rate),
      isAddon: true,
    });
  }

  if (config.additionalNumbersEnabled && toNumber(config.additionalNumberCount) > 0) {
    const count = toNumber(config.additionalNumberCount);
    const rate = config.additionalNumberRate;
    lines.push({
      section: "Add-ons",
      label: `Additional numbers — ${count} @ ${rate}/number`,
      amount: count * toNumber(rate),
      isAddon: true,
    });
  }

  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    const count = toNumber(config.additionalStorageCount);
    const rate = config.additionalStorageRate;
    lines.push({
      section: "Add-ons",
      label: `Add-On Storage — ${count} GB @ ${rate}/GB`,
      amount: count * toNumber(rate),
      isAddon: true,
    });
  }

  if (config.additionalContactsEnabled) {
    lines.push({
      section: "Add-ons",
      label: `Additional contacts slab (${config.additionalContactSlab})`,
      amount: toNumber(
        getContactChargeSlabs(config.region, config.productId || "crm")[config.additionalContactSlab]
          ?.monthlyPrice,
      ),
      isAddon: true,
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationCost)
    : 0;
  const coreForDiscount = lines
    .filter((line) => !line.isAddon)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, coreForDiscount);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

function cdpLines(config) {
  const storageOn =
    config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0;
  if (
    !isFeatureEnabled(config, "platformEnabled") &&
    !config.additionalContactsEnabled &&
    !storageOn
  ) {
    return emptyInvoiceBreakdown(config.currency);
  }

  const currency = config.currency || "INR";
  const lines = [];

  if (isFeatureEnabled(config, "platformEnabled")) {
    lines.push({
      section: "CDP Platform",
      label: "Monthly base price",
      amount: toNumber(config.monthlyBasePrice),
    });
  }

  if (config.additionalContactsEnabled) {
    lines.push({
      section: "Add-ons",
      label: `Additional contacts slab (${config.additionalContactSlab})`,
      amount: toNumber(
        getContactChargeSlabs(config.region, config.productId || "cdp")[config.additionalContactSlab]
          ?.monthlyPrice,
      ),
      isAddon: true,
    });
  }

  if (storageOn) {
    const count = toNumber(config.additionalStorageCount);
    const rate = config.additionalStorageRate;
    lines.push({
      section: "Add-ons",
      label: `Add-On Storage — ${count} GB @ ${rate}/GB`,
      amount: count * toNumber(rate),
      isAddon: true,
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal = isFeatureEnabled(config, "implementationEnabled")
    ? toNumber(config.implementationFee)
    : 0;
  const coreForDiscount = lines
    .filter((line) => !line.isAddon)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, coreForDiscount);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

function campaignLines(config) {
  const currency = config.currency || "INR";
  const lines = [];
  const midPeriodOnly = isMidPeriodAddonBilling(config);

  const channelAmount =
    toNumber(config.emailCount) * toNumber(config.emailRate) +
    toNumber(config.smsCount) * toNumber(config.smsRate) +
    toNumber(config.whatsappCredits) * toNumber(config.whatsappRate) +
    toNumber(config.webPushSubscribers) * toNumber(config.webPushRate) +
    toNumber(config.appPushSubscribers) * toNumber(config.appPushRate) +
    toNumber(config.inAppSubscribers) * toNumber(config.inAppRate);

  if (!midPeriodOnly && isFeatureEnabled(config, "basePlanEnabled")) {
    lines.push({
      section: "Campaign Plan",
      label: "Monthly base price",
      amount: toNumber(config.monthlyBasePrice),
    });

    // Campaign no longer sells number count / additional numbers (messaging packs only).
    // const numberCount = toNumber(config.numberCount);
    // if (numberCount > 0) {
    //   lines.push({
    //     section: "Campaign Plan",
    //     label: `${numberCount} number${numberCount === 1 ? "" : "s"} @ ${config.numberRate}/number`,
    //     amount: numberCount * toNumber(config.numberRate),
    //   });
    // }

    if (channelAmount > 0) {
      lines.push({
        section: "Campaign Plan",
        label: "Channel usage",
        amount: channelAmount,
      });
    }
  }

  if (midPeriodOnly) {
    lines.push(...buildCrmMidPeriodInvoiceLines(config));
    if (channelAmount > 0) {
      lines.push({
        section: "Add-ons",
        label: "Channel packs",
        amount: channelAmount,
        isAddon: true,
      });
    }
  } else {
    // Campaign number add-on removed — messaging packs / storage / contacts only.
    // if (config.additionalNumbersEnabled && toNumber(config.additionalNumberCount) > 0) {
    //   const count = toNumber(config.additionalNumberCount);
    //   const rate = config.additionalNumberRate;
    //   lines.push({
    //     section: "Add-ons",
    //     label: `Additional numbers — ${count} @ ${rate}/number`,
    //     amount: count * toNumber(rate),
    //     isAddon: true,
    //   });
    // }

    if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
      const count = toNumber(config.additionalStorageCount);
      const rate = config.additionalStorageRate;
      lines.push({
        section: "Add-ons",
        label: `Add-On Storage — ${count} GB @ ${rate}/GB`,
        amount: count * toNumber(rate),
        isAddon: true,
      });
    }

    if (config.additionalContactsEnabled) {
      lines.push({
        section: "Add-ons",
        label: `Additional contacts slab (${config.additionalContactSlab})`,
        amount: toNumber(
          getContactChargeSlabs(config.region, config.productId || "campaign")[
            config.additionalContactSlab
          ]?.monthlyPrice,
        ),
        isAddon: true,
      });
    }
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal =
    !midPeriodOnly && isFeatureEnabled(config, "implementationEnabled")
      ? toNumber(config.implementationFee)
      : 0;
  const coreForDiscount = lines
    .filter((line) => !line.isAddon)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, midPeriodOnly ? 0 : coreForDiscount);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

function valueManagementLines(config) {
  const currency = config.currency || "INR";
  const lines = [];
  const midPeriodOnly = isMidPeriodAddonBilling(config);

  if (!midPeriodOnly && isFeatureEnabled(config, "subscriptionEnabled")) {
    lines.push({
      section: "Customer Value Management",
      label: "Monthly base price",
      amount: toNumber(config.monthlyBasePrice),
    });
  }

  if (config.additionalContactsEnabled) {
    lines.push({
      section: "Add-ons",
      label: `Additional contacts slab (${config.additionalContactSlab})`,
      amount: toNumber(
        getContactChargeSlabs(config.region, config.productId || "value-management")[
          config.additionalContactSlab
        ]?.monthlyPrice,
      ),
      isAddon: true,
    });
  }

  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    const count = toNumber(config.additionalStorageCount);
    const rate = config.additionalStorageRate;
    lines.push({
      section: "Add-ons",
      label: `Add-On Storage — ${count} GB @ ${rate}/GB`,
      amount: count * toNumber(rate),
      isAddon: true,
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal =
    !midPeriodOnly && isFeatureEnabled(config, "implementationEnabled")
      ? toNumber(config.implementationFee)
      : 0;
  const coreForDiscount = lines
    .filter((line) => !line.isAddon)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, midPeriodOnly ? 0 : coreForDiscount);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

function ticketingLines(config) {
  const currency = config.currency || "INR";
  const lines = [];
  const midPeriodOnly = isMidPeriodAddonBilling(config);

  if (!midPeriodOnly && isFeatureEnabled(config, "usersEnabled")) {
    lines.push({
      section: "Ticketing License",
      label: `${config.userCount} users @ ${config.userLicenseRate}/user`,
      amount: toNumber(config.userCount) * toNumber(config.userLicenseRate),
    });
  }

  if (config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0) {
    lines.push({
      section: "Add-ons",
      label: `Additional users — ${config.additionalUserCount} @ ${config.userLicenseRate}/user`,
      amount: toNumber(config.additionalUserCount) * toNumber(config.userLicenseRate),
      isAddon: true,
    });
  }

  if (config.additionalTicketsEnabled) {
    lines.push({
      section: "Add-ons",
      label: `Additional tickets slab (${config.additionalTicketSlab})`,
      amount: toNumber(getTicketSlabs(config.region)[config.additionalTicketSlab]?.monthlyPrice),
      isAddon: true,
    });
  }

  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    const count = toNumber(config.additionalStorageCount);
    const rate = config.additionalStorageRate;
    lines.push({
      section: "Add-ons",
      label: `Add-On Storage — ${count} GB @ ${rate}/GB`,
      amount: count * toNumber(rate),
      isAddon: true,
    });
  }

  const monthlySubtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const setupSubtotal =
    !midPeriodOnly && isFeatureEnabled(config, "implementationEnabled")
      ? toNumber(config.implementationFee)
      : 0;
  const coreForDiscount = lines
    .filter((line) => !line.isAddon)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = discountAmount(config, midPeriodOnly ? 0 : coreForDiscount);

  return { lines, currency, monthlySubtotal, setupSubtotal, discount };
}

export function assignmentHasImplementationFee(config = {}) {
  if (config.implementationPurchased === true || config.implementationEnabled === false) {
    return false;
  }
  if (config.isRenewalQuote === true || config.changeType === "renewal") {
    return false;
  }
  const fee = toNumber(config.implementationFee ?? config.implementationCost ?? 0);
  return fee > 0;
}

/** First quote bills OTC only when any product still owes an implementation fee. */
export function quoteNeedsImplementationPhase(assignments = []) {
  return (assignments || []).some((entry) => assignmentHasImplementationFee(entry?.config || {}));
}

function getProductInvoice(
  product,
  config,
  { asOf = new Date(), implementationOnly = false, temporaryInvoiceContents = null } = {},
) {
  if (!config) {
    return null;
  }

  let breakdown;
  if (config.pricingMode === "ccaas") {
    breakdown = ccaasLines(config);
  } else if (config.pricingMode === "crm") {
    breakdown = crmLines(config);
  } else if (config.pricingMode === "cdp") {
    breakdown = cdpLines(config);
  } else if (config.pricingMode === "campaign") {
    breakdown = campaignLines(config);
  } else if (config.pricingMode === "value-management") {
    breakdown = valueManagementLines(config);
  } else if (config.pricingMode === "ticketing") {
    breakdown = ticketingLines(config);
  } else {
    breakdown = simpleLines(config, product.name);
  }

  const mode = String(temporaryInvoiceContents || "").toLowerCase();
  const includeSetup =
    mode === "implementation" ||
    mode === "both" ||
    mode === "all" ||
    (!mode && implementationOnly);
  const includeCore =
    mode === "configuration" ||
    mode === "both" ||
    mode === "all" ||
    (!mode && !implementationOnly);
  const includeAddons =
    mode === "addon" || mode === "all" || (!mode && !implementationOnly);
  const isImplOnlyPhase = mode === "implementation" || (!mode && implementationOnly);

  const { coreAmount, addonAmount } = splitPricedLines(breakdown.lines || []);
  // OTC/setup belongs only on implementation-phase invoices unless Temporary Lead
  // modes both/all explicitly mix setup with recurring on one PDF.
  const rawSetupGross =
    config.isRenewalQuote === true || config.changeType === "renewal"
      ? 0
      : toNumber(breakdown.setupSubtotal);
  const setupGross = includeSetup ? rawSetupGross : 0;
  const { setupDiscount, setupNet: setupTotal } = netImplementationSetup(config, setupGross);

  // Core discount on core monthly; add-on discount on add-on lines (mirrors implementation discount).
  const discount = includeCore ? discountAmount(config, coreAmount) : 0;
  const coreNet = includeCore ? Math.max(coreAmount - discount, 0) : 0;
  const addonGross = includeAddons ? addonAmount : 0;
  const addonDisc = includeAddons ? addonDiscountAmount(config, addonGross) : 0;
  const addonNet = includeAddons ? Math.max(addonGross - addonDisc, 0) : 0;
  const coreGross = includeCore ? coreAmount : 0;

  const configuredPeriodStart = config.periodStart ? new Date(config.periodStart) : null;
  const configuredPeriodEnd = config.periodEnd ? new Date(config.periodEnd) : null;
  const effectiveAsOf =
    configuredPeriodStart && !Number.isNaN(configuredPeriodStart.getTime())
      ? configuredPeriodStart
      : asOf;

  const skipProration = resolveSkipInvoiceProration(config);
  const periodPricing = applyInvoicePeriodPricing({
    coreMonthlyAmount: coreNet,
    addonAmount: addonNet,
    setupAmount: setupTotal,
    billingCycle: config.billingCycle || "monthly",
    asOf: effectiveAsOf,
    implementationOnly: isImplOnlyPhase,
    skipProration,
    periodStart: config.periodStart || null,
    periodEnd: config.periodEnd || null,
  });

  // Gross recurring (before discount) for the same billing period — keeps summary math aligned.
  const periodPricingGross = isImplOnlyPhase
    ? { recurringDue: 0 }
    : applyInvoicePeriodPricing({
        coreMonthlyAmount: coreGross,
        addonAmount: addonGross,
        setupAmount: 0,
        billingCycle: config.billingCycle || "monthly",
        asOf: effectiveAsOf,
        implementationOnly: false,
        skipProration,
        periodStart: config.periodStart || null,
        periodEnd: config.periodEnd || null,
      });

  const billingLabel = periodPricing.implementationOnly
    ? "One-time"
    : periodPricing.billingCycle === "yearly"
      ? "Yearly"
      : "Monthly";
  const periodStart =
    configuredPeriodStart && !Number.isNaN(configuredPeriodStart.getTime())
      ? configuredPeriodStart
      : periodPricing.periodStart;
  const periodEnd =
    configuredPeriodEnd && !Number.isNaN(configuredPeriodEnd.getTime())
      ? configuredPeriodEnd
      : periodPricing.periodEnd;

  const filteredLines = (() => {
    if (isImplOnlyPhase) {
      return [];
    }
    const lines = breakdown.lines || [];
    if (mode === "addon") {
      return lines.filter((line) => line.isAddon === true);
    }
    if (mode === "configuration" || mode === "both") {
      return lines.filter((line) => line.isAddon !== true && line.type !== "setup");
    }
    return lines;
  })();

  return {
    productName: product.name,
    ...breakdown,
    lines: filteredLines,
    monthlySubtotal: isImplOnlyPhase ? 0 : coreGross + addonGross,
    setupSubtotal: setupTotal,
    setupGross,
    implementationDiscount: setupDiscount,
    discount: isImplOnlyPhase ? 0 : discount,
    addonDiscount: isImplOnlyPhase ? 0 : addonDisc,
    addonAmount: isImplOnlyPhase ? 0 : addonNet,
    addonGross: isImplOnlyPhase ? 0 : addonGross,
    coreMonthlyAmount: isImplOnlyPhase ? 0 : coreNet,
    coreGross: isImplOnlyPhase ? 0 : coreGross,
    recurringGross: isImplOnlyPhase ? 0 : toNumber(periodPricingGross.recurringDue),
    discountType: config.discountType || "percentage",
    discountValue: toNumber(config.discountValue),
    implementationDiscountType: config.implementationDiscountType || "percentage",
    implementationDiscountValue: toNumber(config.implementationDiscountValue),
    addonDiscountType: config.addonDiscountType || "percentage",
    addonDiscountValue: toNumber(config.addonDiscountValue),
    finalMonthly: periodPricing.recurringDue,
    totalDue: periodPricing.totalDue,
    billingLabel,
    multiplier: periodPricing.billingCycle === "yearly" ? 12 : 1,
    periodStart,
    periodEnd,
    dueDate: config.dueDate || null,
    prorationNote:
      config.isRenewalQuote || config.changeType === "renewal"
        ? "Full renewal period"
        : periodPricing.prorationNote,
    periodLabel: periodPricing.implementationOnly
      ? periodPricing.periodLabel
      : `Billing period ${formatPeriodDate(periodStart)} to ${formatPeriodDate(periodEnd)}`,
    isProrated:
      config.isRenewalQuote || config.changeType === "renewal" ? false : periodPricing.isProrated,
    remainingDays: periodPricing.remainingDays,
    daysInMonth: periodPricing.daysInMonth,
    implementationOnly: Boolean(periodPricing.implementationOnly),
    temporaryInvoiceContents: mode || null,
    includeSetupWithRecurring: Boolean(!isImplOnlyPhase && includeSetup && setupTotal > 0),
  };
}

const PRODUCT_PRICING_MODE = {
  "contact-center": "ccaas",
  crm: "crm",
  cdp: "cdp",
  campaign: "campaign",
  "value-management": "value-management",
  ticketing: "ticketing",
};

/**
 * Full monthly recurring (core + addons, after discounts) from assignment config.
 * Used when stamped scalars are missing (e.g. implementation-only OTC configs).
 */
export function resolveAssignmentMonthlyRecurring(config = {}, product = {}) {
  const productId = String(product?.id || config.productId || "").trim();
  const pricingMode = config.pricingMode || PRODUCT_PRICING_MODE[productId] || null;
  const invoiceConfig = {
    ...config,
    productId: productId || config.productId,
    ...(pricingMode ? { pricingMode } : {}),
    implementationEnabled: false,
    implementationFee: 0,
    implementationPurchased: true,
  };
  const productRef = {
    id: productId || product?.id || "product",
    name: product?.name || productId || "Product",
  };
  const invoice = getProductInvoice(productRef, invoiceConfig, {
    implementationOnly: false,
  });
  if (!invoice) {
    return 0;
  }
  const core = toNumber(invoice.coreMonthlyAmount);
  const addon = toNumber(invoice.addonAmount);
  return Math.max(0, core + addon);
}

/** Logo for invoice header — full mark on dark background (no left-crop). */
export async function prepareInvoiceLogo(logoUrl, { forDarkBackground = true, iconOnly = false } = {}) {
  if (!logoUrl) {
    return null;
  }

  const response = await fetch(logoUrl);
  if (!response.ok) {
    throw new Error("Could not load company logo.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const sourceWidth = iconOnly
          ? Math.max(Math.floor(image.naturalWidth * 0.22), 1)
          : image.naturalWidth;
        const canvas = document.createElement("canvas");
        canvas.width = sourceWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");

        // worktual-logo.png is a solid black square with a light mark — not a transparent PNG.
        // Knock out near-black pixels and force the mark to white (dark header) or black (light).
        context.drawImage(
          image,
          0,
          0,
          sourceWidth,
          image.naturalHeight,
          0,
          0,
          sourceWidth,
          image.naturalHeight,
        );
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        for (let i = 0; i < pixels.length; i += 4) {
          const luma = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          if (luma < 48) {
            pixels[i + 3] = 0;
            continue;
          }
          if (forDarkBackground) {
            pixels[i] = 255;
            pixels[i + 1] = 255;
            pixels[i + 2] = 255;
          } else {
            pixels[i] = 0;
            pixels[i + 1] = 0;
            pixels[i + 2] = 0;
          }
        }
        context.putImageData(imageData, 0, 0);

        resolve({
          dataUrl: canvas.toDataURL("image/png"),
          width: sourceWidth,
          height: image.naturalHeight,
        });
      };
      image.onerror = () => reject(new Error("Could not process company logo."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatInvoiceDate(date = new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

/** First valid dueDate from product invoices (or invoice rows). Returns Date or null. */
function resolveHeaderDueDate(productInvoices = [], invoiceRows = []) {
  const dueDateSource =
    (productInvoices || []).find((item) => item?.dueDate)?.dueDate ||
    (invoiceRows || []).find((row) => row?.dueDate)?.dueDate ||
    null;
  if (!dueDateSource) return null;
  const parsed = new Date(dueDateSource);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function capitalizeWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function numberToWordsIndian(amount) {
  const rupees = Math.floor(toNumber(amount));
  const paise = Math.round((toNumber(amount) - rupees) * 100);

  if (rupees === 0 && paise === 0) {
    return "Zero Rupees Only";
  }

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigit(value) {
    if (value < 20) {
      return ones[value];
    }

    const remainder = value % 10;
    return `${tens[Math.floor(value / 10)]}${remainder ? ` ${ones[remainder]}` : ""}`.trim();
  }

  function threeDigit(value) {
    if (value >= 100) {
      const remainder = value % 100;
      return `${ones[Math.floor(value / 100)]} Hundred${remainder ? ` ${twoDigit(remainder)}` : ""}`.trim();
    }

    return twoDigit(value);
  }

  function convert(value) {
    if (value >= 10000000) {
      const crores = Math.floor(value / 10000000);
      const remainder = value % 10000000;
      return `${convert(crores)} Crore${remainder ? ` ${convert(remainder)}` : ""}`.trim();
    }

    if (value >= 100000) {
      const lakhs = Math.floor(value / 100000);
      const remainder = value % 100000;
      return `${convert(lakhs)} Lakh${remainder ? ` ${convert(remainder)}` : ""}`.trim();
    }

    if (value >= 1000) {
      const thousands = Math.floor(value / 1000);
      const remainder = value % 1000;
      return `${threeDigit(thousands)} Thousand${remainder ? ` ${threeDigit(remainder)}` : ""}`.trim();
    }

    return threeDigit(value);
  }

  let words = `${convert(rupees)} Rupees`;
  if (paise > 0) {
    words += ` And ${convert(paise)} Paise`;
  }

  return `${capitalizeWords(words)} Only`;
}

function buildProductDescription(item, branchLabel = "") {
  const recurringLabel = item.billingLabel === "Yearly" ? "Yearly" : "Monthly";
  const parts = [];

  if (item.changeTypeLabel && item.changeTypeLabel !== "New") {
    parts.push(`Type: ${item.changeTypeLabel}`);
  }

  if (branchLabel) {
    parts.push(`Location: ${branchLabel}`);
  }

  const planLine = (item.lines || []).find((line) => line.section === "License Plan");
  if (planLine?.label) {
    parts.push(`Plan: ${planLine.label}`);
  }

  const DESCRIPTION_SECTIONS = new Set([
    "Configuration",
    "Add-ons",
    "CRM License",
    "CDP Platform",
    "Campaign",
    "Campaign Base",
    "Campaign Channels",
    "Value Management",
    "Ticketing License",
    "Ticketing",
  ]);

  for (const line of item.lines || []) {
    if (!line || line.section === "CCaaS Modules" || line.section === "License Plan") {
      continue;
    }
    if (!DESCRIPTION_SECTIONS.has(line.section) && line.section) {
      // Keep other product license/base sections when they carry a billed amount.
      if (toNumber(line.amount) <= 0) {
        continue;
      }
    } else if (line.section === "Configuration" || line.section === "Add-ons") {
      const label = String(line.label || "");
      const hasQty = /\d/.test(label) || toNumber(line.amount) > 0;
      if (!hasQty && toNumber(line.amount) <= 0) {
        continue;
      }
    } else if (toNumber(line.amount) <= 0 && !DESCRIPTION_SECTIONS.has(line.section)) {
      continue;
    }

    if (line.section && line.label) {
      parts.push(`${line.section}: ${line.label}`);
    }
  }

  parts.push(`HSN/SAC: ${HSN_SAC}`);
  parts.push(`${recurringLabel} billing`);

  if (item.prorationNote && !String(item.prorationNote).startsWith("Pro-rated")) {
    parts.push(item.prorationNote);
  }

  // Do not put "Billing period …" (or other periodLabel) into the Description column.

  const discountValue = toNumber(item.discountValue);
  const discountAmt = toNumber(item.discount);
  if (discountValue > 0 || discountAmt > 0) {
    const rateLabel = formatDiscountRateLabel(item.discountType, item.discountValue);
    if (rateLabel === "fixed") {
      parts.push(
        discountAmt > 0
          ? `Discount (fixed) applied on subtotal${item.currency ? ` — ${formatMoney(item.currency, discountAmt)}` : ""}`
          : "Discount (fixed) applied on subtotal",
      );
    } else {
      parts.push(
        discountAmt > 0
          ? `Discount ${rateLabel} applied on subtotal (${formatMoney(item.currency || "INR", discountAmt)})`
          : `Discount ${rateLabel} applied on subtotal`,
      );
    }
  }

  return parts.join("\n");
}

function buildImplementationFeeDescription(item, branchLabel = "") {
  const parts = [];

  if (branchLabel) {
    parts.push(`Location: ${branchLabel}`);
  }

  parts.push(`HSN/SAC: ${HSN_SAC}`);
  parts.push("One-time implementation fee");

  if (item.prorationNote) {
    parts.push(item.prorationNote);
  }

  return parts.join("\n");
}

/** Line Unit Price / Subtotal are always pre-discount; netAmount is what tax/payment use. */
function buildInvoiceRows(productInvoices, branchLabel = "") {
  const rows = [];

  for (const item of productInvoices) {
    const itemLocation = item.branchLabel || branchLabel;
    const setupNet = toNumber(item.setupSubtotal);
    const setupGross = Math.max(toNumber(item.setupGross ?? item.setupSubtotal), setupNet);
    const setupDiscount = Math.max(toNumber(item.implementationDiscount), setupGross - setupNet, 0);
    const rowsBefore = rows.length;
    const allowZeroPlaceholder =
      Boolean(item.zeroCatalogDefaults) || Boolean(item.temporaryInvoiceContents);

    // Implementation / OTC invoice: implementation fee lines only.
    if (item.implementationOnly) {
      if (setupGross > 0 || setupNet > 0) {
        rows.push({
          product: `${item.productName} (implementation fee)`,
          description: buildImplementationFeeDescription(item, itemLocation),
          qty: "1",
          unitPrice: setupGross,
          subtotal: setupGross,
          netAmount: setupNet,
          currency: item.currency,
          originalPrice: setupGross,
          discountAmount: setupDiscount,
          periodStart: item.periodStart || null,
          periodEnd: item.periodEnd || null,
          dueDate: item.dueDate || null,
        });
      } else if (allowZeroPlaceholder) {
        rows.push({
          product: `${item.productName} (implementation fee)`,
          description: buildImplementationFeeDescription(item, itemLocation),
          qty: "1",
          unitPrice: 0,
          subtotal: 0,
          netAmount: 0,
          currency: item.currency || "INR",
          originalPrice: 0,
          discountAmount: 0,
          periodStart: item.periodStart || null,
          periodEnd: item.periodEnd || null,
          dueDate: item.dueDate || null,
        });
      }
      continue;
    }

    // Temporary Lead both/all: mix OTC setup with subscription on one invoice.
    if (item.includeSetupWithRecurring && (setupGross > 0 || setupNet > 0)) {
      rows.push({
        product: `${item.productName} (implementation fee)`,
        description: buildImplementationFeeDescription(item, itemLocation),
        qty: "1",
        unitPrice: setupGross,
        subtotal: setupGross,
        netAmount: setupNet,
        currency: item.currency,
        originalPrice: setupGross,
        discountAmount: setupDiscount,
      });
    }

    // Product invoice: subscription / product lines (OTC only when includeSetupWithRecurring above).
    const recurringNet = toNumber(item.finalMonthly);
    const recurringGross = Math.max(
      toNumber(item.recurringGross),
      toNumber(item.coreGross ?? item.monthlySubtotal) + toNumber(item.addonGross),
      recurringNet,
    );
    if (recurringGross > 0 || recurringNet > 0) {
      rows.push({
        product: item.productName,
        description: buildProductDescription(item, itemLocation),
        qty: "1",
        unitPrice: recurringGross,
        subtotal: recurringGross,
        netAmount: recurringNet,
        currency: item.currency,
        periodStart: item.periodStart || null,
        periodEnd: item.periodEnd || null,
        dueDate: item.dueDate || null,
        originalPrice: recurringGross,
        discountAmount: Math.max(recurringGross - recurringNet, 0),
      });
    } else if (allowZeroPlaceholder && rows.length === rowsBefore) {
      rows.push({
        product: item.productName,
        description: buildProductDescription(item, itemLocation),
        qty: "1",
        unitPrice: 0,
        subtotal: 0,
        netAmount: 0,
        currency: item.currency || "INR",
        periodStart: item.periodStart || null,
        periodEnd: item.periodEnd || null,
        dueDate: item.dueDate || null,
        originalPrice: 0,
        discountAmount: 0,
      });
    }
  }

  return rows;
}

function rowNetAmount(row) {
  if (row?.netAmount != null && row.netAmount !== "") {
    return Math.max(toNumber(row.netAmount), 0);
  }
  return Math.max(toNumber(row?.subtotal) - Math.max(toNumber(row?.discountAmount), 0), 0);
}

function drawSectionLabel(doc, label, x, y) {
  rgb(doc, COLORS.label);
  setFont(doc, "bold", 7);
  doc.text(String(label || "").toUpperCase(), x, y);
}

/** Aggregate pre-discount / discount totals from invoice rows for the financial summary. */
function summarizeInvoiceDiscounts(invoiceRows = [], productInvoices = []) {
  const totalDiscount = (invoiceRows || []).reduce(
    (sum, row) => sum + Math.max(toNumber(row.discountAmount), 0),
    0,
  );
  const originalSubtotal = (invoiceRows || []).reduce((sum, row) => {
    const original = toNumber(row.originalPrice ?? row.subtotal);
    if (original > 0) {
      return sum + original;
    }
    return sum + toNumber(row.subtotal);
  }, 0);

  const rateLabels = [];
  for (const item of productInvoices || []) {
    if (toNumber(item.discount) > 0) {
      rateLabels.push(formatDiscountRateLabel(item.discountType, item.discountValue));
    }
    if (toNumber(item.addonDiscount) > 0) {
      rateLabels.push(formatDiscountRateLabel(item.addonDiscountType, item.addonDiscountValue));
    }
    if (toNumber(item.implementationDiscount) > 0) {
      rateLabels.push(
        formatDiscountRateLabel(item.implementationDiscountType, item.implementationDiscountValue),
      );
    }
  }
  const uniqueRates = [...new Set(rateLabels.filter(Boolean))];
  let discountLabel = "Discount";
  if (uniqueRates.length === 1) {
    discountLabel = `Discount (${uniqueRates[0]})`;
  }

  return {
    originalSubtotal,
    totalDiscount,
    discountLabel,
  };
}

function companyToTemplateCompany(seller = null) {
  const company = resolveSellerCompany(seller);
  return {
    brand: company.brand || company.name,
    name: company.name,
    legalName: company.legalName,
    tagline: company.tagline,
    addressLines: textToLineArray(company.address),
    phone: company.phone,
    email: company.email,
    gstin: company.taxNumber,
    website: company.website,
    taxFieldLabel: company.taxFieldLabel,
  };
}

function invoiceRowsToTemplateItems(invoiceRows, currency) {
  return (invoiceRows || []).map((row) => ({
    product: textToLineArray(row.product || "—"),
    description: textToLineArray(row.description || "—"),
    qty: String(row.qty || "1"),
    unitPrice: formatMoneyDisplay(currency, row.unitPrice),
    subtotal: formatMoneyDisplay(currency, row.netAmount ?? row.subtotal),
  }));
}

function buildFinancialTemplateRows(currency, netSubtotal, gstSplit, discountSummary = {}) {
  const { originalSubtotal = 0, totalDiscount = 0, discountLabel = "Discount" } = discountSummary;
  const discount = Math.max(toNumber(totalDiscount), 0);
  const displaySubtotal = Math.max(
    toNumber(originalSubtotal),
    toNumber(netSubtotal) + discount,
    toNumber(netSubtotal),
  );
  const mode = gstSplit?.mode || "intra";
  const taxRate = Number(gstSplit?.taxRate);
  const rate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : GST_RATE;
  const pct = formatTaxPercentLabel(rate);
  const halfPct = formatTaxPercentLabel(rate / 2);
  const taxLabel = String(gstSplit?.taxLabel || "VAT").trim() || "VAT";
  const taxRows =
    mode === "vat"
      ? rate > 0
        ? [[`@ ${pct}% ${taxLabel}`, formatMoneyDisplay(currency, gstSplit.vat ?? gstSplit.taxTotal)]]
        : []
      : mode === "inter"
        ? [[`@ ${pct}% IGST`, formatMoneyDisplay(currency, gstSplit.igst)]]
        : [
            [`@ ${halfPct}% CGST`, formatMoneyDisplay(currency, gstSplit.cgst)],
            [`@ ${halfPct}% SGST`, formatMoneyDisplay(currency, gstSplit.sgst)],
          ];
  const rows =
    discount > 0
      ? [
          ["Subtotal", formatMoneyDisplay(currency, displaySubtotal)],
          [discountLabel, `-${formatMoneyDisplay(currency, discount)}`],
          ...taxRows,
        ]
      : [["Subtotal", formatMoneyDisplay(currency, displaySubtotal)], ...taxRows];
  return rows;
}

function buildDefaultPaymentLines(productInvoices = [], invoiceRows = [], invoiceDate = new Date()) {
  const isImplementationInvoice =
    (productInvoices || []).length > 0 &&
    (productInvoices || []).every((item) => item.implementationOnly);
  const dueDate = resolveHeaderDueDate(productInvoices, invoiceRows);
  const paymentDueDate = dueDate || invoiceDate;
  const paymentLines = isImplementationInvoice
    ? [`Due on ${formatInvoiceDate(paymentDueDate)}`, "One-time implementation / OTC payment"]
    : [`Due on ${formatInvoiceDate(paymentDueDate)}`];
  const proratedNote = (productInvoices || []).find((item) => item.prorationNote)?.prorationNote;
  if (
    proratedNote &&
    !isImplementationInvoice &&
    !String(proratedNote).startsWith("Pro-rated") &&
    proratedNote !== "Selected billing period"
  ) {
    paymentLines.push(proratedNote);
  }
  return paymentLines;
}

function buildDefaultDeliveryLines(
  productInvoices = [],
  invoiceRows = [],
  invoiceDate = new Date(),
  taxLabel = "GST",
) {
  const periodSource =
    (invoiceRows || []).find((row) => row.periodStart && row.periodEnd) ||
    (productInvoices || []).find((item) => item.periodStart && item.periodEnd);
  const isImplementationInvoice =
    (productInvoices || []).length > 0 &&
    (productInvoices || []).every((item) => item.implementationOnly);
  if (periodSource?.periodStart && periodSource?.periodEnd) {
    return [
      `${formatInvoiceDate(new Date(periodSource.periodStart))} to ${formatInvoiceDate(new Date(periodSource.periodEnd))}`,
    ];
  }
  if (isImplementationInvoice) {
    return [
      "Implementation fee is billed once before go-live.",
      "Subscription billing starts after implementation / go-live.",
    ];
  }
  return [
    "Monthly invoices will be generated at the start of each billing cycle.",
    `${taxLabel || "GST"} will be applied as per prevailing tax regulations.`,
  ];
}

function resolveHqContactFields(lead = {}) {
  return {
    contactName: lead.contactName || "",
    designation: lead.designation || "",
    workEmail: lead.workEmail || "",
    mobileCountryCode: lead.mobileCountryCode || "+91",
    mobileNumber: lead.mobileNumber || "",
  };
}

/** Contact for Primary Contact: branch when billed to a branch, else HQ. Empty branch fields fall back to HQ. */
export function resolveBranchInvoiceContact(lead = {}, billingBranchId = null) {
  const hq = resolveHqContactFields(lead);
  if (!billingBranchId || billingBranchId === HQ_BRANCH_ID) {
    return hq;
  }

  const entry = (lead.additionalAddresses || []).find(
    (address) => String(address?.id) === String(billingBranchId),
  );

  if (!entry) {
    return hq;
  }

  return {
    contactName: String(entry.contactName || "").trim() || hq.contactName,
    designation: String(entry.designation || "").trim() || hq.designation,
    workEmail: String(entry.workEmail || "").trim() || hq.workEmail,
    mobileCountryCode: String(entry.mobileCountryCode || "").trim() || hq.mobileCountryCode,
    mobileNumber: String(entry.mobileNumber || "").trim() || hq.mobileNumber,
  };
}

export function resolveInvoiceBillingParty(lead = {}, options = {}) {
  const billingBranchId = options?.billingBranchId ?? null;
  const reseller = lead.reseller;
  if (!reseller?.companyName && !reseller?.invoiceEmail && !reseller?.workEmail) {
    const contact = resolveBranchInvoiceContact(lead, billingBranchId);
    return {
      companyName: lead.companyName || "",
      billingAddress: lead.billingAddress || "",
      country: lead.country || "",
      taxNumber: lead.taxNumber || "",
      contactName: contact.contactName,
      designation: contact.designation,
      workEmail: contact.workEmail,
      mobileCountryCode: contact.mobileCountryCode,
      mobileNumber: contact.mobileNumber,
      serviceForCompanyName: "",
    };
  }

  return {
    companyName: reseller.companyName || lead.companyName || "",
    billingAddress: reseller.billingAddress || "",
    country: reseller.country || lead.country || "",
    taxNumber: reseller.taxNumber || "",
    contactName: reseller.contactName || "",
    designation: reseller.designation || "",
    workEmail: reseller.invoiceEmail || reseller.workEmail || "",
    mobileCountryCode: reseller.mobileCountryCode || "+91",
    mobileNumber: reseller.mobileNumber || "",
    serviceForCompanyName: lead.companyName || "",
  };
}

function hasBankDetails(bankDetails) {
  if (!bankDetails || typeof bankDetails !== "object") {
    return false;
  }
  return ["accountName", "bankName", "accountNumber", "ifsc", "branch"].some((key) =>
    String(bankDetails[key] || "").trim(),
  );
}

function buildTemplateDataFromProductInvoices({
  lead,
  productInvoices,
  billingAddress = "",
  billingLabel = "",
  billingBranchId = null,
  country = "",
  state = "",
  taxNumber = "",
  invoiceNumber = "",
  invoiceDate = new Date(),
  dueDate = null,
  bankDetails = null,
  seller = null,
  footerLineOverrides = null,
}) {
  const billingParty = resolveInvoiceBillingParty(lead, { billingBranchId });
  const isResellerLead = Boolean(billingParty.serviceForCompanyName);
  const buyerState = state || lead?.state || "";
  const buyerCountry = country || lead?.country || "India";
  const currency = productInvoices[0]?.currency || "INR";
  const invoiceRows = buildInvoiceRows(productInvoices, billingLabel);
  const netSubtotal = invoiceRows.reduce((sum, row) => sum + rowNetAmount(row), 0);
  const gstSplit = resolveInvoiceGstSplit(netSubtotal, { buyerState, buyerCountry });
  const discountSummary = summarizeInvoiceDiscounts(invoiceRows, productInvoices);
  const resolvedAddress = isResellerLead
    ? billingParty.billingAddress || billingAddress || ""
    : billingAddress || billingParty.billingAddress || "";
  const resolvedCountry = isResellerLead
    ? billingParty.country || ""
    : country || billingParty.country || "";
  const taxDefaults = getLeadCountryDefaults(resolvedCountry || buyerCountry);
  const resolvedTaxNumber = isResellerLead
    ? billingParty.taxNumber || ""
    : taxNumber || billingParty.taxNumber || "";
  const addressLines = textToLineArray(resolvedAddress);
  if (resolvedCountry) {
    addressLines.push(resolvedCountry);
  }
  if (resolvedTaxNumber) {
    addressLines.push(`Buyer ${taxDefaults.taxFieldLabel}: ${resolvedTaxNumber}`);
  }
  const billToLabel = isResellerLead
    ? "Billing Address:"
    : billingLabel
      ? `Bill to (${billingLabel}):`
      : "Bill to:";
  const company = companyToTemplateCompany(footerLineOverrides?.seller || seller);

  return {
    company,
    invoice: {
      number: invoiceNumber,
      date: formatInvoiceDate(invoiceDate),
      dueDate: "",
    },
    customer: {
      name: billingParty.companyName || lead?.companyName || "—",
      serviceForCompanyName: billingParty.serviceForCompanyName || "",
      billToLabel,
      addressLines: addressLines.length ? addressLines : ["—"],
      gstNumber: resolvedTaxNumber || "—",
      serviceLocationLabel: isResellerLead && billingLabel ? billingLabel : "",
      serviceLocationLines:
        isResellerLead && billingAddress
          ? textToLineArray([billingAddress, country || lead?.country || ""].filter(Boolean).join("\n"))
          : [],
    },
    contact: null,
    items: invoiceRowsToTemplateItems(invoiceRows, currency),
    amountInWords: numberToWordsIndian(gstSplit.grandTotal),
    financial: {
      rows: buildFinancialTemplateRows(currency, netSubtotal, gstSplit, discountSummary),
      total: formatMoneyDisplay(currency, gstSplit.grandTotal),
    },
    bank: hasBankDetails(bankDetails)
      ? {
          accountName: String(bankDetails.accountName || "").trim(),
          bank: String(bankDetails.bankName || "").trim(),
          accountNumber: String(bankDetails.accountNumber || "").trim(),
          ifsc: String(bankDetails.ifsc || "").trim(),
          branch: String(bankDetails.branch || "").trim(),
        }
      : null,
    note: {
      heading: company.legalName || company.name,
      text: "This is computer generated invoice and does not require signature.",
    },
    terms: {
      termsAndConditions:
        footerLineOverrides?.termsLines?.length > 0
          ? footerLineOverrides.termsLines
          : ["Prices are subject to applicable taxes as mentioned above."],
      paymentTerms:
        footerLineOverrides?.paymentLines?.length > 0
          ? footerLineOverrides.paymentLines
          : buildDefaultPaymentLines(productInvoices, invoiceRows, invoiceDate),
      deliveryTimeline:
        footerLineOverrides?.deliveryLines?.length > 0
          ? footerLineOverrides.deliveryLines
          : buildDefaultDeliveryLines(productInvoices, invoiceRows, invoiceDate, taxDefaults.taxLabel),
    },
    itemSections: null,
  };
}

function invoiceModelToTemplateData(model) {
  const currency = model.currency || "INR";
  const invoiceDate = model.invoiceDateIso ? new Date(model.invoiceDateIso) : new Date();
  const invoiceRows = (model.rows || []).map((row) => ({
    ...row,
    netAmount: toNumber(row.netAmount),
    subtotal: toNumber(row.subtotal),
    discountAmount: Math.max(toNumber(row.subtotal) - toNumber(row.netAmount), 0),
  }));
  const netSubtotal = invoiceRows.reduce((sum, row) => sum + rowNetAmount(row), 0);
  const gstSplit = resolveInvoiceGstSplit(netSubtotal, {
    buyerState: model.buyerState || "",
    buyerCountry: model.buyerCountry || "India",
  });
  const addressLines = textToLineArray(model.customer?.address || "—");
  if (model.customer?.country) {
    addressLines.push(model.customer.country);
  }
  if (model.customer?.taxNumber) {
    addressLines.push(`Buyer ${model.customer?.taxFieldLabel || "Tax"}: ${model.customer.taxNumber}`);
  }
  const billToLabel = model.customer?.billingLabel
    ? `Bill to (${model.customer.billingLabel}):`
    : model.customer?.serviceForCompanyName
      ? "Billing Address:"
      : "Bill to:";
  const company = companyToTemplateCompany(model.seller);

  return {
    company,
    invoice: {
      number: model.invoiceNumber || "DRAFT",
      date: formatInvoiceDate(Number.isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate),
      dueDate: "",
    },
    customer: {
      name: model.customer?.companyName || "—",
      serviceForCompanyName: model.customer?.serviceForCompanyName || "",
      billToLabel,
      addressLines: addressLines.length ? addressLines : ["—"],
      gstNumber: model.customer?.taxNumber || "—",
      serviceLocationLabel: "",
      serviceLocationLines: [],
    },
    contact: null,
    items: invoiceRowsToTemplateItems(invoiceRows, currency),
    amountInWords: model.amountInWords || numberToWordsIndian(gstSplit.grandTotal),
    financial: {
      rows: buildFinancialTemplateRows(currency, netSubtotal, gstSplit),
      total: formatMoneyDisplay(currency, model.grandTotal ?? gstSplit.grandTotal),
    },
    bank: hasBankDetails(model.bankDetails)
      ? {
          accountName: String(model.bankDetails.accountName || "").trim(),
          bank: String(model.bankDetails.bankName || "").trim(),
          accountNumber: String(model.bankDetails.accountNumber || "").trim(),
          ifsc: String(model.bankDetails.ifsc || "").trim(),
          branch: String(model.bankDetails.branch || "").trim(),
        }
      : null,
    note: {
      heading: company.legalName || company.name,
      text: "This is computer generated invoice and does not require signature.",
    },
    terms: {
      termsAndConditions: model.termsLines?.length
        ? model.termsLines
        : ["Prices are subject to applicable taxes as mentioned above."],
      paymentTerms: model.paymentLines?.length ? model.paymentLines : [],
      deliveryTimeline: model.deliveryLines?.length ? model.deliveryLines : [],
    },
    itemSections: null,
  };
}

function measureInvoiceHeaderContent(data, logo = null) {
  const company = data.company;
  const hasLogo = Boolean(logo?.dataUrl && logo?.width && logo?.height);
  const logoSize = 26;
  let leftHeight = 0;

  if (company.brand) {
    // Brand row (~16pt) + gap under logo block, then tagline + address/contact lines.
    leftHeight = Math.max(hasLogo ? logoSize : 18, 18) + 10;
    leftHeight += 11; // tagline
    leftHeight += (company.addressLines || []).length * 9;
    leftHeight += 9; // GST
    leftHeight += 9; // Phone
    leftHeight += 9; // Email
    if (company.website) {
      leftHeight += 9;
    }
  } else {
    leftHeight = 14; // name
    leftHeight += 12; // tagline
    leftHeight += (company.addressLines || []).length * 9;
    leftHeight += 27; // phone/email/gstin
  }

  // Header meta shows Invoice # + Date only (no Due Date).
  const metaHeight = 20;
  return { leftHeight, metaHeight, hasLogo, logoSize };
}

function drawInvoiceHeader(doc, data, logo = null) {
  const company = data.company;
  const textX = MARGIN;
  const { leftHeight, metaHeight, hasLogo, logoSize } = measureInvoiceHeaderContent(data, logo);
  const contentHeight = Math.max(leftHeight, metaHeight, hasLogo ? logoSize : 0);
  const verticalPad = 16;
  const headerH = Math.max(HEADER_H, contentHeight + verticalPad * 2);
  const contentTop = (headerH - contentHeight) / 2;

  rgb(doc, COLORS.black);
  doc.rect(0, 0, PAGE_W, headerH, "F");
  rgb(doc, COLORS.white);

  if (hasLogo) {
    // Pin mark beside WORKTUAL on the brand row (not vertically centered over address lines).
    doc.addImage(logo.dataUrl, "PNG", textX, contentTop, logoSize, logoSize);
  }

  if (company.brand) {
    const brandX = textX + (hasLogo ? logoSize + 8 : 0);
    const brandBaseline = contentTop + (hasLogo ? logoSize * 0.68 : 14);
    setFont(doc, "bold", 16);
    doc.text(company.brand, brandX, brandBaseline);

    setFont(doc, "normal", 8);
    let y = contentTop + Math.max(hasLogo ? logoSize : 18, 18) + 10;
    doc.text(company.tagline, textX, y);
    y += 11;

    setFont(doc, "normal", 7.5);
    for (const line of company.addressLines || []) {
      doc.text(line, textX, y);
      y += 9;
    }
    doc.text(`Seller ${company.taxFieldLabel || "GST"}: ${company.gstin}`, textX, y);
    y += 9;
    doc.text(`Phone: ${company.phone}`, textX, y);
    y += 9;
    doc.text(`Email: ${company.email}`, textX, y);
    if (company.website) {
      y += 9;
      if (typeof doc.textWithLink === "function") {
        doc.textWithLink(`Website: ${company.website}`, textX, y, { url: company.website });
      } else {
        doc.text(`Website: ${company.website}`, textX, y);
      }
    }
  } else {
    setFont(doc, "bold", 11);
    let y = contentTop + 12;
    doc.text(company.name, 119, y);
    y += 14;
    setFont(doc, "normal", 7.5);
    doc.text(company.tagline, 119, y);
    y += 12;
    setFont(doc, "normal", 7);
    for (const line of company.addressLines || []) {
      doc.text(line, 119, y);
      y += 9;
    }
    doc.text(`Phone: ${company.phone}`, 119, y);
    y += 9;
    doc.text(`Email: ${company.email}`, 119, y);
    y += 9;
    doc.text(`Seller GSTIN: ${company.gstin}`, 119, y);
  }

  const metaTop = contentTop + (contentHeight - metaHeight) / 2;
  setFont(doc, "bold", 10);
  doc.text(`Invoice #: ${data.invoice.number}`, PAGE_W - MARGIN, metaTop + 4, { align: "right" });
  setFont(doc, "normal", 9);
  doc.text(`Date: ${data.invoice.date}`, PAGE_W - MARGIN, metaTop + 20, { align: "right" });

  return headerH;
}

function drawCustomerSection(doc, data, startY) {
  drawSectionLabel(doc, "Customer details", MARGIN, startY);

  rgb(doc, COLORS.black);
  setFont(doc, "bold", 11);
  doc.text(data.customer.name, MARGIN, startY + 24);

  let leftBottom = startY + 24;
  if (data.customer.serviceForCompanyName) {
    setFont(doc, "normal", 8.5);
    doc.text(`Service for: ${data.customer.serviceForCompanyName}`, MARGIN, startY + 38);
    leftBottom = startY + 38;
  }

  setFont(doc, "normal", 8.5);
  let y = leftBottom + (data.customer.serviceForCompanyName ? 8 : 22);
  doc.text(data.customer.billToLabel, MARGIN, y);
  y += 12;
  for (const line of data.customer.addressLines || []) {
    doc.text(line, MARGIN, y);
    y += 10;
  }

  if (data.customer.serviceLocationLabel && data.customer.serviceLocationLines?.length) {
    y += 4;
    setFont(doc, "bold", 8.5);
    doc.text(`Service location (${data.customer.serviceLocationLabel}):`, MARGIN, y);
    y += 12;
    setFont(doc, "normal", 8.5);
    for (const line of data.customer.serviceLocationLines) {
      doc.text(line, MARGIN, y);
      y += 10;
    }
  }

  // Primary Contact is intentionally omitted from the WIPL invoice template.
  return y + 12;
}

function measureItemRowHeight(doc, item) {
  const pad = 6;
  const productCol = TABLE_COLS.find((col) => col.key === "product");
  const descCol = TABLE_COLS.find((col) => col.key === "description");
  const productLines = (item.product || []).flatMap((line) => wrapLines(doc, line, productCol.width - pad * 2));
  const descLines = (item.description || []).flatMap((line) => wrapLines(doc, line, descCol.width - pad * 2));
  const textHeight = Math.max(productLines.length, descLines.length, 1) * 9 + 14;
  return Math.max(textHeight, 28);
}

function drawItemsTable(doc, items, startY, { showLabel = true } = {}) {
  let y = startY;
  if (showLabel) {
    drawSectionLabel(doc, "Items", MARGIN, y);
    y += 22;
  }

  const tableX = MARGIN;
  const tableY = y;
  const headerH = 25;
  const safeItems = items?.length ? items : [{ product: ["—"], description: ["—"], qty: "—", unitPrice: "—", subtotal: "—" }];
  const rowHeights = safeItems.map((item) => measureItemRowHeight(doc, item));
  const totalTableH = headerH + rowHeights.reduce((sum, h) => sum + h, 0);

  y = ensureSpacePt(doc, tableY, totalTableH + 8);
  const actualTableY = y;

  let x = tableX;
  for (const col of TABLE_COLS) {
    rgb(doc, COLORS.tableHeader);
    doc.setDrawColor(...COLORS.border);
    doc.rect(x, actualTableY, col.width, headerH, "FD");
    rgb(doc, COLORS.black);
    setFont(doc, "bold", 7);
    const labelX =
      col.align === "right"
        ? x + col.width - 4
        : col.align === "center"
          ? x + col.width / 2
          : x + 6;
    doc.text(col.label, labelX, actualTableY + 15, { align: col.align || "left" });
    x += col.width;
  }

  let rowTop = actualTableY + headerH;
  for (let rowIndex = 0; rowIndex < safeItems.length; rowIndex += 1) {
    const item = safeItems[rowIndex];
    const rowH = rowHeights[rowIndex];
    x = tableX;
    for (const col of TABLE_COLS) {
      rgb(doc, COLORS.white);
      doc.setDrawColor(...COLORS.border);
      doc.rect(x, rowTop, col.width, rowH, "FD");
      const pad = 6;
      if (col.key === "product" || col.key === "description") {
        const lines = item[col.key] || [];
        rgb(doc, COLORS.black);
        setFont(doc, col.key === "product" ? "bold" : "normal", 7.5);
        let lineY = rowTop + 14;
        for (const line of lines) {
          const wrapped = wrapLines(doc, line, col.width - pad * 2);
          doc.text(wrapped, x + pad, lineY);
          lineY += wrapped.length * 9;
        }
      } else {
        rgb(doc, COLORS.black);
        setFont(doc, col.key === "subtotal" ? "bold" : "normal", col.key === "subtotal" ? 7 : 7.5);
        const value = item[col.key];
        const valueX =
          col.align === "right"
            ? x + col.width - pad
            : col.align === "center"
              ? x + col.width / 2
              : x + pad;
        doc.text(String(value ?? "—"), valueX, rowTop + 14, { align: col.align || "left" });
      }
      x += col.width;
    }
    rowTop += rowH;
  }

  return rowTop;
}

function drawAmountAndSummary(doc, data, startY) {
  const summaryRows = data.financial.rows || [];
  const boxH = Math.max(72, 40 + summaryRows.length * 16 + 28);
  let y = ensureSpacePt(doc, startY, boxH + 28);
  const yPos = y === MARGIN && startY > MARGIN ? startY : y;
  rgb(doc, COLORS.black);
  setFont(doc, "normal", 8);
  const words = wrapLines(doc, `Amount in words: ${data.amountInWords}`, 300);
  doc.text(words, MARGIN, yPos + 12);
  const wordsBottom = yPos + 12 + Math.max(words.length - 1, 0) * 10;

  const boxX = 340;
  const boxY = yPos + 8;
  const boxW = PAGE_W - MARGIN - boxX;

  rgb(doc, COLORS.card);
  doc.setDrawColor(...COLORS.border);
  drawRoundedRect(doc, boxX, boxY, boxW, boxH, 4);

  rgb(doc, COLORS.black);
  setFont(doc, "bold", 9);
  doc.text("Financial Summary", boxX + 12, boxY + 18);

  let rowY = boxY + 36;
  for (const [label, value] of summaryRows) {
    setFont(doc, "normal", 8);
    doc.text(label, boxX + 12, rowY);
    doc.text(value, boxX + boxW - 12, rowY, { align: "right" });
    rowY += 16;
  }

  rgb(doc, COLORS.divider);
  doc.setDrawColor(...COLORS.divider);
  doc.setLineWidth(0.85);
  doc.line(boxX + 12, rowY + 2, boxX + boxW - 12, rowY + 2);

  rowY += 18;
  rgb(doc, COLORS.black);
  setFont(doc, "bold", 9);
  doc.text("Total Amount:", boxX + 12, rowY);
  doc.text(data.financial.total, boxX + boxW - 12, rowY, { align: "right" });

  return Math.max(boxY + boxH, wordsBottom + 8);
}

function measureWrappedBlockHeight(doc, lines, maxWidth, lineHeight, titleHeight = 0) {
  let height = titleHeight;
  setFont(doc, "normal", 8);
  for (const line of lines || []) {
    const wrapped = wrapLines(doc, line, maxWidth);
    height += wrapped.length * lineHeight;
  }
  return height;
}

function drawBankAndNote(doc, data, startY) {
  const pad = 12;
  const gap = 8;
  const lineHeight = 12;
  const titleBlock = 22;

  const bankLines = data.bank
    ? [
        `Account name: ${data.bank.accountName || ""}`,
        `Bank: ${data.bank.bank || ""}`,
        `Account number: ${data.bank.accountNumber || ""}`,
        `IFSC: ${data.bank.ifsc || ""}`,
        `Branch: ${data.bank.branch || ""}`,
      ].filter((line) => !/:\s*$/.test(line))
    : [];

  const bankBoxW = data.bank && data.note ? 312 : CONTENT_W;
  const noteBoxW = data.note ? (data.bank ? PAGE_W - MARGIN - (MARGIN + bankBoxW + gap) : CONTENT_W) : 0;

  setFont(doc, "normal", 8);
  const bankContentH = data.bank
    ? titleBlock + measureWrappedBlockHeight(doc, bankLines, bankBoxW - pad * 2, lineHeight)
    : 0;
  let noteContentH = 0;
  if (data.note) {
    setFont(doc, "bold", 9);
    const headingLines = wrapLines(doc, data.note.heading, noteBoxW - pad * 2);
    setFont(doc, "normal", 8);
    const bodyLines = wrapLines(doc, data.note.text, noteBoxW - pad * 2);
    noteContentH = 18 + headingLines.length * 11 + 6 + bodyLines.length * 10;
  }

  const boxH = Math.max(bankContentH, noteContentH, 72) + pad;
  let y = ensureSpacePt(doc, startY + 18, boxH + 20);
  const actualBoxY = y === MARGIN && startY + 18 > MARGIN ? startY + 18 : y;

  if (data.bank) {
    const boxX = MARGIN;
    rgb(doc, COLORS.card);
    doc.setDrawColor(...COLORS.border);
    drawRoundedRect(doc, boxX, actualBoxY, bankBoxW, boxH, 4);

    rgb(doc, COLORS.black);
    setFont(doc, "bold", 9);
    doc.text("Bank details", boxX + pad, actualBoxY + 18);
    setFont(doc, "normal", 8);
    let lineY = actualBoxY + 34;
    for (const line of bankLines) {
      const wrapped = wrapLines(doc, line, bankBoxW - pad * 2);
      doc.text(wrapped, boxX + pad, lineY);
      lineY += wrapped.length * lineHeight;
    }
  }

  if (data.note) {
    const noteX = data.bank ? MARGIN + bankBoxW + gap : MARGIN;
    const noteW = data.bank ? noteBoxW : CONTENT_W;
    rgb(doc, COLORS.card);
    doc.setDrawColor(...COLORS.border);
    drawRoundedRect(doc, noteX, actualBoxY, noteW, boxH, 4);

    rgb(doc, COLORS.black);
    setFont(doc, "bold", 9);
    const headingLines = wrapLines(doc, data.note.heading, noteW - pad * 2);
    let noteY = actualBoxY + 18;
    doc.text(headingLines, noteX + pad, noteY);
    noteY += headingLines.length * 11 + 6;
    setFont(doc, "normal", 8);
    const noteLines = wrapLines(doc, data.note.text, noteW - pad * 2);
    doc.text(noteLines, noteX + pad, noteY);
  }

  return actualBoxY + boxH;
}

function drawFooterCards(doc, data, startY) {
  const cardW = (CONTENT_W - 16) / 3;
  const padX = 10;
  const cards = [
    { title: "Terms & Conditions", lines: data.terms.termsAndConditions || [] },
    { title: "Payment Terms", lines: data.terms.paymentTerms || [] },
    { title: "Delivery Timeline", lines: data.terms.deliveryTimeline || [] },
  ];

  const measured = cards.map((card) => {
    setFont(doc, "normal", 7.5);
    let bodyH = 0;
    for (const line of card.lines) {
      const wrapped = wrapLines(doc, line, cardW - padX * 2);
      bodyH += wrapped.length * 9;
    }
    return { ...card, bodyH };
  });
  const cardH = Math.max(75, 28 + Math.max(...measured.map((card) => card.bodyH), 0) + 14);

  let y = ensureSpacePt(doc, startY + 10, cardH + 12);
  const cardY = y === MARGIN && startY + 10 > MARGIN ? startY + 10 : y;

  measured.forEach((card, index) => {
    const x = MARGIN + index * (cardW + 8);
    rgb(doc, COLORS.card);
    doc.setDrawColor(...COLORS.border);
    drawRoundedRect(doc, x, cardY, cardW, cardH, 4);
    rgb(doc, COLORS.black);
    setFont(doc, "bold", 8.5);
    doc.text(card.title, x + padX, cardY + 16);
    setFont(doc, "normal", 7.5);
    let lineY = cardY + 30;
    for (const line of card.lines) {
      const wrapped = wrapLines(doc, line, cardW - padX * 2);
      doc.text(wrapped, x + padX, lineY);
      lineY += wrapped.length * 9;
    }
  });

  return cardY + cardH;
}

function drawConsolidatedGroupHeader(doc, label, addressLines, startY) {
  let y = ensureSpacePt(doc, startY, 40);
  const yPos = y === MARGIN && startY > MARGIN ? startY : y;
  rgb(doc, COLORS.black);
  setFont(doc, "bold", 9);
  doc.text(label, MARGIN, yPos);
  y = yPos + 14;
  setFont(doc, "normal", 8.5);
  for (const line of addressLines || []) {
    doc.text(line, MARGIN, y);
    y += 10;
  }
  return y + 8;
}

function renderInvoiceFromTemplateData(doc, data, logo = null) {
  const headerH = drawInvoiceHeader(doc, data, logo);
  let y = drawCustomerSection(doc, data, headerH + 15);

  if (data.itemSections?.length) {
    for (const section of data.itemSections) {
      y = drawConsolidatedGroupHeader(doc, section.label, section.addressLines, y);
      y = drawItemsTable(doc, section.items, y, { showLabel: true });
      y += 16;
    }
  } else {
    const itemsStart = Math.max(y + 16, 267);
    y = drawItemsTable(doc, data.items, itemsStart, { showLabel: true });
    y += 26;
  }

  y = drawAmountAndSummary(doc, data, y);
  y = drawBankAndNote(doc, data, y);
  drawFooterCards(doc, data, y);
  return doc;
}

function buildInvoicePdf({
  lead,
  logo,
  productInvoices,
  billingAddress,
  billingLabel = "",
  billingBranchId = null,
  country = "",
  state = "",
  taxNumber = "",
  invoiceNumberSuffix = "",
  invoiceNumber: invoiceNumberOption = "",
  invoicePrefix = "WIPL",
  bankDetails = null,
}) {
  const invoiceDate = new Date();
  const year = invoiceDate.getFullYear();
  const baseInvoiceNumber = invoiceNumberOption || `${invoicePrefix || "WIPL"}-${year}-DRAFT`;
  const invoiceNumber = `${baseInvoiceNumber}${invoiceNumberSuffix || ""}`;
  const dueDate = resolveHeaderDueDate(productInvoices);

  const templateData = buildTemplateDataFromProductInvoices({
    lead,
    productInvoices,
    billingAddress,
    billingLabel,
    billingBranchId,
    country,
    state,
    taxNumber,
    invoiceNumber,
    invoiceDate,
    dueDate,
    bankDetails,
  });

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  return renderInvoiceFromTemplateData(doc, templateData, logo);
}

function buildConsolidatedInvoicePdf({
  lead,
  logo,
  billingGroups,
  invoiceNumber: invoiceNumberOption = "",
  invoicePrefix = "WIPL",
  bankDetails = null,
}) {
  const invoiceDate = new Date();
  const year = invoiceDate.getFullYear();
  const invoiceNumber = invoiceNumberOption || `${invoicePrefix || "WIPL"}-${year}-DRAFT`;
  const allProductInvoices = billingGroups.flatMap((group) => group.productInvoices);
  const allInvoiceRows = [];
  const billingParty = resolveInvoiceBillingParty(lead);
  const isResellerLead = Boolean(billingParty.serviceForCompanyName);
  const buyerState = billingGroups[0]?.state || lead?.state || "";
  const buyerCountry = billingGroups[0]?.country || lead?.country || "India";
  const currency = allProductInvoices[0]?.currency || "INR";
  const taxDefaults = getLeadCountryDefaults(buyerCountry);

  const itemSections = billingGroups.map((group) => {
    const invoiceRows = buildInvoiceRows(group.productInvoices, group.label);
    allInvoiceRows.push(...invoiceRows);
    const groupCountry = group.country || lead.country || "";
    const groupTaxDefaults = getLeadCountryDefaults(groupCountry);
    const addressLines = textToLineArray(group.address);
    if (groupCountry) {
      addressLines.push(groupCountry);
    }
    if (!isResellerLead && group.taxNumber) {
      addressLines.push(`Buyer ${groupTaxDefaults.taxFieldLabel}: ${group.taxNumber}`);
    }
    return {
      label: isResellerLead ? `Service location: ${group.label}` : `Bill to: ${group.label}`,
      addressLines,
      items: invoiceRowsToTemplateItems(invoiceRows, currency),
    };
  });

  const netSubtotal = allInvoiceRows.reduce((sum, row) => sum + rowNetAmount(row), 0);
  const gstSplit = resolveInvoiceGstSplit(netSubtotal, { buyerState, buyerCountry });
  const discountSummary = summarizeInvoiceDiscounts(allInvoiceRows, allProductInvoices);
  let addressLines = [];
  if (isResellerLead && billingParty.billingAddress) {
    addressLines = textToLineArray(billingParty.billingAddress);
    if (billingParty.country) {
      addressLines.push(billingParty.country);
    }
    const resellerTaxDefaults = getLeadCountryDefaults(billingParty.country || "");
    if (billingParty.taxNumber) {
      addressLines.push(`Buyer ${resellerTaxDefaults.taxFieldLabel}: ${billingParty.taxNumber}`);
    }
  }

  const templateData = {
    company: companyToTemplateCompany(),
    invoice: {
      number: invoiceNumber,
      date: formatInvoiceDate(invoiceDate),
      dueDate: "",
    },
    customer: {
      name: billingParty.companyName || "—",
      serviceForCompanyName: billingParty.serviceForCompanyName || "",
      billToLabel: isResellerLead ? "Billing Address:" : "Consolidated billing:",
      addressLines: addressLines.length ? addressLines : ["Multiple locations — see items below."],
      gstNumber: billingParty.taxNumber || "—",
      serviceLocationLabel: "",
      serviceLocationLines: [],
    },
    contact: {
      name: billingParty.contactName || "—",
      billingContact: billingParty.designation || "Billing Contact",
      email: billingParty.workEmail || "—",
      phone: billingParty.mobileNumber
        ? `${billingParty.mobileCountryCode || ""} ${billingParty.mobileNumber}`.trim()
        : "—",
    },
    items: [],
    itemSections,
    amountInWords: numberToWordsIndian(gstSplit.grandTotal),
    financial: {
      rows: buildFinancialTemplateRows(currency, netSubtotal, gstSplit, discountSummary),
      total: formatMoneyDisplay(currency, gstSplit.grandTotal),
    },
    bank: hasBankDetails(bankDetails)
      ? {
          accountName: String(bankDetails.accountName || "").trim(),
          bank: String(bankDetails.bankName || "").trim(),
          accountNumber: String(bankDetails.accountNumber || "").trim(),
          ifsc: String(bankDetails.ifsc || "").trim(),
          branch: String(bankDetails.branch || "").trim(),
        }
      : null,
    note: {
      heading: COMPANY.legalName,
      text: "This is computer generated invoice and does not require signature.",
    },
    terms: {
      termsAndConditions: ["Prices are subject to applicable taxes as mentioned above."],
      paymentTerms: buildDefaultPaymentLines(allProductInvoices, allInvoiceRows, invoiceDate),
      deliveryTimeline: buildDefaultDeliveryLines(
        allProductInvoices,
        allInvoiceRows,
        invoiceDate,
        taxDefaults.taxLabel,
      ),
    },
  };

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  return renderInvoiceFromTemplateData(doc, templateData, logo);
}
function assignmentToProductInvoice(
  product,
  assignment,
  lead,
  { implementationOnly = false, temporaryInvoiceContents = null } = {},
) {
  const invoice = getProductInvoice(product, assignment.config, {
    implementationOnly,
    temporaryInvoiceContents,
  });
  if (!invoice) {
    return null;
  }

  const hasGrossContent = invoice.implementationOnly
    ? toNumber(invoice.setupGross) > 0 || toNumber(invoice.setupSubtotal) > 0
    : toNumber(invoice.recurringGross) > 0 ||
      toNumber(invoice.finalMonthly) > 0 ||
      toNumber(invoice.monthlySubtotal) > 0 ||
      toNumber(invoice.setupGross) > 0 ||
      toNumber(invoice.setupSubtotal) > 0;

  const allowZeroInvoice =
    Boolean(assignment.config?.zeroCatalogDefaults) || Boolean(temporaryInvoiceContents);

  // Keep 100% discounted lines visible (gross > 0, net/totalDue = 0).
  // Temporary Lead may invoice at all zeros (edit amounts on the review sheet).
  if (invoice.totalDue <= 0 && !hasGrossContent && !allowZeroInvoice) {
    return null;
  }

  const changeType = assignment.changeType || "new";
  return {
    ...invoice,
    zeroCatalogDefaults: Boolean(assignment.config?.zeroCatalogDefaults),
    branchLabel: getBranchById(lead, assignment.branchId)?.label || "—",
    changeTypeLabel:
      changeType === "renewal"
        ? "Renewal"
        : changeType.charAt(0).toUpperCase() + changeType.slice(1),
  };
}

function computeGroupSubtotal(productInvoices, branchLabel = "") {
  const rows = buildInvoiceRows(productInvoices, branchLabel);
  return rows.reduce((sum, row) => sum + rowNetAmount(row), 0);
}

function computeGroupTotals(productInvoices, branchLabel = "", { buyerState = "", buyerCountry = "India" } = {}) {
  const subtotal = Math.round(computeGroupSubtotal(productInvoices, branchLabel) * 100) / 100;
  const currency = productInvoices[0]?.currency || "INR";
  const gstSplit = resolveInvoiceGstSplit(subtotal, { buyerState, buyerCountry });
  const grandTotal = Math.round(gstSplit.grandTotal * 100) / 100;

  return {
    subtotal,
    cgst: gstSplit.cgst,
    sgst: gstSplit.sgst,
    igst: gstSplit.igst,
    vat: gstSplit.vat || 0,
    gstMode: gstSplit.mode,
    grandTotal,
    currency,
    gstRate: gstSplit.taxRate ?? getTaxRateForCountry(buyerCountry),
    taxLabel: gstSplit.taxLabel,
  };
}

export function computeQuotationPaymentTotals({
  assignments,
  products,
  lead,
  temporaryInvoiceContents = null,
}) {
  const billingAssignments = resolveTemporaryBillingAssignments(
    assignments,
    temporaryInvoiceContents,
  );
  const normalizedAssignments = normalizeAssignmentsBilling(billingAssignments);
  const billingGroups = buildBillingGroups(normalizedAssignments, products, lead, {
    temporaryInvoiceContents,
  });
  const billingPhase = resolveTemporaryBillingPhase(
    normalizedAssignments,
    temporaryInvoiceContents,
  );

  if (!billingGroups.length) {
    const buyerCountry = lead?.country || "India";
    return {
      subtotal: 0,
      grandTotal: 0,
      currency: "INR",
      gstRate: getTaxRateForCountry(buyerCountry),
      billingPhase,
    };
  }

  let subtotal = 0;
  let grandTotal = 0;
  let currency = "INR";
  let gstRate = GST_RATE;

  for (const group of billingGroups) {
    const totals = computeGroupTotals(group.productInvoices, group.label, {
      buyerState: group.state || lead?.state || "",
      buyerCountry: group.country || lead?.country || "India",
    });
    subtotal += totals.subtotal;
    grandTotal += totals.grandTotal;
    currency = totals.currency || currency;
    gstRate = totals.gstRate ?? gstRate;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  grandTotal = Math.round(grandTotal * 100) / 100;

  return {
    subtotal,
    grandTotal,
    currency,
    gstRate,
    billingPhase,
    temporaryInvoiceContents: temporaryInvoiceContents || null,
  };
}

function resolveTemporaryBillingAssignments(assignments, temporaryInvoiceContents) {
  const mode = String(temporaryInvoiceContents || "").toLowerCase();
  if (mode !== "configuration" && mode !== "addon") {
    return assignments || [];
  }
  return (assignments || []).map((entry) => ({
    ...entry,
    config: {
      ...(entry.config || {}),
      implementationPurchased: true,
      implementationEnabled: false,
    },
  }));
}

function resolveTemporaryImplementationOnly(assignments, temporaryInvoiceContents) {
  const mode = String(temporaryInvoiceContents || "").toLowerCase();
  if (mode === "implementation") {
    return true;
  }
  if (
    mode === "configuration" ||
    mode === "both" ||
    mode === "addon" ||
    mode === "all"
  ) {
    return false;
  }
  return quoteNeedsImplementationPhase(assignments);
}

function resolveTemporaryBillingPhase(assignments, temporaryInvoiceContents) {
  const mode = String(temporaryInvoiceContents || "").toLowerCase();
  if (mode === "implementation") {
    return "implementation";
  }
  if (
    mode === "configuration" ||
    mode === "both" ||
    mode === "addon" ||
    mode === "all"
  ) {
    return "standard";
  }
  return quoteNeedsImplementationPhase(assignments) ? "implementation" : "standard";
}

function buildBillingGroups(assignments, products, lead, { temporaryInvoiceContents = null } = {}) {
  const grouped = groupAssignmentsByBillingTarget(assignments);
  const billingGroups = [];
  const implementationOnly = resolveTemporaryImplementationOnly(
    assignments,
    temporaryInvoiceContents,
  );

  for (const [billingBranchId, groupAssignments] of grouped.entries()) {
    const branch = getBranchById(lead, billingBranchId);
    const productInvoices = groupAssignments
      .map((assignment) => {
        const product = products.find((entry) => entry.id === assignment.productId);
        return assignmentToProductInvoice(product, assignment, lead, {
          implementationOnly,
          temporaryInvoiceContents,
        });
      })
      .filter(Boolean);

    if (productInvoices.length === 0) {
      continue;
    }

    billingGroups.push({
      billingBranchId,
      label: billingGroupLabel(lead, billingBranchId),
      address: branch?.address || lead.billingAddress || "—",
      country: branch?.country || lead.country || "",
      state: branch?.state || lead.state || "",
      taxNumber: getBranchTaxNumber(lead, billingBranchId),
      productInvoices,
    });
  }

  return billingGroups;
}

function invoiceSuffixForBillingTarget(billingBranchId, index) {
  if (billingBranchId === HQ_BRANCH_ID) {
    return index > 0 ? "-HQ" : "";
  }

  return `-${String(billingBranchId).slice(0, 4).toUpperCase()}`;
}

/** Sanitize invoice # into a downloadable PDF file name (e.g. WIPL-2026-DRAFT.pdf). */
function sanitizeInvoiceFileName(invoiceNumberOrName = "") {
  const raw = String(invoiceNumberOrName || "WIPL-DRAFT").trim();
  const withoutExt = raw.replace(/\.pdf$/i, "");
  const safe = withoutExt.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "WIPL-DRAFT";
  return `${safe}.pdf`;
}

function resolveInvoiceDownloadFileName({
  invoiceNumber = "",
  invoicePrefix = "WIPL",
  invoiceNumberSuffix = "",
} = {}) {
  const year = new Date().getFullYear();
  const base = String(invoiceNumber || "").trim() || `${invoicePrefix || "WIPL"}-${year}-DRAFT`;
  return sanitizeInvoiceFileName(`${base}${invoiceNumberSuffix || ""}`);
}

function embedPdfFileNameInDataUrl(dataUrl, fileName) {
  const safeName = sanitizeInvoiceFileName(fileName);
  const encoded = encodeURIComponent(safeName);
  if (/filename=/i.test(dataUrl)) {
    return dataUrl.replace(/filename=[^;,]*/i, `filename=${encoded}`);
  }
  if (dataUrl.startsWith("data:application/pdf")) {
    return dataUrl.replace(
      "data:application/pdf",
      `data:application/pdf;filename=${encoded}`,
    );
  }
  return dataUrl;
}

async function pdfToResult(doc, fileName) {
  const safeFileName = sanitizeInvoiceFileName(fileName);
  const title = safeFileName.replace(/\.pdf$/i, "");
  // Chrome's built-in PDF viewer often uses the document title for Save As.
  try {
    doc.setProperties({
      title,
      subject: "Invoice",
      author: "Worktual",
      creator: "Worktual Accounts",
    });
  } catch {
    // Older jsPDF builds may not support setProperties.
  }

  let dataUrl = embedPdfFileNameInDataUrl(doc.output("datauristring"), safeFileName);
  let pdfBase64 = "";
  let blob = null;

  try {
    blob = doc.output("blob");
    // Preserve a File with the invoice name for object-URL previews / downloads.
    if (typeof File !== "undefined") {
      blob = new File([blob], safeFileName, { type: "application/pdf" });
    }
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    pdfBase64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  } catch {
    const arrayBuffer = doc.output("arraybuffer");
    const bytes = new Uint8Array(arrayBuffer);
    pdfBase64 = Buffer.from(bytes).toString("base64");
  }

  return {
    blob,
    dataUrl,
    fileName: safeFileName,
    pdfBase64,
  };
}

/** Editable A4 sheet model used by Temporary Lead in-preview invoice editing. */
export function buildInvoiceSheetModel({
  lead,
  productInvoices,
  billingAddress = "",
  billingLabel = "",
  billingBranchId = null,
  country = "",
  state = "",
  taxNumber = "",
  invoiceNumberSuffix = "",
  invoiceNumber: invoiceNumberOption = "",
  invoicePrefix = "WIPL",
  bankDetails = null,
  fileName = "",
}) {
  const invoiceDate = new Date();
  const year = invoiceDate.getFullYear();
  const baseInvoiceNumber =
    invoiceNumberOption || `${invoicePrefix || "WIPL"}-${year}-DRAFT`;
  const invoiceNumber = `${baseInvoiceNumber}${invoiceNumberSuffix || ""}`;
  const billingParty = resolveInvoiceBillingParty(lead, { billingBranchId });
  const isResellerLead = Boolean(billingParty.serviceForCompanyName);
  const buyerState = state || lead?.state || "";
  const buyerCountry = country || lead?.country || "India";
  const currency = productInvoices[0]?.currency || "INR";
  const invoiceRows = buildInvoiceRows(productInvoices, billingLabel);
  const rows = invoiceRows.map((row, index) => ({
    id: `row-${index}`,
    product: row.product || "",
    description: row.description || "",
    qty: String(row.qty || "1"),
    unitPrice: toNumber(row.unitPrice),
    subtotal: toNumber(row.subtotal),
    netAmount: rowNetAmount(row),
    periodStart: row.periodStart || null,
    periodEnd: row.periodEnd || null,
  }));
  const netSubtotal = rows.reduce((sum, row) => sum + toNumber(row.netAmount), 0);
  const gstSplit = resolveInvoiceGstSplit(netSubtotal, { buyerState, buyerCountry });
  const dueDate = resolveHeaderDueDate(productInvoices, invoiceRows);
  const periodSource =
    rows.find((row) => row.periodStart && row.periodEnd) ||
    (productInvoices || []).find((item) => item.periodStart && item.periodEnd);
  const isImplementationInvoice =
    (productInvoices || []).length > 0 &&
    (productInvoices || []).every((item) => item.implementationOnly);
  const paymentDueDate = dueDate || invoiceDate;
  const paymentLines = isImplementationInvoice
    ? [
        `Due on ${formatInvoiceDate(paymentDueDate)}`,
        "One-time implementation / OTC payment",
      ]
    : [`Due on ${formatInvoiceDate(paymentDueDate)}`];
  const resolvedAddress = isResellerLead
    ? billingParty.billingAddress || billingAddress || ""
    : billingAddress || billingParty.billingAddress || "";
  const resolvedCountry = isResellerLead
    ? billingParty.country || ""
    : country || billingParty.country || "";
  const taxDefaults = getLeadCountryDefaults(resolvedCountry || buyerCountry);
  const resolvedTaxNumber = isResellerLead
    ? billingParty.taxNumber || ""
    : taxNumber || billingParty.taxNumber || "";

  return {
    version: 1,
    fileName: fileName || sanitizeInvoiceFileName(invoiceNumber),
    currency,
    buyerState,
    buyerCountry,
    invoiceNumber,
    invoiceDateIso: invoiceDate.toISOString().slice(0, 10),
    invoiceDateLabel: formatInvoiceDate(invoiceDate),
    dueDateIso: "",
    dueDateLabel: "",
    periodStartIso: periodSource?.periodStart
      ? String(periodSource.periodStart).slice(0, 10)
      : "",
    periodEndIso: periodSource?.periodEnd ? String(periodSource.periodEnd).slice(0, 10) : "",
    seller: {
      brand: COMPANY.brand,
      name: COMPANY.name,
      legalName: COMPANY.legalName,
      tagline: COMPANY.tagline,
      address: COMPANY.address,
      phone: COMPANY.phone,
      email: COMPANY.email,
      website: COMPANY.website,
      taxFieldLabel: COMPANY.taxFieldLabel,
      taxNumber: COMPANY.taxNumber,
    },
    customer: {
      companyName: billingParty.companyName || lead?.companyName || "",
      serviceForCompanyName: billingParty.serviceForCompanyName || "",
      billingLabel: billingLabel || "",
      address: resolvedAddress,
      country: resolvedCountry,
      taxFieldLabel: taxDefaults.taxFieldLabel,
      taxNumber: resolvedTaxNumber,
    },
    contact: {
      contactName: billingParty.contactName || "",
      designation: billingParty.designation || "Billing Contact",
      workEmail: billingParty.workEmail || "",
      phone: billingParty.mobileNumber
        ? `${billingParty.mobileCountryCode || ""} ${billingParty.mobileNumber}`.trim()
        : "",
    },
    rows,
    subtotal: Math.round(netSubtotal * 100) / 100,
    cgst: gstSplit.cgst,
    sgst: gstSplit.sgst,
    igst: gstSplit.igst,
    vat: gstSplit.vat || 0,
    taxLabel: gstSplit.taxLabel,
    taxRate: gstSplit.taxRate,
    gstMode: gstSplit.mode,
    grandTotal: Math.round(gstSplit.grandTotal * 100) / 100,
    amountInWords: numberToWordsIndian(gstSplit.grandTotal),
    bankDetails: bankDetails
      ? {
          accountName: String(bankDetails.accountName || ""),
          bankName: String(bankDetails.bankName || ""),
          accountNumber: String(bankDetails.accountNumber || ""),
          ifsc: String(bankDetails.ifsc || ""),
          branch: String(bankDetails.branch || ""),
        }
      : null,
    termsLines: ["Prices are subject to applicable taxes as mentioned above."],
    paymentLines,
    deliveryLines:
      periodSource?.periodStart && periodSource?.periodEnd
        ? [
            `${formatInvoiceDate(new Date(periodSource.periodStart))} to ${formatInvoiceDate(new Date(periodSource.periodEnd))}`,
          ]
        : isImplementationInvoice
          ? [
              "Implementation fee is billed once before go-live.",
              "Subscription billing starts after implementation / go-live.",
            ]
          : [
              "Monthly invoices will be generated at the start of each billing cycle.",
              `${taxDefaults.taxLabel || "GST"} will be applied as per prevailing tax regulations.`,
            ],
  };
}

/**
 * Formats periodStartIso/periodEndIso into the single-line range label used for the
 * invoice PDF's "Delivery Timeline" text whenever a billing period is set. Returns
 * null when either date is missing/invalid so callers can fall back to existing text.
 */
export function formatInvoiceSheetPeriodLine(periodStartIso, periodEndIso) {
  const start = periodStartIso ? new Date(String(periodStartIso).slice(0, 10)) : null;
  const end = periodEndIso ? new Date(String(periodEndIso).slice(0, 10)) : null;
  const validStart = Boolean(start && !Number.isNaN(start.getTime()));
  const validEnd = Boolean(end && !Number.isNaN(end.getTime()));
  if (!validStart || !validEnd) {
    return null;
  }
  return `${formatInvoiceDate(start)} to ${formatInvoiceDate(end)}`;
}

export function recalculateInvoiceSheetTotals(sheet) {
  if (!sheet) {
    return sheet;
  }
  const rows = (sheet.rows || []).map((row) => {
    const unitPrice = toNumber(row.unitPrice);
    const qty = Math.max(toNumber(row.qty) || 1, 0);
    const subtotal = Math.round(unitPrice * qty * 100) / 100;
    const netAmount =
      row.netAmount != null && row.netAmount !== ""
        ? Math.max(toNumber(row.netAmount), 0)
        : subtotal;
    return {
      ...row,
      qty: String(row.qty || "1"),
      unitPrice,
      subtotal,
      netAmount,
    };
  });
  const netSubtotal = rows.reduce((sum, row) => sum + toNumber(row.netAmount), 0);
  const gstSplit = resolveInvoiceGstSplit(netSubtotal, {
    buyerState: sheet.buyerState || "",
    buyerCountry: sheet.buyerCountry || "India",
  });
  const dueIso = String(sheet.dueDateIso || "").slice(0, 10);
  const dueParsed = dueIso ? new Date(dueIso) : null;
  const hasDue = Boolean(dueParsed && !Number.isNaN(dueParsed.getTime()));
  const invoiceIso = String(sheet.invoiceDateIso || "").slice(0, 10);
  const invoiceParsed = invoiceIso ? new Date(invoiceIso) : new Date();
  return {
    ...sheet,
    rows,
    invoiceDateLabel: formatInvoiceDate(
      Number.isNaN(invoiceParsed.getTime()) ? new Date() : invoiceParsed,
    ),
    dueDateLabel: hasDue ? formatInvoiceDate(dueParsed) : "",
    subtotal: Math.round(netSubtotal * 100) / 100,
    cgst: gstSplit.cgst,
    sgst: gstSplit.sgst,
    igst: gstSplit.igst,
    vat: gstSplit.vat || 0,
    taxLabel: gstSplit.taxLabel,
    taxRate: gstSplit.taxRate,
    gstMode: gstSplit.mode,
    grandTotal: Math.round(gstSplit.grandTotal * 100) / 100,
    amountInWords: numberToWordsIndian(gstSplit.grandTotal),
  };
}

/** Rebuild a PDF blob/dataUrl from an edited Temporary Lead invoice sheet. */
export async function buildInvoicePdfFromSheet(sheet, logo = null) {
  const model = recalculateInvoiceSheetTotals(sheet);
  const templateData = invoiceModelToTemplateData(model);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderInvoiceFromTemplateData(doc, templateData, logo);
  return pdfToResult(
    doc,
    model.fileName || resolveInvoiceDownloadFileName({ invoiceNumber: model.invoiceNumber }),
  );
}

export async function buildQuotationInvoice({
  lead,
  logoUrl,
  /** Preloaded `{ dataUrl, width, height }` (e.g. Node server) — preferred over logoUrl. */
  logoAsset = null,
  products,
  productConfigs,
  assignments,
  invoiceMode = "consolidated",
  skipLogo = false,
  temporaryInvoiceContents = null,
  invoiceNumber = "",
  invoicePrefix = "WIPL",
  bankDetails = null,
}) {
  if (!lead) {
    throw new Error("Lead details are missing.");
  }

  let logo = null;
  if (logoAsset?.dataUrl && logoAsset?.width && logoAsset?.height) {
    logo = logoAsset;
  } else if (!skipLogo && logoUrl) {
    logo = await prepareInvoiceLogo(logoUrl);
  }

  if (assignments?.length) {
    const billingAssignments = resolveTemporaryBillingAssignments(
      assignments,
      temporaryInvoiceContents,
    );
    const normalizedAssignments = normalizeAssignmentsBilling(billingAssignments);
    const effectiveInvoiceMode = resolveInvoiceMode(normalizedAssignments, lead, invoiceMode);
    const validationError = validateInvoiceModeForAssignments(
      normalizedAssignments,
      lead,
      effectiveInvoiceMode,
    );

    if (validationError) {
      throw new Error(validationError);
    }

    const billingGroups = buildBillingGroups(normalizedAssignments, products, lead, {
      temporaryInvoiceContents,
    });

    if (billingGroups.length === 0) {
      const temporaryZeroOk =
        Boolean(temporaryInvoiceContents) ||
        (assignments || []).some((entry) => entry?.config?.zeroCatalogDefaults);
      if (!temporaryZeroOk) {
        throw new Error(
          "Cannot create an invoice with zero purchase amount. Enable and configure at least one product feature with pricing.",
        );
      }
      throw new Error(
        "Could not build the temporary invoice. Choose at least one product, then try again.",
      );
    }

    if (effectiveInvoiceMode === "per_branch" && billingGroups.length > 1) {
      const invoices = [];

      for (let index = 0; index < billingGroups.length; index += 1) {
        const group = billingGroups[index];
        const suffix = invoiceSuffixForBillingTarget(group.billingBranchId, index);
        const doc = buildInvoicePdf({
          lead,
          logo,
          productInvoices: group.productInvoices,
          billingAddress: group.address,
          billingLabel: group.label,
          billingBranchId: group.billingBranchId,
          country: group.country,
          state: group.state,
          taxNumber: group.taxNumber,
          invoiceNumberSuffix: suffix,
          invoiceNumber,
          invoicePrefix,
          bankDetails,
        });
        const totals = computeGroupTotals(group.productInvoices, group.label, {
          buyerState: group.state || lead.state || "",
          buyerCountry: group.country || lead.country || "India",
        });
        const fileName = resolveInvoiceDownloadFileName({
          invoiceNumber,
          invoicePrefix,
          invoiceNumberSuffix: suffix,
        });
        const result = await pdfToResult(doc, fileName);
        const sheet = buildInvoiceSheetModel({
          lead,
          productInvoices: group.productInvoices,
          billingAddress: group.address,
          billingLabel: group.label,
          billingBranchId: group.billingBranchId,
          country: group.country,
          state: group.state,
          taxNumber: group.taxNumber,
          invoiceNumberSuffix: suffix,
          invoiceNumber,
          invoicePrefix,
          bankDetails,
          fileName,
        });

        invoices.push({
          billingBranchId: group.billingBranchId,
          branchLabel: group.label,
          label: group.label,
          ...totals,
          ...result,
          sheet,
        });
      }

      const primary = invoices[0];
      const allProductInvoices = billingGroups.flatMap((group) => group.productInvoices);

      return {
        invoiceMode: effectiveInvoiceMode,
        invoices,
        blob: primary.blob,
        dataUrl: primary.dataUrl,
        fileName: primary.fileName,
        pdfBase64: primary.pdfBase64,
        productInvoices: allProductInvoices,
        billingGroups,
      };
    }

    const doc =
      billingGroups.length === 1
        ? buildInvoicePdf({
            lead,
            logo,
            productInvoices: billingGroups[0].productInvoices,
            billingAddress: billingGroups[0].address,
            billingLabel: billingGroups[0].label,
            billingBranchId: billingGroups[0].billingBranchId,
            country: billingGroups[0].country,
            state: billingGroups[0].state,
            taxNumber: billingGroups[0].taxNumber,
            invoiceNumber,
            invoicePrefix,
            bankDetails,
          })
        : buildConsolidatedInvoicePdf({
            lead,
            logo,
            billingGroups,
            invoiceNumber,
            invoicePrefix,
            bankDetails,
          });

    const fileName = resolveInvoiceDownloadFileName({ invoiceNumber, invoicePrefix });
    const result = await pdfToResult(doc, fileName);
    const allProductInvoices = billingGroups.flatMap((group) => group.productInvoices);
    const totals = computeQuotationPaymentTotals({
      assignments: normalizedAssignments,
      products,
      lead,
    });
    const primaryGroup = billingGroups[0];
    const sheet =
      billingGroups.length === 1
        ? buildInvoiceSheetModel({
            lead,
            productInvoices: primaryGroup.productInvoices,
            billingAddress: primaryGroup.address,
            billingLabel: primaryGroup.label,
            billingBranchId: primaryGroup.billingBranchId,
            country: primaryGroup.country,
            state: primaryGroup.state,
            taxNumber: primaryGroup.taxNumber,
            invoiceNumber,
            invoicePrefix,
            bankDetails,
            fileName,
          })
        : buildInvoiceSheetModel({
            lead,
            productInvoices: allProductInvoices,
            billingAddress: primaryGroup.address,
            billingLabel: "Consolidated",
            billingBranchId: primaryGroup.billingBranchId,
            country: primaryGroup.country,
            state: primaryGroup.state,
            taxNumber: primaryGroup.taxNumber,
            invoiceNumber,
            invoicePrefix,
            bankDetails,
            fileName,
          });

    return {
      invoiceMode: effectiveInvoiceMode,
      invoices: [
        {
          billingBranchId: billingGroups[0].billingBranchId,
          branchLabel: billingGroups.length === 1 ? billingGroups[0].label : "Consolidated",
          label: billingGroups.length === 1 ? billingGroups[0].label : "Consolidated",
          ...totals,
          ...result,
          sheet,
        },
      ],
      ...result,
      ...totals,
      productInvoices: allProductInvoices,
      billingGroups,
    };
  }

  const productInvoices = products
    .map((product) => getProductInvoice(product, productConfigs[product.id]))
    .filter(Boolean);

  if (productInvoices.length === 0) {
    throw new Error("No product pricing found for this quotation.");
  }

  const doc = buildInvoicePdf({
    lead,
    logo,
    productInvoices,
    invoiceNumber,
    invoicePrefix,
    bankDetails,
  });
  const fileName = resolveInvoiceDownloadFileName({ invoiceNumber, invoicePrefix });
  const result = await pdfToResult(doc, fileName);

  return {
    invoiceMode: "consolidated",
    invoices: [{ billingBranchId: HQ_BRANCH_ID, label: "Head office", ...result }],
    ...result,
    productInvoices,
    billingGroups: [],
  };
}

export async function downloadQuotationInvoice({
  lead,
  logoUrl,
  products,
  productConfigs,
  assignments,
  invoiceMode,
}) {
  const { blob, fileName } = await buildQuotationInvoice({
    lead,
    logoUrl,
    products,
    productConfigs,
    assignments,
    invoiceMode,
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export { getProductInvoice };
