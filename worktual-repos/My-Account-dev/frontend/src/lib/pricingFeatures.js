const BASE_PLAN_ENABLE_FIELDS = new Set([
  "usersEnabled",
  "platformEnabled",
  "basePlanEnabled",
  "subscriptionEnabled",
]);

export function isFeatureEnabled(config, field) {
  // Explicit true always wins.
  if (config[field] === true) {
    return true;
  }

  // Explicit false: non–base-plan flags stay off. Base-plan flags fall through to
  // field derivation so removed header toggles do not block quote inclusion when
  // seats/price fields are filled.
  if (config[field] === false && !BASE_PLAN_ENABLE_FIELDS.has(field)) {
    return false;
  }

  switch (field) {
    case "voiceEnabled":
      return Boolean(config.voiceIncludedMinutes || config.voiceMonthlyPrice);
    case "chatbotEnabled":
      return config.chatbotBundle !== "none" && config.chatbotBundle != null;
    case "liveAgentEnabled":
      return (config.liveAgentPlan ?? (config.liveAgentCount ? "custom" : "none")) !== "none";
    case "usersEnabled":
      return Boolean(config.userCount);
    case "platformEnabled":
      return Boolean(config.monthlyBasePrice);
    case "basePlanEnabled":
      return Boolean(config.monthlyBasePrice);
    case "channelsEnabled":
      return Boolean(
        config.emailCount ||
          config.smsCount ||
          config.whatsappCredits ||
          config.webPushSubscribers ||
          config.appPushSubscribers ||
          config.inAppSubscribers,
      );
    case "subscriptionEnabled":
      return Boolean(config.monthlyBasePrice);
    case "implementationEnabled":
      if (config.implementationPurchased) {
        return false;
      }
      return Boolean(config.implementationCost || config.implementationFee);
    default:
      return true;
  }
}

export function emptyInvoiceBreakdown(currency = "INR") {
  return {
    lines: [],
    currency,
    monthlySubtotal: 0,
    setupSubtotal: 0,
    discount: 0,
  };
}
