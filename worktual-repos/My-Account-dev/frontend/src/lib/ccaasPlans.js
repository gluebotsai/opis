export const CCAAS_PLANS = [
  {
    id: "starter",
    label: "Starter",
    subtitle: "Essentials",
    description: "Core contact-center basics for small teams getting started.",
    highlights: [
      "Basic dashboard & contacts",
      "Digital channels (chat)",
      "Basic reports & routing",
      "Voice not included",
    ],
  },
  {
    id: "growth",
    label: "Growth",
    subtitle: "Scale-ready",
    description: "Expand channels and agent assist as your operation grows.",
    highlights: [
      "Voice & digital channels",
      "AI agent assist (basic)",
      "Knowledge base & flow builder",
      "Mobile app included",
    ],
  },
  {
    id: "pro",
    label: "Pro",
    subtitle: "AI-Assisted",
    description: "Full AI-assisted operations with transcription and analytics.",
    highlights: [
      "Full voice & digital suite",
      "Transcription & sentiment",
      "Next best action",
      "Advanced reports & analytics",
    ],
  },
  {
    id: "enterprise",
    label: "Enterprise",
    subtitle: "AI-Native",
    description: "Autonomous, AI-native contact center for large deployments.",
    highlights: [
      "All Pro capabilities",
      "Full multilingual support",
      "Enterprise integrations",
      "Custom commercial terms",
    ],
  },
];

export const PLAN_ORDER = ["starter", "growth", "pro", "enterprise"];

/** Which plan columns / capability tiers are in scope when quoting each license tier. */
export const PLAN_FEATURE_SCOPE = {
  starter: ["starter", "growth"],
  growth: ["growth"],
  pro: ["pro", "enterprise"],
  enterprise: ["enterprise"],
};

export function getFeatureScopePlanIds(licenseTier) {
  return PLAN_FEATURE_SCOPE[licenseTier] || CCAAS_PLANS.map((plan) => plan.id);
}

export function isPlanInFeatureScope(licenseTier, planId) {
  return getFeatureScopePlanIds(licenseTier).includes(planId);
}

export function getCcaasPlan(planId) {
  return CCAAS_PLANS.find((plan) => plan.id === planId) || null;
}

export function getCcaasPlanLabel(planId) {
  const plan = getCcaasPlan(planId);
  if (!plan) {
    return "";
  }
  return plan.subtitle ? `${plan.label} (${plan.subtitle})` : plan.label;
}

export function getPlanTierRank(planId) {
  return PLAN_ORDER.indexOf(String(planId || "").trim());
}

export function getHighestPlanId() {
  return PLAN_ORDER[PLAN_ORDER.length - 1] || "enterprise";
}

export function isHigherPlanThan(currentPlanId, candidatePlanId) {
  const currentRank = getPlanTierRank(currentPlanId);
  const candidateRank = getPlanTierRank(candidatePlanId);
  if (candidateRank < 0) {
    return false;
  }
  if (currentRank < 0) {
    return true;
  }
  return candidateRank > currentRank;
}

export function getHigherPlansThan(currentPlanId) {
  const currentRank = getPlanTierRank(currentPlanId);
  if (currentRank < 0) {
    return [...CCAAS_PLANS];
  }
  return CCAAS_PLANS.filter((plan) => getPlanTierRank(plan.id) > currentRank);
}