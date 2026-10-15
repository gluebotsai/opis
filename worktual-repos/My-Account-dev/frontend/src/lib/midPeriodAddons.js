import {
  getPlanAgentAddon,
  getPlanQueueCapacityAddon,
  getVisiblePlanAddonChannels,
  isChannelVisibleForConfig,
  PLAN_ADDON_CHANNELS,
  pruneCcaasAddonsToPlanVisibility,
} from "./planAddons.js";
import { syncCcaasNumberEntitlementFields } from "./ccaasConfiguration.js";
import { getProductNumberAddOn, getProductStorageAddOn } from "./pricingCatalogDefaults.js";
import { getCatalog, getContactChargeSlabs } from "./pricingRuntime.js";

export const CCAAS_MID_PERIOD_CHANNELS = PLAN_ADDON_CHANNELS.map((channel) => ({
  id: channel.id,
  label: channel.label === "Voice" ? "Call (voice)" : channel.label,
}));

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyChannelEntry() {
  return { enabled: false, slabId: "", count: "", rate: "" };
}

export function createEmptyCcaasMidPeriodAddons() {
  return {
    active: false,
    humanAgent: { enabled: false, count: "", rate: "" },
    queueCapacity: { enabled: false, count: "", rate: "" },
    storage: { enabled: false, count: "", rate: "", label: "Add-On Storage", unit: "GB" },
    channels: Object.fromEntries(
      CCAAS_MID_PERIOD_CHANNELS.map((channel) => [channel.id, emptyChannelEntry()]),
    ),
  };
}

export function createEmptyCrmMidPeriodAddons() {
  return {
    active: false,
    userLicense: { enabled: false, additionalCount: "" },
    contacts: { enabled: false, slab: "" },
    numbers: { enabled: false, count: "", rate: "", label: "Additional numbers" },
    storage: { enabled: false, count: "", rate: "", label: "Add-On Storage" },
  };
}

export function seedCcaasMidPeriodAddons(config = {}, { billingMode = "with-core" } = {}) {
  const region = config.region || "India";
  const catalog = getCatalog(region);
  const contactCenter = catalog.products?.["contact-center"] || {};
  const visibleChannels = getVisiblePlanAddonChannels(config, contactCenter);
  const agentAddon = getPlanAgentAddon(config, contactCenter);
  const queueAddon = getPlanQueueCapacityAddon(config, contactCenter);
  const storageAddOn = getProductStorageAddOn(contactCenter, region);
  const existing = config.midPeriodAddons || {};
  const existingChannels = existing.channels || {};
  const zero = Boolean(config.zeroCatalogDefaults);
  const legacyPhone = existing.phoneNumbers || {};
  const existingQueue = existing.queueCapacity || {};

  const channels = {};
  for (const channel of CCAAS_MID_PERIOD_CHANNELS) {
    const visible = visibleChannels.find((entry) => entry.id === channel.id);
    const prior = existingChannels[channel.id] || {};
    const slabIds = new Set((visible?.slabs || []).map((slab) => slab.id));
    const slabId = visible && prior.slabId && slabIds.has(prior.slabId) ? prior.slabId : "";
    const selectedSlab = slabId
      ? (visible.slabs || []).find((slab) => slab.id === slabId)
      : null;

    if (!visible) {
      channels[channel.id] = {
        enabled: false,
        slabId: "",
        count: "",
        rate: "",
        label: channel.label,
      };
      continue;
    }

    if (!selectedSlab) {
      channels[channel.id] = {
        enabled: false,
        slabId: "",
        count: "",
        rate: "",
        label: visible.label || channel.label,
      };
      continue;
    }

    channels[channel.id] = {
      enabled: true,
      slabId,
      count: prior.count || selectedSlab.count || "",
      rate: prior.rate || (zero ? "0" : selectedSlab.rate || ""),
      label: visible.label || channel.label,
    };
  }

  const humanAgent = {
    enabled: agentAddon ? existing.humanAgent?.enabled === true : false,
    count: existing.humanAgent?.count || agentAddon?.defaultCount || "",
    rate: existing.humanAgent?.rate || (zero ? "0" : agentAddon?.defaultRate || ""),
    label: agentAddon?.label || "Agent count increase",
  };

  const queueFromLegacy =
    !existing.queueCapacity && legacyPhone.enabled === true
      ? {
          enabled: true,
          count: legacyPhone.count || "",
          rate: legacyPhone.rate || "",
          label: legacyPhone.label || "Queue capacity",
        }
      : null;

  const queueCapacity = {
    enabled: queueAddon
      ? queueFromLegacy?.enabled === true || existingQueue.enabled === true
      : false,
    count:
      existingQueue.count ||
      queueFromLegacy?.count ||
      queueAddon?.defaultCount ||
      "",
    rate:
      existingQueue.rate ||
      queueFromLegacy?.rate ||
      (zero ? "0" : queueAddon?.defaultRate || ""),
    label: existingQueue.label || queueAddon?.label || "Queue capacity",
  };

  const storage = {
    enabled:
      storageAddOn.enabled &&
      (existing.storage?.enabled === true || config.additionalStorageEnabled === true),
    count:
      existing.storage?.count ||
      config.additionalStorageCount ||
      storageAddOn.defaultCount ||
      "",
    rate:
      existing.storage?.rate ||
      config.additionalStorageRate ||
      (zero ? "0" : storageAddOn.defaultRate || ""),
    label: existing.storage?.label || storageAddOn.label || "Add-On Storage",
    unit: existing.storage?.unit || storageAddOn.unit || "GB",
  };

  return {
    active: true,
    billingMode,
    humanAgent,
    queueCapacity,
    storage,
    channels,
  };
}

export function seedCrmMidPeriodAddons(config = {}) {
  const existing = config.midPeriodAddons || {};
  const region = config.region || "India";
  const productId = config.productId || "crm";
  const product = getCatalog(region).products?.[productId] || {};
  const numberAddOn = getProductNumberAddOn(product);
  const storageAddOn = getProductStorageAddOn(product, region);
  return {
    active: true,
    billingMode: "addons-only",
    userLicense: {
      enabled: existing.userLicense?.enabled === true,
      additionalCount: existing.userLicense?.additionalCount || "",
    },
    contacts: {
      enabled:
        existing.contacts?.enabled === true ||
        config.additionalContactsEnabled === true,
      slab: existing.contacts?.slab || config.additionalContactSlab || "",
    },
    numbers: {
      enabled:
        numberAddOn.enabled &&
        (existing.numbers?.enabled === true || config.additionalNumbersEnabled === true),
      count:
        existing.numbers?.count ||
        config.additionalNumberCount ||
        numberAddOn.defaultCount ||
        "",
      rate:
        existing.numbers?.rate ||
        config.additionalNumberRate ||
        numberAddOn.defaultRate ||
        "",
      label: existing.numbers?.label || numberAddOn.label || "Additional numbers",
    },
    storage: {
      enabled:
        storageAddOn.enabled &&
        (existing.storage?.enabled === true || config.additionalStorageEnabled === true),
      count:
        existing.storage?.count ||
        config.additionalStorageCount ||
        storageAddOn.defaultCount ||
        "",
      rate:
        existing.storage?.rate ||
        config.additionalStorageRate ||
        storageAddOn.defaultRate ||
        "",
      label: existing.storage?.label || storageAddOn.label || "Add-On Storage",
      unit: existing.storage?.unit || storageAddOn.unit || "GB",
    },
  };
}

/**
 * @param {{ addonsOnly?: boolean, seedCcaas?: boolean }} options
 * - addonsOnly: mid-period lock — CRM + CCaaS bill add-ons only
 * - seedCcaas: first-purchase CCaaS — seed human agent/channels with with-core billing
 */
export function ensureMidPeriodAddons(config, { addonsOnly = false, seedCcaas = false } = {}) {
  if (!config) {
    return config;
  }

  if (addonsOnly) {
    if (config.pricingMode === "ccaas") {
      return syncCcaasNumberEntitlementFields({
        ...config,
        midPeriodAddons: seedCcaasMidPeriodAddons(config, { billingMode: "addons-only" }),
        telcoLineCharge:
          config.telcoLineCharge ??
          getContactCenterProduct(config).liveAgent?.telcoLineCharge ??
          "",
      });
    }
    if (config.pricingMode === "crm") {
      return { ...config, midPeriodAddons: seedCrmMidPeriodAddons(config) };
    }
    if (config.pricingMode === "campaign") {
      const mid = seedCrmMidPeriodAddons({ ...config, productId: "campaign" });
      return {
        ...config,
        // Campaign: messaging packs only — force number add-on off.
        midPeriodAddons: {
          ...mid,
          numbers: { enabled: false, count: "", rate: "", label: "Additional numbers" },
        },
        channelsEnabled: true,
        additionalNumbersEnabled: false,
      };
    }
    if (config.pricingMode === "value-management") {
      return {
        ...config,
        midPeriodAddons: { active: true, billingMode: "addons-only" },
      };
    }
    if (config.pricingMode === "ticketing") {
      return {
        ...config,
        midPeriodAddons: { active: true, billingMode: "addons-only" },
      };
    }
    return config;
  }

  if (seedCcaas && config.pricingMode === "ccaas") {
    return syncCcaasNumberEntitlementFields({
      ...config,
      midPeriodAddons: seedCcaasMidPeriodAddons(config, { billingMode: "with-core" }),
      telcoLineCharge:
        config.telcoLineCharge ??
        getContactCenterProduct(config).liveAgent?.telcoLineCharge ??
        "",
    });
  }

  // Leaving mid-period: convert CCaaS addons-only → with-core (keep selections); clear CRM mid-period blob
  if (
    config.midPeriodAddons?.active &&
    config.midPeriodAddons?.billingMode !== "with-core"
  ) {
    if (config.pricingMode === "ccaas") {
      const region = config.region || "India";
      const contactCenter = getCatalog(region).products?.["contact-center"] || {};
      return pruneCcaasAddonsToPlanVisibility(
        {
          ...config,
          midPeriodAddons: {
            ...config.midPeriodAddons,
            billingMode: "with-core",
            active: true,
          },
        },
        contactCenter,
      );
    }
    if (config.pricingMode === "crm") {
      return {
        ...config,
        midPeriodAddons: { ...config.midPeriodAddons, active: false },
      };
    }
    if (config.pricingMode === "campaign") {
      return {
        ...config,
        midPeriodAddons: { ...config.midPeriodAddons, active: false },
      };
    }
    if (config.pricingMode === "value-management") {
      return {
        ...config,
        midPeriodAddons: { ...config.midPeriodAddons, active: false },
      };
    }
    if (config.pricingMode === "ticketing") {
      return {
        ...config,
        midPeriodAddons: { ...config.midPeriodAddons, active: false },
      };
    }
  }

  return config;
}

/** True when quote should charge ONLY mid-period add-ons (no core package). */
export function isMidPeriodAddonBilling(config) {
  const addons = config?.midPeriodAddons;
  if (!addons?.active) {
    return false;
  }
  // Legacy mid-period blobs have active without billingMode → treat as addons-only.
  return addons.billingMode !== "with-core";
}

function getContactCenterProduct(config) {
  const region = config?.region || "India";
  return getCatalog(region).products?.["contact-center"] || {};
}

/** Per-agent telco from quote config or catalog liveAgent.telcoLineCharge. */
export function resolveTelcoLineCharge(config = {}) {
  if (config.telcoLineCharge != null && config.telcoLineCharge !== "") {
    return toNumber(config.telcoLineCharge);
  }
  const usageTelco = config.usageDetails?.telcoLineCharge;
  if (usageTelco != null && usageTelco !== "") {
    return toNumber(usageTelco);
  }
  const contactCenter = getContactCenterProduct(config);
  return toNumber(contactCenter.liveAgent?.telcoLineCharge);
}

export function sumCcaasMidPeriodAddonPrices(config) {
  const addons = config?.midPeriodAddons;
  if (!addons?.active) {
    return 0;
  }

  const contactCenter = getContactCenterProduct(config);
  const visibleIds = new Set(
    getVisiblePlanAddonChannels(config, contactCenter).map((channel) => channel.id),
  );
  const agentAddon = getPlanAgentAddon(config, contactCenter);
  const queueAddon = getPlanQueueCapacityAddon(config, contactCenter);
  const telco = resolveTelcoLineCharge(config);

  let total = 0;
  if (agentAddon && addons.humanAgent?.enabled) {
    // Mid-period agents include telco per seat (same as first-purchase agent line).
    total +=
      toNumber(addons.humanAgent.count) * (toNumber(addons.humanAgent.rate) + telco);
  }
  if (queueAddon && addons.queueCapacity?.enabled) {
    total += toNumber(addons.queueCapacity.count) * toNumber(addons.queueCapacity.rate);
  }

  const storageEnabled = addons.storage?.enabled || config.additionalStorageEnabled;
  if (storageEnabled) {
    total +=
      toNumber(addons.storage?.count || config.additionalStorageCount) *
      toNumber(addons.storage?.rate || config.additionalStorageRate);
  }

  for (const channel of CCAAS_MID_PERIOD_CHANNELS) {
    if (!visibleIds.has(channel.id)) {
      continue;
    }
    const entry = addons.channels?.[channel.id];
    if (!entry?.enabled) {
      continue;
    }
    const count = Math.max(1, toNumber(entry.count) || 1);
    total += count * toNumber(entry.rate);
  }

  return total;
}

export function sumCrmMidPeriodAddonPrices(config) {
  const addons = config?.midPeriodAddons;
  if (!addons?.active) {
    return 0;
  }

  let total = 0;
  if (addons.userLicense?.enabled) {
    total +=
      toNumber(addons.userLicense.additionalCount) *
      toNumber(config.additionalUserLicenseRate || config.userLicenseRate);
  }

  const contactsEnabled = addons.contacts?.enabled || config.additionalContactsEnabled;
  const slab = addons.contacts?.slab || config.additionalContactSlab;
  if (contactsEnabled && slab) {
    total += toNumber(
      getContactChargeSlabs(config.region, config.productId || "crm")[slab]?.monthlyPrice,
    );
  }

  // Campaign no longer bills purchased numbers (CRM hybrid still does).
  const isCampaign = (config.productId || config.pricingMode) === "campaign";
  const numbersEnabled =
    !isCampaign && (addons.numbers?.enabled || config.additionalNumbersEnabled);
  if (numbersEnabled) {
    total +=
      toNumber(addons.numbers?.count || config.additionalNumberCount) *
      toNumber(addons.numbers?.rate || config.additionalNumberRate);
  }

  const storageEnabled = addons.storage?.enabled || config.additionalStorageEnabled;
  if (storageEnabled) {
    total +=
      toNumber(addons.storage?.count || config.additionalStorageCount) *
      toNumber(addons.storage?.rate || config.additionalStorageRate);
  }

  return total;
}

export function buildCcaasMidPeriodInvoiceLines(config) {
  const addons = config?.midPeriodAddons;
  const lines = [];
  if (!addons?.active) {
    return lines;
  }

  const contactCenter = getContactCenterProduct(config);
  const visibleChannels = getVisiblePlanAddonChannels(config, contactCenter);
  const agentAddon = getPlanAgentAddon(config, contactCenter);
  const queueAddon = getPlanQueueCapacityAddon(config, contactCenter);
  const telco = resolveTelcoLineCharge(config);

  if (agentAddon && addons.humanAgent?.enabled) {
    const count = toNumber(addons.humanAgent.count);
    const seatRate = toNumber(addons.humanAgent.rate);
    const unit = seatRate + telco;
    const label = addons.humanAgent.label || agentAddon.label || "Human agent";
    const ratePart =
      telco > 0
        ? `${addons.humanAgent.rate}+${telco} telco/seat`
        : `${addons.humanAgent.rate}/seat`;
    lines.push({
      section: "Add-ons",
      label: `${label} — ${count} seat${count === 1 ? "" : "s"} @ ${ratePart}`,
      amount: count * unit,
      isAddon: true,
    });
  }

  if (queueAddon && addons.queueCapacity?.enabled) {
    const count = toNumber(addons.queueCapacity.count);
    const rate = toNumber(addons.queueCapacity.rate);
    const label = addons.queueCapacity.label || queueAddon.label || "Queue capacity";
    lines.push({
      section: "Add-ons",
      label: `${label} — ${count} @ ${addons.queueCapacity.rate}`,
      amount: count * rate,
      isAddon: true,
    });
  }

  const storageEnabled = addons.storage?.enabled || config.additionalStorageEnabled;
  const storageCount = toNumber(addons.storage?.count || config.additionalStorageCount);
  const storageRateLabel = addons.storage?.rate || config.additionalStorageRate;
  if (storageEnabled && storageCount > 0) {
    const label = addons.storage?.label || "Add-On Storage";
    const unit = addons.storage?.unit || "GB";
    lines.push({
      section: "Add-ons",
      label: `${label} — ${storageCount} ${unit} @ ${storageRateLabel}/${unit}`,
      amount: storageCount * toNumber(storageRateLabel),
      isAddon: true,
    });
  }

  for (const channel of visibleChannels) {
    const entry = addons.channels?.[channel.id];
    if (!entry?.enabled) {
      continue;
    }
    const count = Math.max(1, toNumber(entry.count) || 1);
    const rate = toNumber(entry.rate);
    const channelLabel = entry.label || channel.label;
    lines.push({
      section: "Add-ons",
      label: `${channelLabel} channel${entry.count ? ` × ${entry.count}` : ""} @ ${entry.rate}`,
      amount: count * rate,
      isAddon: true,
    });
  }

  return lines;
}

export function buildCrmMidPeriodInvoiceLines(config) {
  const addons = config?.midPeriodAddons;
  const lines = [];
  if (!addons?.active) {
    return lines;
  }

  if (addons.userLicense?.enabled) {
    const count = toNumber(addons.userLicense.additionalCount);
    const rateLabel = config.additionalUserLicenseRate || config.userLicenseRate;
    const rate = toNumber(rateLabel);
    lines.push({
      section: "Add-ons",
      label: `Additional user licenses — ${count} @ ${rateLabel}/user`,
      amount: count * rate,
      isAddon: true,
    });
  }

  const contactsEnabled = addons.contacts?.enabled || config.additionalContactsEnabled;
  const slab = addons.contacts?.slab || config.additionalContactSlab;
  if (contactsEnabled && slab) {
    lines.push({
      section: "Add-ons",
      label: `Additional contacts slab (${slab})`,
      amount: toNumber(
        getContactChargeSlabs(config.region, config.productId || "crm")[slab]?.monthlyPrice,
      ),
      isAddon: true,
    });
  }

  const isCampaign = (config.productId || config.pricingMode) === "campaign";
  const numbersEnabled =
    !isCampaign && (addons.numbers?.enabled || config.additionalNumbersEnabled);
  const numberCount = toNumber(addons.numbers?.count || config.additionalNumberCount);
  const numberRateLabel = addons.numbers?.rate || config.additionalNumberRate;
  if (numbersEnabled && numberCount > 0) {
    const label = addons.numbers?.label || "Additional numbers";
    lines.push({
      section: "Add-ons",
      label: `${label} — ${numberCount} number${numberCount === 1 ? "" : "s"} @ ${numberRateLabel}/number`,
      amount: numberCount * toNumber(numberRateLabel),
      isAddon: true,
    });
  }

  const storageEnabled = addons.storage?.enabled || config.additionalStorageEnabled;
  const storageCount = toNumber(addons.storage?.count || config.additionalStorageCount);
  const storageRateLabel = addons.storage?.rate || config.additionalStorageRate;
  if (storageEnabled && storageCount > 0) {
    const label = addons.storage?.label || "Add-On Storage";
    const unit = addons.storage?.unit || "GB";
    lines.push({
      section: "Add-ons",
      label: `${label} — ${storageCount} ${unit} @ ${storageRateLabel}/${unit}`,
      amount: storageCount * toNumber(storageRateLabel),
      isAddon: true,
    });
  }

  return lines;
}

export function hasAnyMidPeriodAddonSelected(config) {
  const addons = config?.midPeriodAddons;
  if (!addons?.active) {
    return false;
  }

  if (config.pricingMode === "ccaas") {
    const contactCenter = getContactCenterProduct(config);
    const agentAddon = getPlanAgentAddon(config, contactCenter);
    const queueAddon = getPlanQueueCapacityAddon(config, contactCenter);
    if (agentAddon && addons.humanAgent?.enabled && toNumber(addons.humanAgent.count) > 0) {
      return true;
    }
    if (queueAddon && addons.queueCapacity?.enabled && toNumber(addons.queueCapacity.count) > 0) {
      return true;
    }
    const storageEnabled = addons.storage?.enabled || config.additionalStorageEnabled;
    if (storageEnabled && toNumber(addons.storage?.count || config.additionalStorageCount) > 0) {
      return true;
    }
    return getVisiblePlanAddonChannels(config, contactCenter).some(
      (channel) => addons.channels?.[channel.id]?.enabled,
    );
  }

  if (config.pricingMode === "crm" || config.pricingMode === "campaign") {
    if (addons.userLicense?.enabled && toNumber(addons.userLicense.additionalCount) > 0) {
      return true;
    }
    const contactsEnabled = addons.contacts?.enabled || config.additionalContactsEnabled;
    const slab = addons.contacts?.slab || config.additionalContactSlab;
    if (contactsEnabled && slab) {
      return true;
    }
    const isCampaign = config.pricingMode === "campaign";
    const numbersEnabled =
      !isCampaign && (addons.numbers?.enabled || config.additionalNumbersEnabled);
    if (numbersEnabled && toNumber(addons.numbers?.count || config.additionalNumberCount) > 0) {
      return true;
    }
    const storageEnabled = addons.storage?.enabled || config.additionalStorageEnabled;
    if (storageEnabled && toNumber(addons.storage?.count || config.additionalStorageCount) > 0) {
      return true;
    }
    return false;
  }

  return false;
}

export { isChannelVisibleForConfig, pruneCcaasAddonsToPlanVisibility };
