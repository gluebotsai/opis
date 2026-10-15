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

/** Products that may be tagged on Email channel configs (CCaaS + Campaign only). */
export const EMAIL_CHANNEL_PRODUCT_IDS = ["contact-center", "campaign"];

export function getProductName(productId) {
  return PRODUCT_CATALOG.find((entry) => entry.id === productId)?.name || productId;
}

/** Catalog entries for products the customer currently has active/purchased. */
export function getPurchasedProductCatalog(activeProducts = []) {
  const purchasedIds = new Set(
    (Array.isArray(activeProducts) ? activeProducts : [])
      .map((entry) => entry?.productId)
      .filter(Boolean),
  );
  return PRODUCT_CATALOG.filter((product) => purchasedIds.has(product.id));
}

/** Purchased products eligible for Email channel configuration. */
export function getEmailEligibleProductCatalog(activeProducts = []) {
  const allow = new Set(EMAIL_CHANNEL_PRODUCT_IDS);
  return getPurchasedProductCatalog(activeProducts).filter((product) => allow.has(product.id));
}
