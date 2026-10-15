import { getCachedPricingCatalog } from "./pricingCatalog.js";

export const PRODUCT_CATALOG = [
  {
    id: "contact-center",
    name: "AI - Native Contact Center as a Service",
  },
  {
    id: "crm",
    name: "AI Native CRM",
  },
  {
    id: "cdp",
    name: "Cognitive Customer Data Platform (CDP)",
  },
  {
    id: "campaign",
    name: "AI Native Campaign Management",
  },
  {
    id: "value-management",
    name: "AI Native Customer Value Management",
  },
  {
    id: "ticketing",
    name: "AI Native Ticketing System",
  },
];

export function getProductName(productId: any) {
  const catalogLabel = getCachedPricingCatalog().products?.[productId]?.label;
  if (String(catalogLabel || "").trim()) {
    return String(catalogLabel).trim();
  }

  return PRODUCT_CATALOG.find((entry: any) => entry.id === productId)?.name || productId;
}
