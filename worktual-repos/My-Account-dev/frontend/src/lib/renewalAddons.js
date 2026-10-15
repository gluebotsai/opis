/**
 * Helpers for selecting which in-product add-ons carry forward on renewal.
 * Add-ons remain nested capacity/options inside the product config (not separate SKUs).
 */

function isEnabled(entry) {
  return entry?.enabled === true;
}

/**
 * @returns {{ id: string, label: string, group: string }[]}
 */
export function listRenewableAddons(productId, config = {}) {
  const items = [];
  const mid = config.midPeriodAddons || {};

  if (productId === "contact-center") {
    if (isEnabled(mid.humanAgent)) {
      items.push({
        id: "mid.humanAgent",
        label: `Human agents${mid.humanAgent.count ? ` (${mid.humanAgent.count})` : ""}`,
        group: "Mid-period add-ons",
      });
    }

    if (isEnabled(mid.queueCapacity) || isEnabled(mid.phoneNumbers)) {
      const queue = mid.queueCapacity?.enabled ? mid.queueCapacity : mid.phoneNumbers;
      items.push({
        id: "mid.queueCapacity",
        label: `Queue capacity${queue?.count ? ` (${queue.count})` : ""}`,
        group: "Mid-period add-ons",
      });
    }

    for (const [channelId, channel] of Object.entries(mid.channels || {})) {
      if (!isEnabled(channel)) {
        continue;
      }
      items.push({
        id: `mid.channel.${channelId}`,
        label: `${channel.label || channelId}${channel.count ? ` × ${channel.count}` : ""}`,
        group: "Channel add-ons",
      });
    }

    const addons = config.addons || {};
    if (Number(addons.sessionPrice) > 0 || addons.sessionsEnabled) {
      items.push({
        id: "ccaas.sessions",
        label: "Sessions package",
        group: "Contact Center add-ons",
      });
    }
    if (Number(addons.multilingualPrice) > 0 || addons.multilingualEnabled) {
      items.push({
        id: "ccaas.multilingual",
        label: "Multilingual add-on",
        group: "Contact Center add-ons",
      });
    }
  }

  if (productId === "crm" || productId === "cdp" || productId === "campaign") {
    if (isEnabled(mid.userLicense)) {
      items.push({
        id: "mid.userLicense",
        label: `Additional user licenses${
          mid.userLicense.additionalCount ? ` (+${mid.userLicense.additionalCount})` : ""
        }`,
        group: "Mid-period add-ons",
      });
    }
    if (isEnabled(mid.contacts)) {
      items.push({
        id: "mid.contacts",
        label: `Additional contacts${mid.contacts.slab ? ` (${mid.contacts.slab})` : ""}`,
        group: "Mid-period add-ons",
      });
    }
  }

  return items;
}

export function defaultRenewalAddonSelection(productId, config = {}) {
  return listRenewableAddons(productId, config).map((item) => item.id);
}

/**
 * Strip deselected add-ons from config for a renewal quote.
 * Base plan fields are left intact; only optional add-on capacity is removed.
 */
export function applyAddonRenewalSelection(productId, config = {}, selectedIds = []) {
  const selected = new Set(selectedIds);
  const next = structuredClone(config);
  const mid = next.midPeriodAddons ? { ...next.midPeriodAddons } : null;

  if (mid) {
    if (mid.humanAgent && !selected.has("mid.humanAgent")) {
      mid.humanAgent = { enabled: false, count: "", rate: "" };
    }
    if (mid.queueCapacity && !selected.has("mid.queueCapacity")) {
      mid.queueCapacity = { enabled: false, count: "", rate: "" };
    }
    if (mid.phoneNumbers && !selected.has("mid.queueCapacity") && !selected.has("mid.phoneNumbers")) {
      mid.phoneNumbers = { enabled: false, count: "", rate: "" };
    }
    if (mid.channels) {
      const channels = { ...mid.channels };
      for (const [channelId, channel] of Object.entries(channels)) {
        if (!selected.has(`mid.channel.${channelId}`)) {
          channels[channelId] = {
            ...channel,
            enabled: false,
            slabId: "",
            count: "",
            rate: "",
          };
        }
      }
      mid.channels = channels;
    }
    if (mid.userLicense && !selected.has("mid.userLicense")) {
      mid.userLicense = { enabled: false, additionalCount: "" };
    }
    if (mid.contacts && !selected.has("mid.contacts")) {
      mid.contacts = { enabled: false, slab: "" };
    }

    const anyChannel = Object.values(mid.channels || {}).some((entry) => entry?.enabled);
    const anyAgent = mid.humanAgent?.enabled;
    const anyQueue = mid.queueCapacity?.enabled || mid.phoneNumbers?.enabled;
    const anyCrm = mid.userLicense?.enabled || mid.contacts?.enabled;
    mid.active = Boolean(anyChannel || anyAgent || anyQueue || anyCrm);
    next.midPeriodAddons = mid;
  }

  if (productId === "contact-center" && next.addons) {
    const addons = { ...next.addons };
    if (!selected.has("ccaas.sessions")) {
      addons.sessionsEnabled = false;
      addons.sessionPrice = 0;
    }
    if (!selected.has("ccaas.multilingual")) {
      addons.multilingualEnabled = false;
      addons.multilingualPrice = 0;
    }
    next.addons = addons;
  }

  next.renewalAddonSelection = [...selected];
  return next;
}
