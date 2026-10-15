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

export const DEFAULT_CONTACT_SLABS = {
  500: { contacts: "500", monthlyPrice: "750", perContactRate: "1.50" },
  1000: { contacts: "1000", monthlyPrice: "1400", perContactRate: "1.40" },
  2500: { contacts: "2500", monthlyPrice: "3000", perContactRate: "1.20" },
  5000: { contacts: "5000", monthlyPrice: "5000", perContactRate: "1.00" },
  10000: { contacts: "10000", monthlyPrice: "8500", perContactRate: "0.85" },
  15000: { contacts: "15000", monthlyPrice: "10500", perContactRate: "0.70" },
  25000: { contacts: "25000", monthlyPrice: "22500", perContactRate: "0.90" },
  50000: { contacts: "50000", monthlyPrice: "40000", perContactRate: "0.80" },
};

export const DEFAULT_NUMBER_ADDON = {
  enabled: true,
  label: "Additional numbers",
  defaultCount: "0",
  defaultRate: "0",
};

/** Per-GB Add-On Storage defaults by catalog region (admin-editable). */
export const STORAGE_ADDON_RATES_BY_REGION: Record<string, string> = {
  India: "3000",
  UK: "30",
  Dubai: "110",
};

export const DEFAULT_STORAGE_ADDON = {
  enabled: true,
  label: "Add-On Storage",
  unit: "GB",
  defaultCount: "0",
  defaultRate: STORAGE_ADDON_RATES_BY_REGION.India,
};

export function buildStorageAddOn(region: any = "India") {
  const regionName = String(region || "India");
  return {
    enabled: true,
    label: DEFAULT_STORAGE_ADDON.label,
    unit: DEFAULT_STORAGE_ADDON.unit,
    defaultCount: DEFAULT_STORAGE_ADDON.defaultCount,
    defaultRate: STORAGE_ADDON_RATES_BY_REGION[regionName] || DEFAULT_STORAGE_ADDON.defaultRate,
  };
}

/** Normalize per-product storageAddOn with region-aware defaults. */
export function getProductStorageAddOn(product: any, region: any = "India") {
  const defaults = buildStorageAddOn(region);
  const addon = product?.storageAddOn && typeof product.storageAddOn === "object" ? product.storageAddOn : {};
  return {
    enabled: addon.enabled !== false,
    label: addon.label || defaults.label,
    unit: addon.unit || defaults.unit,
    defaultCount:
      addon.defaultCount != null && addon.defaultCount !== ""
        ? String(addon.defaultCount)
        : defaults.defaultCount,
    defaultRate:
      addon.defaultRate != null && addon.defaultRate !== ""
        ? String(addon.defaultRate)
        : defaults.defaultRate,
  };
}

function regionalStorageProductPatches(region: any = "India") {
  const storageAddOn = buildStorageAddOn(region);
  return {
    crm: { storageAddOn },
    cdp: { storageAddOn },
    campaign: { storageAddOn },
    "value-management": { storageAddOn },
    ticketing: { storageAddOn },
  };
}

/** Normalize CRM/Campaign catalog numberAddOn with defaults. */
export function getProductNumberAddOn(product: any) {
  const addon = product?.numberAddOn && typeof product.numberAddOn === "object" ? product.numberAddOn : {};
  return {
    enabled: addon.enabled !== false,
    label: addon.label || DEFAULT_NUMBER_ADDON.label,
    defaultCount:
      addon.defaultCount != null && addon.defaultCount !== ""
        ? String(addon.defaultCount)
        : DEFAULT_NUMBER_ADDON.defaultCount,
    defaultRate:
      addon.defaultRate != null && addon.defaultRate !== ""
        ? String(addon.defaultRate)
        : DEFAULT_NUMBER_ADDON.defaultRate,
  };
}

export const DEFAULT_TICKET_SLABS = {
  1000: { tickets: "1000", monthlyPrice: "12000", perTicketRate: "12" },
  5000: { tickets: "5000", monthlyPrice: "50000", perTicketRate: "10" },
  10000: { tickets: "10000", monthlyPrice: "90000", perTicketRate: "9" },
};

const CONTACT_SLAB_PRODUCT_IDS = ["crm", "campaign", "cdp", "value-management"];

/** Legacy placeholder so regional merge still has a shared object. */
const SHARED_DEFAULTS: Record<string, any> = {};

function buildContactCenterDefaults(region: any = "India") {
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
    storageAddOn: buildStorageAddOn(region),
  });
}

const BASE_PRODUCTS = {
  "contact-center": buildContactCenterDefaults("India"),
  crm: {
    label: "AI Native CRM",
    base: {
      userLicenseRate: "15000",
      includedContacts: "10000",
      numberCount: "0",
      numberRate: "0",
    },
    implementationFee: "500000",
    additionalUserLicenseRate: "15000",
    numberAddOn: {
      enabled: true,
      label: "Additional numbers",
      defaultCount: "0",
      defaultRate: "0",
    },
    storageAddOn: buildStorageAddOn("India"),
    contactSlabs: structuredClone(DEFAULT_CONTACT_SLABS),
  },
  cdp: {
    label: "Cognitive Customer Data Platform (CDP)",
    base: {
      monthlyBasePrice: "7650000",
      customerProfiles: "10000",
    },
    implementationFee: "",
    storageAddOn: buildStorageAddOn("India"),
    contactSlabs: structuredClone(DEFAULT_CONTACT_SLABS),
  },
  campaign: {
    label: "AI Native Campaign Management",
    base: {
      monthlyBasePrice: "35000",
      includedContacts: "50000",
      // Campaign numbers removed — messaging channel packs only.
      // numberCount: "0",
      // numberRate: "0",
    },
    implementationFee: "",
    // numberAddOn: {
    //   enabled: true,
    //   label: "Additional numbers",
    //   defaultCount: "0",
    //   defaultRate: "0",
    // },
    storageAddOn: buildStorageAddOn("India"),
    channels: {
      email: { defaultCount: "1000", rate: "5" },
      sms: { defaultCount: "", rate: "1.06" },
      whatsapp: { defaultCount: "1000", rate: "5" },
      webPush: { defaultCount: "", rate: "0.44" },
      appPush: { defaultCount: "", rate: "1.23" },
    },
    contactSlabs: structuredClone(DEFAULT_CONTACT_SLABS),
  },
  "value-management": {
    label: "AI Native Customer Value Management",
    base: {
      monthlyBasePrice: "100000",
      monthlyActiveUsers: "10000",
    },
    implementationFee: "560000",
    storageAddOn: buildStorageAddOn("India"),
    contactSlabs: structuredClone(DEFAULT_CONTACT_SLABS),
  },
  ticketing: {
    label: "AI Native Ticketing System",
    base: {
      userLicenseRate: "15000",
      includedTickets: "2000",
      includedTicketRate: "7.5",
    },
    implementationFee: "",
    storageAddOn: buildStorageAddOn("India"),
    ticketSlabs: structuredClone(DEFAULT_TICKET_SLABS),
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
        ...regionalStorageProductPatches("India"),
      },
      shared: SHARED_DEFAULTS,
    },
    UK: {
      products: {
        "contact-center": buildContactCenterDefaults("UK"),
        ...regionalStorageProductPatches("UK"),
      },
      shared: SHARED_DEFAULTS,
    },
    Dubai: {
      products: {
        "contact-center": buildContactCenterDefaults("Dubai"),
        ...regionalStorageProductPatches("Dubai"),
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

function isPlainObject(value: any) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasSlabEntries(slabs: any) {
  return isPlainObject(slabs) && Object.keys(slabs).length > 0;
}

/** Seed missing storageAddOn on every product for the active region. */
function ensureProductStorageAddOns(products: any, region: any) {
  if (!isPlainObject(products)) {
    return products;
  }
  const next = { ...products };
  const defaults = buildStorageAddOn(region);
  for (const productId of ADMIN_PRODUCT_ORDER) {
    const product = next[productId];
    if (!isPlainObject(product)) {
      continue;
    }
    if (!isPlainObject(product.storageAddOn)) {
      next[productId] = { ...product, storageAddOn: { ...defaults } };
      continue;
    }
    const rate = product.storageAddOn.defaultRate;
    if (rate == null || rate === "") {
      next[productId] = {
        ...product,
        storageAddOn: getProductStorageAddOn(product, region),
      };
    }
  }
  return next;
}

function migrateProductsVolumeSlabs(products: any, shared: any) {
  if (!isPlainObject(products)) {
    return products;
  }

  const next = { ...products };
  const legacyContacts = shared?.contactSlabs;
  const legacyTickets = shared?.ticketSlabs;

  for (const productId of CONTACT_SLAB_PRODUCT_IDS) {
    const product = next[productId];
    if (!isPlainObject(product)) {
      continue;
    }

    if (!hasSlabEntries(product.contactSlabs) && hasSlabEntries(legacyContacts)) {
      next[productId] = {
        ...product,
        contactSlabs: structuredClone(legacyContacts),
      };
    } else if (!hasSlabEntries(product.contactSlabs)) {
      next[productId] = {
        ...product,
        contactSlabs: structuredClone(DEFAULT_CONTACT_SLABS),
      };
    }
  }

  const ticketing = next.ticketing;
  if (isPlainObject(ticketing)) {
    if (!hasSlabEntries(ticketing.ticketSlabs) && hasSlabEntries(legacyTickets)) {
      next.ticketing = {
        ...ticketing,
        ticketSlabs: structuredClone(legacyTickets),
      };
    } else if (!hasSlabEntries(ticketing.ticketSlabs)) {
      next.ticketing = {
        ...ticketing,
        ticketSlabs: structuredClone(DEFAULT_TICKET_SLABS),
      };
    }
  }

  return next;
}

/**
 * Copy legacy shared contact/ticket slabs onto per-product fields before defaults merge.
 * Preserves customized shared tables on older catalogs.
 */
export function migrateSharedSlabsOntoProducts(catalog: any) {
  if (!isPlainObject(catalog)) {
    return catalog;
  }

  const result = structuredClone(catalog);
  result.products = migrateProductsVolumeSlabs(result.products, result.shared);

  if (isPlainObject(result.regionPricing)) {
    for (const [regionName, slice] of Object.entries(result.regionPricing)) {
      if (!isPlainObject(slice)) {
        continue;
      }

      result.regionPricing[regionName] = {
        ...(slice as Record<string, unknown>),
        products: migrateProductsVolumeSlabs((slice as any).products, (slice as any).shared || result.shared),
        shared: isPlainObject((slice as any).shared) ? (slice as any).shared : {},
      };
    }
  }

  if (!isPlainObject(result.shared)) {
    result.shared = {};
  }

  return result;
}

export function deepMergeCatalog(base: any, override: any) {
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

export function getRegionPricingSlice(catalog: any, region: any) {
  const slice = catalog.regionPricing?.[region];
  if (slice?.products && slice.shared != null) {
    return {
      products: slice.products,
      shared: slice.shared,
    };
  }

  return {
    products: catalog.products,
    shared: catalog.shared || {},
  };
}

export function ensureRegionPricing(catalog: any) {
  const migrated = migrateSharedSlabsOntoProducts(catalog);
  const result = structuredClone(migrated);
  const base = {
    products: result.products,
    shared: result.shared || {},
  };
  const regionNames = Object.keys(result.regions || { India: {} });
  result.regionPricing = result.regionPricing || {};

  for (const name of regionNames) {
    const existing = result.regionPricing[name];
    let mergedProducts = deepMergeCatalog(base.products, existing?.products || {});
    mergedProducts = migrateProductsVolumeSlabs(mergedProducts, existing?.shared || base.shared);

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
    mergedProducts = ensureProductStorageAddOns(mergedProducts, name);

    result.regionPricing[name] = {
      products: mergedProducts,
      shared: deepMergeCatalog(base.shared, existing?.shared || {}),
    };
  }

  result.products = ensureProductStorageAddOns(
    migrateProductsVolumeSlabs(result.products, result.shared),
    "India",
  );
  result.shared = result.shared || {};

  return result;
}

export function buildRegionalCatalogView(catalog: any, region: any) {
  const slice = getRegionPricingSlice(catalog, region);
  return {
    ...catalog,
    products: slice.products,
    shared: slice.shared,
  };
}
