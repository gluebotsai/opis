import { migratePlanModules } from "./planModules.js";

export const CONTACT_CENTER_ADDON_SECTIONS = [
  {
    id: "voice",
    label: "Voice",
    description: "Optional minute bundles beyond the included voice package.",
    addLabel: "Add minute plan",
    keyLabel: "Minutes",
    placeholder: "e.g. 3000",
  },
  {
    id: "chatbot",
    label: "Chatbot",
    description: "Session bundles used when sales configures chatbot capacity.",
    addLabel: "Add session bundle",
    keyLabel: "Session count",
    placeholder: "e.g. 5000",
  },
  {
    id: "humanAgent",
    label: "Human agent",
    kind: "additional-agent-rate",
    description: "Additional agent pricing and telco line charges for live agent seats.",
  },
  {
    id: "language",
    label: "Language",
    description: "Add one or more languages with a setup price.",
    addLabel: "Add language",
    keyLabel: "Language",
    placeholder: "e.g. Hindi",
  },
  {
    id: "sms",
    label: "SMS",
    description: "SMS message bundles beyond tier allowances.",
    addLabel: "Add SMS bundle",
    keyLabel: "Message count",
    placeholder: "e.g. 1000",
  },
  {
    id: "email",
    label: "Email",
    description: "Email bundles beyond tier allowances.",
    addLabel: "Add email bundle",
    keyLabel: "Email count",
    placeholder: "e.g. 5000",
  },
];

export const EMPTY_ADDON_BUNDLE = {
  label: "",
  rate: "",
};

export function buildDefaultTierAgentRates() {
  return {
    starter: "6000",
    growth: "9000",
    pro: "13000",
    enterprise: "custom",
  };
}

export function buildDefaultContactCenterAddons() {
  return {
    voice: {
      bundles: {
        1000: { label: "1000-minute bundle", rate: "8000" },
        2000: { label: "2000-minute bundle", rate: "14000" },
      },
    },
    chatbot: {
      bundles: {
        300: { label: "300 sessions", rate: "10000" },
        1000: { label: "1000 sessions", rate: "27000" },
        2500: { label: "2500 sessions", rate: "50000" },
        3000: { label: "3000 sessions", rate: "60000" },
      },
    },
    humanAgent: {
      bundles: {},
    },
    language: {
      bundles: {
        english: { label: "English", rate: "20000" },
      },
    },
    sms: {
      bundles: {
        1000: { label: "1000 SMS bundle", rate: "1060" },
      },
    },
    email: {
      bundles: {
        5000: { label: "5000 email bundle", rate: "25000" },
      },
    },
  };
}

function slugifyBundleKey(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBundleEntry(key, entry, fallbackLabel) {
  if (!entry || typeof entry !== "object") {
    return {
      label: fallbackLabel,
      rate: "",
    };
  }

  return {
    label: entry.label || fallbackLabel,
    rate: entry.rate ?? entry.monthlyPrice ?? "",
  };
}

export function migrateContactCenterProduct(product = {}) {
  const next = { ...product };
  const addons = structuredClone(next.addons || buildDefaultContactCenterAddons());

  if (!addons.voice?.bundles && next.additionalMinutePlans) {
    addons.voice = {
      bundles: Object.fromEntries(
        Object.entries(next.additionalMinutePlans).map(([key, plan]) => [
          key,
          normalizeBundleEntry(key, plan, plan.label || `${key}-minute bundle`),
        ]),
      ),
    };
  }

  if (!addons.chatbot?.bundles && next.chatbot?.bundles) {
    addons.chatbot = {
      bundles: Object.fromEntries(
        Object.entries(next.chatbot.bundles).map(([key, bundle]) => [
          key,
          normalizeBundleEntry(key, bundle, `${key} sessions`),
        ]),
      ),
    };
  }

  if (!next.liveAgent) {
    next.liveAgent = {
      defaultCount: "1",
      rate: "9000",
      telcoLineCharge: "840",
      additionalAgentRate: "2000",
    };
  } else if (next.liveAgent.additionalAgentRate == null || next.liveAgent.additionalAgentRate === "") {
    next.liveAgent = {
      ...next.liveAgent,
      additionalAgentRate: "2000",
    };
  }

  if (!addons.language?.bundles && next.voice?.languageSetupFee) {
    addons.language = {
      bundles: {
        default: {
          label: "Default language setup",
          rate: next.voice.languageSetupFee,
        },
      },
    };
  }

  for (const section of CONTACT_CENTER_ADDON_SECTIONS) {
    if (!addons[section.id]?.bundles) {
      addons[section.id] = { bundles: {} };
    }
  }

  next.addons = addons;

  next.planModules = migratePlanModules(next);

  if (!next.tierAgentRates) {
    next.tierAgentRates = buildDefaultTierAgentRates();
  }

  return next;
}

export function resolveAddonBundles(product, addonId) {
  const migrated = migrateContactCenterProduct(product);
  return migrated.addons?.[addonId]?.bundles || {};
}

export function createAddonBundleKey(addonId, rawKey) {
  const trimmed = String(rawKey).trim();
  if (!trimmed) {
    return "";
  }

  if (addonId === "language") {
    return slugifyBundleKey(trimmed) || trimmed;
  }

  return trimmed.replace(/,/g, "");
}

export function defaultLabelForAddonBundle(addonId, key) {
  if (addonId === "language") {
    return key
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  if (addonId === "voice") {
    return `${key}-minute bundle`;
  }

  if (addonId === "chatbot") {
    return `${key} sessions`;
  }

  if (addonId === "humanAgent") {
    return `${key} agent seat`;
  }

  if (addonId === "sms") {
    return `${key} SMS bundle`;
  }

  if (addonId === "email") {
    return `${key} email bundle`;
  }

  return key;
}
