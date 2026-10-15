import { isModuleBillable } from "./ccaasModules.js";
import {
  CONFIGURATION_DEFAULT_SLAB_KEY,
  DIGITAL_CHANNEL_OPTION_TO_ADDON_CHANNELS,
  getChannelSlabs,
  getPlanAddonsForPlan,
} from "./planAddons.js";

/** Digital option → configuration channel ids (purchase Configuration table). */
export const DIGITAL_CHANNEL_OPTION_CHANNELS = {
  "email-sms": ["email", "sms"],
  "web-social-email-sms": ["webChat", "whatsapp", "instagram", "facebook", "email", "sms"],
  "ai-auto-attendant-live": [
    "webChat",
    "whatsapp",
    "instagram",
    "facebook",
    "email",
    "sms",
    "agent",
    "voice",
  ],
  "autonomous-all-channels": [
    "webChat",
    "whatsapp",
    "instagram",
    "facebook",
    "email",
    "sms",
    "whatsApp",
    "agent",
    "voice",
  ],
};

export const VOICE_OPTION_CHANNELS = {
  "human-agent": ["voice", "agent"],
  "ai-auto-attendant-human": ["voice", "agent"],
  "autonomous-voice": ["voice"],
};

/**
 * Purchase-flow Configuration pricing rows.
 * Agent seats bill via Voice module × count; other rows bill on Configuration.
 */
/**
 * Purchase-flow Configuration pricing rows.
 * Agent seats bill via Voice module × count; other rows bill on Configuration.
 */
export const CCAAS_CONFIGURATION_PRICING_ROWS = [
  {
    id: "agent",
    qtyKey: "agentCount",
    rateKey: "agentRate",
    totalKey: "agentTotal",
    itemLabel: "Agent",
    rateLabel: "Rate/Agent",
    totalLabel: "Total agent price",
    addonChannelId: null,
    volumeKey: "agentCount",
    channels: ["agent"],
    billOnConfiguration: false,
    min: 1,
    alwaysWithPlan: true,
    usesTierAgentRate: true,
  },
  {
    id: "sms",
    qtyKey: "smsCount",
    rateKey: "smsRate",
    totalKey: "smsTotal",
    itemLabel: "Sms",
    rateLabel: "Rate/sms",
    totalLabel: "Total sms price",
    addonChannelId: "sms",
    volumeKey: "smsCount",
    channels: ["sms"],
    billOnConfiguration: true,
    tierVolumeKey: "smsCount",
  },
  {
    id: "email",
    qtyKey: "emailCount",
    rateKey: "emailRate",
    totalKey: "emailTotal",
    itemLabel: "Email",
    rateLabel: "Rate/email",
    totalLabel: "Total email price",
    addonChannelId: "email",
    volumeKey: "emailCount",
    channels: ["email"],
    billOnConfiguration: true,
    tierVolumeKey: "emailCount",
  },
  {
    id: "minutes",
    qtyKey: "minutesCount",
    rateKey: "minutesRate",
    totalKey: "minutesTotal",
    itemLabel: "Minutes",
    rateLabel: "Rate/minute",
    totalLabel: "Total minutes price",
    addonChannelId: "voice",
    volumeKey: "voiceBotMinutes",
    channels: ["voice", "voiceBot"],
    billOnConfiguration: true,
    tierVolumeKey: "voiceBotMinutes",
    isMinutes: true,
  },
  {
    id: "whatsapp",
    qtyKey: "whatsAppCount",
    rateKey: "whatsAppRate",
    totalKey: "whatsAppTotal",
    itemLabel: "Whatsapp",
    rateLabel: "Rate/message",
    totalLabel: "Total message price",
    addonChannelId: "whatsapp",
    volumeKey: "whatsAppCount",
    channels: ["whatsapp", "whatsApp"],
    billOnConfiguration: true,
  },
  {
    id: "instagram",
    qtyKey: "instagramCount",
    rateKey: "instagramRate",
    totalKey: "instagramTotal",
    itemLabel: "Instagram",
    rateLabel: "Rate/message",
    totalLabel: "Total message price",
    addonChannelId: "instagram",
    volumeKey: "instagramCount",
    channels: ["instagram"],
    billOnConfiguration: true,
  },
  {
    id: "facebook",
    qtyKey: "facebookCount",
    rateKey: "facebookRate",
    totalKey: "facebookTotal",
    itemLabel: "Facebook",
    rateLabel: "Rate/message",
    totalLabel: "Total message price",
    addonChannelId: "facebook",
    volumeKey: "facebookCount",
    channels: ["facebook"],
    billOnConfiguration: true,
  },
  {
    id: "webChat",
    qtyKey: "webChatCount",
    rateKey: "webChatRate",
    totalKey: "webChatTotal",
    itemLabel: "Web chat sessions",
    rateLabel: "Rate/session",
    totalLabel: "Total session price",
    addonChannelId: "chat",
    volumeKey: "webChatCount",
    channels: ["webChat", "chat"],
    billOnConfiguration: true,
  },
];

function slugifyConfigurationLabel(value: any) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toAdminConfigurationField(row: any) {
  return {
    id: row.id,
    itemLabel: row.itemLabel,
    rateLabel: row.rateLabel,
    volumeKey: row.volumeKey,
    addonChannelId: row.addonChannelId,
    usesTierAgentRate: row.usesTierAgentRate === true,
    qtyKey: row.qtyKey,
    custom: row.custom === true,
  };
}

function normalizeCustomConfigurationFeature(row: any = {}) {
  if (!row?.id || !row?.itemLabel) {
    return null;
  }

  const id = String(row.id);
  // Always derive keys from id so a bad sanitize pass cannot leave broken keys.
  const qtyKey = `${id}Count`;
  const rateKey = `${id}Rate`;
  const totalKey = `${id}Total`;
  const addonChannelId = id;

  return {
    id,
    itemLabel: String(row.itemLabel).trim(),
    rateLabel: String(row.rateLabel || "Rate/unit").trim() || "Rate/unit",
    totalLabel: String(row.totalLabel || `Total ${String(row.itemLabel).trim()} price`).trim(),
    qtyKey,
    rateKey,
    totalKey,
    volumeKey: qtyKey,
    addonChannelId,
    channels: [addonChannelId],
    billOnConfiguration: row.billOnConfiguration !== false,
    alwaysWithPlan: true,
    custom: true,
  };
}

/** Persist normalized custom Configuration features (repairs wiped labels/keys). */
export function repairContactCenterConfigurationFeatures(product: any = {}) {
  if (!product || typeof product !== "object") {
    return product;
  }
  const features = getCustomConfigurationFeatures(product);
  if (!Array.isArray(product.configurationFeatures) && features.length === 0) {
    return product;
  }
  return {
    ...product,
    configurationFeatures: features,
  };
}

/** Custom Configuration default rows stored on the contact-center product. */
export function getCustomConfigurationFeatures(contactCenter: any = {}) {
  const list = contactCenter?.configurationFeatures;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map(normalizeCustomConfigurationFeature)
    .filter((row): row is NonNullable<typeof row> => row != null);
}

/** Built-in Configuration row ids hidden by admin delete. */
export function getDisabledConfigurationFeatureIds(contactCenter: any = {}) {
  const list = contactCenter?.disabledConfigurationFeatureIds;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map(String).filter(Boolean);
}

/** Create a persisted custom Configuration feature (admin Add configuration). */
export function createCustomConfigurationFeature(itemLabel: any, rateLabel = "Rate/unit") {
  const trimmedLabel = String(itemLabel || "").trim();
  const trimmedRate = String(rateLabel || "Rate/unit").trim() || "Rate/unit";
  const slug = slugifyConfigurationLabel(trimmedLabel) || "feature";
  const id = `custom-${slug}-${Date.now()}`;

  return normalizeCustomConfigurationFeature({
    id,
    itemLabel: trimmedLabel,
    rateLabel: trimmedRate,
    qtyKey: `${id}Count`,
    rateKey: `${id}Rate`,
    totalKey: `${id}Total`,
    volumeKey: `${id}Count`,
    addonChannelId: id,
    channels: [id],
    billOnConfiguration: true,
    custom: true,
  });
}

/**
 * Admin Tiers matrix rows (same labels as purchase Configuration).
 * Bot sessions stay in legacy tier volumes only — not shown here.
 * Pass contactCenter to include admin-added custom features and skip deleted built-ins.
 */
export function getAdminConfigurationDefaultFields(contactCenter: any = null) {
  const disabled = new Set(getDisabledConfigurationFeatureIds(contactCenter));
  const builtIn = CCAAS_CONFIGURATION_PRICING_ROWS.filter((row: any) => !disabled.has(row.id)).map(
    (row: any) => toAdminConfigurationField(row),
  );
  const custom = getCustomConfigurationFeatures(contactCenter).map((row: any) =>
    toAdminConfigurationField(row),
  );
  return [...builtIn, ...custom];
}

/** Legacy usage fields (kept for older quotes / dashboards). */
export const CCAAS_USAGE_DETAIL_FIELDS = [
  { id: "agentCount", label: "Agent count", channels: ["agent"], placeholder: "1", min: 1 },
  { id: "voiceMinutes", label: "Voice minutes", channels: ["voice"], placeholder: "e.g. 3000" },
  { id: "smsCount", label: "SMS count", channels: ["sms"], placeholder: "e.g. 10000" },
  { id: "emailCount", label: "Email count", channels: ["email"], placeholder: "e.g. 5000" },
  {
    id: "botSessions",
    label: "Bot sessions",
    channels: ["bot"],
    placeholder: "e.g. 1000",
  },
  {
    id: "voiceBotMinutes",
    label: "VoiceBot minutes",
    channels: ["voiceBot"],
    placeholder: "e.g. 5000",
  },
  {
    id: "minutesCount",
    label: "Minutes",
    channels: ["voice", "voiceBot"],
    placeholder: "e.g. 3000",
  },
  {
    id: "webChatCount",
    label: "Web chat sessions",
    channels: ["webChat"],
    placeholder: "e.g. 2000",
  },
  {
    id: "socialMediaCount",
    label: "Social media messages",
    channels: ["socialMedia"],
    placeholder: "e.g. 1500",
  },
  {
    id: "whatsAppCount",
    label: "WhatsApp messages",
    channels: ["whatsApp", "whatsapp"],
    placeholder: "e.g. 2000",
  },
  {
    id: "instagramCount",
    label: "Instagram messages",
    channels: ["instagram"],
    placeholder: "e.g. 1500",
  },
  {
    id: "facebookCount",
    label: "Facebook messages",
    channels: ["facebook"],
    placeholder: "e.g. 1500",
  },
];

/** Plan-level included volumes by license tier (admin catalog defaults). */
export const CCAAS_TIER_VOLUME_FIELDS = [
  { id: "agentCount", label: "Agent count" },
  { id: "smsCount", label: "SMS message count" },
  { id: "emailCount", label: "Email count" },
  { id: "botSessions", label: "Bot sessions" },
  { id: "voiceBotMinutes", label: "Minutes count" },
  { id: "whatsAppCount", label: "WhatsApp message count" },
  { id: "instagramCount", label: "Instagram message count" },
  { id: "facebookCount", label: "Facebook message count" },
  { id: "webChatCount", label: "Web chat session count" },
];

export function buildDefaultTierDefaultVolumes() {
  return {
    starter: {
      agentCount: "1",
      smsCount: "500",
      emailCount: "5000",
      botSessions: "0",
      voiceBotMinutes: "0",
      whatsAppCount: "0",
      instagramCount: "0",
      facebookCount: "0",
      webChatCount: "0",
    },
    growth: {
      agentCount: "1",
      smsCount: "1000",
      emailCount: "10000",
      botSessions: "1000",
      voiceBotMinutes: "0",
      whatsAppCount: "0",
      instagramCount: "0",
      facebookCount: "0",
      webChatCount: "0",
    },
    pro: {
      agentCount: "1",
      smsCount: "2000",
      emailCount: "20000",
      botSessions: "2500",
      voiceBotMinutes: "5000",
      whatsAppCount: "0",
      instagramCount: "0",
      facebookCount: "0",
      webChatCount: "0",
    },
    enterprise: {
      agentCount: "custom",
      smsCount: "custom",
      emailCount: "custom",
      botSessions: "custom",
      voiceBotMinutes: "custom",
      whatsAppCount: "custom",
      instagramCount: "custom",
      facebookCount: "custom",
      webChatCount: "custom",
    },
  };
}

export function isTierVolumeMetricAvailable(rawValue: any) {
  if (rawValue == null || rawValue === "" || rawValue === "custom") {
    return rawValue === "custom";
  }

  return Number(String(rawValue).replace(/,/g, "")) > 0;
}

export function formatTierVolumeAdminValue(rawValue: any) {
  if (rawValue === "custom") {
    return "Custom";
  }

  if (rawValue === "0") {
    return "0 (Not available)";
  }

  return rawValue ?? "";
}

function parseMoneyNumber(value: any) {
  if (value == null || value === "") {
    return NaN;
  }
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function formatMoneyNumber(value: any) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const rounded = Math.round(value * 10000) / 10000;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded);
}

export function applyTierDefaultVolumes(usageDetails: any, licenseTier: any, tierDefaultVolumes: any) {
  const tierVolumes = tierDefaultVolumes?.[licenseTier];
  if (!tierVolumes) {
    return usageDetails || createDefaultUsageDetails();
  }

  const next = { ...(usageDetails || createDefaultUsageDetails()) };

  for (const field of CCAAS_TIER_VOLUME_FIELDS) {
    const raw = tierVolumes[field.id];

    if (raw === "custom" || raw == null || raw === "") {
      if (field.id !== "agentCount") {
        next[field.id] = next[field.id] ?? "";
      }
      continue;
    }

    const planVolume = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(planVolume) || planVolume <= 0) {
      if (field.id === "agentCount") {
        continue;
      }
      next[field.id] = "0";
      continue;
    }

    next[field.id] = String(planVolume);
  }

  // Singular Minutes qty: map voiceBotMinutes tier default.
  const voiceBotRaw = tierVolumes.voiceBotMinutes;
  if (voiceBotRaw != null && voiceBotRaw !== "" && voiceBotRaw !== "custom") {
    const planVolume = Number(String(voiceBotRaw).replace(/,/g, ""));
    if (Number.isFinite(planVolume) && planVolume > 0) {
      next.minutesCount = String(planVolume);
    } else if (voiceBotRaw === "0") {
      next.minutesCount = next.minutesCount || "0";
    }
  }

  return next;
}

function pickDefaultOrFirstSlab(slabs: any = []) {
  if (!slabs.length) {
    return null;
  }
  return (
    slabs.find((slab: any) => slab.id === CONFIGURATION_DEFAULT_SLAB_KEY) ||
    slabs.find((slab: any) => parseMoneyNumber(slab.rate) > 0) ||
    slabs.find((slab: any) => parseMoneyNumber(slab.count) > 0) ||
    slabs[0]
  );
}

/** Read admin default qty for a Configuration row (Tiers volume, else default slab). */
export function getAdminConfigurationDefaultQty(contactCenter: any, planId: any, row: any) {
  const volumeKey = row?.volumeKey;
  if (volumeKey) {
    const fromTier = contactCenter?.tierDefaultVolumes?.[planId]?.[volumeKey];
    if (fromTier != null && fromTier !== "") {
      return String(fromTier);
    }
  }

  if (row?.id === "agent") {
    return "1";
  }

  if (!row?.addonChannelId) {
    return "";
  }

  const slab = pickDefaultOrFirstSlab(getChannelSlabs(contactCenter, planId, row.addonChannelId));
  return slab?.count != null && slab.count !== "" ? String(slab.count) : "";
}

/** Read admin default rate for a Configuration row (tierAgentRates or default slab). */
export function getAdminConfigurationDefaultRate(contactCenter: any, planId: any, row: any) {
  if (row?.usesTierAgentRate || row?.id === "agent") {
    const tierRate = contactCenter?.tierAgentRates?.[planId];
    if (tierRate != null && tierRate !== "") {
      return String(tierRate);
    }
    const monthly = contactCenter?.licenseTiers?.[planId]?.monthlyPerUser;
    return monthly != null ? String(monthly) : "";
  }

  if (!row?.addonChannelId) {
    return "";
  }

  const slab = pickDefaultOrFirstSlab(getChannelSlabs(contactCenter, planId, row.addonChannelId));
  return slab?.rate != null && slab.rate !== "" ? String(slab.rate) : "";
}

export const CCAAS_MULTILINGUAL_ADDON_OPTIONS = [
  { id: "none", label: "Not included" },
  { id: "addon", label: "Multilingual add-on" },
];

export function getActiveConfigurationChannels(modulesConfig: any = {}) {
  const channels = new Set();

  const digitalSelection = modulesConfig.digitalChannels;
  if (isModuleBillable(digitalSelection)) {
    const optionChannels = (DIGITAL_CHANNEL_OPTION_CHANNELS as Record<string, any>)[digitalSelection.optionId] || [];
    optionChannels.forEach((channel: any) => channels.add(channel));

    const addonChannels = (DIGITAL_CHANNEL_OPTION_TO_ADDON_CHANNELS as Record<string, any>)[digitalSelection.optionId] || [];
    for (const addonId of addonChannels) {
      if (addonId === "chat") {
        channels.add("webChat");
        channels.add("chat");
      } else if (addonId === "voice") {
        channels.add("voice");
      } else {
        channels.add(addonId);
      }
    }
  }

  const voiceSelection = modulesConfig.voice;
  if (isModuleBillable(voiceSelection)) {
    const optionChannels = (VOICE_OPTION_CHANNELS as Record<string, any>)[voiceSelection.optionId] || [];
    optionChannels.forEach((channel: any) => channels.add(channel));
  }

  return channels;
}

export function getVisibleUsageDetailFields(modulesConfig: any = {}) {
  const activeChannels = getActiveConfigurationChannels(modulesConfig);

  return CCAAS_USAGE_DETAIL_FIELDS.filter((field: any) =>
    field.channels.some((channel: any) => activeChannels.has(channel)),
  );
}

export function getTierVolumeConfigurationFields(licenseTier: any, tierDefaultVolumes: any) {
  if (!licenseTier) {
    return [];
  }

  const tierVolumes = tierDefaultVolumes?.[licenseTier];
  if (!tierVolumes) {
    return [];
  }

  return CCAAS_TIER_VOLUME_FIELDS.filter((field: any) => {
    const raw = tierVolumes[field.id];
    return raw != null && raw !== "0";
  }).map((field: any) => ({
    id: field.id,
    label: field.label,
    placeholder: tierVolumes[field.id] === "custom" ? "Custom volume" : "e.g. 1000",
    min: 0,
  }));
}

export function isEnterpriseConfigurationTier(licenseTier: any) {
  return licenseTier === "enterprise";
}

export function isConfigurationFieldEditable(fieldId: any, licenseTier: any) {
  if (fieldId === "agentCount") {
    return true;
  }

  return isEnterpriseConfigurationTier(licenseTier);
}

export function formatConfigurationDisplayValue(usageDetails: any, fieldId: any) {
  const raw = getUsageDetailDisplayValue(usageDetails, fieldId);
  if (raw === "" || raw == null) {
    return "—";
  }

  const numeric = Number(String(raw).replace(/,/g, ""));
  if (Number.isFinite(numeric)) {
    return numeric.toLocaleString();
  }

  return raw;
}

function tierVolumeShowsRow(row: any, licenseTier: any, tierDefaultVolumes: any) {
  if (!row.tierVolumeKey || !licenseTier) {
    return false;
  }
  const raw = tierDefaultVolumes?.[licenseTier]?.[row.tierVolumeKey];
  return raw != null && raw !== "" && raw !== "0";
}

/**
 * Visible purchase Configuration pricing rows for the current plan / modules.
 * Pass contactCenter (4th arg) to include admin-added custom features.
 */
export function getCcaasConfigurationPricingRows(
  modulesConfig: any = {},
  licenseTier: any = "",
  tierDefaultVolumes: any = {},
  contactCenter: any = null,
) {
  if (!licenseTier) {
    return [];
  }

  const activeChannels = getActiveConfigurationChannels(modulesConfig);
  const disabled = new Set(getDisabledConfigurationFeatureIds(contactCenter));

  const builtIn = CCAAS_CONFIGURATION_PRICING_ROWS.filter((row: any) => {
    if (disabled.has(row.id)) {
      return false;
    }

    if (row.alwaysWithPlan) {
      return true;
    }

    if (row.isMinutes) {
      if (row.channels.some((channel: any) => activeChannels.has(channel))) {
        return true;
      }
      return tierVolumeShowsRow(row, licenseTier, tierDefaultVolumes);
    }

    if (row.channels.some((channel: any) => activeChannels.has(channel))) {
      return true;
    }

    return tierVolumeShowsRow(row, licenseTier, tierDefaultVolumes);
  });

  const custom = getCustomConfigurationFeatures(contactCenter);
  return [...builtIn, ...custom];
}

/** @deprecated Prefer getCcaasConfigurationPricingRows for purchase UI. */
export function getCcaasConfigurationFields(modulesConfig: any = {}, licenseTier: any = "", tierDefaultVolumes: any = {}) {
  return getCcaasConfigurationPricingRows(modulesConfig, licenseTier, tierDefaultVolumes).map(
    (row: any) => ({
      id: row.qtyKey,
      label: row.itemLabel,
      readOnly: false,
      min: row.min ?? 0,
      placeholder: row.min === 1 ? "1" : "e.g. 1000",
      rateKey: row.rateKey,
      totalKey: row.totalKey,
      rateLabel: row.rateLabel,
      totalLabel: row.totalLabel,
      billOnConfiguration: row.billOnConfiguration,
      rowId: row.id,
    }),
  );
}

export function getConfigurationSummary(modulesConfig: any = {}, licenseTier: any = "", tierDefaultVolumes: any = {}) {
  const rows = getCcaasConfigurationPricingRows(modulesConfig, licenseTier, tierDefaultVolumes);
  if (!licenseTier) {
    return "Select a plan above to configure agent count, rates, and usage volumes.";
  }

  if (rows.length === 0) {
    return "No configuration rows for the current module selection.";
  }

  return "Set qty, rate, and totals for each configuration row.";
}

function defaultQtyKeys() {
  const keys = new Set(["agentCount"]);
  for (const row of CCAAS_CONFIGURATION_PRICING_ROWS) {
    keys.add(row.qtyKey);
    keys.add(row.rateKey);
    keys.add(row.totalKey);
  }
  for (const field of CCAAS_USAGE_DETAIL_FIELDS) {
    keys.add(field.id);
  }
  return [...keys];
}

export function createDefaultUsageDetails() {
  const details: Record<string, any> = {};
  for (const key of defaultQtyKeys()) {
    details[key] = key === "agentCount" ? "1" : "";
  }
  return details;
}

export function normalizeUsageDetailValue(fieldId: any, value: any) {
  if (fieldId !== "agentCount") {
    return value;
  }

  const parsed = Math.floor(Number(String(value ?? "").replace(/,/g, "")));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return "1";
  }

  return String(parsed);
}

export function getUsageDetailDisplayValue(usageDetails: any, fieldId: any) {
  const raw = usageDetails?.[fieldId];
  if (fieldId === "agentCount") {
    return normalizeUsageDetailValue(fieldId, raw || "1");
  }

  return raw ?? "";
}

/**
 * Last-wins bidirectional math for a configuration line.
 * @param {"qty"|"rate"|"total"} edited
 */
export function recalculateConfigurationLine({ qty, rate, total, edited }: any) {
  let nextQty = qty ?? "";
  let nextRate = rate ?? "";
  let nextTotal = total ?? "";

  const q = parseMoneyNumber(nextQty);
  const r = parseMoneyNumber(nextRate);
  const t = parseMoneyNumber(nextTotal);

  if (edited === "qty" || edited === "rate") {
    if (Number.isFinite(q) && Number.isFinite(r)) {
      nextTotal = formatMoneyNumber(q * r);
    }
    return { qty: nextQty, rate: nextRate, total: nextTotal };
  }

  if (edited === "total") {
    if (Number.isFinite(t) && Number.isFinite(q) && q !== 0) {
      nextRate = formatMoneyNumber(t / q);
    } else if (Number.isFinite(t) && Number.isFinite(r) && r !== 0) {
      nextQty = formatMoneyNumber(t / r);
    }
    return { qty: nextQty, rate: nextRate, total: nextTotal };
  }

  return { qty: nextQty, rate: nextRate, total: nextTotal };
}

function resolveAgentSeatRate(contactCenter: any, planId: any) {
  if (!planId || !contactCenter) {
    return "";
  }

  const tierRate = String(contactCenter.tierAgentRates?.[planId] ?? "").trim();
  if (tierRate && tierRate.toLowerCase() !== "custom") {
    return tierRate;
  }

  const monthly = String(contactCenter.licenseTiers?.[planId]?.monthlyPerUser ?? "").trim();
  return monthly;
}

function resolveAddonChannelDefaultRate(contactCenter: any, planId: any, channelId: any) {
  if (!channelId || !planId) {
    return "";
  }

  const slabs = getChannelSlabs(contactCenter, planId, channelId);
  const picked = pickDefaultOrFirstSlab(slabs);
  if (picked?.rate != null && picked.rate !== "") {
    return String(picked.rate);
  }

  const planAddons = getPlanAddonsForPlan(contactCenter, planId);
  const entry = planAddons.channels?.[channelId];
  if (entry?.defaultRate != null && entry.defaultRate !== "") {
    return String(entry.defaultRate);
  }

  return "";
}

function resolveAddonChannelDefaultCount(contactCenter: any, planId: any, channelId: any) {
  if (!channelId || !planId) {
    return "";
  }

  const slabs = getChannelSlabs(contactCenter, planId, channelId);
  const picked = pickDefaultOrFirstSlab(slabs);
  if (picked && parseMoneyNumber(picked.count) > 0) {
    return String(picked.count);
  }

  return "";
}

/**
 * Seed empty qty/rate/total from catalog. Does not overwrite non-empty sales values.
 * When zeroRates (Temporary Lead), leave qty blank and rates at "0" — no catalog volumes.
 */
export function seedConfigurationPricingFromCatalog(
  usageDetails: any,
  {
    licenseTier = "",
    modulesConfig = {},
    catalog = null,
    region = "India",
    tierDefaultVolumes = null,
    zeroRates = false,
  }: any = {},
) {
  const next = { ...(usageDetails || createDefaultUsageDetails()) };
  if (!licenseTier || !catalog) {
    return next;
  }

  const contactCenter =
    catalog?.regionPricing?.[region]?.products?.["contact-center"] ||
    catalog?.products?.["contact-center"] ||
    {};
  const volumes = tierDefaultVolumes || contactCenter.tierDefaultVolumes || {};

  // Row discovery still uses catalog volumes so Configuration fields appear;
  // Temporary Lead must not copy those volumes or rates into the form.
  if (zeroRates) {
    for (const field of CCAAS_TIER_VOLUME_FIELDS) {
      next[field.id] = "";
    }
    next.minutesCount = "";
    next.voiceMinutes = "";
  } else {
    const withTier = applyTierDefaultVolumes(next, licenseTier, volumes);
    Object.assign(next, withTier);
  }

  const rows = getCcaasConfigurationPricingRows(
    modulesConfig,
    licenseTier,
    volumes,
    contactCenter,
  );

  const tierVolumes = volumes?.[licenseTier] || {};

  for (const row of rows) {
    if (!row) {
      continue;
    }
    if (zeroRates) {
      if (row.qtyKey) next[row.qtyKey] = "";
      if (row.rateKey) next[row.rateKey] = "0";
      if (row.totalKey) next[row.totalKey] = "";
      continue;
    }

    if (row.qtyKey === "agentCount") {
      const fromTier = tierVolumes.agentCount;
      if (fromTier != null && fromTier !== "" && fromTier !== "custom") {
        const planVolume = Number(String(fromTier).replace(/,/g, ""));
        if (Number.isFinite(planVolume) && planVolume >= 1) {
          next.agentCount = String(Math.floor(planVolume));
        }
      }
      if (!next.agentCount) {
        next.agentCount = "1";
      }
    } else if (next[row.qtyKey] == null || next[row.qtyKey] === "") {
      const volumeKey =
        row.volumeKey || ("tierVolumeKey" in row ? (row as { tierVolumeKey?: string }).tierVolumeKey : "");
      const fromTier = volumeKey ? tierVolumes[volumeKey] : null;
      if (fromTier != null && fromTier !== "" && fromTier !== "custom" && fromTier !== "0") {
        const planVolume = Number(String(fromTier).replace(/,/g, ""));
        if (Number.isFinite(planVolume) && planVolume > 0) {
          next[row.qtyKey] = String(planVolume);
        }
      } else {
        const fromAddon = resolveAddonChannelDefaultCount(
          contactCenter,
          licenseTier,
          row.addonChannelId,
        );
        if (fromAddon) {
          next[row.qtyKey] = fromAddon;
        }
      }
    }

    if (next[row.rateKey] == null || next[row.rateKey] === "") {
      if (row.id === "agent") {
        next[row.rateKey] = resolveAgentSeatRate(contactCenter, licenseTier);
      } else {
        next[row.rateKey] = resolveAddonChannelDefaultRate(
          contactCenter,
          licenseTier,
          row.addonChannelId,
        );
      }
    }

    const q = parseMoneyNumber(next[row.qtyKey]);
    const r = parseMoneyNumber(next[row.rateKey]);
    if (
      (next[row.totalKey] == null || next[row.totalKey] === "") &&
      Number.isFinite(q) &&
      Number.isFinite(r)
    ) {
      next[row.totalKey] = formatMoneyNumber(q * r);
    }
  }

  return next;
}

/**
 * Apply an edit to one cell of a configuration pricing row.
 */
export function applyConfigurationPricingEdit(usageDetails: any, row: any, editedField: any, value: any) {
  const current = { ...(usageDetails || createDefaultUsageDetails()) };
  let qty = current[row.qtyKey] ?? "";
  let rate = current[row.rateKey] ?? "";
  let total = current[row.totalKey] ?? "";

  if (editedField === "qty") {
    qty =
      row.qtyKey === "agentCount" ? normalizeUsageDetailValue("agentCount", value) : String(value ?? "");
  } else if (editedField === "rate") {
    rate = String(value ?? "");
  } else if (editedField === "total") {
    total = String(value ?? "");
  }

  const recalculated = recalculateConfigurationLine({
    qty,
    rate,
    total,
    edited: editedField,
  });

  current[row.qtyKey] =
    row.qtyKey === "agentCount"
      ? normalizeUsageDetailValue("agentCount", recalculated.qty)
      : recalculated.qty;
  current[row.rateKey] = recalculated.rate;
  current[row.totalKey] = recalculated.total;

  // Keep legacy voiceBotMinutes in sync with singular Minutes for older consumers.
  if (row.isMinutes) {
    current.voiceBotMinutes = current.minutesCount;
    current.voiceMinutes = current.minutesCount;
  }

  return current;
}

export function getConfigurationLineAmount(usageDetails: any, row: any) {
  if (!row?.billOnConfiguration) {
    return 0;
  }

  const total = parseMoneyNumber(usageDetails?.[row.totalKey]);
  if (Number.isFinite(total)) {
    return total;
  }

  const qty = parseMoneyNumber(usageDetails?.[row.qtyKey]);
  const rate = parseMoneyNumber(usageDetails?.[row.rateKey]);
  if (Number.isFinite(qty) && Number.isFinite(rate)) {
    return qty * rate;
  }

  return 0;
}

export function createDefaultCcaasAddons() {
  return {
    sessionBundle: "none",
    sessionCount: "",
    sessionPrice: "0",
    multilingualOption: "none",
    multilingualPrice: "0",
  };
}

export function getMultilingualCatalogPrice(catalog: any, region: any = "India") {
  return (
    catalog?.products?.["contact-center"]?.modules?.multilingual?.addon?.monthlyPrice ?? "0"
  );
}

export function sumCcaasAddonPrices(config: any) {
  const addons = config.addons || createDefaultCcaasAddons();
  let total = 0;

  if (addons.sessionBundle && addons.sessionBundle !== "none") {
    total += Number(addons.sessionPrice) || 0;
  }

  if (addons.multilingualOption === "addon") {
    total += Number(addons.multilingualPrice) || 0;
  }

  return total;
}

export function formatSessionBundleLabel(bundleKey: any, bundleDefaults: any) {
  if (!bundleDefaults) {
    return `${bundleKey} sessions`;
  }

  return `${Number(bundleKey).toLocaleString()} sessions — ${Number(bundleDefaults.monthlyPrice).toLocaleString()}`;
}

function toEntitlementCount(value: any) {
  const parsed = Math.floor(Number(String(value ?? "").replace(/,/g, "")));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Resolve CCaaS agent / included-number / queue-capacity entitlement counts.
 * includedNumberCount always equals agentCount (1 DID per agent).
 * totalNumberEntitlement = agentCount + queueCapacityCount.
 */
export function resolveCcaasNumberEntitlementCounts(config: any = {}) {
  const usageDetails = config.usageDetails || {};
  let agentCount = toEntitlementCount(usageDetails.agentCount);

  const humanAgent = config.midPeriodAddons?.humanAgent;
  if (humanAgent?.enabled === true) {
    agentCount += toEntitlementCount(humanAgent.count);
  }

  const queue =
    config.midPeriodAddons?.queueCapacity ||
    // Legacy mid-period phoneNumbers SKU → treat as queue capacity for entitlement.
    config.midPeriodAddons?.phoneNumbers;
  let queueCapacityCount = 0;
  if (queue?.enabled === true) {
    queueCapacityCount = toEntitlementCount(queue.count);
  } else {
    queueCapacityCount = toEntitlementCount(
      config.queueCapacityCount ?? usageDetails.queueCapacityCount,
    );
  }

  const includedNumberCount = agentCount;
  const totalNumberEntitlement = agentCount + queueCapacityCount;

  return {
    agentCount,
    includedNumberCount,
    queueCapacityCount,
    queueCapacityRate:
      queue?.rate ?? config.queueCapacityRate ?? usageDetails.queueCapacityRate ?? "",
    queueCapacityEnabled: queueCapacityCount > 0 || queue?.enabled === true,
    totalNumberEntitlement,
  };
}

/**
 * Stamp includedNumberCount / queueCapacity* / totalNumberEntitlement onto config
 * (and mirror includedNumberCount into usageDetails) whenever agents or queue change.
 */
export function syncCcaasNumberEntitlementFields(config: any = {}) {
  if (!config || config.pricingMode !== "ccaas") {
    return config;
  }

  const counts = resolveCcaasNumberEntitlementCounts(config);
  const usageDetails = {
    ...(config.usageDetails || createDefaultUsageDetails()),
    includedNumberCount: String(counts.includedNumberCount || ""),
  };

  return {
    ...config,
    usageDetails,
    includedNumberCount: counts.includedNumberCount,
    queueCapacityCount: counts.queueCapacityCount,
    queueCapacityRate: counts.queueCapacityRate,
    queueCapacityEnabled: counts.queueCapacityEnabled,
    totalNumberEntitlement: counts.totalNumberEntitlement,
  };
}
