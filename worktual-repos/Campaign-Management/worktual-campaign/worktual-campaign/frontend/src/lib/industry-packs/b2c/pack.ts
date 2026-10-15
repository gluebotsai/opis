import type { IndustryPack } from "../types";

/** Generic B2C pack — customers, no company/job title; vertical from industry_type. */
export const B2C_PACK: IndustryPack = {
  id: "generic-b2c",
  mode: "b2c",
  label: "Generic B2C",
  modules: { hide: [] },
  labels: {
    audience: "Customers",
    create_campaign: "Create campaign",
  },
  descriptions: {
    audience: "Customers for consumer campaigns.",
    create_campaign:
      "Consumer campaign workspace for your customer audience.",
  },
  contactExtraFields: [
    { key: "segment", label: "customer segment", ask: "recommended" },
    { key: "product_interest", label: "product interest", ask: "recommended" },
  ],
};
