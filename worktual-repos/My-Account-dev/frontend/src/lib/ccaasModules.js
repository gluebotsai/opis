import { getFeatureScopePlanIds, CCAAS_PLANS, PLAN_ORDER } from "./ccaasPlans.js";
import { getPlanModuleRows } from "./planModules.js";

export const NONE_OPTION_ID = "none";

/** Per-user license fee defaults by region (monthly / annual per user per month). */
export const LICENSE_TIER_FEES_BY_REGION = {
  India: {
    starter: { monthlyPerUser: "6000", annualPerUser: "5000", implementationFee: "" },
    growth: { monthlyPerUser: "9000", annualPerUser: "7000", implementationFee: "" },
    pro: { monthlyPerUser: "13000", annualPerUser: "10000", implementationFee: "" },
    enterprise: { monthlyPerUser: "", annualPerUser: "", implementationFee: "" },
  },
  UK: {
    starter: { monthlyPerUser: "60", annualPerUser: "48", implementationFee: "" },
    growth: { monthlyPerUser: "80", annualPerUser: "64", implementationFee: "" },
    pro: { monthlyPerUser: "110", annualPerUser: "88", implementationFee: "" },
    enterprise: { monthlyPerUser: "", annualPerUser: "", implementationFee: "" },
  },
  Dubai: {
    starter: { monthlyPerUser: "6000", annualPerUser: "5000", implementationFee: "" },
    growth: { monthlyPerUser: "9000", annualPerUser: "7000", implementationFee: "" },
    pro: { monthlyPerUser: "13000", annualPerUser: "10000", implementationFee: "" },
    enterprise: { monthlyPerUser: "", annualPerUser: "", implementationFee: "" },
  },
};

const PER_AGENT_MODULE_OPTIONS = {
  voice: new Set(["human-agent", "ai-auto-attendant-human"]),
  digitalChannels: new Set(["ai-auto-attendant-live", "autonomous-all-channels"]),
};

/**
 * Full CCaaS module matrix from the license tier reference sheet.
 * Each option lists which plans use it as the default column value.
 * Identical labels across tiers share one option id.
 */
export const CCAAS_MODULES = [
  {
    id: "dashboard",
    label: "Dashboard",
    options: [
      { id: "static", label: "Static", plans: ["starter", "growth"] },
      { id: "dynamic", label: "Dynamic conversation insights", plans: ["pro"] },
      { id: "ai-executive", label: "AI Executive Insights", plans: ["enterprise"] },
    ],
  },
  {
    id: "contactsActivities",
    label: "Contacts & Activities",
    options: [
      { id: "basic", label: "Basic", plans: ["starter", "growth"] },
      { id: "ai-summaries", label: "AI Summaries & Sentiment", plans: ["pro"] },
      { id: "cognitive-360", label: "Cognitive Customer 360", plans: ["enterprise"] },
    ],
  },
  {
    id: "knowledgeBase",
    label: "Knowledge Base",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter"] },
      { id: "manual-upload", label: "Manual Upload", plans: ["growth"] },
      {
        id: "manual-webscraping",
        label: "Manual file uploads and Webscraping",
        plans: ["pro"],
      },
      {
        id: "self-learning",
        label: "Manual file uploads, Webscraping and Self-Learning Knowledge Base",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    options: [
      { id: "human-agent", label: "Human Agent", plans: ["starter", "growth"] },
      {
        id: "ai-auto-attendant-human",
        label: "AI Auto Attendant + Human agent",
        plans: ["pro"],
      },
      {
        id: "autonomous-voice",
        label: "Autonomous AI Voice Agent",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "digitalChannels",
    label: "Digital Channels",
    options: [
      { id: "email-sms", label: "Email, SMS", plans: ["starter"] },
      {
        id: "web-social-email-sms",
        label: "Web Chat, Social media, Email and SMS",
        plans: ["growth"],
      },
      {
        id: "ai-auto-attendant-live",
        label: "AI Auto Attendant + Live Agent : Web Chat, Social media, Email and SMS",
        plans: ["pro"],
      },
      {
        id: "autonomous-all-channels",
        label: "Autonomous AI agent Across All Chat Channels",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "aiAgentAssist",
    label: "AI Agent Assist",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter"] },
      { id: "basic-suggestions", label: "Basic Suggestions", plans: ["growth"] },
      { id: "realtime-copilot", label: "Real-time AI Copilot", plans: ["pro"] },
      {
        id: "autonomous-assistant",
        label: "Autonomous AI Assistant",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "transcription",
    label: "Transcription",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter", "growth"] },
      { id: "realtime", label: "Real-time transcripts", plans: ["pro"] },
      {
        id: "realtime-multilingual",
        label: "Real-time & Multilingual",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "sentimentAnalysis",
    label: "Sentiment Analysis",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter", "growth"] },
      { id: "customer-agent", label: "Customer & Agent", plans: ["pro"] },
      { id: "predictive", label: "Predictive Sentiment", plans: ["enterprise"] },
    ],
  },
  {
    id: "nextBestAction",
    label: "Next Best Action",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter", "growth"] },
      { id: "ai-recommendations", label: "AI Recommendations", plans: ["pro"] },
      {
        id: "autonomous-decisions",
        label: "Autonomous Decisions",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "interactionHistory",
    label: "Interaction History",
    options: [
      { id: "basic-logs", label: "Basic Logs", plans: ["starter", "growth"] },
      { id: "ai-summary", label: "AI Conversation Summary", plans: ["pro"] },
      {
        id: "ai-summary-cross-channel",
        label: "AI Conversation Summary along with Cross-Channel Messaging",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    options: [
      { id: "historical", label: "Historical", plans: ["starter", "growth"] },
      {
        id: "historical-suggestions",
        label: "Historical reports with suggestions",
        plans: ["pro"],
      },
      {
        id: "predictive-prescriptive",
        label: "Predictive & Prescriptive Reports",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    options: [
      { id: "basic", label: "Basic", plans: ["starter"] },
      { id: "queue-agent", label: "Queue & Agent", plans: ["growth"] },
      {
        id: "descriptive-suggestions",
        label: "Descriptive Analytics with suggestions",
        plans: ["pro"],
      },
      {
        id: "predictive-advanced",
        label: "Predictive Advanced AI Analytics and Autonomous Decisions",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "routing",
    label: "Routing",
    options: [
      { id: "round-robin", label: "Round Robin", plans: ["starter", "growth"] },
      { id: "ai-intent", label: "AI Intent Routing", plans: ["pro"] },
      {
        id: "autonomous-routing",
        label: "Autonomous AI Routing (based on priority, sentiment, intent)",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "outboundCampaigns",
    label: "Outbound Campaigns",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter"] },
      { id: "manual", label: "Manual", plans: ["growth"] },
      { id: "agent-specific", label: "Agent specific campaign", plans: ["pro"] },
      { id: "fully-autonomous", label: "Fully Autonomous", plans: ["enterprise"] },
    ],
  },
  {
    id: "flowBuilder",
    label: "Flow Builder",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter"] },
      { id: "manual", label: "Manual", plans: ["growth", "pro"] },
      {
        id: "autonomous-flow",
        label: "Autonomous AI agents will build the conversation flow",
        plans: ["enterprise"],
      },
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
    options: [
      { id: "manual", label: "Manual", plans: ["starter", "growth"] },
      { id: "ai-guided", label: "AI Guided", plans: ["pro", "enterprise"] },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    options: [
      { id: "basic", label: "Basic", plans: ["starter"] },
      { id: "standard", label: "Standard", plans: ["growth"] },
      { id: "ai-guided", label: "AI Guided", plans: ["pro", "enterprise"] },
    ],
  },
  {
    id: "mobileApp",
    label: "Mobile App",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter"] },
      { id: "included", label: "Included", plans: ["growth", "pro", "enterprise"] },
    ],
  },
  {
    id: "multilingual",
    label: "Multilingual",
    options: [
      { id: NONE_OPTION_ID, label: "Not included", plans: ["starter"] },
      { id: "addon", label: "Add-on", plans: ["growth", "pro", "enterprise"] },
    ],
  },
];

export function getCcaasModule(moduleId) {
  return CCAAS_MODULES.find((module) => module.id === moduleId) || null;
}

export function getModuleOption(moduleId, optionId) {
  const module = getCcaasModule(moduleId);
  return module?.options.find((option) => option.id === optionId) || null;
}

export function getModuleOptionsForLicenseTier(moduleId, licenseTier) {
  const module = getCcaasModule(moduleId);
  if (!module) {
    return [];
  }

  const scope = new Set(getFeatureScopePlanIds(licenseTier));
  return module.options.filter((option) => option.plans.some((planId) => scope.has(planId)));
}

export function getModuleFeatureLabelForPlan(moduleId, planId) {
  const optionId = getPlanDefaultOptionId(moduleId, planId);
  if (optionId === NONE_OPTION_ID) {
    return null;
  }

  return getModuleOption(moduleId, optionId)?.label || null;
}

export function clampModulesToLicenseTier(modules, licenseTier, catalog, region = "India") {
  const next = { ...(modules || {}) };

  for (const module of CCAAS_MODULES) {
    const allowed = getModuleOptionsForLicenseTier(module.id, licenseTier);
    const allowedIds = new Set(allowed.map((option) => option.id));
    const currentId = next[module.id]?.optionId || NONE_OPTION_ID;

    if (!allowedIds.has(currentId)) {
      const defaultId = getPlanDefaultOptionId(module.id, licenseTier);
      next[module.id] = {
        optionId: defaultId,
        pricingPlanId: licenseTier,
        price: getModuleOptionPrice(catalog, module.id, defaultId, region, licenseTier),
      };
    }
  }

  return next;
}

export function getPlanDefaultOptionId(moduleId, planId) {
  const module = getCcaasModule(moduleId);
  if (!module) {
    return NONE_OPTION_ID;
  }

  const match = module.options.find((option) => option.plans.includes(planId));
  return match?.id || NONE_OPTION_ID;
}

export function buildDefaultLicenseTiers(region = "India") {
  return structuredClone(LICENSE_TIER_FEES_BY_REGION[region] || LICENSE_TIER_FEES_BY_REGION.India);
}

/** Prefer per-plan fee; fall back to legacy product-level implementationFee. */
export function getContactCenterPlanImplementationFee(contactCenter, planId) {
  const planFee = String(
    contactCenter?.licenseTiers?.[planId]?.implementationFee ?? "",
  ).trim();
  if (planFee) {
    return planFee;
  }
  return String(contactCenter?.implementationFee ?? "").trim();
}

function resolveAgentSeatMonthlyPrice(slice, planId) {
  if (!planId) {
    return "";
  }

  const tierRate = String(slice?.tierAgentRates?.[planId] ?? "").trim();
  if (tierRate && tierRate.toLowerCase() !== "custom") {
    return tierRate;
  }

  const monthly = String(slice?.licenseTiers?.[planId]?.monthlyPerUser ?? "").trim();
  return monthly;
}

export function buildDefaultModulePlanPricing(region = "India") {
  const licenseTiers = buildDefaultLicenseTiers(region);
  const pricing = {};

  for (const plan of CCAAS_PLANS) {
    pricing[plan.id] = {};
    const seatFee = resolveAgentSeatMonthlyPrice(
      { licenseTiers, tierAgentRates: null },
      plan.id,
    );

    for (const module of CCAAS_MODULES) {
      const optionId = getPlanDefaultOptionId(module.id, plan.id);
      if (optionId === NONE_OPTION_ID) {
        continue;
      }

      // Seat fee lives on the plan's voice capability (per-agent). Other modules are included.
      let monthlyPrice = "0";
      if (module.id === "voice" && isPerAgentModuleOption(module.id, optionId)) {
        monthlyPrice = seatFee || "0";
      }

      pricing[plan.id][module.id] = {
        [optionId]: { monthlyPrice },
      };
    }
  }

  return pricing;
}

export function isPerAgentModuleOption(moduleId, optionId) {
  return PER_AGENT_MODULE_OPTIONS[moduleId]?.has(optionId) || false;
}

/** Keep Voice / digital per-agent module price aligned with Configuration Agent rate. */
export function syncAgentRateIntoPerAgentModules(modules, agentRate) {
  if (agentRate == null || agentRate === "" || !modules || typeof modules !== "object") {
    return modules;
  }

  let changed = false;
  const next = { ...modules };
  for (const [moduleId, selection] of Object.entries(next)) {
    if (!selection || !isPerAgentModuleOption(moduleId, selection.optionId)) {
      continue;
    }
    if (String(selection.price ?? "") === String(agentRate)) {
      continue;
    }
    next[moduleId] = { ...selection, price: String(agentRate) };
    changed = true;
  }

  return changed ? next : modules;
}

export function resolveModuleOptionPricingPlan(moduleId, optionId, licenseTier) {
  const option = getModuleOption(moduleId, optionId);
  if (!option || !licenseTier) {
    return licenseTier || "starter";
  }

  if (option.plans.includes(licenseTier)) {
    return licenseTier;
  }

  const scope = new Set(getFeatureScopePlanIds(licenseTier));
  const inScope = option.plans.filter((planId) => scope.has(planId));
  if (inScope.length === 1) {
    return inScope[0];
  }

  const sorted = [...option.plans].sort(
    (left, right) => PLAN_ORDER.indexOf(left) - PLAN_ORDER.indexOf(right),
  );
  return sorted.find((planId) => scope.has(planId)) || sorted[sorted.length - 1];
}

function getContactCenterSlice(catalog, region = "India") {
  return (
    catalog?.regionPricing?.[region]?.products?.["contact-center"] ||
    catalog?.products?.["contact-center"] ||
    {}
  );
}

export function getLicenseTierPerUserRate(catalog, planId, region = "India", billingCycle = "monthly") {
  const tiers = getContactCenterSlice(catalog, region).licenseTiers || {};
  const entry = tiers[planId];
  if (!entry) {
    return 0;
  }

  const rate =
    billingCycle === "yearly"
      ? entry.annualPerUser ?? entry.monthlyPerUser
      : entry.monthlyPerUser;

  const parsed = Number(String(rate ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildDefaultModuleCatalogPrices() {
  const modules = {};
  for (const module of CCAAS_MODULES) {
    modules[module.id] = {};
    for (const option of module.options) {
      modules[module.id][option.id] = { monthlyPrice: "0" };
    }
  }
  return modules;
}

export function getModuleOptionPrice(
  catalog,
  moduleId,
  optionId,
  region = "India",
  pricingPlanId = null,
) {
  if (!optionId || optionId === NONE_OPTION_ID) {
    return "0";
  }

  const slice = getContactCenterSlice(catalog, region);

  let catalogPrice = "";
  if (pricingPlanId) {
    const planScoped =
      slice?.modulePlanPricing?.[pricingPlanId]?.[moduleId]?.[optionId]?.monthlyPrice;
    if (planScoped != null && planScoped !== "") {
      catalogPrice = String(planScoped);
    }
  }

  if (!catalogPrice) {
    const legacy = slice?.modules?.[moduleId]?.[optionId]?.monthlyPrice;
    if (legacy != null && legacy !== "") {
      catalogPrice = String(legacy);
    }
  }

  // Admin "Agent price" (tierAgentRates) is the seat fee source of truth for voice seats.
  // Older catalogs only priced starter/growth `human-agent`, leaving Pro/Enterprise at 0.
  if (moduleId === "voice" && isPerAgentModuleOption(moduleId, optionId)) {
    const parsed = Number(String(catalogPrice).replace(/,/g, ""));
    if (!catalogPrice || !Number.isFinite(parsed) || parsed === 0) {
      const seatFee = resolveAgentSeatMonthlyPrice(slice, pricingPlanId);
      if (seatFee) {
        return seatFee;
      }
    }
  }

  return catalogPrice || "0";
}

export function getModuleOptionPriceForQuote(
  catalog,
  moduleId,
  optionId,
  region,
  licenseTier,
  pricingPlanId = null,
) {
  const planId =
    pricingPlanId || resolveModuleOptionPricingPlan(moduleId, optionId, licenseTier);
  return getModuleOptionPrice(catalog, moduleId, optionId, region, planId);
}

export function buildModulesFromPlan(planId, catalog, region = "India") {
  const slice = getContactCenterSlice(catalog, region);
  const rows = getPlanModuleRows(slice, planId);
  const modules = {};

  for (const row of rows) {
    const moduleId = row.sourceModuleId || row.id;
    const optionId = row.optionId && row.optionId !== NONE_OPTION_ID ? row.optionId : "included";

    modules[moduleId] = {
      optionId,
      moduleName: row.moduleName,
      capabilityLabel: row.capability,
      pricingPlanId: planId,
      price: getModuleOptionPrice(catalog, moduleId, optionId, region, planId) || "0",
    };
  }

  return modules;
}

export function zeroModuleCatalogPrices(modulesConfig) {
  if (!modulesConfig || typeof modulesConfig !== "object") {
    return modulesConfig || {};
  }

  const next = {};
  for (const [moduleId, selection] of Object.entries(modulesConfig)) {
    if (!selection || typeof selection !== "object") {
      next[moduleId] = selection;
      continue;
    }
    next[moduleId] = { ...selection, price: "0" };
  }
  return next;
}

export function resolveModulesWithCatalogPrices(
  modulesConfig,
  licenseTier,
  catalog,
  region = "India",
  agentRate = null,
  { preferStoredPrices = false } = {},
) {
  if (!modulesConfig || typeof modulesConfig !== "object") {
    return {};
  }

  const next = {};
  for (const [moduleId, selection] of Object.entries(modulesConfig)) {
    if (!selection || typeof selection !== "object") {
      next[moduleId] = selection;
      continue;
    }

    const optionId = selection.optionId || NONE_OPTION_ID;
    const pricingPlanId =
      selection.pricingPlanId ||
      resolveModuleOptionPricingPlan(moduleId, optionId, licenseTier) ||
      licenseTier;

    const storedPrice = selection.price;
    const catalogPrice = getModuleOptionPrice(catalog, moduleId, optionId, region, pricingPlanId) || "0";
    next[moduleId] = {
      ...selection,
      pricingPlanId,
      price:
        preferStoredPrices && storedPrice != null && storedPrice !== ""
          ? String(storedPrice)
          : preferStoredPrices
            ? "0"
            : catalogPrice,
    };
  }

  // Catalog defaults would wipe Configuration Agent rate edits; re-apply seat fee after resolve.
  return syncAgentRateIntoPerAgentModules(next, agentRate);
}

export function modulesAreComplete(modulesConfig, planId = null, catalog = null, region = "India") {
  if (!modulesConfig || typeof modulesConfig !== "object") {
    return false;
  }

  if (planId && catalog) {
    const rows = getPlanModuleRows(getContactCenterSlice(catalog, region), planId);
    return rows.every((row) => {
      const moduleId = row.sourceModuleId || row.id;
      return Boolean(modulesConfig[moduleId]?.optionId);
    });
  }

  return CCAAS_MODULES.every((module) => {
    const selection = modulesConfig[module.id];
    return Boolean(selection?.optionId);
  });
}

export function hasAnyActiveModule(modulesConfig, planId = null, catalog = null, region = "India") {
  if (!modulesConfig || typeof modulesConfig !== "object") {
    return false;
  }

  if (planId && catalog) {
    const rows = getPlanModuleRows(getContactCenterSlice(catalog, region), planId);
    return rows.some((row) => isModuleBillable(modulesConfig[row.sourceModuleId || row.id]));
  }

  return CCAAS_MODULES.some((module) => isModuleBillable(modulesConfig[module.id]));
}

export function isModuleBillable(selection) {
  if (!selection?.optionId || selection.optionId === NONE_OPTION_ID) {
    return false;
  }
  return true;
}

export function sumModulePrices(modulesConfig, { agentCount = 1 } = {}) {
  if (!modulesConfig || typeof modulesConfig !== "object") {
    return 0;
  }

  const seats = Math.max(1, Number(agentCount) || 1);
  let total = 0;

  for (const [moduleId, selection] of Object.entries(modulesConfig)) {
    if (!isModuleBillable(selection)) {
      continue;
    }

    let amount = Number(String(selection.price ?? "").replace(/,/g, ""));
    if (!Number.isFinite(amount)) {
      amount = 0;
    }

    if (isPerAgentModuleOption(moduleId, selection.optionId)) {
      amount *= seats;
    }

    total += amount;
  }

  return total;
}
