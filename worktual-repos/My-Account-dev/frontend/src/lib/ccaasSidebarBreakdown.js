import {
  resolveModulesWithCatalogPrices,
} from "./ccaasModules.js";
import {
  createDefaultCcaasAddons,
  createDefaultUsageDetails,
  getCcaasConfigurationPricingRows,
  getConfigurationLineAmount,
} from "./ccaasConfiguration.js";
import {
  buildCcaasMidPeriodInvoiceLines,
  buildCrmMidPeriodInvoiceLines,
  isMidPeriodAddonBilling,
  sumCcaasMidPeriodAddonPrices,
} from "./midPeriodAddons.js";
import { getCachedPricingCatalog } from "./pricingCatalog.js";
import { isFeatureEnabled } from "./pricingFeatures.js";
import { getContactChargeSlabs, getTicketSlabs } from "./pricingRuntime.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasQty(value) {
  return value !== undefined && value !== null && value !== "";
}

function emptyBreakdown() {
  return { sections: [] };
}

function section(title, lines, { showBaseSubtotal = false } = {}) {
  if (!lines.length) {
    return null;
  }
  return { title, lines, showBaseSubtotal };
}

function pushSection(sections, entry) {
  if (entry) {
    sections.push(entry);
  }
}

function qtyRateLine({ id, label, qty, rate, amount, includedInBase = false }) {
  return {
    id,
    label,
    qty: hasQty(qty) ? qty : null,
    rate: hasQty(rate) ? rate : null,
    amount: toNumber(amount),
    includedInBase,
  };
}

function buildCcaasSections(config) {
  const sections = [];
  const catalog = getCachedPricingCatalog();
  const region = config.region || "India";
  const usageDetails = config.usageDetails || createDefaultUsageDetails();
  const addons = config.addons || createDefaultCcaasAddons();

  if (isMidPeriodAddonBilling(config)) {
    const addonLines = buildCcaasMidPeriodInvoiceLines(config).map((line, index) =>
      qtyRateLine({ id: `addon-${index}`, label: line.label, amount: line.amount }),
    );
    pushSection(sections, section("Add-ons", addonLines));
    return { sections };
  }

  const modulesConfig = resolveModulesWithCatalogPrices(
    config.modules,
    config.licenseTier,
    catalog,
    region,
    usageDetails.agentRate,
    { preferStoredPrices: Boolean(config.zeroCatalogDefaults) },
  );

  // Modules are rolled into Base Price in the sidebar UI — do not list each capability.
  const contactCenter = catalog.products?.["contact-center"] || {};
  const tierDefaultVolumes = contactCenter.tierDefaultVolumes || {};
  const configurationRows = getCcaasConfigurationPricingRows(
    modulesConfig,
    config.licenseTier,
    tierDefaultVolumes,
    contactCenter,
  );

  const configuration = [];
  for (const row of configurationRows) {
    const qty = usageDetails[row.qtyKey];
    if (!hasQty(qty) || toNumber(qty) <= 0) {
      continue;
    }

    const includedInBase = row.billOnConfiguration === false;
    // Informational only for in-base rows (e.g. Agent) — rollups/invoice still use
    // getConfigurationLineAmount (0) so Base Price is not double-counted.
    const displayAmount = includedInBase
      ? toNumber(usageDetails[row.totalKey]) ||
        toNumber(qty) * toNumber(usageDetails[row.rateKey])
      : getConfigurationLineAmount(usageDetails, row);

    configuration.push(
      qtyRateLine({
        id: row.id,
        label: row.itemLabel,
        qty,
        rate: usageDetails[row.rateKey],
        amount: displayAmount,
        includedInBase,
      }),
    );
  }
  pushSection(sections, section("Configuration", configuration));

  const addonsList = [];
  const channelAddonTotal = sumCcaasMidPeriodAddonPrices(config);
  const useChannelAddons = channelAddonTotal > 0 || config.midPeriodAddons?.active;

  if (useChannelAddons) {
    for (const [index, line] of buildCcaasMidPeriodInvoiceLines(config).entries()) {
      addonsList.push(
        qtyRateLine({ id: `addon-${index}`, label: line.label, amount: line.amount }),
      );
    }
  } else {
    if (addons.sessionBundle && addons.sessionBundle !== "none") {
      const sessionLabel =
        addons.sessionBundle === "custom"
          ? `${addons.sessionCount || "Custom"} sessions`
          : `${Number(addons.sessionBundle).toLocaleString()} sessions`;
      addonsList.push(
        qtyRateLine({
          id: "sessions",
          label: `Sessions — ${sessionLabel}`,
          amount: addons.sessionPrice,
        }),
      );
    }

    if (addons.multilingualOption === "addon") {
      addonsList.push(
        qtyRateLine({
          id: "multilingual",
          label: "Multilingual add-on",
          amount: addons.multilingualPrice,
        }),
      );
    }
  }
  pushSection(sections, section("Add-ons", addonsList));

  return { sections };
}

function buildCrmSections(config) {
  const sections = [];

  if (isMidPeriodAddonBilling(config)) {
    const addonLines = buildCrmMidPeriodInvoiceLines(config).map((line, index) =>
      qtyRateLine({ id: `addon-${index}`, label: line.label, amount: line.amount }),
    );
    pushSection(sections, section("Add-ons", addonLines));
    return { sections };
  }

  const baseLines = [];
  if (isFeatureEnabled(config, "usersEnabled")) {
    baseLines.push(
      qtyRateLine({
        id: "users",
        label: "Users",
        qty: config.userCount,
        rate: config.userLicenseRate,
        amount: toNumber(config.userCount) * toNumber(config.userLicenseRate),
      }),
    );
    if (toNumber(config.numberCount) > 0) {
      baseLines.push(
        qtyRateLine({
          id: "numbers",
          label: "Numbers",
          qty: config.numberCount,
          rate: config.numberRate,
          amount: toNumber(config.numberCount) * toNumber(config.numberRate),
        }),
      );
    }
  }
  pushSection(sections, section("License", baseLines, { showBaseSubtotal: true }));

  const addons = [];
  if (config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0) {
    const rate = config.additionalUserLicenseRate || config.userLicenseRate;
    addons.push(
      qtyRateLine({
        id: "additional-users",
        label: "Additional users",
        qty: config.additionalUserCount,
        rate,
        amount: toNumber(config.additionalUserCount) * toNumber(rate),
      }),
    );
  }
  if (config.additionalNumbersEnabled && toNumber(config.additionalNumberCount) > 0) {
    addons.push(
      qtyRateLine({
        id: "additional-numbers",
        label: "Additional numbers",
        qty: config.additionalNumberCount,
        rate: config.additionalNumberRate,
        amount: toNumber(config.additionalNumberCount) * toNumber(config.additionalNumberRate),
      }),
    );
  }
  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    addons.push(
      qtyRateLine({
        id: "additional-storage",
        label: "Add-On Storage",
        qty: config.additionalStorageCount,
        rate: config.additionalStorageRate,
        amount: toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate),
      }),
    );
  }
  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    addons.push(
      qtyRateLine({
        id: "additional-contacts",
        label: `Additional contacts (${config.additionalContactSlab})`,
        amount: toNumber(
          getContactChargeSlabs(config.region, config.productId || "crm")[config.additionalContactSlab]
            ?.monthlyPrice,
        ),
      }),
    );
  }
  pushSection(sections, section("Add-ons", addons));

  return { sections };
}

function buildCdpSections(config) {
  const sections = [];
  const baseLines = [];

  if (isFeatureEnabled(config, "platformEnabled")) {
    baseLines.push(
      qtyRateLine({
        id: "monthly-base",
        label: "Monthly base price",
        amount: config.monthlyBasePrice,
      }),
    );
  }
  pushSection(sections, section("Platform", baseLines, { showBaseSubtotal: true }));

  const usage = [];
  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    usage.push(
      qtyRateLine({
        id: "additional-contacts",
        label: `Additional contacts (${config.additionalContactSlab})`,
        amount: toNumber(
          getContactChargeSlabs(config.region, config.productId || "cdp")[config.additionalContactSlab]
            ?.monthlyPrice,
        ),
      }),
    );
  }
  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    usage.push(
      qtyRateLine({
        id: "additional-storage",
        label: "Add-On Storage",
        qty: config.additionalStorageCount,
        rate: config.additionalStorageRate,
        amount: toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate),
      }),
    );
  }
  pushSection(sections, section("Configuration", usage));

  return { sections };
}

const CAMPAIGN_CHANNEL_ROWS = [
  { id: "webPush", label: "Web push", qtyKey: "webPushSubscribers", rateKey: "webPushRate" },
  { id: "appPush", label: "App push", qtyKey: "appPushSubscribers", rateKey: "appPushRate" },
  { id: "email", label: "Email", qtyKey: "emailCount", rateKey: "emailRate" },
  { id: "sms", label: "SMS", qtyKey: "smsCount", rateKey: "smsRate" },
  { id: "whatsapp", label: "WhatsApp", qtyKey: "whatsappCredits", rateKey: "whatsappRate" },
];

function buildCampaignChannelLines(config) {
  const lines = [];
  for (const row of CAMPAIGN_CHANNEL_ROWS) {
    const qty = config[row.qtyKey];
    const rate = config[row.rateKey];
    if (!hasQty(qty) || toNumber(qty) <= 0) {
      continue;
    }
    lines.push(
      qtyRateLine({
        id: row.id,
        label: row.label,
        qty,
        rate,
        amount: toNumber(qty) * toNumber(rate),
      }),
    );
  }
  return lines;
}

function buildCampaignSections(config) {
  const sections = [];
  const midPeriodOnly = isMidPeriodAddonBilling(config);
  const channelLines = buildCampaignChannelLines(config);

  if (!midPeriodOnly && isFeatureEnabled(config, "basePlanEnabled")) {
    const baseLines = [
      qtyRateLine({
        id: "monthly-base",
        label: "Monthly base price",
        amount: config.monthlyBasePrice,
      }),
    ];
    // Campaign numbers removed — messaging packs only.
    // if (toNumber(config.numberCount) > 0) {
    //   baseLines.push(
    //     qtyRateLine({
    //       id: "numbers",
    //       label: "Numbers",
    //       qty: config.numberCount,
    //       rate: config.numberRate,
    //       amount: toNumber(config.numberCount) * toNumber(config.numberRate),
    //     }),
    //   );
    // }
    pushSection(
      sections,
      section("Plan", baseLines, { showBaseSubtotal: channelLines.length === 0 }),
    );
    pushSection(
      sections,
      section("Channels", channelLines, { showBaseSubtotal: channelLines.length > 0 }),
    );
  } else if (midPeriodOnly) {
    pushSection(sections, section("Channels", channelLines));
  }

  const addons = [];
  if (midPeriodOnly) {
    for (const [index, line] of buildCrmMidPeriodInvoiceLines(config).entries()) {
      addons.push(qtyRateLine({ id: `addon-${index}`, label: line.label, amount: line.amount }));
    }
  } else {
    // Campaign additional numbers removed.
    // if (config.additionalNumbersEnabled && toNumber(config.additionalNumberCount) > 0) { ... }
    if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
      addons.push(
        qtyRateLine({
          id: "additional-storage",
          label: "Add-On Storage",
          qty: config.additionalStorageCount,
          rate: config.additionalStorageRate,
          amount: toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate),
        }),
      );
    }
    if (config.additionalContactsEnabled && config.additionalContactSlab) {
      addons.push(
        qtyRateLine({
          id: "additional-contacts",
          label: `Additional contacts (${config.additionalContactSlab})`,
          amount: toNumber(
            getContactChargeSlabs(config.region, config.productId || "campaign")[
              config.additionalContactSlab
            ]?.monthlyPrice,
          ),
        }),
      );
    }
  }
  pushSection(sections, section("Add-ons", addons));

  return { sections };
}

function buildValueManagementSections(config) {
  const sections = [];
  const midPeriodOnly = isMidPeriodAddonBilling(config);

  if (!midPeriodOnly && isFeatureEnabled(config, "subscriptionEnabled")) {
    pushSection(
      sections,
      section(
        "Subscription",
        [
          qtyRateLine({
            id: "monthly-base",
            label: "Monthly base price",
            amount: config.monthlyBasePrice,
          }),
        ],
        { showBaseSubtotal: true },
      ),
    );
  }

  const addons = [];
  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    addons.push(
      qtyRateLine({
        id: "additional-contacts",
        label: `Additional contacts (${config.additionalContactSlab})`,
        amount: toNumber(
          getContactChargeSlabs(config.region, config.productId || "value-management")[
            config.additionalContactSlab
          ]?.monthlyPrice,
        ),
      }),
    );
  }
  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    addons.push(
      qtyRateLine({
        id: "additional-storage",
        label: "Add-On Storage",
        qty: config.additionalStorageCount,
        rate: config.additionalStorageRate,
        amount: toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate),
      }),
    );
  }
  pushSection(sections, section("Add-ons", addons));

  return { sections };
}

function buildTicketingSections(config) {
  const sections = [];
  const midPeriodOnly = isMidPeriodAddonBilling(config);

  if (!midPeriodOnly && isFeatureEnabled(config, "usersEnabled")) {
    pushSection(
      sections,
      section(
        "License",
        [
          qtyRateLine({
            id: "users",
            label: "Users",
            qty: config.userCount,
            rate: config.userLicenseRate,
            amount: toNumber(config.userCount) * toNumber(config.userLicenseRate),
          }),
        ],
        { showBaseSubtotal: true },
      ),
    );
  }

  const addons = [];
  if (config.additionalUsersEnabled && toNumber(config.additionalUserCount) > 0) {
    const rate = config.additionalUserLicenseRate || config.userLicenseRate;
    addons.push(
      qtyRateLine({
        id: "additional-users",
        label: "Additional users",
        qty: config.additionalUserCount,
        rate,
        amount: toNumber(config.additionalUserCount) * toNumber(rate),
      }),
    );
  }
  if (config.additionalTicketsEnabled && config.additionalTicketSlab) {
    addons.push(
      qtyRateLine({
        id: "additional-tickets",
        label: `Additional tickets (${config.additionalTicketSlab})`,
        amount: toNumber(
          getTicketSlabs(config.region)[config.additionalTicketSlab]?.monthlyPrice,
        ),
      }),
    );
  }
  if (config.additionalStorageEnabled && toNumber(config.additionalStorageCount) > 0) {
    addons.push(
      qtyRateLine({
        id: "additional-storage",
        label: "Add-On Storage",
        qty: config.additionalStorageCount,
        rate: config.additionalStorageRate,
        amount: toNumber(config.additionalStorageCount) * toNumber(config.additionalStorageRate),
      }),
    );
  }
  pushSection(sections, section("Add-ons", addons));

  return { sections };
}

function buildGenericSections(config, productName = "Product") {
  const amount = toNumber(config.monthlyBasePrice);
  if (amount <= 0 && !isFeatureEnabled(config, "implementationEnabled")) {
    return emptyBreakdown();
  }

  return {
    sections: [
      section(
        productName,
        [qtyRateLine({ id: "monthly-base", label: "Monthly base price", amount })],
        { showBaseSubtotal: true },
      ),
    ].filter(Boolean),
  };
}

/**
 * Detailed pricing sidebar breakdown for any product pricing mode.
 * Returns `{ sections: [{ title, lines, showBaseSubtotal? }] }`.
 */
export function buildSidebarPricingBreakdown(config, { productName = "Product" } = {}) {
  if (!config) {
    return emptyBreakdown();
  }

  switch (config.pricingMode) {
    case "ccaas":
      return buildCcaasSections(config);
    case "crm":
      return buildCrmSections(config);
    case "cdp":
      return buildCdpSections(config);
    case "campaign":
      return buildCampaignSections(config);
    case "value-management":
      return buildValueManagementSections(config);
    case "ticketing":
      return buildTicketingSections(config);
    default:
      return buildGenericSections(config, productName);
  }
}

/** @deprecated Prefer buildSidebarPricingBreakdown */
export function buildCcaasSidebarBreakdown(config) {
  if (!config || config.pricingMode !== "ccaas") {
    return null;
  }
  return buildSidebarPricingBreakdown(config);
}
