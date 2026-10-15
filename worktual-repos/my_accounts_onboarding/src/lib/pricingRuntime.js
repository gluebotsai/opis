import { getRegionPricingSlice } from "./pricingCatalogDefaults.js";
import { getCachedPricingCatalog } from "./pricingCatalog.js";
import { resolveAddonBundles } from "./contactCenterAddons.js";

export function emptyChatChannels() {
  return {
    sms: false,
    email: false,
    socialMedia: {
      enabled: false,
      whatsapp: false,
      facebook: false,
      instagram: false,
    },
  };
}

export function formatSelectedChatChannelLabels(chatChannels) {
  if (!chatChannels) {
    return [];
  }

  const labels = [];
  if (chatChannels.sms) {
    labels.push("SMS");
  }
  if (chatChannels.email) {
    labels.push("Email");
  }
  const social = chatChannels.socialMedia || {};
  if (social.whatsapp) {
    labels.push("WhatsApp");
  }
  if (social.facebook) {
    labels.push("Facebook");
  }
  if (social.instagram) {
    labels.push("Instagram");
  }
  return labels;
}

export function getCatalog(region = "India") {
  const catalog = getCachedPricingCatalog();
  const slice = getRegionPricingSlice(catalog, region);
  return {
    ...catalog,
    products: slice.products,
    shared: slice.shared,
  };
}

export function getContactChargeSlabs(region = "India") {
  return getCatalog(region).shared.contactSlabs;
}

export function getTicketSlabs(region = "India") {
  return getCatalog(region).shared.ticketSlabs;
}

export function getAdditionalMinuteBundlePlans(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  const plans =
    resolveAddonBundles(contactCenter, "voice") || contactCenter.additionalMinutePlans || {};
  const mapped = {};

  for (const [key, plan] of Object.entries(plans)) {
    mapped[key] = {
      label: plan.label || `${key}-minute bundle`,
      quantityLabel: `Number of ${key}-minute bundles`,
      rateLabel: `Rate per ${key} minutes`,
      rate: plan.rate || "",
    };
  }

  return mapped;
}

export function getChatbotBundleDefaults(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  const bundles =
    resolveAddonBundles(contactCenter, "chatbot") || contactCenter.chatbot?.bundles || {};
  const mapped = {};

  for (const [key, value] of Object.entries(bundles)) {
    mapped[key] = {
      monthlyPrice: value.rate ?? value.monthlyPrice ?? "",
      perSessionRate: value.perSessionRate ?? "",
      additionalSessionRate: value.additionalSessionRate ?? "",
    };
  }

  return mapped;
}

export function getHumanAgentBundleDefaults(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  return resolveAddonBundles(contactCenter, "humanAgent");
}

export function getLanguageBundleDefaults(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  return resolveAddonBundles(contactCenter, "language");
}

export function getSmsBundleDefaults(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  return resolveAddonBundles(contactCenter, "sms");
}

export function getEmailBundleDefaults(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  return resolveAddonBundles(contactCenter, "email");
}

export function getTierDefaultVolumes(region = "India") {
  return (
    getCatalog(region).products["contact-center"]?.tierDefaultVolumes ||
    buildDefaultTierDefaultVolumes()
  );
}

export function getTierAgentRates(region = "India") {
  const contactCenter = getCatalog(region).products["contact-center"];
  return contactCenter?.tierAgentRates || {};
}

export function getProductCatalogEntry(productId, region = "India") {
  return getCatalog(region).products[productId] || null;
}

export function getRegionDefaults(region) {
  return getCachedPricingCatalog().regions[region] || getCachedPricingCatalog().regions.India;
}

export function applyCatalogFeatureDefaults(config, field, enabled) {
  const region = config.region || "India";
  const next = { ...config, [field]: enabled };
  const cc = getCatalog(region).products["contact-center"];
  const crm = getCatalog(region).products.crm;
  const cdp = getCatalog(region).products.cdp;
  const campaign = getCatalog(region).products.campaign;
  const valueMgmt = getCatalog(region).products["value-management"];
  const ticketing = getCatalog(region).products.ticketing;

  switch (field) {
    case "voiceEnabled":
      if (enabled) {
        return {
          ...next,
          voiceIncludedMinutes: cc.voice.includedMinutes,
          voiceMonthlyPrice: cc.voice.basePrice,
          additionalMinutePlan: "",
          additionalMinuteQuantity: "",
          additionalMinuteRate: "",
          additionalLanguagesEnabled: false,
          selectedLanguages: [],
        };
      }
      return {
        ...next,
        voiceIncludedMinutes: "",
        voiceMonthlyPrice: "",
        additionalMinutePlan: "",
        additionalMinuteQuantity: "",
        additionalMinuteRate: "",
        additionalLanguagesEnabled: false,
        selectedLanguages: [],
      };

    case "chatbotEnabled":
      if (enabled) {
        return {
          ...next,
          chatbotBundle: cc.chatbot.minimumSessions,
          customChatbotSessions: "",
          chatbotMonthlyPrice: cc.chatbot.minimumMonthlyPrice,
          chatbotPerSessionRate: cc.chatbot.minimumPerSessionRate,
          additionalSessionRate: cc.chatbot.additionalSessionRate,
          additionalSessionsEnabled: false,
          additionalSessionQuantity: "",
          chatChannels: next.chatChannels || emptyChatChannels(),
        };
      }
      return {
        ...next,
        chatbotBundle: "none",
        customChatbotSessions: "",
        chatbotMonthlyPrice: "0",
        chatbotPerSessionRate: "0",
        additionalSessionsEnabled: false,
        additionalSessionQuantity: "",
        chatChannels: emptyChatChannels(),
      };

    case "liveAgentEnabled":
      if (enabled) {
        return {
          ...next,
          liveAgentPlan: "custom",
          liveAgentCount: cc.liveAgent.defaultCount,
          liveAgentRate: cc.liveAgent.rate,
          telcoLineCharge: cc.liveAgent.telcoLineCharge,
          additionalLiveAgentsEnabled: false,
          additionalLiveAgentCount: "",
        };
      }
      return {
        ...next,
        liveAgentPlan: "none",
        liveAgentCount: "",
        additionalLiveAgentsEnabled: false,
        additionalLiveAgentCount: "",
      };

    case "usersEnabled":
      if (enabled) {
        const rate =
          config.pricingMode === "ticketing"
            ? ticketing.base.userLicenseRate
            : crm.base.userLicenseRate;
        return {
          ...next,
          userCount: "1",
          userLicenseRate: next.userLicenseRate || rate,
        };
      }
      return { ...next, userCount: "" };

    case "platformEnabled":
      if (enabled) {
        return {
          ...next,
          monthlyBasePrice: next.monthlyBasePrice || cdp.base.monthlyBasePrice,
          customerProfiles: next.customerProfiles || cdp.base.customerProfiles,
          dataSources: next.dataSources || cdp.base.dataSources,
        };
      }
      return {
        ...next,
        monthlyBasePrice: "",
        customerProfiles: "",
        dataSources: "",
      };

    case "basePlanEnabled":
      if (enabled) {
        return {
          ...next,
          monthlyBasePrice: next.monthlyBasePrice || campaign.base.monthlyBasePrice,
          includedContacts: next.includedContacts || campaign.base.includedContacts,
        };
      }
      return { ...next, monthlyBasePrice: "", includedContacts: "" };

    case "channelsEnabled":
      if (enabled) {
        const ch = campaign.channels;
        return {
          ...next,
          emailCount: next.emailCount || ch.email.defaultCount,
          emailRate: next.emailRate || ch.email.rate,
          smsCount: next.smsCount || ch.sms.defaultCount,
          smsRate: next.smsRate || ch.sms.rate,
          whatsappCredits: next.whatsappCredits || ch.whatsapp.defaultCount,
          whatsappRate: next.whatsappRate || ch.whatsapp.rate,
          webPushSubscribers: next.webPushSubscribers || ch.webPush.defaultCount,
          webPushRate: next.webPushRate || ch.webPush.rate,
          appPushSubscribers: next.appPushSubscribers || ch.appPush.defaultCount,
          appPushRate: next.appPushRate || ch.appPush.rate,
          inAppSubscribers: next.inAppSubscribers || ch.inApp.defaultCount,
          inAppRate: next.inAppRate || ch.inApp.rate,
        };
      }
      return {
        ...next,
        emailCount: "",
        smsCount: "",
        whatsappCredits: "",
        webPushSubscribers: "",
        appPushSubscribers: "",
        inAppSubscribers: "",
      };

    case "subscriptionEnabled":
      if (enabled) {
        return {
          ...next,
          monthlyBasePrice: next.monthlyBasePrice || valueMgmt.base.monthlyBasePrice,
          monthlyActiveUsers: next.monthlyActiveUsers || valueMgmt.base.monthlyActiveUsers,
        };
      }
      return { ...next, monthlyBasePrice: "", monthlyActiveUsers: "" };

    case "implementationEnabled":
      if (config.implementationPurchased) {
        return { ...config, implementationEnabled: false };
      }
      if (enabled) {
        if ("implementationCost" in next) {
          return { ...next, implementationCost: next.implementationCost || crm.implementationFee };
        }
        return {
          ...next,
          implementationFee: next.implementationFee || valueMgmt.implementationFee,
        };
      }
      if ("implementationCost" in next) {
        return { ...next, implementationCost: "" };
      }
      return { ...next, implementationFee: "" };

    default:
      return next;
  }
}

import {
  createDefaultCcaasAddons,
  createDefaultUsageDetails,
  applyTierDefaultVolumes,
  buildDefaultTierDefaultVolumes,
} from "./ccaasConfiguration.js";

export function createCcaasInitialConfigFromCatalog(product, region = "India") {
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "ccaas",
    licenseTier: "",
    modules: {},
    usageDetails: createDefaultUsageDetails(),
    addons: createDefaultCcaasAddons(),
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    discountType: "percentage",
    discountValue: "",
  };
}

export function createCrmInitialConfigFromCatalog(product, region = "India") {
  const crm = getCatalog(region).products.crm;
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "crm",
    usersEnabled: false,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationCost: "",
    userCount: "",
    userLicenseRate: crm.base.userLicenseRate,
    includedContacts: crm.base.includedContacts,
    additionalContactsEnabled: false,
    additionalContactSlab: "",
    discountType: "percentage",
    discountValue: "",
    pricingNotes: product.notes.join("\n"),
  };
}

export function createCdpInitialConfigFromCatalog(product, region = "India") {
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "cdp",
    platformEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    monthlyBasePrice: "",
    customerProfiles: "",
    dataSources: "",
    pricingNotes: "Charges depend on customer profiles and connected data sources.",
    discountType: "percentage",
    discountValue: "",
  };
}

export function createCampaignInitialConfigFromCatalog(product, region = "India") {
  const campaign = getCatalog(region).products.campaign;
  const ch = campaign.channels;
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "campaign",
    basePlanEnabled: false,
    channelsEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    monthlyBasePrice: "",
    includedContacts: "",
    emailCount: "",
    emailRate: ch.email.rate,
    smsCount: "",
    smsRate: ch.sms.rate,
    whatsappCredits: "",
    whatsappRate: ch.whatsapp.rate,
    webPushSubscribers: "",
    webPushRate: ch.webPush.rate,
    appPushSubscribers: "",
    appPushRate: ch.appPush.rate,
    inAppSubscribers: "",
    inAppRate: ch.inApp.rate,
    additionalContactsEnabled: false,
    additionalContactSlab: "500",
    discountType: "percentage",
    discountValue: "",
  };
}

export function createValueManagementInitialConfigFromCatalog(product, region = "India") {
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "value-management",
    subscriptionEnabled: false,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationFee: "",
    monthlyBasePrice: "",
    monthlyActiveUsers: "",
    discountType: "percentage",
    discountValue: "",
  };
}

export function createTicketingInitialConfigFromCatalog(product, region = "India") {
  const ticketing = getCatalog(region).products.ticketing;
  const regionDefaults = getRegionDefaults(region);
  return {
    productId: product.id,
    pricingMode: "ticketing",
    usersEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    userCount: "",
    userLicenseRate: ticketing.base.userLicenseRate,
    includedTickets: ticketing.base.includedTickets,
    includedTicketRate: ticketing.base.includedTicketRate,
    additionalTicketsEnabled: false,
    additionalTicketSlab: "",
    discountType: "percentage",
    discountValue: "",
  };
}

export function createInitialConfigFromCatalog(product, region = "India") {
  const factories = {
    "contact-center": createCcaasInitialConfigFromCatalog,
    crm: createCrmInitialConfigFromCatalog,
    cdp: createCdpInitialConfigFromCatalog,
    campaign: createCampaignInitialConfigFromCatalog,
    "value-management": createValueManagementInitialConfigFromCatalog,
    ticketing: createTicketingInitialConfigFromCatalog,
  };

  return factories[product.id]?.(product, region) ?? null;
}
