export function isFeatureEnabled(config: any, field: any) {
  if (config[field] !== undefined) {
    return config[field] === true;
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

export function emptyInvoiceBreakdown(currency: any = "INR") {
  return {
    lines: [],
    currency,
    monthlySubtotal: 0,
    setupSubtotal: 0,
    discount: 0,
  };
}
