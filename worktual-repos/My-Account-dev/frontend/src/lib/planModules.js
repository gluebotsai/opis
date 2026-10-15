import { CCAAS_PLANS } from "./ccaasPlans.js";
import {
  CCAAS_MODULES,
  NONE_OPTION_ID,
  getModuleOption,
  getPlanDefaultOptionId,
} from "./ccaasModules.js";

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildDefaultPlanModules() {
  const planModules = {};

  for (const plan of CCAAS_PLANS) {
    planModules[plan.id] = [];

    for (const module of CCAAS_MODULES) {
      const optionId = getPlanDefaultOptionId(module.id, plan.id);
      if (optionId === NONE_OPTION_ID) {
        continue;
      }

      const option = getModuleOption(module.id, optionId);
      planModules[plan.id].push({
        id: module.id,
        moduleName: module.label,
        capability: option?.label || optionId,
        sourceModuleId: module.id,
        optionId,
      });
    }
  }

  return planModules;
}

export function migratePlanModules(product = {}) {
  if (product.planModules && Object.keys(product.planModules).length > 0) {
    return product.planModules;
  }

  return buildDefaultPlanModules();
}

export function getPlanModuleRows(product, planId) {
  const planModules = migratePlanModules(product);
  return Array.isArray(planModules[planId]) ? planModules[planId] : [];
}

export function createCustomPlanModule(moduleName, capability) {
  const trimmedName = String(moduleName).trim();
  const trimmedCapability = String(capability).trim();
  const slug = slugify(trimmedName) || "module";

  return {
    id: `custom-${slug}-${Date.now()}`,
    moduleName: trimmedName,
    capability: trimmedCapability,
    custom: true,
    optionId: "included",
  };
}

export function resolvePlanModuleKey(row) {
  return row.sourceModuleId || row.id;
}

export function getModuleDisplayLabel(moduleId, selection) {
  if (selection?.moduleName) {
    const capability = selection.capabilityLabel || selection.optionId;
    return capability ? `${selection.moduleName}: ${capability}` : selection.moduleName;
  }

  const module = CCAAS_MODULES.find((entry) => entry.id === moduleId);
  const option = module?.options.find((entry) => entry.id === selection?.optionId);
  return `${module?.label || moduleId}: ${option?.label || selection?.optionId || ""}`;
}
