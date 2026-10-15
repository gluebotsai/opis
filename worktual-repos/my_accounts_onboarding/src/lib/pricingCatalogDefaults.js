import {
  buildDefaultLicenseTiers,
  buildDefaultModuleCatalogPrices,
  buildDefaultModulePlanPricing,
} from "./ccaasModules.js";
import {
  buildDefaultContactCenterAddons,
  buildDefaultTierAgentRates,
  migrateContactCenterProduct,
} from "./contactCenterAddons.js";
import { buildDefaultTierDefaultVolumes } from "./ccaasConfiguration.js";
import { buildDefaultPlanModules, migratePlanModules } from "./planModules.js";

export const PRICING_CATALOG_VERSION = 2;

const SHARED_DEFAULTS = {
  contactSlabs: {
    500: { contacts: "500", monthlyPrice: "750", perContactRate: "1.50" },
    1000: { contacts: "1000", monthlyPrice: "1400", perContactRate: "1.40" },
    2500: { contacts: "2500", monthlyPrice: "3000", perContactRate: "1.20" },
    5000: { contacts: "5000", monthlyPrice: "5000", perContactRate: "1.00" },
    10000: { contacts: "10000", monthlyPrice: "8500", perContactRate: "0.85" },
    15000: { contacts: "15000", monthlyPrice: "10500", perContactRate: "0.70" },
    25000: { contacts: "25000", monthlyPrice: "22500", perContactRate: "0.90" },
    50000: { contacts: "50000", monthlyPrice: "40000", perContactRate: "0.80" },
  },
  ticketSlabs: {
    1000: { tickets: "1000", monthlyPrice: "12000", perTicketRate: "12" },
    5000: { tickets: "5000", monthlyPrice: "50000", perTicketRate: "10" },
    10000: { tickets: "10000", monthlyPrice: "90000", perTicketRate: "9" },
  },
};

function buildContactCenterDefaults(region = "India") {
  return migrateContactCenterProduct({
    label: "AI - Native Contact Center as a Service",
    modules: buildDefaultModuleCatalogPrices(),
    licenseTiers: buildDefaultLicenseTiers(region),
    modulePlanPricing: buildDefaultModulePlanPricing(region),
    tierDefaultVolumes: buildDefaultTierDefaultVolumes(),
    tierAgentRates: buildDefaultTierAgentRates(),
    planModules: buildDefaultPlanModules(),
    addons: buildDefaultContactCenterAddons(),
    voice: {
      includedMinutes: "3000",
      basePrice: "50000",
      languageSetupFee: "20000",
    },
    chatbot: {
      minimumSessions: "300",
      minimumMonthlyPrice: "10000",
      minimumPerSessionRate: "33.30",
      additionalSessionRate: "30",
      bundles: {
        300: { monthlyPrice: "10000", perSessionRate: "33.30", additionalSessionRate: "30" },
        1000: { monthlyPrice: "27000", perSessionRate: "27.00", additionalSessionRate: "25" },
        2500: { monthlyPrice: "50000", perSessionRate: "20.00", additionalSessionRate: "10" },
        3000: { monthlyPrice: "60000", perSessionRate: "20.00", additionalSessionRate: "20" },
      },
    },
    liveAgent: {
      defaultCount: "1",
      rate: "9000",
      telcoLineCharge: "840",
      additionalAgentRate: "2000",
    },
    additionalMinutePlans: {
      1000: { label: "1000-minute bundle", rate: "8000" },
      2000: { label: "2000-minute bundle", rate: "14000" },
    },
  });
}

const BASE_PRODUCTS = {
  "contact-center": buildContactCenterDefaults("India"),
  crm: {
    label: "AI Native CRM",
    base: {
      userLicenseRate: "15000",
      includedContacts: "10000",
    },
    implementationFee: "500000",
  },
  cdp: {
    label: "Cognitive Customer Data Platform (CDP)",
    base: {
      monthlyBasePrice: "7650000",
      customerProfiles: "10000",
      dataSources: "1",
    },
  },
  campaign: {
    label: "AI Native Campaign Management",
    base: {
      monthlyBasePrice: "35000",
      includedContacts: "50000",
    },
    channels: {
      email: { defaultCount: "1000", rate: "5" },
      sms: { defaultCount: "", rate: "1.06" },
      whatsapp: { defaultCount: "", rate: "5" },
      webPush: { defaultCount: "", rate: "0.44" },
      appPush: { defaultCount: "", rate: "1.23" },
      inApp: { defaultCount: "", rate: "0.44" },
    },
  },
  "value-management": {
    label: "AI Native Customer Value Management",
    base: {
      monthlyBasePrice: "100000",
      monthlyActiveUsers: "10000",
    },
    implementationFee: "560000",
  },
  ticketing: {
    label: "AI Native Ticketing System",
    base: {
      userLicenseRate: "15000",
      includedTickets: "2000",
      includedTicketRate: "7.5",
    },
  },
};

export const DEFAULT_PRICING_CATALOG = {
  version: PRICING_CATALOG_VERSION,
  updatedAt: null,
  updatedBy: null,
  regions: {
    India: { currency: "INR", taxLabel: "GST" },
    UK: { currency: "GBP", taxLabel: "VAT" },
    Dubai: { currency: "AED", taxLabel: "VAT" },
  },
  shared: SHARED_DEFAULTS,
  products: BASE_PRODUCTS,
  regionPricing: {
    India: {
      products: {
        "contact-center": buildContactCenterDefaults("India"),
      },
      shared: SHARED_DEFAULTS,
    },
    UK: {
      products: {
        "contact-center": buildContactCenterDefaults("UK"),
      },
      shared: SHARED_DEFAULTS,
    },
    Dubai: {
      products: {
        "contact-center": buildContactCenterDefaults("Dubai"),
      },
      shared: SHARED_DEFAULTS,
    },
  },
};

export const ADMIN_PRODUCT_ORDER = [
  "contact-center",
  "crm",
  "cdp",
  "campaign",
  "value-management",
  "ticketing",
];

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeCatalog(base, override) {
  if (!override) {
    return structuredClone(base);
  }

  const result = structuredClone(base);

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergeCatalog(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function getRegionPricingSlice(catalog, region) {
  const slice = catalog.regionPricing?.[region];
  if (slice?.products && slice?.shared) {
    return {
      products: slice.products,
      shared: slice.shared,
    };
  }

  return {
    products: catalog.products,
    shared: catalog.shared,
  };
}

export function ensureRegionPricing(catalog) {
  const result = structuredClone(catalog);
  const base = {
    products: result.products,
    shared: result.shared,
  };
  const regionNames = Object.keys(result.regions || { India: {} });
  result.regionPricing = result.regionPricing || {};

  for (const name of regionNames) {
    const existing = result.regionPricing[name];
    const mergedProducts = deepMergeCatalog(base.products, existing?.products || {});

    if (!mergedProducts["contact-center"]?.modulePlanPricing) {
      mergedProducts["contact-center"] = {
        ...mergedProducts["contact-center"],
        licenseTiers: buildDefaultLicenseTiers(name),
        modulePlanPricing: buildDefaultModulePlanPricing(name),
      };
    }

    if (!mergedProducts["contact-center"]?.tierDefaultVolumes) {
      mergedProducts["contact-center"] = {
        ...mergedProducts["contact-center"],
        tierDefaultVolumes: buildDefaultTierDefaultVolumes(),
      };
    }

    if (!mergedProducts["contact-center"]?.planModules) {
      mergedProducts["contact-center"] = {
        ...mergedProducts["contact-center"],
        planModules: buildDefaultPlanModules(),
      };
    }

    mergedProducts["contact-center"] = migrateContactCenterProduct(mergedProducts["contact-center"] || {});

    result.regionPricing[name] = {
      products: mergedProducts,
      shared: deepMergeCatalog(base.shared, existing?.shared || {}),
    };
  }

  return result;
}

export function buildRegionalCatalogView(catalog, region) {
  const slice = getRegionPricingSlice(catalog, region);
  return {
    ...catalog,
    products: slice.products,
    shared: slice.shared,
  };
}
