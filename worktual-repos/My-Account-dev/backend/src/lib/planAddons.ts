import { CCAAS_PLANS } from "./ccaasPlans.js";

/** Canonical channel ids for plan-wise CCaaS add-ons (admin + quote). */
export const PLAN_ADDON_CHANNELS = [
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "chat", label: "Chat" },
  { id: "voice", label: "Voice" },
];

/**
 * Digital Channels module optionId → purchasable channel add-on ids.
 * Quote visibility = this list ∩ admin planAddons[plan].channels where enabled.
 */
export const DIGITAL_CHANNEL_OPTION_TO_ADDON_CHANNELS = {
  "email-sms": ["email", "sms"],
  "web-social-email-sms": ["chat", "whatsapp", "facebook", "instagram", "email", "sms"],
  "ai-auto-attendant-live": [
    "chat",
    "whatsapp",
    "facebook",
    "instagram",
    "email",
    "sms",
    "voice",
  ],
  "autonomous-all-channels": [
    "chat",
    "whatsapp",
    "facebook",
    "instagram",
    "email",
    "sms",
    "voice",
  ],
};

/** Default which channels are admin-enabled per license plan. */
const DEFAULT_ENABLED_CHANNELS_BY_PLAN = {
  starter: ["sms", "email", "whatsapp", "instagram", "facebook", "chat"],
  growth: ["sms", "email", "whatsapp", "instagram", "facebook", "chat"],
  pro: ["sms", "email", "whatsapp", "instagram", "facebook", "chat", "voice"],
  enterprise: ["sms", "email", "whatsapp", "instagram", "facebook", "chat", "voice"],
};

export const EMPTY_CHANNEL_SLAB = {
  count: "0",
  rate: "0",
  label: "",
};

/** Slab key written by Admin Configuration defaults (Tiers tab). */
export const CONFIGURATION_DEFAULT_SLAB_KEY = "default";

/**
 * Upsert the Configuration-defaults slab for a channel on a plan.
 * Enables the channel so purchase seed can read qty/rate.
 */
export function upsertPlanAddonDefaultSlab(
  product: any,
  planId: any,
  channelId: any,
  { count, rate, label }: any = {},
) {
  if (!planId || !channelId) {
    return migratePlanAddons(product || {});
  }

  const migrated = migratePlanAddons(product || {});
  const plan = migrated[planId] || migrated.starter;
  const channelMeta = PLAN_ADDON_CHANNELS.find((entry: any) => entry.id === channelId);
  const channel =
    plan.channels?.[channelId] || emptyChannelEntry(label || channelMeta?.label || channelId);
  const existing = channel.slabs?.[CONFIGURATION_DEFAULT_SLAB_KEY] || {};

  const nextCount =
    count != null && count !== undefined ? String(count) : existing.count != null ? String(existing.count) : "0";
  const nextRate =
    rate != null && rate !== undefined ? String(rate) : existing.rate != null ? String(existing.rate) : "0";

  return {
    ...migrated,
    [planId]: {
      ...plan,
      channels: {
        ...plan.channels,
        [channelId]: {
          ...channel,
          enabled: true,
          label: label || channel.label || channelMeta?.label || channelId,
          slabs: {
            ...(channel.slabs || {}),
            [CONFIGURATION_DEFAULT_SLAB_KEY]: {
              count: nextCount,
              rate: nextRate,
              label: existing.label || "Default",
            },
          },
        },
      },
    },
  };
}

function emptyAgentCount() {
  return {
    enabled: true,
    label: "Agent count increase",
    defaultCount: "1",
    defaultRate: "0",
  };
}

function emptyQueueCapacity() {
  return {
    enabled: true,
    label: "Queue capacity",
    defaultCount: "1",
    defaultRate: "0",
  };
}

function emptyChannelEntry(label: any, { enabled = false }: any = {}) {
  return {
    enabled,
    label,
    slabs: {},
  };
}

function normalizeSlabEntry(key: any, entry: any = {}) {
  const count = entry.count ?? key ?? "0";
  return {
    count: String(count),
    rate: entry.rate != null && entry.rate !== "" ? String(entry.rate) : "0",
    label: entry.label || "",
  };
}

/** Build slabs object; migrate legacy defaultCount/defaultRate into one slab when needed. */
function resolveChannelSlabs(existing: any = {}) {
  const existingSlabs =
    existing.slabs && typeof existing.slabs === "object" ? existing.slabs : null;

  if (existingSlabs && Object.keys(existingSlabs).length > 0) {
    return Object.fromEntries(
      Object.entries(existingSlabs).map(([key, slab]: any) => [key, normalizeSlabEntry(key, slab)]),
    );
  }

  const legacyCount = existing.defaultCount;
  const legacyRate = existing.defaultRate;
  const hasLegacy =
    (legacyCount != null && String(legacyCount) !== "" && String(legacyCount) !== "0") ||
    (legacyRate != null && String(legacyRate) !== "" && String(legacyRate) !== "0");

  if (hasLegacy) {
    const key = String(legacyCount || "default").replace(/,/g, "") || "default";
    return {
      [key]: normalizeSlabEntry(key, {
        count: legacyCount || "0",
        rate: legacyRate || "0",
        label: legacyCount ? `${legacyCount}` : "Default",
      }),
    };
  }

  return {};
}

export function buildDefaultPlanAddons(_product: any = {}) {
  const planAddons: Record<string, any> = {};

  for (const plan of CCAAS_PLANS) {
    const enabledSet = new Set((DEFAULT_ENABLED_CHANNELS_BY_PLAN as Record<string, any>)[plan.id] || []);

    const channels: Record<string, any> = {};
    for (const channel of PLAN_ADDON_CHANNELS) {
      channels[channel.id] = emptyChannelEntry(channel.label, {
        enabled: enabledSet.has(channel.id),
      });
    }

    planAddons[plan.id] = {
      agentCount: emptyAgentCount(),
      queueCapacity: emptyQueueCapacity(),
      channels,
    };
  }

  return planAddons;
}

function mergeAgentCount(existing: any, fallback: any) {
  return {
    enabled: existing?.enabled !== false,
    label: existing?.label || fallback.label,
    defaultCount: existing?.defaultCount ?? fallback.defaultCount ?? "",
    defaultRate: existing?.defaultRate ?? fallback.defaultRate ?? "",
  };
}

function mergeQueueCapacity(existing: any, fallback: any) {
  return {
    enabled: existing?.enabled !== false,
    label: existing?.label || fallback.label,
    defaultCount: existing?.defaultCount ?? fallback.defaultCount ?? "",
    defaultRate: existing?.defaultRate ?? fallback.defaultRate ?? "",
  };
}

function mergeChannelEntry(existing: any, fallback: any) {
  return {
    enabled: existing?.enabled === true || (existing?.enabled == null && fallback.enabled),
    label: existing?.label || fallback.label,
    slabs: resolveChannelSlabs(existing || {}),
  };
}

/** Ensure planAddons exists and every plan/channel has a full entry. */
export function migratePlanAddons(product: any = {}) {
  const defaults = buildDefaultPlanAddons(product);
  const existing = product.planAddons && typeof product.planAddons === "object" ? product.planAddons : {};
  const next: Record<string, any> = {};

  for (const plan of CCAAS_PLANS) {
    const planExisting = existing[plan.id] || {};
    const planDefaults = defaults[plan.id];
    const channels: Record<string, any> = {};
    for (const channel of PLAN_ADDON_CHANNELS) {
      channels[channel.id] = mergeChannelEntry(
        planExisting.channels?.[channel.id],
        planDefaults.channels[channel.id],
      );
    }
    // Keep custom Configuration / add-on channels beyond the canonical list.
    for (const [channelId, entry] of Object.entries(planExisting.channels || {}) as [string, any][]) {
      if (channels[channelId]) {
        continue;
      }
      channels[channelId] = mergeChannelEntry(
        entry,
        emptyChannelEntry(entry?.label || channelId, { enabled: true }),
      );
    }
    // Prefer queueCapacity; migrate legacy planAddons.numberCount (phone SKU) when needed.
    const queueExisting = planExisting.queueCapacity || planExisting.numberCount;
    next[plan.id] = {
      agentCount: mergeAgentCount(planExisting.agentCount, planDefaults.agentCount),
      queueCapacity: mergeQueueCapacity(queueExisting, planDefaults.queueCapacity),
      channels,
    };
  }

  return next;
}

export function getPlanAddonsForPlan(product: any, planId: any) {
  const migrated = migratePlanAddons(product || {});
  return migrated[planId] || migrated.starter;
}

export function getDigitalChannelsOptionId(config: any) {
  return config?.modules?.digitalChannels?.optionId || "";
}

export function getAddonChannelIdsForDigitalOption(optionId: any) {
  if (!optionId || optionId === "none") {
    return [];
  }
  return (DIGITAL_CHANNEL_OPTION_TO_ADDON_CHANNELS as Record<string, any>)[optionId] || [];
}

export function formatChannelSlabOptionLabel(slab: any, fallbackKey: any = "") {
  if (slab?.label) {
    return slab.label;
  }
  const count = slab?.count || fallbackKey || "0";
  const rate = slab?.rate || "0";
  const countLabel = Number.isFinite(Number(count)) ? Number(count).toLocaleString() : count;
  return `${countLabel} @ ${rate}`;
}

/**
 * Slabs for a channel on a plan as [{ id, count, rate, label, optionLabel }].
 */
export function getChannelSlabs(product: any, planId: any, channelId: any) {
  const planAddons = getPlanAddonsForPlan(product, planId);
  const slabs = planAddons.channels?.[channelId]?.slabs || {};
  return Object.entries(slabs).map(([id, slab]: any) => ({
    id,
    count: slab.count || "0",
    rate: slab.rate || "0",
    label: slab.label || "",
    optionLabel: formatChannelSlabOptionLabel(slab, id),
  }));
}

/**
 * Channels visible on a quote: admin-enabled for plan ∩ digitalChannels option map.
 * Returns [{ id, label, slabs }].
 */
export function getVisiblePlanAddonChannels(config: any, product: any) {
  const planId = config?.licenseTier || "";
  if (!planId) {
    return [];
  }

  const optionId = getDigitalChannelsOptionId(config);
  const allowedByOption = new Set(getAddonChannelIdsForDigitalOption(optionId));
  if (allowedByOption.size === 0) {
    return [];
  }

  const planAddons = getPlanAddonsForPlan(product, planId);
  const visible: any[] = [];
  for (const channel of PLAN_ADDON_CHANNELS) {
    const entry = planAddons.channels?.[channel.id];
    if (!entry?.enabled) {
      continue;
    }
    if (!allowedByOption.has(channel.id)) {
      continue;
    }
    const slabs = getChannelSlabs(product, planId, channel.id);
    visible.push({
      id: channel.id,
      label: entry.label || channel.label,
      slabs,
    });
  }
  return visible;
}

export function getPlanAgentAddon(config: any, product: any) {
  const planId = config?.licenseTier || "";
  if (!planId) {
    return null;
  }
  const planAddons = getPlanAddonsForPlan(product, planId);
  const agent = planAddons.agentCount;
  if (!agent || agent.enabled === false) {
    return null;
  }
  return agent;
}

/** Extra concurrent queue capacity add-on (replaces legacy CCaaS number-count SKU). */
export function getPlanQueueCapacityAddon(config: any, product: any) {
  const planId = config?.licenseTier || "";
  if (!planId) {
    return null;
  }
  const planAddons = getPlanAddonsForPlan(product, planId);
  const queue = planAddons.queueCapacity;
  if (!queue || queue.enabled === false) {
    return null;
  }
  return queue;
}

export function isChannelVisibleForConfig(config: any, product: any, channelId: any) {
  return getVisiblePlanAddonChannels(config, product).some((channel: any) => channel.id === channelId);
}

export function createChannelSlabKey(rawKey: any) {
  const trimmed = String(rawKey || "").trim().replace(/,/g, "");
  return trimmed;
}

/**
 * Disable channel selections that are no longer visible for the current plan / digital option.
 * Clears invalid slabId; also sync agent/number defaults when rate/count empty.
 */
export function pruneCcaasAddonsToPlanVisibility(config: any, product: any) {
  if (!config?.midPeriodAddons?.active) {
    return config;
  }

  const visibleChannels = getVisiblePlanAddonChannels(config, product);
  const visibleById = Object.fromEntries(visibleChannels.map((c: any) => [c.id, c]));
  const agentAddon = getPlanAgentAddon(config, product);
  const queueAddon = getPlanQueueCapacityAddon(config, product);
  const mid = config.midPeriodAddons;
  const channels = { ...mid.channels };

  for (const channel of PLAN_ADDON_CHANNELS) {
    const entry = channels[channel.id] || {
      enabled: false,
      slabId: "",
      count: "",
      rate: "",
    };
    const visible = visibleById[channel.id];
    if (!visible) {
      if (entry.enabled || entry.slabId) {
        channels[channel.id] = {
          ...entry,
          enabled: false,
          slabId: "",
        };
      } else if (!channels[channel.id]) {
        channels[channel.id] = entry;
      }
      continue;
    }

    const slabIds = new Set(visible.slabs.map((slab: any) => slab.id));
    if (entry.slabId && !slabIds.has(entry.slabId)) {
      channels[channel.id] = {
        ...entry,
        enabled: false,
        slabId: "",
      };
    } else if (!channels[channel.id]) {
      channels[channel.id] = entry;
    }
  }

  let humanAgent = { ...mid.humanAgent };
  if (!agentAddon) {
    humanAgent = { ...humanAgent, enabled: false };
  } else if (!humanAgent.rate) {
    humanAgent = {
      ...humanAgent,
      rate: agentAddon.defaultRate || humanAgent.rate || "",
      count: humanAgent.count || agentAddon.defaultCount || "",
      label: agentAddon.label,
    };
  }

  const legacyPhone = mid.phoneNumbers || {};
  let queueCapacity = {
    enabled: false,
    count: "",
    rate: "",
    ...(mid.queueCapacity || {}),
  };
  // Migrate legacy mid.phoneNumbers → queueCapacity when queue blob is empty.
  if (!mid.queueCapacity && legacyPhone.enabled) {
    queueCapacity = {
      enabled: true,
      count: legacyPhone.count || "",
      rate: legacyPhone.rate || "",
      label: legacyPhone.label || "Queue capacity",
    };
  }
  if (!queueAddon) {
    queueCapacity = { ...queueCapacity, enabled: false };
  } else if (!queueCapacity.rate) {
    queueCapacity = {
      ...queueCapacity,
      rate: queueAddon.defaultRate || queueCapacity.rate || "",
      count: queueCapacity.count || queueAddon.defaultCount || "",
      label: queueAddon.label,
    };
  }

  return {
    ...config,
    midPeriodAddons: {
      ...mid,
      humanAgent,
      queueCapacity,
      channels,
    },
  };
}
