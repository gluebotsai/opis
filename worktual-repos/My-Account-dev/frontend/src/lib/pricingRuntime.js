import {
  getProductNumberAddOn,
  getProductStorageAddOn,
  getRegionPricingSlice,
} from "./pricingCatalogDefaults.js";
import { getCachedPricingCatalog } from "./pricingCatalog.js";
import { resolveAddonBundles } from "./contactCenterAddons.js";
import { getContactCenterPlanImplementationFee } from "./ccaasModules.js";

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

export function getContactChargeSlabs(region = "India", productId = "crm") {
  const catalog = getCatalog(region);
  const productSlabs = catalog.products?.[productId]?.contactSlabs;
  if (productSlabs && Object.keys(productSlabs).length) {
    return productSlabs;
  }

  return catalog.shared?.contactSlabs || {};
}

export function getTicketSlabs(region = "India") {
  const catalog = getCatalog(region);
  const productSlabs = catalog.products?.ticketing?.ticketSlabs;
  if (productSlabs && Object.keys(productSlabs).length) {
    return productSlabs;
  }

  return catalog.shared?.ticketSlabs || {};
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
  const zero = Boolean(config.zeroCatalogDefaults);
  const z = (catalogValue, fallback = "0") => (zero ? fallback : catalogValue);
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
          voiceIncludedMinutes: zero ? "" : cc.voice.includedMinutes,
          voiceMonthlyPrice: z(cc.voice.basePrice),
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
          chatbotBundle: zero ? "custom" : cc.chatbot.minimumSessions,
          customChatbotSessions: "",
          chatbotMonthlyPrice: z(cc.chatbot.minimumMonthlyPrice),
          chatbotPerSessionRate: z(cc.chatbot.minimumPerSessionRate),
          additionalSessionRate: z(cc.chatbot.additionalSessionRate),
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
          liveAgentCount: zero ? "1" : cc.liveAgent.defaultCount,
          liveAgentRate: z(cc.liveAgent.rate),
          telcoLineCharge: z(cc.liveAgent.telcoLineCharge),
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
        const crmNumberAddOn = getProductNumberAddOn(crm);
        const crmStorageAddOn = getProductStorageAddOn(crm, region);
        const ticketingStorageAddOn = getProductStorageAddOn(ticketing, region);
        return {
          ...next,
          userCount: "1",
          userLicenseRate: next.userLicenseRate || z(rate),
          ...(config.pricingMode === "crm"
            ? {
                includedContacts: next.includedContacts || (zero ? "" : crm.base.includedContacts),
                numberCount: next.numberCount || crm.base.numberCount || "0",
                numberRate: next.numberRate || z(crm.base.numberRate || "0"),
                additionalNumberCount:
                  next.additionalNumberCount || crmNumberAddOn.defaultCount || "0",
                additionalNumberRate:
                  next.additionalNumberRate || z(crmNumberAddOn.defaultRate || "0"),
                additionalStorageCount:
                  next.additionalStorageCount || crmStorageAddOn.defaultCount || "0",
                additionalStorageRate:
                  next.additionalStorageRate || z(crmStorageAddOn.defaultRate || "0"),
                additionalUserLicenseRate:
                  next.additionalUserLicenseRate ||
                  z(crm.additionalUserLicenseRate || rate),
              }
            : config.pricingMode === "ticketing"
              ? {
                  additionalStorageCount:
                    next.additionalStorageCount || ticketingStorageAddOn.defaultCount || "0",
                  additionalStorageRate:
                    next.additionalStorageRate || z(ticketingStorageAddOn.defaultRate || "0"),
                }
              : null),
        };
      }
      return { ...next, userCount: "" };

    case "platformEnabled":
      if (enabled) {
        const cdpStorageAddOn = getProductStorageAddOn(cdp, region);
        return {
          ...next,
          monthlyBasePrice: next.monthlyBasePrice || z(cdp.base.monthlyBasePrice),
          customerProfiles: next.customerProfiles || (zero ? "" : cdp.base.customerProfiles),
          additionalStorageCount:
            next.additionalStorageCount || cdpStorageAddOn.defaultCount || "0",
          additionalStorageRate:
            next.additionalStorageRate || z(cdpStorageAddOn.defaultRate || "0"),
        };
      }
      return {
        ...next,
        monthlyBasePrice: "",
        customerProfiles: "",
      };

    case "basePlanEnabled":
      if (enabled) {
        // Campaign numbers removed — keep storage defaults only.
        // const campaignNumberAddOn = getProductNumberAddOn(campaign);
        const campaignStorageAddOn = getProductStorageAddOn(campaign, region);
        return {
          ...next,
          monthlyBasePrice: next.monthlyBasePrice || z(campaign.base.monthlyBasePrice),
          includedContacts: next.includedContacts || (zero ? "" : campaign.base.includedContacts),
          numberCount: "0",
          numberRate: "0",
          additionalNumbersEnabled: false,
          additionalNumberCount: "0",
          additionalNumberRate: "0",
          additionalStorageCount:
            next.additionalStorageCount || campaignStorageAddOn.defaultCount || "0",
          additionalStorageRate:
            next.additionalStorageRate || z(campaignStorageAddOn.defaultRate || "0"),
        };
      }
      return { ...next, monthlyBasePrice: "", includedContacts: "" };

    case "channelsEnabled":
      if (enabled) {
        const ch = campaign.channels;
        return {
          ...next,
          emailCount: next.emailCount || (zero ? "" : ch.email.defaultCount),
          emailRate: next.emailRate || z(ch.email.rate),
          smsCount: next.smsCount || (zero ? "" : ch.sms.defaultCount),
          smsRate: next.smsRate || z(ch.sms.rate),
          whatsappCredits: next.whatsappCredits || (zero ? "" : ch.whatsapp.defaultCount),
          whatsappRate: next.whatsappRate || z(ch.whatsapp.rate),
          webPushSubscribers: next.webPushSubscribers || (zero ? "" : ch.webPush.defaultCount),
          webPushRate: next.webPushRate || z(ch.webPush.rate),
          appPushSubscribers: next.appPushSubscribers || (zero ? "" : ch.appPush.defaultCount),
          appPushRate: next.appPushRate || z(ch.appPush.rate),
          inAppSubscribers: next.inAppSubscribers || (zero ? "" : ch.inApp?.defaultCount),
          inAppRate: next.inAppRate || z(ch.inApp?.rate || "0"),
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
        const valueStorageAddOn = getProductStorageAddOn(valueMgmt, region);
        return {
          ...next,
          monthlyBasePrice: next.monthlyBasePrice || z(valueMgmt.base.monthlyBasePrice),
          monthlyActiveUsers: next.monthlyActiveUsers || (zero ? "" : valueMgmt.base.monthlyActiveUsers),
          additionalStorageCount:
            next.additionalStorageCount || valueStorageAddOn.defaultCount || "0",
          additionalStorageRate:
            next.additionalStorageRate || z(valueStorageAddOn.defaultRate || "0"),
        };
      }
      return { ...next, monthlyBasePrice: "", monthlyActiveUsers: "" };

    case "implementationEnabled":
      if (config.implementationPurchased) {
        return { ...config, implementationEnabled: false };
      }
      if (enabled) {
        if ("implementationCost" in next) {
          return {
            ...next,
            implementationCost: next.implementationCost || (zero ? "" : crm.implementationFee),
          };
        }
        const productId = next.productId || config.productId || "";
        const catalogFee = zero
          ? ""
          : productId === "contact-center"
            ? getContactCenterPlanImplementationFee(cc, next.licenseTier || config.licenseTier)
            : productId === "cdp"
              ? cdp.implementationFee
              : productId === "campaign"
                ? campaign.implementationFee
                : productId === "ticketing"
                  ? ticketing.implementationFee
                  : valueMgmt.implementationFee;
        return {
          ...next,
          implementationFee: next.implementationFee || catalogFee || "",
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

function emptyCcaasUsageDetails() {
  const details = createDefaultUsageDetails();
  for (const key of Object.keys(details)) {
    details[key] = "";
  }
  return details;
}

export function createCcaasInitialConfigFromCatalog(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  const contactCenter = getCatalog(region).products?.["contact-center"] || {};
  const telco = zero ? "0" : contactCenter.liveAgent?.telcoLineCharge || "0";
  return {
    productId: product.id,
    pricingMode: "ccaas",
    licenseTier: "",
    modules: {},
    usageDetails: zero ? emptyCcaasUsageDetails() : createDefaultUsageDetails(),
    addons: createDefaultCcaasAddons(),
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    telcoLineCharge: telco,
    includedNumberCount: 1,
    queueCapacityCount: 0,
    queueCapacityRate: "",
    queueCapacityEnabled: false,
    totalNumberEntitlement: 1,
    implementationEnabled: false,
    implementationFee: "",
    implementationDiscountType: "percentage",
    implementationDiscountValue: "",
    addonDiscountType: "percentage",
    addonDiscountValue: "",
    discountType: "percentage",
    discountValue: "",
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

export function createCrmInitialConfigFromCatalog(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const crm = getCatalog(region).products.crm;
  const numberAddOn = getProductNumberAddOn(crm);
  const storageAddOn = getProductStorageAddOn(crm, region);
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  return {
    productId: product.id,
    pricingMode: "crm",
    usersEnabled: true,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationCost: "",
    implementationDiscountType: "percentage",
    implementationDiscountValue: "",
    addonDiscountType: "percentage",
    addonDiscountValue: "",
    userCount: zero ? "" : "1",
    userLicenseRate: zero ? "0" : crm.base.userLicenseRate,
    includedContacts: zero ? "" : crm.base.includedContacts,
    numberCount: zero ? "" : crm.base.numberCount || "0",
    numberRate: zero ? "0" : crm.base.numberRate || "0",
    additionalUsersEnabled: false,
    additionalUserCount: "",
    additionalUserLicenseRate: zero
      ? "0"
      : crm.additionalUserLicenseRate || crm.base.userLicenseRate || "",
    additionalNumbersEnabled: false,
    additionalNumberCount: zero ? "" : numberAddOn.defaultCount || "0",
    additionalNumberRate: zero ? "0" : numberAddOn.defaultRate || "0",
    additionalStorageEnabled: false,
    additionalStorageCount: zero ? "" : storageAddOn.defaultCount || "0",
    additionalStorageRate: zero ? "0" : storageAddOn.defaultRate || "0",
    additionalContactsEnabled: false,
    additionalContactSlab: "",
    discountType: "percentage",
    discountValue: "",
    pricingNotes: zero ? "" : product.notes.join("\n"),
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

export function createCdpInitialConfigFromCatalog(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const cdp = getCatalog(region).products.cdp;
  const storageAddOn = getProductStorageAddOn(cdp, region);
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  return {
    productId: product.id,
    pricingMode: "cdp",
    platformEnabled: true,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationFee: "",
    implementationDiscountType: "percentage",
    implementationDiscountValue: "",
    addonDiscountType: "percentage",
    addonDiscountValue: "",
    monthlyBasePrice: zero ? "0" : cdp.base.monthlyBasePrice || "",
    customerProfiles: zero ? "" : cdp.base.customerProfiles || "",
    additionalContactsEnabled: false,
    additionalContactSlab: "",
    additionalStorageEnabled: false,
    additionalStorageCount: zero ? "" : storageAddOn.defaultCount || "0",
    additionalStorageRate: zero ? "0" : storageAddOn.defaultRate || "0",
    pricingNotes: "Charges depend on customer profiles.",
    discountType: "percentage",
    discountValue: "",
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

export function createCampaignInitialConfigFromCatalog(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const campaign = getCatalog(region).products.campaign;
  const ch = campaign.channels;
  // const numberAddOn = getProductNumberAddOn(campaign);
  const storageAddOn = getProductStorageAddOn(campaign, region);
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  return {
    productId: product.id,
    pricingMode: "campaign",
    basePlanEnabled: true,
    channelsEnabled: false,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationFee: "",
    implementationDiscountType: "percentage",
    implementationDiscountValue: "",
    addonDiscountType: "percentage",
    addonDiscountValue: "",
    monthlyBasePrice: zero ? "0" : campaign.base.monthlyBasePrice || "",
    includedContacts: zero ? "" : campaign.base.includedContacts || "",
    // Campaign numbers removed — force zero / unused.
    numberCount: "0",
    numberRate: "0",
    emailCount: "",
    emailRate: zero ? "0" : ch.email.rate,
    smsCount: "",
    smsRate: zero ? "0" : ch.sms.rate,
    whatsappCredits: "",
    whatsappRate: zero ? "0" : ch.whatsapp.rate,
    webPushSubscribers: "",
    webPushRate: zero ? "0" : ch.webPush.rate,
    appPushSubscribers: "",
    appPushRate: zero ? "0" : ch.appPush.rate,
    inAppSubscribers: "",
    inAppRate: zero ? "0" : ch.inApp?.rate || "0",
    additionalNumbersEnabled: false,
    additionalNumberCount: "0",
    additionalNumberRate: "0",
    additionalStorageEnabled: false,
    additionalStorageCount: zero ? "" : storageAddOn.defaultCount || "0",
    additionalStorageRate: zero ? "0" : storageAddOn.defaultRate || "0",
    additionalContactsEnabled: false,
    additionalContactSlab: zero ? "" : "500",
    discountType: "percentage",
    discountValue: "",
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

export function createValueManagementInitialConfigFromCatalog(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const valueMgmt = getCatalog(region).products["value-management"];
  const storageAddOn = getProductStorageAddOn(valueMgmt, region);
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  return {
    productId: product.id,
    pricingMode: "value-management",
    subscriptionEnabled: true,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationFee: "",
    implementationDiscountType: "percentage",
    implementationDiscountValue: "",
    addonDiscountType: "percentage",
    addonDiscountValue: "",
    monthlyBasePrice: zero ? "0" : valueMgmt.base.monthlyBasePrice || "",
    monthlyActiveUsers: zero ? "" : valueMgmt.base.monthlyActiveUsers || "",
    additionalContactsEnabled: false,
    additionalContactSlab: "",
    additionalStorageEnabled: false,
    additionalStorageCount: zero ? "" : storageAddOn.defaultCount || "0",
    additionalStorageRate: zero ? "0" : storageAddOn.defaultRate || "0",
    discountType: "percentage",
    discountValue: "",
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

export function createTicketingInitialConfigFromCatalog(product, region = "India", { zeroCatalogDefaults = false } = {}) {
  const ticketing = getCatalog(region).products.ticketing;
  const storageAddOn = getProductStorageAddOn(ticketing, region);
  const regionDefaults = getRegionDefaults(region);
  const zero = Boolean(zeroCatalogDefaults);
  return {
    productId: product.id,
    pricingMode: "ticketing",
    usersEnabled: true,
    implementationEnabled: false,
    billingCycle: "monthly",
    region,
    currency: regionDefaults.currency,
    taxLabel: regionDefaults.taxLabel,
    implementationFee: "",
    implementationDiscountType: "percentage",
    implementationDiscountValue: "",
    addonDiscountType: "percentage",
    addonDiscountValue: "",
    userCount: zero ? "" : "1",
    userLicenseRate: zero ? "0" : ticketing.base.userLicenseRate,
    includedTickets: zero ? "" : ticketing.base.includedTickets,
    includedTicketRate: zero ? "0" : ticketing.base.includedTicketRate,
    additionalUsersEnabled: false,
    additionalUserCount: "",
    additionalTicketsEnabled: false,
    additionalTicketSlab: "",
    additionalStorageEnabled: false,
    additionalStorageCount: zero ? "" : storageAddOn.defaultCount || "0",
    additionalStorageRate: zero ? "0" : storageAddOn.defaultRate || "0",
    discountType: "percentage",
    discountValue: "",
    zeroCatalogDefaults: zero,
    skipInvoiceProration: zero,
    proratedBilling: !zero,
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  };
}

export function createInitialConfigFromCatalog(product, region = "India", options = {}) {
  const factories = {
    "contact-center": createCcaasInitialConfigFromCatalog,
    crm: createCrmInitialConfigFromCatalog,
    cdp: createCdpInitialConfigFromCatalog,
    campaign: createCampaignInitialConfigFromCatalog,
    "value-management": createValueManagementInitialConfigFromCatalog,
    ticketing: createTicketingInitialConfigFromCatalog,
  };

  return factories[product.id]?.(product, region, options) ?? null;
}
