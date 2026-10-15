import { isModuleBillable } from "./ccaasModules.js";

export const DIGITAL_CHANNEL_OPTION_CHANNELS = {
  "email-sms": ["email", "sms"],
  "web-social-email-sms": ["webChat", "socialMedia", "email", "sms"],
  "ai-auto-attendant-live": ["webChat", "socialMedia", "email", "sms", "agent"],
  "autonomous-all-channels": ["webChat", "socialMedia", "email", "sms", "whatsApp", "agent"],
};

export const VOICE_OPTION_CHANNELS = {
  "human-agent": ["voice", "agent"],
  "ai-auto-attendant-human": ["voice", "agent"],
  "autonomous-voice": ["voice"],
};

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
    channels: ["whatsApp"],
    placeholder: "e.g. 2000",
  },
];

/** Per-user/month included volumes by license tier (admin catalog defaults). */
export const CCAAS_TIER_VOLUME_FIELDS = [
  { id: "smsCount", label: "SMS message count" },
  { id: "emailCount", label: "Email count" },
  { id: "botSessions", label: "Bot sessions" },
  { id: "voiceBotMinutes", label: "VoiceBot minutes count" },
];

export function buildDefaultTierDefaultVolumes() {
  return {
    starter: {
      smsCount: "500",
      emailCount: "5000",
      botSessions: "0",
      voiceBotMinutes: "0",
    },
    growth: {
      smsCount: "1000",
      emailCount: "10000",
      botSessions: "1000",
      voiceBotMinutes: "0",
    },
    pro: {
      smsCount: "2000",
      emailCount: "20000",
      botSessions: "2500",
      voiceBotMinutes: "5000",
    },
    enterprise: {
      smsCount: "custom",
      emailCount: "custom",
      botSessions: "custom",
      voiceBotMinutes: "custom",
    },
  };
}

export function isTierVolumeMetricAvailable(rawValue) {
  if (rawValue == null || rawValue === "" || rawValue === "custom") {
    return rawValue === "custom";
  }

  return Number(String(rawValue).replace(/,/g, "")) > 0;
}

export function formatTierVolumeAdminValue(rawValue) {
  if (rawValue === "custom") {
    return "Custom";
  }

  if (rawValue === "0") {
    return "0 (Not available)";
  }

  return rawValue ?? "";
}

export function applyTierDefaultVolumes(usageDetails, licenseTier, tierDefaultVolumes) {
  const tierVolumes = tierDefaultVolumes?.[licenseTier];
  if (!tierVolumes) {
    return usageDetails || createDefaultUsageDetails();
  }

  const agentCount = Math.max(1, Number(usageDetails?.agentCount) || 1);
  const next = { ...(usageDetails || createDefaultUsageDetails()) };

  for (const field of CCAAS_TIER_VOLUME_FIELDS) {
    const raw = tierVolumes[field.id];

    if (raw === "custom" || raw == null || raw === "") {
      next[field.id] = "";
      continue;
    }

    const perUser = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(perUser) || perUser <= 0) {
      next[field.id] = "0";
      continue;
    }

    next[field.id] = String(perUser * agentCount);
  }

  return next;
}

export const CCAAS_MULTILINGUAL_ADDON_OPTIONS = [
  { id: "none", label: "Not included" },
  { id: "addon", label: "Multilingual add-on" },
];

export function getActiveConfigurationChannels(modulesConfig = {}) {
  const channels = new Set();

  const digitalSelection = modulesConfig.digitalChannels;
  if (isModuleBillable(digitalSelection)) {
    const optionChannels = DIGITAL_CHANNEL_OPTION_CHANNELS[digitalSelection.optionId] || [];
    optionChannels.forEach((channel) => channels.add(channel));
  }

  const voiceSelection = modulesConfig.voice;
  if (isModuleBillable(voiceSelection)) {
    const optionChannels = VOICE_OPTION_CHANNELS[voiceSelection.optionId] || [];
    optionChannels.forEach((channel) => channels.add(channel));
  }

  return channels;
}

export function getVisibleUsageDetailFields(modulesConfig = {}) {
  const activeChannels = getActiveConfigurationChannels(modulesConfig);

  return CCAAS_USAGE_DETAIL_FIELDS.filter((field) =>
    field.channels.some((channel) => activeChannels.has(channel)),
  );
}

export function getTierVolumeConfigurationFields(licenseTier, tierDefaultVolumes) {
  if (!licenseTier) {
    return [];
  }

  const tierVolumes = tierDefaultVolumes?.[licenseTier];
  if (!tierVolumes) {
    return [];
  }

  return CCAAS_TIER_VOLUME_FIELDS.filter((field) => {
    const raw = tierVolumes[field.id];
    return raw != null && raw !== "0";
  }).map((field) => ({
    id: field.id,
    label: field.label,
    placeholder: tierVolumes[field.id] === "custom" ? "Custom volume" : "e.g. 1000",
    min: 0,
  }));
}

export function getCcaasConfigurationFields(modulesConfig = {}, licenseTier = "", tierDefaultVolumes = {}) {
  const channelFields = getVisibleUsageDetailFields(modulesConfig).filter(
    (field) => field.id !== "agentCount",
  );
  const tierFields = getTierVolumeConfigurationFields(licenseTier, tierDefaultVolumes);
  const seen = new Set(channelFields.map((field) => field.id));

  return [
    ...channelFields,
    ...tierFields.filter((field) => !seen.has(field.id)),
  ];
}

export function getConfigurationSummary(modulesConfig = {}, licenseTier = "", tierDefaultVolumes = {}) {
  const fields = getCcaasConfigurationFields(modulesConfig, licenseTier, tierDefaultVolumes);
  if (fields.length === 0) {
    return "No usage counts required for the current module selection.";
  }

  return `Collect counts for ${fields.map((field) => field.label.toLowerCase()).join(", ")}.`;
}

export function createDefaultUsageDetails() {
  return Object.fromEntries(
    CCAAS_USAGE_DETAIL_FIELDS.map((field) => [field.id, field.id === "agentCount" ? "1" : ""]),
  );
}

export function normalizeUsageDetailValue(fieldId, value) {
  if (fieldId !== "agentCount") {
    return value;
  }

  const parsed = Math.floor(Number(String(value ?? "").replace(/,/g, "")));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return "1";
  }

  return String(parsed);
}

export function getUsageDetailDisplayValue(usageDetails, fieldId) {
  const raw = usageDetails?.[fieldId];
  if (fieldId === "agentCount") {
    return normalizeUsageDetailValue(fieldId, raw || "1");
  }

  return raw ?? "";
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

export function getMultilingualCatalogPrice(catalog, region = "India") {
  return (
    catalog?.products?.["contact-center"]?.modules?.multilingual?.addon?.monthlyPrice ?? "0"
  );
}

export function sumCcaasAddonPrices(config) {
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

export function formatSessionBundleLabel(bundleKey, bundleDefaults) {
  if (!bundleDefaults) {
    return `${bundleKey} sessions`;
  }

  return `${Number(bundleKey).toLocaleString()} sessions — ${Number(bundleDefaults.monthlyPrice).toLocaleString()}`;
}
