import { getCachedPricingCatalog } from "./pricingCatalog.js";

export const PRODUCT_CATALOG = [
  {
    id: "contact-center",
    name: "AI - Native Contact Center as a Service",
    shortName: "Contact Center",
  },
  {
    id: "crm",
    name: "AI Native CRM",
    shortName: "CRM",
  },
  {
    id: "cdp",
    name: "Cognitive Customer Data Platform (CDP)",
    shortName: "CDP",
  },
  {
    id: "campaign",
    name: "AI Native Campaign Management",
    shortName: "Campaign",
  },
  {
    id: "value-management",
    name: "AI Native Customer Value Management",
    shortName: "Value Management",
  },
  {
    id: "ticketing",
    name: "AI Native Ticketing System",
    shortName: "Ticketing",
  },
];

export function getProductName(productId) {
  const catalogLabel = getCachedPricingCatalog().products?.[productId]?.label;
  if (String(catalogLabel || "").trim()) {
    return String(catalogLabel).trim();
  }

  return PRODUCT_CATALOG.find((entry) => entry.id === productId)?.name || productId;
}

/** Compact display label for tables/chips (CRM, Contact Center, …). */
export function getProductLabel(productId) {
  const id = String(productId || "").trim();
  if (!id) {
    return "";
  }

  return PRODUCT_CATALOG.find((entry) => entry.id === id)?.shortName || getProductName(id);
}
